import { lazy, Suspense, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { useApp } from '../../store'
import { Button, Input } from '../ui'
import { parseKit } from '../../lib/recovery'
import { KitUnlock } from './KitUnlock'
import { linkWithPairing, parsePairing, syncNow, syncSupported, type ParsedPairing } from '../../lib/sync'
import { updateSettings } from '../../db/db'

// The scanner pulls in a QR decoder; load it only when the camera is opened.
const QrScanner = lazy(() => import('./QrScanner').then((m) => ({ default: m.QrScanner })))

/** Onboarding shortcut: join an existing device's sync instead of starting from scratch. */
export function LinkExisting() {
  const { refresh, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingKit, setPendingKit] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')

  async function onResult(text: string) {
    const kit = parseKit(text)
    if (kit) {
      setOpen(false)
      setPendingKit(kit)
      return
    }
    const parsed = parsePairing(text)
    if (!parsed) {
      notify('That is not a Monetr sync code or recovery kit.', 'error')
      return
    }
    await join(parsed)
  }

  async function join(parsed: ParsedPairing) {
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
      {pasteOpen ? (
        <div className="mt-2 flex gap-2">
          <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a sync code or recovery code" />
          <Button variant="ghost" onClick={() => onResult(pasted)} disabled={!pasted.trim()}>
            Go
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setPasteOpen(true)} className="mt-1.5 w-full text-center text-[11px] font-medium text-muted underline underline-offset-2 hover:text-ink">
          Restoring from a recovery kit? Paste the code
        </button>
      )}
      <KitUnlock
        kit={pendingKit}
        onClose={() => setPendingKit(null)}
        onUnlocked={async (p) => {
          setPendingKit(null)
          await join(p)
        }}
      />
      {open ? (
        <Suspense fallback={null}>
          <QrScanner open={open} onClose={() => setOpen(false)} onResult={onResult} />
        </Suspense>
      ) : null}
    </>
  )
}
