export const config = {
  runtime: 'nodejs',
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { DATABASE_URL } = process.env
  if (!DATABASE_URL) return res.status(500).json({ error: 'DATABASE_URL not configured' })

  const { syncId, data, deviceId } = req.body || {}
  if (!syncId || !data) return res.status(400).json({ error: 'Missing syncId or data' })

  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(DATABASE_URL)
    const buf = Buffer.from(data, 'base64')
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
    await sql`
      INSERT INTO sync_snapshots (sync_id, data, device_id, updated_at, size_bytes)
      VALUES (${syncId}, ${buf}, ${deviceId || null}, NOW(), ${buf.length})
      ON CONFLICT (sync_id) DO UPDATE SET data = EXCLUDED.data, device_id = EXCLUDED.device_id, updated_at = NOW(), size_bytes = EXCLUDED.size_bytes
    `
    res.status(200).json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
