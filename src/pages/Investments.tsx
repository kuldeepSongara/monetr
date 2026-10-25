import { useEffect, useMemo, useState } from 'react'
import { Plus, TrendingUp, Wallet, ArrowRightLeft } from 'lucide-react'
import { Card, Button, SectionTitle, EmptyState as Empty, Badge } from '../components/ui'
import { useApp } from '../store'
import { addInvestment, addInvestmentTx, deleteInvestment, listCurrencyProfiles } from '../db/db'
import { minorFactor } from '../lib/money'
import { todayISO } from '../lib/dates'
import { uid } from '../lib/utils'
import type { Investment, InvestmentTx, InvestmentType } from '../types'
import { db } from '../db/db'

const TYPES: { id: InvestmentType; label: string }[] = [
  { id: 'stock', label: 'Stock' },
  { id: 'etf', label: 'ETF' },
  { id: 'mutualfund', label: 'Mutual Fund' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'fd', label: 'FD' },
  { id: 'bond', label: 'Bond' },
  { id: 'other', label: 'Other' },
]

export default function Investments() {
  const { notify, refresh } = useApp()
  const [profiles, setProfiles] = useState<any[]>([])
  const [investments, setInvestments] = useState<Investment[]>([])
  const [txs, setTxs] = useState<InvestmentTx[]>([])
  const [showNew, setShowNew] = useState(false)
  const [showTx, setShowTx] = useState<string | null>(null)
  const [showTransfer, setShowTransfer] = useState(false)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({ profileId: '', type: 'stock' as InvestmentType, symbol: '', name: '', account: '', openedAt: todayISO() })
  const [txForm, setTxForm] = useState({ type: 'buy' as any, date: todayISO(), qty: '', price: '', amount: '', fees: '', note: '' })
  const [tr, setTr] = useState({ type: 'redeem-and-invest', date: todayISO(), fromProfileId: '', fromInvestmentId: '', fromAmount: '', toProfileId: '', toInvestmentId: '', toAmount: '', fxRate: '', fees: '', feeCurrency: '' })

  async function load() {
    const [p, inv, itx] = await Promise.all([
      listCurrencyProfiles(),
      (await import('../db/db')).db.investments.toArray(),
      (await import('../db/db')).db.investmentTxs.toArray(),
    ])
    setProfiles(p)
    setInvestments(inv)
    setTxs(itx)
    if (!form.profileId && p[0]?.id) setForm((f) => ({ ...f, profileId: p[0].id }))
  }

  useEffect(() => { load() }, [])

  const byInv = useMemo(() => {
    const map = new Map<string, InvestmentTx[]>()
    for (const t of txs) map.set(t.investmentId, [...(map.get(t.investmentId) || []), t])
    return map
  }, [txs])

  const totals = useMemo(() => {
    let investedBase = 0
    for (const inv of investments) {
      const its = byInv.get(inv.id) || []
      for (const t of its) {
        if (t.type === 'buy') investedBase += t.baseAmount
        if (t.type === 'sell') investedBase -= t.baseAmount
      }
    }
    return { investedBase }
  }, [investments, byInv])

  async function createInv() {
    if (!form.name || !form.profileId) return notify('Name and profile required', 'error')
    setBusy(true)
    try {
      await addInvestment({ ...form, name: form.name.trim() })
      setShowNew(false)
      setForm({ ...form, symbol: '', name: '', account: '' })
      await load(); await refresh()
      notify('Investment added', 'success')
    } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }

  async function addTx() {
    if (!showTx) return
    const inv = investments.find((i) => i.id === showTx)
    const prof = profiles.find((p) => p.id === inv?.profileId)
    if (!inv || !prof) return
    setBusy(true)
    try {
      const fxRate = prof.fxToBase || 1
      const amtMinor = txForm.amount ? Math.round(Number(txForm.amount) * minorFactor(inv.currency)) : (txForm.price && txForm.qty ? Math.round(Number(txForm.price) * Number(txForm.qty) * minorFactor(inv.currency)) : 0)
      await addInvestmentTx({
        investmentId: inv.id,
        profileId: inv.profileId,
        type: txForm.type,
        date: txForm.date,
        qty: txForm.qty ? Number(txForm.qty) : undefined,
        price: txForm.price ? Math.round(Number(txForm.price) * minorFactor(inv.currency)) : undefined,
        amount: amtMinor,
        currency: inv.currency,
        fxRate,
        baseAmount: Math.round(amtMinor * fxRate),
        fees: txForm.fees ? Math.round(Number(txForm.fees) * minorFactor(inv.currency)) : 0,
        note: txForm.note || undefined,
      })
      setShowTx(null)
      setTxForm({ type: 'buy', date: todayISO(), qty: '', price: '', amount: '', fees: '', note: '' })
      await load(); await refresh()
      notify('Transaction added', 'success')
    } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }

  async function doTransfer() {
    if (!tr.fromProfileId || !tr.toProfileId || !tr.fromAmount || !tr.toAmount || !tr.fxRate) return notify('Fill required fields', 'error')
    setBusy(true)
    try {
      const fromP = profiles.find((p:any)=>p.id===tr.fromProfileId)
      const toP = profiles.find((p:any)=>p.id===tr.toProfileId)
      const fromInv = investments.find((i:any)=>i.id===tr.fromInvestmentId)
      const toInv = investments.find((i:any)=>i.id===tr.toInvestmentId)
      const fromCur = fromInv?.currency || fromP?.code
      const toCur = toInv?.currency || toP?.code
      const linkedTxIds: string[] = []
      if (fromInv) {
        const fx = fromP?.fxToBase || 1
        const amt = Math.round(Number(tr.fromAmount)*minorFactor(fromCur))
        const t = await addInvestmentTx({ investmentId: fromInv.id, profileId: fromInv.profileId, type:'transfer', date: tr.date, amount: amt, currency: fromCur, fxRate: fx, baseAmount: Math.round(amt*fx), note: `Transfer out to ${toP?.name}` })
        linkedTxIds.push(t.id)
      }
      let toInvId = toInv?.id
      if (!toInvId && toCur) {
        const ni = await addInvestment({ profileId: tr.toProfileId, currency: toCur, type: 'other', name: `Repatriated - ${toP?.name||toCur}` } as any)
        toInvId = ni.id
      }
      if (toInvId) {
        const fx2 = toP?.fxToBase || 1
        const amt2 = Math.round(Number(tr.toAmount)*minorFactor(toCur))
        const t2 = await addInvestmentTx({ investmentId: toInvId, profileId: tr.toProfileId, type:'buy', date: tr.date, amount: amt2, currency: toCur, fxRate: fx2, baseAmount: Math.round(amt2*fx2), note: `Transfer in from ${fromP?.name} @ ${tr.fxRate}` })
        linkedTxIds.push(t2.id)
      }
      await db.investmentTransfers.put({ id: uid('trf_'), type: tr.type, date: tr.date, fromProfileId: tr.fromProfileId, fromCurrency: fromCur, fromInvestmentId: tr.fromInvestmentId||undefined, fromAmount: Math.round(Number(tr.fromAmount)*minorFactor(fromCur)), toProfileId: tr.toProfileId, toCurrency: toCur, toInvestmentId: toInvId, toAmount: Math.round(Number(tr.toAmount)*minorFactor(toCur)), fxRate: Number(tr.fxRate), fees: tr.fees?Math.round(Number(tr.fees)*minorFactor(tr.feeCurrency||fromCur)):0, feeCurrency: tr.feeCurrency||fromCur, feeBaseAmount: 0, note: undefined, linkedTxIds, createdAt: new Date().toISOString() })
      setShowTransfer(false)
      setTr({ type:'redeem-and-invest', date:todayISO(), fromProfileId:'', fromInvestmentId:'', fromAmount:'', toProfileId:'', toInvestmentId:'', toAmount:'', fxRate:'', fees:'', feeCurrency:'' })
      await load(); await refresh()
      notify('Transfer recorded with linked transactions', 'success')
    } catch(e:any){ notify(e.message,'error') } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">Investments</h1>
          <p className="text-sm text-muted">Track holdings across currency profiles (works abroad too).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="soft" onClick={() => setShowTransfer(true)}><ArrowRightLeft className="h-4 w-4" /> Transfer between profiles</Button>
          <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> Add investment</Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="card-pad flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/12 text-accent"><Wallet className="h-5 w-5" /></div>
          <div><p className="text-xs text-muted">Holdings</p><p className="text-lg font-semibold text-ink">{investments.filter(i=>!i.archived).length}</p></div>
        </Card>
        <Card className="card-pad flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-good/12 text-good"><TrendingUp className="h-5 w-5" /></div>
          <div><p className="text-xs text-muted">Profiles</p><p className="text-lg font-semibold text-ink">{profiles.length}</p></div>
        </Card>
      </div>

      {investments.length === 0 ? (
        <Empty title="No investments yet" body="Add your first investment and log buy/sell/dividend transactions." action={<Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4" /> Add investment</Button>} />
      ) : (
        <div className="grid gap-3">
          {investments.map((inv) => {
            const prof = profiles.find((p) => p.id === inv.profileId)
            const its = byInv.get(inv.id) || []
            return (
              <Card key={inv.id} className="card-pad">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ink">{inv.name} {inv.symbol ? `(${inv.symbol})` : ''}</p>
                      <Badge tone="neutral">{TYPES.find(t=>t.id===inv.type)?.label}</Badge>
                      {prof && <Badge tone="neutral">{prof.emoji || ''} {prof.code}</Badge>}
                    </div>
                    <p className="text-xs text-muted">{its.length} transactions</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="soft" onClick={() => setShowTx(inv.id)}><Plus className="h-3.5 w-3.5" /> Add transaction</Button>
                    <Button size="sm" variant="ghost" onClick={async()=>{await deleteInvestment(inv.id); await load(); await refresh()}}>Delete</Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md card-pad">
            <SectionTitle title="Add investment" sub="Create a holding under a currency profile" />
            <div className="mt-3 grid gap-2">
              <select className="input" value={form.profileId} onChange={(e)=>setForm({...form,profileId:e.target.value})}>
                {profiles.map(p=><option key={p.id} value={p.id}>{p.emoji} {p.name} ({p.code})</option>)}
              </select>
              <select className="input" value={form.type} onChange={(e)=>setForm({...form,type:e.target.value as any})}>
                {TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input className="input" placeholder="Name (e.g. Apple Inc)" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} />
              <input className="input" placeholder="Symbol (e.g. AAPL)" value={form.symbol} onChange={(e)=>setForm({...form,symbol:e.target.value})} />
              <input className="input" placeholder="Account/broker (optional)" value={form.account} onChange={(e)=>setForm({...form,account:e.target.value})} />
              <input className="input" type="date" value={form.openedAt} onChange={(e)=>setForm({...form,openedAt:e.target.value})} />
              <div className="flex gap-2">
                <Button onClick={createInv} loading={busy}>Create</Button>
                <Button variant="ghost" onClick={()=>setShowNew(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md card-pad">
            <SectionTitle title="Add investment transaction" sub="Buy/Sell/Dividend/Fee" />
            <div className="mt-3 grid gap-2">
              <select className="input" value={txForm.type} onChange={(e)=>setTxForm({...txForm,type:e.target.value})}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
                <option value="fee">Fee</option>
                <option value="interest">Interest</option>
                <option value="transfer">Transfer</option>
              </select>
              <input className="input" type="date" value={txForm.date} onChange={(e)=>setTxForm({...txForm,date:e.target.value})} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="Qty (optional)" value={txForm.qty} onChange={(e)=>setTxForm({...txForm,qty:e.target.value})} />
                <input className="input" placeholder="Price per unit (optional)" value={txForm.price} onChange={(e)=>setTxForm({...txForm,price:e.target.value})} />
              </div>
              <input className="input" placeholder="Total amount (required)" value={txForm.amount} onChange={(e)=>setTxForm({...txForm,amount:e.target.value})} />
              <input className="input" placeholder="Fees (optional)" value={txForm.fees} onChange={(e)=>setTxForm({...txForm,fees:e.target.value})} />
              <input className="input" placeholder="Note (optional)" value={txForm.note} onChange={(e)=>setTxForm({...txForm,note:e.target.value})} />
              <div className="flex gap-2">
                <Button onClick={addTx} loading={busy}>Add</Button>
                <Button variant="ghost" onClick={()=>setShowTx(null)}>Cancel</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg card-pad max-h-[90vh] overflow-auto">
            <SectionTitle title="Transfer between currency profiles" sub="Preserve history with FX + fees" />
            <div className="mt-3 grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={tr.fromProfileId} onChange={(e)=>setTr({...tr,fromProfileId:e.target.value})}><option value="">From profile</option>{profiles.map((p:any)=><option key={p.id} value={p.id}>{p.emoji} {p.name} ({p.code})</option>)}</select>
                <select className="input" value={tr.toProfileId} onChange={(e)=>setTr({...tr,toProfileId:e.target.value})}><option value="">To profile</option>{profiles.map((p:any)=><option key={p.id} value={p.id}>{p.emoji} {p.name} ({p.code})</option>)}</select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={tr.fromInvestmentId} onChange={(e)=>setTr({...tr,fromInvestmentId:e.target.value})}><option value="">From investment/cash (optional)</option>{investments.filter((i:any)=>i.profileId===tr.fromProfileId).map((i:any)=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
                <select className="input" value={tr.toInvestmentId} onChange={(e)=>setTr({...tr,toInvestmentId:e.target.value})}><option value="">To investment (create if empty)</option>{investments.filter((i:any)=>i.profileId===tr.toProfileId).map((i:any)=><option key={i.id} value={i.id}>{i.name}</option>)}</select>
              </div>
              <input className="input" type="date" value={tr.date} onChange={(e)=>setTr({...tr,date:e.target.value})} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="Debited amount (source)" value={tr.fromAmount} onChange={(e)=>setTr({...tr,fromAmount:e.target.value})} />
                <input className="input" placeholder="Credited amount (destination)" value={tr.toAmount} onChange={(e)=>setTr({...tr,toAmount:e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="FX rate used by bank" value={tr.fxRate} onChange={(e)=>setTr({...tr,fxRate:e.target.value})} />
                <input className="input" placeholder="Fees" value={tr.fees} onChange={(e)=>setTr({...tr,fees:e.target.value})} />
              </div>
              <p className="text-[11px] text-muted">Enter actual debited/credited amounts from your bank app (banks rarely give mid-market). History is preserved.</p>
              <div className="flex gap-2">
                <Button onClick={doTransfer} loading={busy}>Record transfer</Button>
                <Button variant="ghost" onClick={()=>setShowTransfer(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
