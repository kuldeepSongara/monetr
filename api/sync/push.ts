// Helpers are inlined so each Vercel function is self-contained (no relative ESM imports).
import { createHash } from 'node:crypto'

interface ApiRequest {
  method?: string
  body?: unknown
}

interface ApiResponse {
  setHeader(name: string, value: string): void
  status(code: number): ApiResponse
  json(body: unknown): void
  end(): void
}

/** CORS stays open so a locally served app can sync through your deployment; writes are protected by the auth token. */
function preflight(req: ApiRequest, res: ApiResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return true
  }
  return false
}

function body(req: ApiRequest): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return (req.body as Record<string, unknown>) ?? {}
}

const SYNC_ID = /^mtr_[0-9a-f]{32}$/
const AUTH = /^[0-9a-f]{64}$/
const MAX_BYTES = 3_500_000

function hashAuth(auth: string): string {
  return createHash('sha256').update(auth).digest('hex')
}

async function sqlClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not configured')
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

async function ensureTable(sql: Awaited<ReturnType<typeof sqlClient>>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sync_snapshots (
      sync_id VARCHAR(64) PRIMARY KEY,
      data BYTEA,
      version INT DEFAULT 1,
      device_id VARCHAR(64),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      size_bytes INT
    )
  `
  await sql`ALTER TABLE sync_snapshots ADD COLUMN IF NOT EXISTS auth_hash VARCHAR(64)`
}

function fail(res: ApiResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Server error'
  res.status(500).json({ error: message })
}

export const config = { runtime: 'nodejs' }

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (preflight(req, res)) return
  const { syncId, auth, data, deviceId, baseVersion } = body(req)
  if (typeof syncId !== 'string' || !SYNC_ID.test(syncId)) return res.status(400).json({ error: 'Invalid sync ID' })
  if (typeof auth !== 'string' || !AUTH.test(auth)) return res.status(400).json({ error: 'Missing auth token' })
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'Missing data' })
  const base = Number(baseVersion) || 0
  const device = typeof deviceId === 'string' ? deviceId.slice(0, 64) : null

  const buf = Buffer.from(data, 'base64')
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Snapshot too large for the free sync tier' })
  const authHash = hashAuth(auth)

  try {
    const sql = await sqlClient()
    await ensureTable(sql)
    const rows = (await sql`SELECT version, auth_hash FROM sync_snapshots WHERE sync_id = ${syncId}`) as {
      version: number
      auth_hash: string | null
    }[]

    if (!rows.length) {
      if (base !== 0) return res.status(409).json({ error: 'Cloud copy was removed', version: 0 })
      const inserted = (await sql`
        INSERT INTO sync_snapshots (sync_id, data, version, device_id, updated_at, size_bytes, auth_hash)
        VALUES (${syncId}, ${buf}, 1, ${device}, NOW(), ${buf.length}, ${authHash})
        ON CONFLICT (sync_id) DO NOTHING
        RETURNING version
      `) as { version: number }[]
      if (!inserted.length) return res.status(409).json({ error: 'Another device synced first' })
      return res.status(200).json({ ok: true, version: 1 })
    }

    const row = rows[0]
    if (row.auth_hash && row.auth_hash !== authHash) return res.status(403).json({ error: 'This device is not linked to that sync ID' })
    if ((row.version ?? 1) !== base) return res.status(409).json({ error: 'Another device synced first', version: row.version })

    const updated = (await sql`
      UPDATE sync_snapshots
      SET data = ${buf}, version = version + 1, device_id = ${device}, updated_at = NOW(),
          size_bytes = ${buf.length}, auth_hash = ${authHash}
      WHERE sync_id = ${syncId} AND version = ${base}
      RETURNING version
    `) as { version: number }[]
    if (!updated.length) return res.status(409).json({ error: 'Another device synced first' })
    res.status(200).json({ ok: true, version: updated[0].version })
  } catch (err) {
    fail(res, err)
  }
}
