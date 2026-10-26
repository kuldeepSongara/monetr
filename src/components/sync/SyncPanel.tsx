import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Cloud, Copy, KeyRound, Link2, QrCode, RefreshCw, ScanLine, ShieldCheck, Unlink } from 'lucide-react'
import QRCode from 'qrcode'
import { Badge, Button, Card, Confirm, Field, Input, Modal, SectionTitle, Toggle } from '../ui'
import {
  createSyncState,
  getSyncState,
  getSyncStatus,
  linkWithPairing,
  onSyncChange,
  pairingCode,
  pairingUrl,
  parsePairing,
  patchSyncState,
  setSyncState,
  syncNow,
  syncSupported,
  type ParsedPairing,
} from '../../lib/sync'
import { relativeTime } from '../../lib/dates'
import { updateSettings } from '../../db/db'

// The scanner pulls in a QR decoder; load it only when the camera is opened.
const QrScanner = lazy(() => import('./QrScanner').then((m) => ({ default: m.QrScanner })))

function useSync() {
  const subscribe = useCallback((fn: () => void) => onSyncChange(fn), [])
  const status = useSyncExternalStore(subscribe, getSyncStatus)
  const state = useSyncExternalStore(subscribe, () => localStorage.getItem('monetr:sync'))
  return { status, state: state ? getSyncState() : null }
}

export function SyncPanel({ notify }: { notify: (m: string, k?: 'info' | 'success' | 'error') => void }) {
  const { status, state } = useSync()
  const [qr, setQr] = useState('')
  const [showPair, setShowPair] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [code, setCode] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [server, setServer] = useState(state?.server ?? '')
  const unsupported = syncSupported()

  useEffect(() => {
    if (!state || !showPair) return
    QRCode.toDataURL(pairingUrl(state), { width: 260, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''))
  }, [state, showPair])

  useEffect(() => setServer(state?.server ?? ''), [state?.server])

  async function run(successMessage?: string) {
    try {
      const result = await syncNow()
      if (successMessage) notify(successMessage, 'success')
      else if (result) notify(result.changed ? `Synced · ${result.changed} change${result.changed === 1 ? '' : 's'} pulled` : 'Up to date', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Sync failed', 'error')
    }
  }

  async function enable() {
    // This device starts the sync, so its settings are the ones the other devices should pick up.
    await updateSettings({ sharedUpdatedAt: new Date().toISOString() })
    setSyncState({ ...createSyncState(), server: server.trim() || undefined })
    setShowPair(true)
    await run('Sync is on. Scan the QR with your other device to link it.')
  }

  async function link(p: ParsedPairing) {
    linkWithPairing({ ...p, server: p.server ?? (server.trim() || undefined) })
    setScanOpen(false)
    setCode('')
    await run('Device linked. Your data is merged across both devices.')
  }

  function linkFromText(text: string) {
    const parsed = parsePairing(text)
    if (!parsed) {
      notify('That is not a Monetr sync code. Scan the QR shown in Settings → Cloud sync on your other device.', 'error')
      return
    }
    void link(parsed)
  }

  const statusLine = status.running
    ? 'Syncing…'
    : status.error || state?.lastError
      ? (status.error ?? state?.lastError)
      : state?.lastSyncedAt
        ? `Last synced ${relativeTime(state.lastSyncedAt)}`
        : 'Not synced yet'

  const serverField = (
    <Field label="Sync server (optional)" hint="Leave blank when Monetr is opened from your Vercel URL. Set it to that URL when running Monetr locally.">
      <Input
        value={server}
        onChange={(e) => setServer(e.target.value)}
        onBlur={() => state && patchSyncState({ server: server.trim() || undefined })}
        placeholder="https://your-monetr.vercel.app"
        inputMode="url"
      />
    </Field>
  )

  return (
    <Card>
      <SectionTitle
        title="Cloud sync"
        sub={state ? 'End-to-end encrypted across your devices' : 'Keep your phone and laptop in step'}
        action={state ? <Badge tone={status.error || state.lastError ? 'warn' : 'good'}>{status.error || state.lastError ? 'attention' : 'on'}</Badge> : null}
      />

      {unsupported ? <p className="mb-3 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">{unsupported}</p> : null}

      {!state ? (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-muted">
            Turn sync on here, then scan the QR from your other device (or link this device by scanning the QR shown on
            the other one). Data is encrypted on the device before upload — the server only stores ciphertext.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button onClick={enable} disabled={Boolean(unsupported)}>
              <Cloud className="h-4 w-4" /> Turn on sync here
            </Button>
            <Button variant="soft" onClick={() => setScanOpen(true)} disabled={Boolean(unsupported)}>
              <ScanLine className="h-4 w-4" /> Scan QR from other device
            </Button>
          </div>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="…or paste a sync code / link" />
            <Button variant="ghost" onClick={() => linkFromText(code)} disabled={!code.trim() || Boolean(unsupported)}>
              <Link2 className="h-4 w-4" /> Link
            </Button>
          </div>
          {serverField}
        </div>
      ) : (
        <div className="space-y-3">
          <p className={`text-[11px] ${status.error || state.lastError ? 'font-medium text-warn' : 'text-muted'}`}>{statusLine}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => run()} loading={status.running}>
              <RefreshCw className="h-3.5 w-3.5" /> Sync now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPair(true)}>
              <QrCode className="h-3.5 w-3.5" /> Link another device
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setScanOpen(true)}>
              <ScanLine className="h-3.5 w-3.5" /> Scan QR
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(true)}>
              <Unlink className="h-3.5 w-3.5" /> Unlink
            </Button>
          </div>
          <Toggle
            checked={state.includeAiProfiles !== false}
            onChange={(v) => {
              patchSyncState({ includeAiProfiles: v })
              void run()
            }}
            label="Sync AI profiles"
            hint="Your AI keys follow you to linked devices (end-to-end encrypted). Turn off to keep keys on each device."
          />
          {serverField}
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
            Everything syncs — transactions, bills, budgets, investments, settings, appearance, AI profiles and your
            PIN — automatically after changes, when you open the app and when you come back online. Fingerprint
            unlock is set up separately on each device because it uses that device's sensor.
          </p>
        </div>
      )}

      <Modal open={showPair && Boolean(state)} onClose={() => setShowPair(false)} title="Link another device" subtitle="On your phone: open Monetr → Settings → Cloud sync → Scan QR. The phone camera app works too." size="sm">
        {state ? (
          <div className="flex flex-col items-center gap-3">
            {qr ? <img src={qr} alt="Sync QR code" className="h-[240px] w-[240px] rounded-lg bg-white p-2" /> : null}
            <p className="flex items-center gap-1.5 text-center text-[10px] text-warn">
              <KeyRound className="h-3 w-3" /> This QR is the key to your data. Only show it to your own devices.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(pairingCode(state))
                notify('Sync code copied', 'success')
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy sync code instead
            </Button>
          </div>
        ) : null}
      </Modal>

      {scanOpen ? (
        <Suspense fallback={null}>
          <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={linkFromText} />
        </Suspense>
      ) : null}

      <Confirm
        open={confirmUnlink}
        title="Unlink this device?"
        body="This device stops syncing. Your data stays here and on your other devices. To link again, scan the QR from a linked device."
        confirmLabel="Unlink"
        onConfirm={() => {
          setSyncState(null)
          setConfirmUnlink(false)
          notify('Sync unlinked on this device', 'info')
        }}
        onClose={() => setConfirmUnlink(false)}
      />
    </Card>
  )
}
