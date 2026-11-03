import { useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { useApp } from '../store'
import { enableNotifications, needsHomeScreenForNotifications, notificationPermission } from '../lib/notify'
import { Button, Card } from './ui'

const SNOOZE_KEY = 'monetr:notify-prompt-snoozed'
const SNOOZE_DAYS = 7

function snoozed(): boolean {
  try {
    const until = localStorage.getItem(SNOOZE_KEY)
    return Boolean(until && until > new Date().toISOString())
  } catch {
    return false
  }
}

/**
 * Shown on each device until reminders are on there (permission is per device and per browser).
 * "Not now" hides it for a week; it comes back, because reminders are most of the value.
 */
export function NotifyPrompt() {
  const { settings, saveSettings, notify } = useApp()
  const [hidden, setHidden] = useState(snoozed)
  const [busy, setBusy] = useState(false)
  const permission = notificationPermission()
  const homeScreen = needsHomeScreenForNotifications()

  if (hidden) return null
  if (permission === 'granted' && settings.notifications) return null
  if (permission === 'denied') return null
  if (permission === 'unsupported' && !homeScreen) return null

  function later() {
    try {
      localStorage.setItem(SNOOZE_KEY, new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString())
    } catch {
      /* private mode */
    }
    setHidden(true)
  }

  async function turnOn() {
    setBusy(true)
    try {
      const result = permission === 'granted' ? 'granted' : await enableNotifications()
      if (result === 'granted') {
        await saveSettings({ notifications: true })
        notify('Reminders are on for this device', 'success')
      } else if (result === 'denied') {
        notify('Notifications were blocked. You can allow them later in your browser’s site settings.', 'error')
        setHidden(true)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink/[0.07] text-ink">
        <BellRing className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink">Turn on reminders on this device</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
          {homeScreen
            ? 'On iPhone and iPad, add Monetr to your Home Screen first (Share → Add to Home Screen), then open it from there to turn reminders on.'
            : 'Bills the day before they’re due, a heads-up when a budget is running fast — like Shopping half gone in the first week — and a short summary each evening.'}
        </p>
        {!homeScreen ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={turnOn} loading={busy}>
              Turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={later}>
              Not now
            </Button>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={later} className="btn btn-icon h-7 w-7 text-muted hover:text-ink" aria-label="Hide for a week">
        <X className="h-4 w-4" />
      </button>
    </Card>
  )
}
