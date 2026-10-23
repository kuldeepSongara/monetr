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

  const { syncId } = req.body || {}
  if (!syncId) return res.status(400).json({ error: 'Missing syncId' })

  try {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(DATABASE_URL)
    const rows = await sql`SELECT encode(data, 'base64') as data, updated_at, size_bytes FROM sync_snapshots WHERE sync_id = ${syncId}`
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.status(200).json({ data: rows[0].data, updatedAt: rows[0].updated_at, sizeBytes: rows[0].size_bytes })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
