import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import { useApp } from '../../store'
import { Button, Modal } from '../ui'
import { linkWithPairing, syncNow, syncSupported, takePendingLink, type ParsedPairing } from '../../lib/sync'
import { updateSettings } from '../../db/db'

/** Shown when Monetr was opened from a sync QR / link (`#/link?code=…`). */
export function PendingLink() {
  const { settings, refresh, notify } = useApp()
  const [pending, setPending] = useState<ParsedPairing | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPending(takePendingLink(true))
  }, [])

  if (!pending) return null

  async function accept() {
    if (!pending) return
    const unsupported = syncSupported()
    if (unsupported) {
      notify(unsupported, 'error')
      return
    }
    setBusy(true)
    try {
      takePendingLink()
      linkWithPairing(pending)
      if (!settings.onboarded) await updateSettings({ onboarded: true })
      await syncNow()
      await refresh({ fromSync: true })
      notify('Linked. Your data is now synced to this device.', 'success')
      setPending(null)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not link this device', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        takePendingLink()
        setPending(null)
      }}
      title="Link this device?"
      subtitle="You opened a Monetr sync link. This device will join your encrypted sync and download your data."
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              takePendingLink()
              setPending(null)
            }}
          >
            Not now
          </Button>
          <Button className="flex-[2]" onClick={accept} loading={busy}>
            <Link2 className="h-4 w-4" /> Link and sync
          </Button>
        </div>
      }
    >
      <p className="text-[11px] leading-relaxed text-muted">
        Anything already on this device is merged, not replaced. Only accept this if the QR came from your own device.
      </p>
    </Modal>
  )
}
