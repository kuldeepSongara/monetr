import { deflate, inflate } from 'pako'

const SNAPSHOT_KEYS = [
  'settings',
  'categories',
  'transactions',
  'bills',
  'billPayments',
  'budgets',
  'rules',
  'profiles',
] as const

export function generateSyncId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `mtr_${hex}`
}

export function generateDeviceId(): string {
  const key = 'monetr:deviceId'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  localStorage.setItem(key, hex)
  return hex
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function compressSnapshot(obj: unknown): string {
  const json = JSON.stringify(obj)
  const gz = deflate(new TextEncoder().encode(json))
  return bytesToBase64url(gz)
}

export function decompressSnapshot(b64: string): unknown {
  const bytes = base64urlToBytes(b64)
  const ungz = inflate(bytes)
  const json = new TextDecoder().decode(ungz)
  return JSON.parse(json)
}

export function buildSnapshot(data: Record<string, any>) {
  const out: Record<string, any> = { version: 1, exportedAt: new Date().toISOString() }
  for (const key of SNAPSHOT_KEYS) {
    out[key] = data[key] ?? []
  }
  if (data.settings) out.settings = data.settings
  return out
}

export function getSyncState() {
  try {
    const raw = localStorage.getItem('monetr:sync')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setSyncState(state: any) {
  localStorage.setItem('monetr:sync', JSON.stringify(state))
}
