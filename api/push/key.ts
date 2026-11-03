// The public half of the VAPID key pair, so devices can subscribe to the morning wake-up.
interface ApiRequest {
  method?: string
}
interface ApiResponse {
  setHeader(name: string, value: string): void
  status(code: number): ApiResponse
  json(body: unknown): void
  end(): void
}

export const config = { runtime: 'nodejs' }

export default function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return res.status(501).json({ error: 'Morning notifications are not set up on the server yet (VAPID keys missing).' })
  res.status(200).json({ key })
}
