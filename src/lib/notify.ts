import { getMeta, setMeta } from '../db/db'
import { DAILY_NOTIFICATION_CAP, dueNudges, localStamp, type Nudge } from './nudges'

/*
 * Delivering nudges as system notifications without a server:
 *  - the app works nudges out whenever your data changes and stores them on this device;
 *  - while Monetr is open (or in a background tab), a timer shows them when they fall due;
 *  - where the browser supports Periodic Background Sync (Chrome/Edge on Android and desktop, with
 *    Monetr installed), the service worker wakes now and then and shows the stored ones too.
 * The service worker (public/sw.js) reads the same stored keys — keep the names in step.
 */

export const NUDGES_KEY = 'nudges'
export const SHOWN_KEY = 'nudgesShown'
export const PERIODIC_TAG = 'monetr-nudges'

export type Permission = 'unsupported' | 'default' | 'granted' | 'denied'

export function notificationPermission(): Permission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as Permission
}

/** iPhone/iPad Safari only offers notifications to Monetr once it's added to the Home Screen. */
export function needsHomeScreenForNotifications(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  return ios && !standalone
}

export async function publishNudges(nudges: Nudge[]): Promise<void> {
  await setMeta(NUDGES_KEY, { at: new Date().toISOString(), items: nudges.slice(0, 40) })
}

async function show(n: Nudge): Promise<void> {
  const options: NotificationOptions = { body: n.body, tag: n.id, icon: './icon-192.png', badge: './icon-192.png', data: { url: n.url } }
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (reg) await reg.showNotification(n.title, options)
  else new Notification(n.title, options)
}

let delivering = false
/** Show whatever is due and hasn't been shown on this device. */
export async function deliverDue(enabled: boolean): Promise<number> {
  if (!enabled || notificationPermission() !== 'granted' || delivering) return 0
  delivering = true
  try {
    const stored = await getMeta<{ items: Nudge[] }>(NUDGES_KEY)
    const shown = (await getMeta<Record<string, string>>(SHOWN_KEY)) ?? {}
    const now = localStamp()
    // Respect the daily cap shared with the service worker's morning check.
    const shownToday = Object.values(shown).filter((when) => localStamp(new Date(when)).slice(0, 10) === now.slice(0, 10)).length
    const room = Math.max(0, DAILY_NOTIFICATION_CAP - shownToday)
    const due = dueNudges(stored?.items ?? [], new Set(Object.keys(shown)), now, Math.min(3, room))
    for (const n of due) {
      try {
        await show(n)
        shown[n.id] = new Date().toISOString()
      } catch {
        /* blocked or unsupported here */
      }
    }
    if (due.length) {
      // Forget ids older than two weeks so the list doesn't grow forever.
      const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
      for (const [id, when] of Object.entries(shown)) if (when < cutoff) delete shown[id]
      await setMeta(SHOWN_KEY, shown)
    }
    return due.length
  } finally {
    delivering = false
  }
}

/** Ask the browser to wake the service worker periodically (supported browsers, installed app). */
export async function registerBackgroundNudges(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.ready
    const periodic = (reg as unknown as { periodicSync?: { register: (tag: string, o: { minInterval: number }) => Promise<void> } })?.periodicSync
    if (!periodic) return false
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName })
    if (status.state !== 'granted') return false
    await periodic.register(PERIODIC_TAG, { minInterval: 3 * 60 * 60 * 1000 })
    return true
  } catch {
    return false
  }
}

/** Ask for permission (must run from a tap), then confirm with a first notification. */
export async function enableNotifications(): Promise<Permission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  const result = (await Notification.requestPermission()) as Permission
  if (result === 'granted') {
    await registerBackgroundNudges()
    void subscribeMorningPush()
    try {
      await show({ id: `welcome_${Date.now()}`, kind: 'summary', title: 'Monetr reminders are on', body: 'Bills before they’re due, a heads-up when a budget runs fast, and a short summary each evening.', at: localStamp(), url: '/', priority: 0 })
    } catch {
      /* fine */
    }
  }
  return result
}

/* ---------------------------- morning wake-up push ---------------------------- */

function apiBase(): string {
  try {
    const raw = localStorage.getItem('monetr:sync')
    const server = raw ? (JSON.parse(raw) as { server?: string }).server : undefined
    return (server || '').replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function urlB64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushResult = 'subscribed' | 'unsupported' | 'not-configured' | 'full' | 'failed'

/**
 * Lets the server wake this device each morning (the push carries no data; the service worker
 * does the analysis on the device). Safe to call repeatedly — it refreshes the subscription.
 */
export async function subscribeMorningPush(): Promise<PushResult> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || notificationPermission() !== 'granted') return 'unsupported'
    const reg = await navigator.serviceWorker.ready
    const base = apiBase()
    const keyRes = await fetch(`${base}/api/push/key`)
    if (!keyRes.ok) return 'not-configured'
    const { key } = (await keyRes.json()) as { key?: string }
    if (!key) return 'not-configured'
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) })
    const res = await fetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
    if (res.status === 429) {
      // Device limit reached: drop this browser's subscription so it doesn't linger unused.
      await sub.unsubscribe().catch(() => {})
      return 'full'
    }
    return res.ok ? 'subscribed' : 'failed'
  } catch {
    return 'failed'
  }
}

export async function unsubscribeMorningPush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await fetch(`${apiBase()}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), remove: true }),
    }).catch(() => {})
    await sub.unsubscribe()
  } catch {
    /* nothing to undo */
  }
}
