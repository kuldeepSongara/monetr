import { suspendAutoLock } from './lockGuard'
import { sha256Bytes } from './sha256'
export function uid(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8)
  return `${prefix}${rnd}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1))
}

export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|store|online|payment|purchase|pos|debit|card)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return clamp((part / whole) * 100, 0, 999)
}

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Open the system file picker. Auto-lock is paused while the picker (or camera) is open — on a
 * phone that hides the app, and we don't want to lock you out mid-scan.
 */
export function pickFile(accept: string, capture?: 'environment' | 'user'): Promise<File | null> {
  const resume = suspendAutoLock(5 * 60_000)
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    if (capture) input.setAttribute('capture', capture)
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  }).finally(() => window.setTimeout(resume, 1500))
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  // crypto.subtle only exists on https/localhost; fall back to a JS implementation on plain http (LAN dev).
  const digest = crypto.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', data)) : sha256Bytes(data)
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Pull a JSON value out of an LLM response, tolerating fences and prose. */
export function extractJson<T = unknown>(text: string): T | null {
  const direct = safeJsonParse<T>(text.trim())
  if (direct !== null) return direct

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const parsed = safeJsonParse<T>(fenced[1].trim())
    if (parsed !== null) return parsed
  }

  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = text.indexOf(open)
    const end = text.lastIndexOf(close)
    if (start >= 0 && end > start) {
      const parsed = safeJsonParse<T>(text.slice(start, end + 1))
      if (parsed !== null) return parsed
    }
  }
  return null
}

export function uidDate(): string {
  return new Date().toISOString()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
