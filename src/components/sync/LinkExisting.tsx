import { lazy, Suspense, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { useApp } from '../../store'
import { Button } from '../ui'
import { linkWithPairing, parsePairing, syncNow, syncSupported } from '../../lib/sync'
import { updateSettings } from '../../db/db'

// The scanner pulls in a QR decoder; load it only when the camera is opened.
const QrScanner = lazy(() => import('./QrScanner').then((m) => ({ default: m.QrScanner })))

/** Onboarding shortcut: join an existing device's sync instead of starting from scratch. */
export function LinkExisting() {
  const { refresh, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onResult(text: string) {
    const parsed = parsePairing(text)
    if (!parsed) {
      notify('That QR is not a Monetr sync code.', 'error')
      return
    }
    setOpen(false)
    setBusy(true)
    try {
      linkWithPairing(parsed)
      await updateSettings({ onboarded: true })
      await syncNow()
      await refresh({ fromSync: true })
      notify('Linked — your data is on this device now.', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not link', 'error')
      await refresh({ fromSync: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        className="w-full"
        loading={busy}
        onClick={() => {
          const reason = syncSupported()
          if (reason) notify(reason, 'error')
          else setOpen(true)
        }}
      >
        <ScanLine className="h-4 w-4" /> Already use Monetr? Scan the sync QR
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <QrScanner open={open} onClose={() => setOpen(false)} onResult={onResult} />
        </Suspense>
      ) : null}
    </>
  )
}
