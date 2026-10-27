import QRCode from 'qrcode'
import { base64urlToBytes, bytesToBase64url, parsePairing, pairingCode, type ParsedPairing } from './sync'

/*
 * Recovery kit: your sync key, locked with a password you choose, so it is safe to email to
 * yourself or keep in cloud storage. If every device is wiped, scanning the kit (or opening its
 * link) and entering the password links a fresh device and downloads everything again.
 *
 * Format: mtrk1.<salt>.<iv+ciphertext>  (base64url). PBKDF2-SHA256, 600k iterations → AES-GCM.
 * The password is never stored or sent anywhere.
 */

const PREFIX = 'mtrk1'
const ITERATIONS = 600_000

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

function random(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export async function sealKit(pairing: ParsedPairing, password: string): Promise<string> {
  const salt = random(16)
  const iv = random(12)
  const key = await deriveKey(password, salt)
  const payload = new TextEncoder().encode(JSON.stringify({ c: pairingCode(pairing), s: pairing.server }))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload))
  const body = new Uint8Array(iv.length + cipher.length)
  body.set(iv)
  body.set(cipher, iv.length)
  return `${PREFIX}.${bytesToBase64url(salt)}.${bytesToBase64url(body)}`
}

export class WrongPasswordError extends Error {
  constructor() {
    super('That password doesn’t open this recovery kit.')
  }
}

export async function openKit(kit: string, password: string): Promise<ParsedPairing> {
  const [prefix, saltB64, bodyB64] = kit.split('.')
  if (prefix !== PREFIX || !saltB64 || !bodyB64) throw new Error('That is not a Monetr recovery kit.')
  const body = base64urlToBytes(bodyB64)
  const key = await deriveKey(password, base64urlToBytes(saltB64))
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: body.subarray(0, 12) }, key, body.subarray(12))
  } catch {
    throw new WrongPasswordError()
  }
  const { c, s } = JSON.parse(new TextDecoder().decode(plain)) as { c: string; s?: string }
  const parsed = parsePairing(c)
  if (!parsed) throw new Error('This recovery kit is damaged.')
  return { ...parsed, server: s ?? parsed.server }
}

/** A recovery kit from raw text, a `#/link?kit=…` URL, or a scanned QR. */
export function parseKit(input: string): string | null {
  const text = input.trim()
  const m = text.match(/[?&]kit=([^&#\s]+)/)
  const kit = m ? decodeURIComponent(m[1]) : text
  return /^mtrk1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{40,}$/.test(kit) ? kit : null
}

export function kitUrl(kit: string): string {
  return `${location.origin}${location.pathname}#/link?kit=${encodeURIComponent(kit)}`
}

/** A printable / shareable card: QR (opens the restore link), the code as text, and how to use it. */
export async function drawKitImage(kit: string, createdAt: Date = new Date()): Promise<HTMLCanvasElement> {
  const W = 1080
  const H = 1400
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Arial, sans-serif'
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = '#15161C'
  ctx.font = `800 56px ${FONT}`
  ctx.fillText('Monetr recovery kit', 80, 130)
  ctx.fillStyle = '#6B7280'
  ctx.font = `500 30px ${FONT}`
  ctx.fillText(`Created ${createdAt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`, 80, 180)

  const qr = await QRCode.toDataURL(kitUrl(kit), { width: 620, margin: 1, errorCorrectionLevel: 'M' })
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = qr
  })
  ctx.drawImage(img, (W - 620) / 2, 240, 620, 620)

  ctx.fillStyle = '#15161C'
  ctx.font = `700 32px ${FONT}`
  ctx.fillText('To restore on a new or wiped device', 80, 950)
  ctx.fillStyle = '#374151'
  ctx.font = `500 28px ${FONT}`
  const steps = [
    '1. Scan this QR with the phone camera (or open the Monetr site',
    '    → Settings → Cloud sync → paste the code below).',
    '2. Enter the recovery password you chose. It is not on this page.',
    '3. Monetr downloads all your data from your encrypted sync.',
  ]
  steps.forEach((line, i) => ctx.fillText(line, 80, 1000 + i * 42))

  ctx.fillStyle = '#6B7280'
  ctx.font = `600 22px ui-monospace, SFMono-Regular, Menlo, monospace`
  const perLine = 52
  const lines = kit.match(new RegExp(`.{1,${perLine}}`, 'g')) ?? [kit]
  lines.slice(0, 6).forEach((l, i) => ctx.fillText(l, 80, 1175 + i * 30))

  ctx.fillStyle = '#B45309'
  ctx.font = `600 24px ${FONT}`
  ctx.fillText('Keep the password separate from this kit. Without it, the kit can’t be opened.', 80, H - 40)
  return canvas
}
