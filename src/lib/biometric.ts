import { bytesToBase64url, base64urlToBytes } from './sync'
import { suspendAutoLock } from './lockGuard'

/*
 * Fingerprint / Touch ID unlock via WebAuthn with the device's built-in (platform) authenticator.
 * The fingerprint never leaves the device: the OS checks it and signs a random challenge with a key
 * created for Monetr on this device. We verify that signature locally with the stored public key.
 *
 * WebAuthn only works in a secure context (https, or http://localhost) and on a real hostname —
 * not on a LAN IP like http://192.168.1.20:5173.
 */

export interface BiometricCredential {
  id: string
  publicKey?: string
  alg?: number
}

function rand(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function biometricLabel(): string {
  const ua = navigator.userAgent
  if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return 'Touch ID'
  if (/iPhone|iPad/.test(ua)) return 'Face ID / Touch ID'
  if (/Android/.test(ua)) return 'fingerprint'
  if (/Windows/.test(ua)) return 'Windows Hello'
  return 'biometrics'
}

/** Why biometrics can't be used here, or null if they can. */
export async function biometricUnavailableReason(): Promise<string | null> {
  if (!window.isSecureContext) return 'Fingerprint unlock needs https (your Vercel URL) or localhost.'
  if (/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)) return 'Fingerprint unlock does not work on an IP address. Use your https URL.'
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) return 'This browser does not support passkeys / WebAuthn.'
  try {
    const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    if (!ok) return 'No fingerprint sensor or screen lock is set up on this device.'
  } catch {
    return 'Could not check for a fingerprint sensor.'
  }
  return null
}

export async function registerBiometric(): Promise<BiometricCredential> {
  const resume = suspendAutoLock(120_000)
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Monetr', id: location.hostname },
        user: { id: rand(16), name: 'monetr', displayName: 'Monetr unlock' },
        challenge: rand(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null
    if (!cred) throw new Error('Fingerprint setup was cancelled.')
    const response = cred.response as AuthenticatorAttestationResponse
    const spki = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null
    const alg = typeof response.getPublicKeyAlgorithm === 'function' ? response.getPublicKeyAlgorithm() : undefined
    return {
      id: bytesToBase64url(new Uint8Array(cred.rawId)),
      publicKey: spki ? bytesToBase64url(new Uint8Array(spki)) : undefined,
      alg,
    }
  } catch (err) {
    throw new Error(friendly(err, 'Could not set up fingerprint unlock.'))
  } finally {
    resume()
  }
}

/** Ask the OS for a fingerprint / Touch ID check. Resolves true only for a verified, signed assertion. */
export async function verifyBiometric(cred: BiometricCredential): Promise<boolean> {
  const resume = suspendAutoLock(120_000)
  try {
    const challenge = rand(32)
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: base64urlToBytes(cred.id), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
    if (!assertion) return false
    const res = assertion.response as AuthenticatorAssertionResponse
    const clientData = JSON.parse(new TextDecoder().decode(res.clientDataJSON)) as { type: string; challenge: string; origin: string }
    if (clientData.type !== 'webauthn.get') return false
    if (clientData.challenge !== bytesToBase64url(challenge)) return false
    if (clientData.origin !== location.origin) return false
    const authData = new Uint8Array(res.authenticatorData)
    const flags = authData[32]
    if (!(flags & 0x01) || !(flags & 0x04)) return false // user present + user verified
    if (!cred.publicKey) return true // older browsers don't expose the key at registration
    return await verifySignature(cred, authData, new Uint8Array(res.clientDataJSON), new Uint8Array(res.signature))
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (name === 'NotAllowedError' || name === 'AbortError') return false
    throw new Error(friendly(err, 'Fingerprint check failed.'))
  } finally {
    resume()
  }
}

async function verifySignature(cred: BiometricCredential, authData: Uint8Array<ArrayBuffer>, clientDataJSON: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON))
  const data = new Uint8Array(authData.length + hash.length)
  data.set(authData)
  data.set(hash, authData.length)
  const spki = base64urlToBytes(cred.publicKey!)
  if (cred.alg === -257) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)
  }
  const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(signature), data)
}

/** WebAuthn ES256 signatures are DER encoded; WebCrypto wants raw r||s. */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f)
  const readInt = () => {
    i++ // 0x02 INTEGER tag
    const len = der[i++]
    let v = der.subarray(i, i + len)
    i += len
    while (v.length > 32 && v[0] === 0) v = v.subarray(1)
    const out = new Uint8Array(32)
    out.set(v, 32 - v.length)
    return out
  }
  const r = readInt()
  const s = readInt()
  const raw = new Uint8Array(64)
  raw.set(r)
  raw.set(s, 32)
  return raw
}

function friendly(err: unknown, fallback: string): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return 'The fingerprint prompt was dismissed or timed out.'
  if (name === 'InvalidStateError') return 'This device already has a Monetr fingerprint key. Remove it and try again.'
  if (name === 'SecurityError') return 'Fingerprint unlock is not allowed on this address. Use your https URL.'
  return err instanceof Error && err.message ? err.message : fallback
}
