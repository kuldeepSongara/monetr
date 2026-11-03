// Daily job (see vercel.json): sends every subscribed device an empty "morning" wake-up.
// The device's service worker then reads your data on the device and decides what to tell you —
// the server never sees any numbers.
import webpush from 'web-push'

interface ApiRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
}
interface ApiResponse {
  setHeader(name: string, value: string): void
  status(code: number): ApiResponse
  json(body: unknown): void
  end(): void
}

export const config = { runtime: 'nodejs', maxDuration: 60 }

async function sqlClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not configured')
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

interface Row {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` to cron paths when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET
  const header = req.headers?.authorization
  if (!secret || header !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(501).json({ error: 'VAPID keys missing' })
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:monetr@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  try {
    const sql = await sqlClient()
    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id VARCHAR(64) PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
        tz VARCHAR(64), created_at TIMESTAMPTZ DEFAULT NOW(), last_sent_at TIMESTAMPTZ
      )
    `
    const rows = (await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`) as Row[]
    let sent = 0
    const gone: string[] = []
    await Promise.all(
      rows.map(async (r) => {
        try {
          await webpush.sendNotification(
            { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
            JSON.stringify({ type: 'morning', at: new Date().toISOString() }),
            { TTL: 6 * 3600, urgency: 'normal' },
          )
          sent++
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // The browser dropped this subscription (uninstalled, permission removed): forget it.
          if (status === 404 || status === 410) gone.push(r.id)
        }
      }),
    )
    for (const id of gone) await sql`DELETE FROM push_subscriptions WHERE id = ${id}`
    if (sent) await sql`UPDATE push_subscriptions SET last_sent_at = NOW()`
    res.status(200).json({ devices: rows.length, sent, removed: gone.length })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
}
