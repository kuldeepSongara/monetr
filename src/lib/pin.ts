import { sha256Hex } from './utils'

/**
 * PIN hashes: `pbkdf2$<iterations>$<hex>` when WebCrypto is available (slow to brute-force),
 * otherwise a salted SHA-256 (legacy format, plain hex). Both verify.
 */
const ITERATIONS = 210_000

export async function hashPin(pin: string, salt: string): Promise<string> {
  if (crypto.subtle) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS },
      key,
      256,
    )
    const hex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('')
    return `pbkdf2$${ITERATIONS}$${hex}`
  }
  return sha256Hex(`${salt}:${pin}`)
}

export async function verifyPin(pin: string, salt: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2$')) {
    if (!crypto.subtle) return false
    const iterations = Number(stored.split('$')[1])
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations },
      key,
      256,
    )
    const hex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('')
    return `pbkdf2$${iterations}$${hex}` === stored
  }
  return (await sha256Hex(`${salt}:${pin}`)) === stored
}

/** Wrong-PIN backoff: 5 free tries, then 30s, 1m, 2m … capped at 15 minutes. */
export function lockoutMs(failCount: number): number {
  if (failCount < 5) return 0
  return Math.min(15 * 60_000, 30_000 * 2 ** (failCount - 5))
}
