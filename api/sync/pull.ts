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

interface Row {
  data: string
  version: number
  updated_at: string
  auth_hash: string | null
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (preflight(req, res)) return
  const { syncId, auth } = body(req)
  if (typeof syncId !== 'string' || !SYNC_ID.test(syncId)) return res.status(400).json({ error: 'Invalid sync ID' })
  if (typeof auth !== 'string' || !AUTH.test(auth)) return res.status(400).json({ error: 'Missing auth token' })

  try {
    const sql = await sqlClient()
    await ensureTable(sql)
    const rows = (await sql`
      SELECT encode(data, 'base64') AS data, version, updated_at, auth_hash
      FROM sync_snapshots WHERE sync_id = ${syncId}
    `) as Row[]
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const row = rows[0]
    // Rows written by the old unencrypted sync carry no auth hash and can't be decrypted — the
    // client treats them as empty and overwrites them on its next push.
    if (!row.auth_hash) return res.status(200).json({ legacy: true, version: row.version ?? 1 })
    if (row.auth_hash !== hashAuth(auth)) return res.status(403).json({ error: 'This device is not linked to that sync ID' })
    res.status(200).json({ data: (row.data ?? '').replace(/\s+/g, ''), version: row.version, updatedAt: row.updated_at })
  } catch (err) {
    fail(res, err)
  }
}
