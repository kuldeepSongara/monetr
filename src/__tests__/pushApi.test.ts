import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny in-memory stand-in for Neon: enough SQL to exercise the push endpoints.
const rows = new Map<string, { id: string; endpoint: string; p256dh: string; auth: string; tz: string | null }>()
const sent: string[] = []

vi.mock('@neondatabase/serverless', () => ({
  neon: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join('?')
    if (q.includes('CREATE TABLE')) return Promise.resolve([])
    if (q.includes('COUNT(*)')) return Promise.resolve([{ count: rows.size }])
    if (q.startsWith('SELECT 1')) return Promise.resolve(rows.has(values[0] as string) ? [1] : [])
    if (q.includes('INSERT INTO push_subscriptions')) {
      const [id, endpoint, p256dh, auth, tz] = values as string[]
      rows.set(id, { id, endpoint, p256dh, auth, tz })
      return Promise.resolve([])
    }
    if (q.startsWith('DELETE')) {
      rows.delete(values[0] as string)
      return Promise.resolve([])
    }
    if (q.includes('SELECT id, endpoint')) return Promise.resolve([...rows.values()])
    return Promise.resolve([])
  },
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('Gone'), { statusCode: 410 })
      expect(JSON.parse(payload)).toMatchObject({ type: 'morning' })
      sent.push(sub.endpoint)
    }),
  },
}))

function res() {
  const out = { code: 0, body: undefined as unknown, headers: {} as Record<string, string> }
  const r = {
    setHeader: (k: string, v: string) => void (out.headers[k] = v),
    status: (c: number) => ((out.code = c), r),
    json: (b: unknown) => void (out.body = b),
    end: () => undefined,
  }
  return { r, out }
}

const sub = (endpoint: string) => ({ subscription: { endpoint, keys: { p256dh: 'pk', auth: 'ak' } }, tz: 'America/Toronto' })

describe('push endpoints', () => {
  beforeEach(() => {
    rows.clear()
    sent.length = 0
    process.env.DATABASE_URL = 'postgres://test'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
  })

  it('stores a subscription (no money data) and removes it on request', async () => {
    const { default: subscribe } = await import('../../api/push/subscribe')
    let t = res()
    await subscribe({ method: 'POST', body: sub('https://push.example/abc') }, t.r)
    expect(t.out.code).toBe(200)
    expect([...rows.values()][0]).toMatchObject({ endpoint: 'https://push.example/abc', tz: 'America/Toronto' })
    t = res()
    await subscribe({ method: 'POST', body: { ...sub('https://push.example/abc'), remove: true } }, t.r)
    expect(rows.size).toBe(0)
    t = res()
    await subscribe({ method: 'POST', body: sub('http://not-https') }, t.r)
    expect(t.out.code).toBe(400)
  })

  it('the daily job needs the cron secret, wakes every device and forgets dead ones', async () => {
    const { default: subscribe } = await import('../../api/push/subscribe')
    const { default: morning } = await import('../../api/cron/morning')
    await subscribe({ method: 'POST', body: sub('https://push.example/phone') }, res().r)
    await subscribe({ method: 'POST', body: sub('https://push.example/gone') }, res().r)
    let t = res()
    await morning({ headers: {} }, t.r)
    expect(t.out.code).toBe(401)
    t = res()
    await morning({ headers: { authorization: 'Bearer cron-secret' } }, t.r)
    expect(t.out.body).toMatchObject({ devices: 2, sent: 1, removed: 1 })
    expect(sent).toEqual(['https://push.example/phone'])
    expect(rows.size).toBe(1)
  })

  it('hands out the public key only when configured', async () => {
    const { default: key } = await import('../../api/push/key')
    let t = res()
    key({ method: 'GET' }, t.r)
    expect(t.out.body).toEqual({ key: 'pub' })
    delete process.env.VAPID_PUBLIC_KEY
    t = res()
    key({ method: 'GET' }, t.r)
    expect(t.out.code).toBe(501)
  })
})

describe('device cap', () => {
  it('accepts up to 20 devices, refuses the 21st, still lets existing ones refresh', async () => {
    rows.clear()
    const { default: subscribe } = await import('../../api/push/subscribe')
    for (let i = 0; i < 20; i++) await subscribe({ method: 'POST', body: sub(`https://push.example/d${i}`) }, res().r)
    expect(rows.size).toBe(20)
    let t = res()
    await subscribe({ method: 'POST', body: sub('https://push.example/d20') }, t.r)
    expect(t.out.code).toBe(429)
    t = res()
    await subscribe({ method: 'POST', body: sub('https://push.example/d3') }, t.r)
    expect(t.out.code).toBe(200)
  })
})
