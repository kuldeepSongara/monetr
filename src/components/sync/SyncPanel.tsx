import { useEffect, useState } from 'react'
import { QrCode, Link, RefreshCw, Copy, Unlink, Cloud } from 'lucide-react'
import { Card, Button, Input, SectionTitle, Badge } from '../../components/ui'
import { generateSyncId, generateDeviceId, getSyncState, setSyncState, compressSnapshot, decompressSnapshot, buildSnapshot } from '../../lib/sync'
import { db } from '../../db/db'
import QRCode from 'qrcode'

export function SyncPanel({ notify, refresh }: { notify: (m: string, k?: any) => void; refresh: () => Promise<void> }) {
  const [state, setState] = useState<any>(() => getSyncState())
  const [qr, setQr] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastSync, setLastSync] = useState(state?.lastSyncedAt || null)

  useEffect(() => {
    if (state?.syncId && state?.showQr) {
      const payload = JSON.stringify({ syncId: state.syncId, t: Date.now() })
      QRCode.toDataURL(payload, { width: 220, margin: 1 })
        .then(setQr)
        .catch(() => {})
    }
  }, [state?.syncId, state?.showQr])

  async function enable() {
    const syncId = generateSyncId()
    const deviceId = generateDeviceId()
    const next = { enabled: true, syncId, deviceId, showQr: true, linkedAt: new Date().toISOString() }
    setSyncState(next)
    setState(next)
    notify('Sync enabled. Scan QR with your other device', 'success')
  }

  async function copy() {
    if (!state?.syncId) return
    await navigator.clipboard.writeText(state.syncId)
    notify('Sync ID copied', 'success')
  }

  async function link() {
    if (!input.trim()) return
    const next = { ...(state || {}), enabled: true, syncId: input.trim(), showQr: false }
    setSyncState(next)
    setState(next)
    setInput('')
    notify('Device linked', 'success')
    await syncNow()
  }

  async function showQrAgain() {
    if (!state?.syncId) return
    const next = { ...state, showQr: true }
    setSyncState(next)
    setState(next)
  }

  async function syncNow() {
    if (!state?.enabled || !state?.syncId) return
    setBusy(true)
    try {
      const [settingsArr, categories, transactions, bills, payments, budgets, profiles, rules, currencyProfiles, investments, investmentTxs, investmentTransfers, flags, flagIdeas, imports] = await Promise.all([
        db.settings.toArray(),
        db.categories.toArray(),
        db.transactions.toArray(),
        db.bills.toArray(),
        db.billPayments.toArray(),
        db.budgets.toArray(),
        db.profiles.toArray(),
        db.rules.toArray(),
        db.currencyProfiles.toArray(),
        db.investments.toArray(),
        db.investmentTxs.toArray(),
        db.investmentTransfers.toArray(),
        db.flags.toArray(),
        db.flagIdeas.toArray(),
        db.imports.toArray(),
      ])
      const snapshot = buildSnapshot({
        settings: settingsArr[0],
        categories,
        transactions,
        bills,
        billPayments: payments,
        budgets,
        profiles,
        rules,
        currencyProfiles,
        investments,
        investmentTxs,
        investmentTransfers,
        flags,
        flagIdeas,
        imports,
      })
      const data = compressSnapshot(snapshot)
      await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncId: state.syncId, data, deviceId: state.deviceId }),
      })
      const at = new Date().toISOString()
      const next = { ...state, lastSyncedAt: at }
      setSyncState(next)
      setState(next)
      setLastSync(at)
      notify('Synced to cloud', 'success')
    } catch (e: any) {
      notify(e.message || 'Sync failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function pull() {
    if (!state?.enabled || !state?.syncId) return
    setBusy(true)
    try {
      const res = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncId: state.syncId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const snapshot: any = decompressSnapshot(json.data)
      await db.transaction('rw', [db.settings, db.profiles, db.categories, db.transactions, db.bills, db.billPayments, db.budgets, db.rules], async () => {
        await Promise.all([
          db.settings.clear(),
          db.profiles.clear(),
          db.categories.clear(),
          db.transactions.clear(),
          db.bills.clear(),
          db.billPayments.clear(),
          db.budgets.clear(),
          db.rules.clear(),
        ])
        if (snapshot.settings) await db.settings.put(snapshot.settings)
        if (snapshot.profiles?.length) await db.profiles.bulkPut(snapshot.profiles)
        if (snapshot.categories?.length) await db.categories.bulkPut(snapshot.categories)
        if (snapshot.transactions?.length) await db.transactions.bulkPut(snapshot.transactions)
        if (snapshot.bills?.length) await db.bills.bulkPut(snapshot.bills)
        if (snapshot.billPayments?.length) await db.billPayments.bulkPut(snapshot.billPayments)
        if (snapshot.budgets?.length) await db.budgets.bulkPut(snapshot.budgets)
        if (snapshot.rules?.length) await db.rules.bulkPut(snapshot.rules)
      })
      await refresh()
      notify('Pulled from cloud', 'success')
    } catch (e: any) {
      notify(e.message || 'Pull failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  function unlink() {
    localStorage.removeItem('monetr:sync')
    setState(null)
    notify('Sync unlinked from this device', 'info')
  }

  if (!state?.enabled) {
    return (
      <Card>
        <SectionTitle title="Cloud sync" sub="Link your phone and laptop with a QR code" />
        <p className="text-xs text-muted">Start on your laptop, enable sync, scan the QR with your phone to link both devices. After that they stay in sync automatically.</p>
        <Button className="mt-3" onClick={enable}>
          <Cloud className="h-4 w-4" /> Enable sync
        </Button>
      </Card>
    )
  }

  return (
    <Card>
      <SectionTitle title="Cloud sync" sub="Linked across devices" action={<Badge tone="good">Enabled</Badge>} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="soft" onClick={syncNow} loading={busy}><RefreshCw className="h-3.5 w-3.5" /> Sync now</Button>
        <Button size="sm" variant="ghost" onClick={pull} loading={busy}><RefreshCw className="h-3.5 w-3.5" /> Pull from cloud</Button>
        <Button size="sm" variant="ghost" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copy Sync ID</Button>
        {!qr && <Button size="sm" variant="ghost" onClick={showQrAgain}><QrCode className="h-3.5 w-3.5" /> Show QR</Button>}
        <Button size="sm" variant="ghost" onClick={unlink}><Unlink className="h-3.5 w-3.5" /> Unlink</Button>
      </div>
      {lastSync && <p className="mt-2 text-[10px] text-muted">Last sync: {new Date(lastSync).toLocaleString()}</p>}
      {qr && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-line/70 bg-surface2/40 p-4">
          <p className="text-xs font-medium text-ink">Scan this QR with your other device</p>
          <img src={qr} alt="Sync QR" className="h-[220px] w-[220px] rounded-md" />
          <p className="text-[10px] text-muted text-center">Open Monetr on your phone → Settings → Cloud sync → Paste the Sync ID</p>
        </div>
      )}
      {!qr && (
        <div className="mt-3 flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste Sync ID to link this device" />
          <Button onClick={link}><Link className="h-4 w-4" /> Link</Button>
        </div>
      )}
    </Card>
  )
}
