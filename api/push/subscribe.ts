// Stores a device's push subscription so the daily job can wake it. Holds no money data at all:
// only the browser's push endpoint, its encryption keys and the device's time zone.
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

export const config = { runtime: 'nodejs' }

// A personal app: a phone, a laptop, a tablet… 20 is plenty, and keeps strangers from piling on.
const MAX_SUBSCRIPTIONS = 20

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

async function sqlClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not configured')
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

async function ensurePushTable(sql: Awaited<ReturnType<typeof sqlClient>>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id VARCHAR(64) PRIMARY KEY,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      tz VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_sent_at TIMESTAMPTZ
    )
  `
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { subscription, tz, remove } = body(req) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    tz?: string
    remove?: boolean
  }
  const endpoint = subscription?.endpoint
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) {
    return res.status(400).json({ error: 'Invalid subscription' })
  }
  const id = createHash('sha256').update(endpoint).digest('hex')
  try {
    const sql = await sqlClient()
    await ensurePushTable(sql)
    if (remove) {
      await sql`DELETE FROM push_subscriptions WHERE id = ${id}`
      return res.status(200).json({ ok: true })
    }
    const p256dh = subscription?.keys?.p256dh
    const auth = subscription?.keys?.auth
    if (typeof p256dh !== 'string' || typeof auth !== 'string') return res.status(400).json({ error: 'Invalid subscription keys' })
    const [{ count }] = (await sql`SELECT COUNT(*)::int AS count FROM push_subscriptions`) as { count: number }[]
    const exists = (await sql`SELECT 1 FROM push_subscriptions WHERE id = ${id}`) as unknown[]
    if (!exists.length && count >= MAX_SUBSCRIPTIONS) return res.status(429).json({ error: `The morning check is limited to ${MAX_SUBSCRIPTIONS} devices. Turn reminders off on a device you no longer use.` })
    const zone = typeof tz === 'string' ? tz.slice(0, 64) : null
    await sql`
      INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, tz)
      VALUES (${id}, ${endpoint}, ${p256dh}, ${auth}, ${zone})
      ON CONFLICT (id) DO UPDATE SET endpoint = EXCLUDED.endpoint, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, tz = EXCLUDED.tz
    `
    res.status(200).json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
