import { deflate, inflate } from 'pako'
import { db, SYNC_TABLES, type SyncTable } from '../db/db'
import { SHARED_SETTING_KEYS, type Settings, type Tombstone } from '../types'

/* -------------------------------------------------------------------------- */
/*  Model                                                                     */
/* -------------------------------------------------------------------------- */
/*
 * Devices are linked by a pairing code: `mtr1.<syncId>.<key>`.
 *  - syncId names the encrypted blob on the server.
 *  - key (256-bit) never leaves your devices. Snapshots are AES-GCM encrypted with it before upload,
 *    and a write token derived from it stops anyone else overwriting your blob.
 * Each sync pulls the cloud copy, merges record by record (newest `updatedAt` wins, deletions are
 * carried as tombstones), writes the result locally and pushes it back with optimistic versioning.
 */

export interface SyncState {
  enabled: boolean
  syncId: string
  key: string
  deviceId: string
  /** Base URL of the sync API. Empty = same origin as the app. */
  server?: string
  /** Sync AI profiles (API keys, still end-to-end encrypted). On unless turned off. */
  includeAiProfiles?: boolean
  version?: number
  lastSyncedAt?: string
  lastError?: string
  fingerprint?: string
  linkedAt: string
}

export interface Snapshot {
  v: 2
  exportedAt: string
  deviceId: string
  settings: { values: Partial<Settings>; updatedAt: string }
  tables: Partial<Record<SyncTable, Record<string, unknown>[]>>
  tombstones: Tombstone[]
}

type Row = Record<string, unknown> & { id: string }

const STATE_KEY = 'monetr:sync'
const PAIR_PREFIX = 'mtr1'
const TOMBSTONE_TTL_DAYS = 180

/* -------------------------------------------------------------------------- */
/*  Encoding helpers                                                          */
/* -------------------------------------------------------------------------- */

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  return bytes
}

export function bytesToBase64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)
  return base64ToBytes(padded)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/* -------------------------------------------------------------------------- */
/*  State + pairing                                                           */
/* -------------------------------------------------------------------------- */

export function getSyncState(): SyncState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SyncState>
    // Pre-encryption sync states (no key) cannot be used any more.
    if (!parsed.syncId || !parsed.key) return null
    return parsed as SyncState
  } catch {
    return null
  }
}

export function setSyncState(state: SyncState | null): void {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state))
    else localStorage.removeItem(STATE_KEY)
  } catch {
    /* storage blocked */
  }
  emit()
}

export function patchSyncState(patch: Partial<SyncState>): SyncState | null {
  const current = getSyncState()
  if (!current) return null
  const next = { ...current, ...patch }
  setSyncState(next)
  return next
}

export function deviceId(): string {
  const k = 'monetr:deviceId'
  try {
    const existing = localStorage.getItem(k)
    if (existing) return existing
    const id = hex(randomBytes(12))
    localStorage.setItem(k, id)
    return id
  } catch {
    return hex(randomBytes(12))
  }
}

export function createSyncState(): SyncState {
  return {
    enabled: true,
    syncId: `mtr_${hex(randomBytes(16))}`,
    key: bytesToBase64url(randomBytes(32)),
    deviceId: deviceId(),
    linkedAt: new Date().toISOString(),
  }
}

export function pairingCode(state: Pick<SyncState, 'syncId' | 'key'>): string {
  return `${PAIR_PREFIX}.${state.syncId}.${state.key}`
}

/** URL that opens Monetr and links the device — works with the phone's own camera app too. */
export function pairingUrl(state: Pick<SyncState, 'syncId' | 'key' | 'server'>): string {
  const base = `${location.origin}${location.pathname}`
  const server = state.server ? `&server=${encodeURIComponent(state.server)}` : ''
  return `${base}#/link?code=${encodeURIComponent(pairingCode(state))}${server}`
}

export interface ParsedPairing {
  syncId: string
  key: string
  server?: string
}

/** Accepts a raw pairing code or any URL that carries one. */
export function parsePairing(input: string): ParsedPairing | null {
  const text = input.trim()
  let code = text
  let server: string | undefined
  const match = text.match(/[?&]code=([^&#\s]+)/)
  if (match) {
    code = decodeURIComponent(match[1])
    const s = text.match(/[?&]server=([^&#\s]+)/)
    if (s) server = decodeURIComponent(s[1])
  }
  const parts = code.split('.')
  if (parts.length !== 3 || parts[0] !== PAIR_PREFIX) return null
  const [, syncId, key] = parts
  if (!/^mtr_[0-9a-f]{32}$/.test(syncId)) return null
  try {
    if (base64urlToBytes(key).length !== 32) return null
  } catch {
    return null
  }
  return { syncId, key, server }
}

export function linkWithPairing(p: ParsedPairing): SyncState {
  const state: SyncState = {
    enabled: true,
    syncId: p.syncId,
    key: p.key,
    server: p.server,
    deviceId: deviceId(),
    linkedAt: new Date().toISOString(),
  }
  setSyncState(state)
  return state
}

/* -------------------------------------------------------------------------- */
/*  Pending link from a scanned QR / opened link                              */
/* -------------------------------------------------------------------------- */

const PENDING_KEY = 'monetr:pendingLink'
const PENDING_KIT_KEY = 'monetr:pendingKit'

/** A recovery kit opened from its QR / link (`#/link?kit=…`), waiting for its password. */
export function takePendingKit(peek = false): string | null {
  try {
    const kit = sessionStorage.getItem(PENDING_KIT_KEY)
    if (kit && !peek) sessionStorage.removeItem(PENDING_KIT_KEY)
    return kit
  } catch {
    return null
  }
}

/** Called once at startup: stash a `#/link?code=…` from the URL and clean the address bar. */
export function capturePendingLink(): void {
  try {
    const hash = location.hash
    if (!hash.startsWith('#/link')) return
    const parsed = parsePairing(hash)
    if (parsed) sessionStorage.setItem(PENDING_KEY, JSON.stringify(parsed))
    const kit = hash.match(/[?&]kit=([^&#\s]+)/)
    if (kit) sessionStorage.setItem(PENDING_KIT_KEY, decodeURIComponent(kit[1]))
    history.replaceState(null, '', `${location.pathname}${location.search}#/`)
  } catch {
    /* ignore */
  }
}

export function takePendingLink(peek = false): ParsedPairing | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    if (!peek) sessionStorage.removeItem(PENDING_KEY)
    return JSON.parse(raw) as ParsedPairing
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*  Crypto                                                                    */
/* -------------------------------------------------------------------------- */

export function syncSupported(): string | null {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return 'Sync needs a secure connection. Open Monetr over https (your Vercel URL) or on localhost.'
  }
  return null
}

async function aesKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64urlToBytes(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function authToken(keyB64: string): Promise<string> {
  const data = new TextEncoder().encode(`monetr-auth:${keyB64}`)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
}

export async function encryptSnapshot(snapshot: Snapshot, keyB64: string): Promise<string> {
  const key = await aesKey(keyB64)
  const iv = randomBytes(12)
  const plain = deflate(new TextEncoder().encode(JSON.stringify(snapshot)))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(iv.length + cipher.length)
  out.set(iv)
  out.set(cipher, iv.length)
  return bytesToBase64(out)
}

export async function decryptSnapshot(b64: string, keyB64: string): Promise<Snapshot> {
  const key = await aesKey(keyB64)
  const bytes = base64ToBytes(b64)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))
  const snap = JSON.parse(new TextDecoder().decode(inflate(new Uint8Array(plain)))) as Snapshot
  if (snap?.v !== 2 || !snap.tables) throw new Error('Unknown snapshot format')
  return snap
}

/* -------------------------------------------------------------------------- */
/*  Snapshots + merge (pure, unit-tested)                                     */
/* -------------------------------------------------------------------------- */

export function rowTs(row: Record<string, unknown>): string {
  return String(row.updatedAt ?? row.createdAt ?? '')
}

function cutoff(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

export function syncedTables(includeAiProfiles: boolean): SyncTable[] {
  return SYNC_TABLES.filter((t) => includeAiProfiles || t !== 'profiles')
}

/**
 * Merge two snapshots. Newest version of each record wins (ties keep `local`), a tombstone wins over
 * any version of the record that is not newer than the deletion. Tables `local` does not carry
 * (e.g. AI profiles when this device opted out) are passed through from `remote` untouched.
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot, now = new Date()): Snapshot {
  const tombs = new Map<string, Tombstone>()
  const minDeletedAt = cutoff(TOMBSTONE_TTL_DAYS, now)
  for (const t of [...remote.tombstones, ...local.tombstones]) {
    if (t.deletedAt < minDeletedAt) continue
    const prev = tombs.get(t.id)
    if (!prev || t.deletedAt > prev.deletedAt) tombs.set(t.id, t)
  }

  const tables: Snapshot['tables'] = {}
  const names = new Set([...Object.keys(local.tables), ...Object.keys(remote.tables)] as SyncTable[])
  for (const name of names) {
    const mine = local.tables[name]
    const theirs = remote.tables[name]
    if (!mine) {
      tables[name] = theirs
      continue
    }
    const byId = new Map<string, Record<string, unknown>>()
    for (const row of theirs ?? []) byId.set(String(row.id), row)
    for (const row of mine) {
      const other = byId.get(String(row.id))
      if (!other || rowTs(row) >= rowTs(other)) byId.set(String(row.id), row)
    }
    tables[name] = [...byId.values()].filter((row) => {
      const tomb = tombs.get(`${name}:${row.id}`)
      return !tomb || rowTs(row) > tomb.deletedAt
    })
  }

  const settings = remote.settings.updatedAt > local.settings.updatedAt ? remote.settings : local.settings

  return {
    v: 2,
    exportedAt: now.toISOString(),
    deviceId: local.deviceId,
    settings,
    tables,
    tombstones: [...tombs.values()],
  }
}

export function snapshotFingerprint(s: Snapshot): string {
  const parts = Object.keys(s.tables)
    .sort()
    .map((name) => {
      const rows = s.tables[name as SyncTable] ?? []
      let max = ''
      for (const r of rows) {
        const ts = rowTs(r)
        if (ts > max) max = ts
      }
      return `${name}:${rows.length}:${max}`
    })
  return `${parts.join('|')}|t${s.tombstones.length}|s${s.settings.updatedAt}`
}

function sharedSettings(settings: Settings): Snapshot['settings'] {
  const values: Partial<Settings> = {}
  // null (not undefined) so a cleared value — e.g. a removed PIN — survives JSON and clears it elsewhere.
  for (const k of SHARED_SETTING_KEYS) (values as Record<string, unknown>)[k] = settings[k] ?? null
  return { values, updatedAt: settings.sharedUpdatedAt ?? '' }
}

export async function buildLocalSnapshot(includeAiProfiles: boolean): Promise<Snapshot> {
  const names = syncedTables(includeAiProfiles)
  const [settings, tombstones, ...rows] = await Promise.all([
    db.settings.get('settings'),
    db.tombstones.toArray(),
    ...names.map((n) => db.table(n).toArray() as Promise<Record<string, unknown>[]>),
  ])
  const tables: Snapshot['tables'] = {}
  names.forEach((n, i) => (tables[n] = rows[i]))
  return {
    v: 2,
    exportedAt: new Date().toISOString(),
    deviceId: deviceId(),
    settings: settings ? sharedSettings(settings) : { values: {}, updatedAt: '' },
    tables,
    tombstones: tombstones.filter((t) => names.includes(t.table as SyncTable)),
  }
}

/** Write the merged result into IndexedDB. Returns how many local records changed. */
async function applyLocally(merged: Snapshot, local: Snapshot): Promise<number> {
  let changed = 0
  const names = Object.keys(local.tables) as SyncTable[]
  await db.transaction('rw', [db.settings, db.tombstones, ...names.map((n) => db.table(n))], async () => {
    for (const name of names) {
      const before = new Map((local.tables[name] ?? []).map((r) => [String(r.id), r]))
      const after = merged.tables[name] ?? []
      const afterIds = new Set(after.map((r) => String(r.id)))
      const puts = after.filter((r) => {
        const prev = before.get(String(r.id))
        return !prev || rowTs(prev) !== rowTs(r) || JSON.stringify(prev) !== JSON.stringify(r)
      })
      const dels = [...before.keys()].filter((id) => !afterIds.has(id))
      if (puts.length) await db.table(name).bulkPut(puts as Row[])
      if (dels.length) await db.table(name).bulkDelete(dels)
      changed += puts.length + dels.length
    }
    await db.tombstones.clear()
    if (merged.tombstones.length) await db.tombstones.bulkPut(merged.tombstones)

    if (merged.settings.updatedAt > local.settings.updatedAt) {
      const current = await db.settings.get('settings')
      if (current) {
        const incoming = Object.fromEntries(
          Object.entries(merged.settings.values).map(([k, v]) => [k, v === null ? undefined : v]),
        ) as Partial<Settings>
        await db.settings.put({
          ...current,
          ...incoming,
          sharedUpdatedAt: merged.settings.updatedAt,
          updatedAt: new Date().toISOString(),
        })
        changed++
      }
    }
  })
  return changed
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                   */
/* -------------------------------------------------------------------------- */

class SyncHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: Record<string, unknown>,
  ) {
    super(message)
  }
}

async function api(state: SyncState, path: 'pull' | 'push', body: unknown): Promise<Record<string, unknown>> {
  const base = (state.server || '').replace(/\/+$/, '')
  const url = `${base}/api/sync/${path}`
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new SyncHttpError('Could not reach the sync server. Check your connection.', 0)
  }
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* not JSON */
  }
  if (!json) {
    throw new SyncHttpError(
      `No sync server at ${base || location.origin}. Sync works on your Vercel deployment — set the server URL in Settings → Cloud sync.`,
      res.status,
    )
  }
  if (!res.ok) throw new SyncHttpError(String(json.error ?? `Sync failed (${res.status})`), res.status, json)
  return json
}

/* -------------------------------------------------------------------------- */
/*  Sync run + status                                                         */
/* -------------------------------------------------------------------------- */

export interface SyncStatus {
  running: boolean
  lastResult?: { at: string; changed: number; pushed: boolean }
  error?: string
}

let status: SyncStatus = { running: false }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function onSyncChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSyncStatus(): SyncStatus {
  return status
}

let running: Promise<SyncStatus['lastResult']> | null = null
let afterApply: (() => Promise<void> | void) | null = null

/** Run one pull → merge → push cycle. Concurrent calls share the same run. */
export function syncNow(): Promise<SyncStatus['lastResult']> {
  if (running) return running
  running = (async () => {
    const state = getSyncState()
    if (!state?.enabled) throw new Error('Sync is not set up on this device.')
    const unsupported = syncSupported()
    if (unsupported) throw new Error(unsupported)
    status = { ...status, running: true, error: undefined }
    emit()

    const auth = await authToken(state.key)
    const include = state.includeAiProfiles !== false
    for (let attempt = 0; attempt < 3; attempt++) {
      let remote: Snapshot | null = null
      let version = 0
      // After a full sync, ask the server to skip the download when nothing changed since.
      const known = attempt === 0 && state.fingerprint && state.version ? state.version : undefined
      try {
        const pulled = await api(state, 'pull', { syncId: state.syncId, auth, known })
        version = Number(pulled.version) || 0
        if (pulled.unchanged) {
          // The cloud copy is exactly what this device merged last time, so local already holds it.
          const local = await buildLocalSnapshot(include)
          const fp = snapshotFingerprint(local)
          let pushed = false
          if (fp !== state.fingerprint) {
            try {
              const res = await api(state, 'push', { syncId: state.syncId, auth, deviceId: state.deviceId, baseVersion: version, data: await encryptSnapshot(local, state.key) })
              version = Number(res.version) || version + 1
              pushed = true
            } catch (err) {
              if (err instanceof SyncHttpError && err.status === 409) continue
              throw err
            }
          }
          const at = new Date().toISOString()
          patchSyncState({ version, lastSyncedAt: at, lastError: undefined, fingerprint: fp })
          return { at, changed: 0, pushed }
        }
        if (!pulled.legacy && typeof pulled.data === 'string') {
          try {
            remote = await decryptSnapshot(pulled.data, state.key)
          } catch {
            throw new Error('Could not decrypt the cloud copy. Re-link this device using the QR code from your other device.')
          }
        }
      } catch (err) {
        if (!(err instanceof SyncHttpError && err.status === 404)) throw err
      }

      const local = await buildLocalSnapshot(include)
      const merged = remote ? mergeSnapshots(local, remote) : local
      const changed = remote ? await applyLocally(merged, local) : 0
      if (changed && afterApply) await afterApply()

      const fingerprint = snapshotFingerprint(merged)
      const needsPush = !remote || snapshotFingerprint(remote) !== fingerprint
      if (needsPush) {
        try {
          const pushed = await api(state, 'push', {
            syncId: state.syncId,
            auth,
            deviceId: state.deviceId,
            baseVersion: version,
            data: await encryptSnapshot(merged, state.key),
          })
          version = Number(pushed.version) || version + 1
        } catch (err) {
          // Another device pushed in between — pull again and re-merge.
          if (err instanceof SyncHttpError && err.status === 409) continue
          throw err
        }
      }

      const at = new Date().toISOString()
      patchSyncState({ version, lastSyncedAt: at, lastError: undefined, fingerprint: snapshotFingerprint(await buildLocalSnapshot(include)) })
      return { at, changed, pushed: needsPush }
    }
    throw new Error('Sync kept colliding with another device. Try again in a moment.')
  })()
    .then((result) => {
      status = { running: false, lastResult: result }
      emit()
      return result
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Sync failed'
      status = { ...status, running: false, error: message }
      patchSyncState({ lastError: message })
      emit()
      throw err
    })
    .finally(() => {
      running = null
    })
  return running
}

/* -------------------------------------------------------------------------- */
/*  Auto-sync                                                                 */
/* -------------------------------------------------------------------------- */

let debounce: number | undefined
let started = false

/** Ask for a sync soon. Skipped when nothing changed locally and we synced recently. */
export function requestAutoSync(delayMs = 4000, force = false): void {
  const state = getSyncState()
  if (!state?.enabled || syncSupported()) return
  window.clearTimeout(debounce)
  debounce = window.setTimeout(async () => {
    try {
      if (!force && state.lastSyncedAt && Date.now() - Date.parse(state.lastSyncedAt) < 120_000) {
        const local = await buildLocalSnapshot(state.includeAiProfiles !== false)
        if (snapshotFingerprint(local) === getSyncState()?.fingerprint) return
      }
      if (!navigator.onLine) return
      await syncNow()
    } catch {
      /* status already records the error */
    }
  }, delayMs)
}

/** Wire auto-sync to app lifecycle. `onApplied` refreshes the UI after remote changes land. */
export function startAutoSync(onApplied: () => Promise<void> | void): () => void {
  afterApply = onApplied
  if (started) return () => {}
  started = true
  const onVisible = () => {
    if (document.visibilityState === 'visible') requestAutoSync(500, true)
  }
  const onOnline = () => requestAutoSync(500, true)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  const interval = window.setInterval(() => {
    if (document.visibilityState === 'visible') requestAutoSync(0, true)
  }, 180_000)
  requestAutoSync(1500, true)
  return () => {
    started = false
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.clearInterval(interval)
  }
}
