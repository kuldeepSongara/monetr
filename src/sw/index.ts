/*
 * Monetr service worker (bundled to dist/sw.js by scripts/build-sw.mjs).
 *  - Offline: caches the app shell and assets.
 *  - Nudges: shows reminders the app stored for today (Periodic Background Sync, where supported).
 *  - Morning check: a daily wake-up push from the server (no data in it) makes this worker read
 *    your data on the device and send one or two useful notifications — app closed or not.
 */
import { db } from '../db/db'
import { DAILY_NOTIFICATION_CAP, localStamp, type Nudge } from '../lib/nudges'
import { morningNudges } from './morning'

const CACHE = 'monetr-v4'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']

interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void
}
interface FetchEvent extends ExtendableEvent {
  request: Request
  respondWith(r: Response | Promise<Response>): void
}
interface NotificationEvent extends ExtendableEvent {
  notification: Notification & { data?: { url?: string } }
}
interface PushEvent extends ExtendableEvent {
  data: { json(): unknown } | null
}
interface PeriodicSyncEvent extends ExtendableEvent {
  tag: string
}
interface WindowClientLike {
  focus(): Promise<unknown>
  navigate(url: string): Promise<unknown>
}
interface SWScope {
  location: Location
  registration: ServiceWorkerRegistration
  clients: { claim(): Promise<void>; matchAll(o: object): Promise<WindowClientLike[]>; openWindow(url: string): Promise<unknown> }
  skipWaiting(): Promise<void>
  addEventListener(type: string, fn: (e: never) => void): void
}
const sw = self as unknown as SWScope

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  )
})

sw.addEventListener('fetch', (event: FetchEvent) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Never cache API or AI traffic — always go to the network.
  if (url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
    }),
  )
})

/* --------------------------------- nudges --------------------------------- */

async function shownIds(): Promise<Record<string, string>> {
  return ((await db.meta.get('nudgesShown'))?.value as Record<string, string>) ?? {}
}

async function present(list: Nudge[]): Promise<number> {
  const shown = await shownIds()
  const today = localStamp().slice(0, 10)
  let room = DAILY_NOTIFICATION_CAP - Object.values(shown).filter((when) => localStamp(new Date(when)).slice(0, 10) === today).length
  let count = 0
  for (const n of list) {
    if (shown[n.id] || room <= 0) continue
    room--
    await sw.registration.showNotification(n.title, { body: n.body, tag: n.id, icon: './icon-192.png', badge: './icon-192.png', data: { url: n.url } })
    shown[n.id] = new Date().toISOString()
    count++
  }
  if (count) await db.meta.put({ key: 'nudgesShown', value: shown })
  return count
}

/** Reminders the app worked out for today, due by now. */
async function showStoredNudges(): Promise<void> {
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return
  const stored = (await db.meta.get('nudges'))?.value as { items?: Nudge[] } | undefined
  const now = localStamp()
  const due = (stored?.items ?? []).filter((n) => n.at.slice(0, 10) === now.slice(0, 10) && n.at <= now).slice(0, 3)
  await present(due)
}

/** The daily wake-up: a fresh look at your numbers, then one or two notifications. */
async function morningCheck(): Promise<void> {
  let list: Nudge[] = []
  try {
    list = await morningNudges()
  } catch {
    list = []
  }
  const shownNow = await present(list)
  // A push must always show something; if everything was already said, keep it short.
  if (!shownNow) {
    await sw.registration.showNotification('Monetr', { body: 'Morning check: nothing new needs your attention today.', tag: 'morning-quiet', icon: './icon-192.png', data: { url: '/' }, silent: true })
  }
}

sw.addEventListener('push', (event: PushEvent) => {
  let payload: { type?: string } = {}
  try {
    payload = (event.data?.json() as { type?: string }) ?? {}
  } catch {
    payload = {}
  }
  event.waitUntil(payload.type === 'morning' ? morningCheck() : showStoredNudges())
})

sw.addEventListener('periodicsync', (event: PeriodicSyncEvent) => {
  if (event.tag === 'monetr-nudges') event.waitUntil(showStoredNudges())
})

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  const target = new URL(`./#${url}`, sw.registration.scope).href
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        c.navigate(target).catch(() => {})
        return c.focus()
      }
      return sw.clients.openWindow(target)
    }),
  )
})
