import { useMemo, useState } from 'react'
import { ArrowRightLeft, ChevronDown, LineChart, Pencil, Plus, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useApp } from '../store'
import type { Investment, InvestmentTxType, InvestmentType } from '../types'
import { addInvestment, addInvestmentTx, db, deleteInvestment, deleteInvestmentTx, updateInvestment } from '../db/db'
import { CURRENCIES, formatMoney, fromMajorString, majorString, toBaseMinor } from '../lib/money'
import { formatDate, toISO, todayISO } from '../lib/dates'
import { uid } from '../lib/utils'
import { computeHolding, fxToBaseFor, portfolioTotals, type Holding } from '../lib/investments'
import { Badge, Button, Card, Confirm, EmptyState, Field, Input, Modal, Select, cn } from '../components/ui'

const TYPES: { id: InvestmentType; label: string }[] = [
  { id: 'stock', label: 'Stock' },
  { id: 'etf', label: 'ETF' },
  { id: 'mutualfund', label: 'Mutual fund' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'fd', label: 'Fixed deposit' },
  { id: 'bond', label: 'Bond' },
  { id: 'other', label: 'Other / cash' },
]

const TX_TYPES: { id: InvestmentTxType; label: string }[] = [
  { id: 'buy', label: 'Buy / deposit' },
  { id: 'sell', label: 'Sell / withdraw' },
  { id: 'dividend', label: 'Dividend' },
  { id: 'interest', label: 'Interest' },
  { id: 'fee', label: 'Fee' },
  { id: 'transfer', label: 'Transfer out' },
]

const num = (s: string) => {
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}

function Pnl({ minor, currency, pct }: { minor: number; currency: string; pct?: number | null }) {
  const up = minor >= 0
  return (
    <span className={cn('tnum font-semibold', up ? 'text-good' : 'text-bad')}>
      {formatMoney(minor, currency, { signed: true })}
      {pct !== undefined && pct !== null ? ` (${up ? '+' : ''}${pct.toFixed(1)}%)` : ''}
    </span>
  )
}

export default function Investments() {
  const { investments, investmentTxs, currencyProfiles, settings, refresh, notify } = useApp()
  const base = settings.currency
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [txFor, setTxFor] = useState<Investment | null>(null)
  const [priceFor, setPriceFor] = useState<Holding | null>(null)
  const [deleting, setDeleting] = useState<Investment | null>(null)
  const [showTransfer, setShowTransfer] = useState(false)
  const [busy, setBusy] = useState(false)

  const holdings = useMemo(
    () => investments.filter((i) => !i.archived).map((inv) => computeHolding(inv, investmentTxs, base, currencyProfiles)),
    [investments, investmentTxs, base, currencyProfiles],
  )
  const totals = portfolioTotals(holdings)
  const unknownValues = holdings.filter((h) => !h.valueKnown && h.cost > 0).length
  const profileOf = (id: string) => currencyProfiles.find((p) => p.id === id)

  /* --------------------------- new investment --------------------------- */
  const defaultProfile = currencyProfiles.find((p) => p.isDefault) ?? currencyProfiles[0]
  const [form, setForm] = useState({ profileId: '', currency: '', type: 'stock' as InvestmentType, symbol: '', name: '', account: '', openedAt: todayISO() })
  function openNew() {
    setForm({ profileId: defaultProfile?.id ?? '', currency: defaultProfile?.code ?? base, type: 'stock', symbol: '', name: '', account: '', openedAt: todayISO() })
    setShowNew(true)
  }
  async function createInv() {
    if (!form.name.trim() || !form.profileId) return notify('Name and profile are required', 'error')
    setBusy(true)
    try {
      await addInvestment({ ...form, name: form.name.trim(), symbol: form.symbol.trim() || undefined, account: form.account.trim() || undefined })
      await refresh()
      setShowNew(false)
      notify('Investment added — log a buy to start tracking it', 'success')
    } finally {
      setBusy(false)
    }
  }

  /* ---------------------------- transaction ----------------------------- */
  const [txForm, setTxForm] = useState({ type: 'buy' as InvestmentTxType, date: todayISO(), qty: '', price: '', amount: '', fees: '', fx: '', note: '' })
  function openTx(inv: Investment) {
    const { rate } = fxToBaseFor(inv.currency, base, currencyProfiles, investmentTxs)
    setTxForm({ type: 'buy', date: todayISO(), qty: '', price: '', amount: '', fees: '', fx: inv.currency === base ? '1' : String(rate), note: '' })
    setTxFor(inv)
  }
  const txAuto = (() => {
    const q = num(txForm.qty)
    const p = num(txForm.price)
    return q > 0 && p > 0 ? q * p : NaN
  })()
  async function addTx() {
    if (!txFor) return
    const amountMajor = txForm.amount.trim() ? num(txForm.amount) : txAuto
    if (!(amountMajor > 0)) return notify('Enter the total amount (or quantity and price)', 'error')
    const fx = txFor.currency === base ? 1 : num(txForm.fx)
    if (!(fx > 0)) return notify(`Enter the ${txFor.currency} → ${base} rate`, 'error')
    const amount = fromMajorString(String(amountMajor), txFor.currency) ?? 0
    setBusy(true)
    try {
      await addInvestmentTx({
        investmentId: txFor.id,
        profileId: txFor.profileId,
        type: txForm.type,
        date: txForm.date,
        qty: txForm.qty.trim() ? num(txForm.qty) : undefined,
        price: txForm.price.trim() ? (fromMajorString(txForm.price, txFor.currency) ?? undefined) : undefined,
        amount,
        currency: txFor.currency,
        fxRate: fx,
        baseAmount: toBaseMinor(amount, txFor.currency, fx, base),
        fees: txForm.fees.trim() ? (fromMajorString(txForm.fees, txFor.currency) ?? 0) : 0,
        note: txForm.note.trim() || undefined,
      })
      await refresh()
      setTxFor(null)
      notify('Transaction added', 'success')
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------- price -------------------------------- */
  const [priceInput, setPriceInput] = useState('')
  function openPrice(h: Holding) {
    const inv = h.investment
    setPriceInput(
      h.qty > 0
        ? inv.currentPrice !== undefined
          ? majorString(inv.currentPrice, inv.currency)
          : ''
        : inv.currentValue !== undefined
          ? majorString(inv.currentValue, inv.currency)
          : '',
    )
    setPriceFor(h)
  }
  async function savePrice() {
    if (!priceFor) return
    const minor = fromMajorString(priceInput, priceFor.investment.currency)
    if (minor === null || minor < 0) return notify('Enter a valid number', 'error')
    await updateInvestment(priceFor.investment.id, {
      ...(priceFor.qty > 0 ? { currentPrice: minor } : { currentValue: minor }),
      priceUpdatedAt: new Date().toISOString(),
    })
    await refresh()
    setPriceFor(null)
  }

  /* ------------------------------ transfer ------------------------------ */
  const [tr, setTr] = useState({ date: todayISO(), fromProfileId: '', fromInvestmentId: '', fromAmount: '', toProfileId: '', toInvestmentId: '', toAmount: '', fees: '', note: '' })
  const fromP = profileOf(tr.fromProfileId)
  const toP = profileOf(tr.toProfileId)
  const fromInv = investments.find((i) => i.id === tr.fromInvestmentId)
  const toInv = investments.find((i) => i.id === tr.toInvestmentId)
  const fromCur = fromInv?.currency ?? fromP?.code ?? base
  const toCur = toInv?.currency ?? toP?.code ?? base
  const bankRate = num(tr.toAmount) > 0 && num(tr.fromAmount) > 0 ? num(tr.toAmount) / num(tr.fromAmount) : null

  async function doTransfer() {
    if (!fromP || !toP) return notify('Choose both profiles', 'error')
    const fromAmount = fromMajorString(tr.fromAmount, fromCur)
    const toAmount = fromMajorString(tr.toAmount, toCur)
    if (!fromAmount || !toAmount) return notify('Enter the amount debited and the amount credited', 'error')
    const fees = tr.fees.trim() ? (fromMajorString(tr.fees, fromCur) ?? 0) : 0
    const fxFrom = fxToBaseFor(fromCur, base, currencyProfiles, investmentTxs).rate
    const fxTo = fxToBaseFor(toCur, base, currencyProfiles, investmentTxs).rate
    setBusy(true)
    try {
      const linked: string[] = []
      if (fromInv) {
        const t = await addInvestmentTx({
          investmentId: fromInv.id,
          profileId: fromInv.profileId,
          type: 'transfer',
          date: tr.date,
          amount: fromAmount,
          currency: fromCur,
          fxRate: fxFrom,
          baseAmount: toBaseMinor(fromAmount, fromCur, fxFrom, base),
          fees,
          note: `Transfer to ${toP.name}${tr.note ? ` · ${tr.note}` : ''}`,
        })
        linked.push(t.id)
      }
      const target = toInv ?? (await addInvestment({ profileId: toP.id, currency: toCur, type: 'other', name: `Cash · ${toP.name}` }))
      const t2 = await addInvestmentTx({
        investmentId: target.id,
        profileId: toP.id,
        type: 'buy',
        date: tr.date,
        amount: toAmount,
        currency: toCur,
        fxRate: fxTo,
        baseAmount: toBaseMinor(toAmount, toCur, fxTo, base),
        note: `Transfer from ${fromP.name}${bankRate ? ` @ ${bankRate.toFixed(4)}` : ''}`,
      })
      linked.push(t2.id)
      const now = new Date().toISOString()
      await db.investmentTransfers.put({
        id: uid('trf_'),
        type: fromInv ? 'redeem-and-invest' : 'deposit',
        date: tr.date,
        fromProfileId: fromP.id,
        fromCurrency: fromCur,
        fromInvestmentId: fromInv?.id,
        fromAmount,
        toProfileId: toP.id,
        toCurrency: toCur,
        toInvestmentId: target.id,
        toAmount,
        fxRate: bankRate ?? 0,
        fees,
        feeCurrency: fromCur,
        feeBaseAmount: toBaseMinor(fees, fromCur, fxFrom, base),
        note: tr.note || undefined,
        linkedTxIds: linked,
        createdAt: now,
        updatedAt: now,
      })
      await refresh()
      setShowTransfer(false)
      notify('Transfer recorded', 'success')
    } finally {
      setBusy(false)
    }
  }

  const profileOptions = currencyProfiles.map((p) => (
    <option key={p.id} value={p.id}>
      {p.emoji} {p.name} ({p.code})
    </option>
  ))

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="soft" onClick={() => setShowTransfer(true)} disabled={currencyProfiles.length < 1}>
          <ArrowRightLeft className="h-4 w-4" /> Transfer
        </Button>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Add investment
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat icon={<Wallet className="h-4 w-4" />} label="Invested (cost)" value={formatMoney(totals.cost, base)} />
        <Stat icon={<LineChart className="h-4 w-4" />} label="Current value" value={formatMoney(totals.value, base)} hint={unknownValues ? `${unknownValues} without a price` : undefined} />
        <Stat
          icon={totals.unrealised >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          label="Unrealised P/L"
          value={<Pnl minor={totals.unrealised} currency={base} pct={totals.cost ? (totals.unrealised / totals.cost) * 100 : null} />}
        />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Realised + income" value={<Pnl minor={totals.realised + totals.income} currency={base} />} />
      </div>

      {currencyProfiles.length < 2 ? (
        <p className="rounded-xl border border-line/70 bg-surface2/40 px-3 py-2 text-[11px] text-muted">
          Hold money in more than one country? Add currency profiles in Settings → Currency profiles, then record transfers between them here.
        </p>
      ) : null}

      {holdings.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="No investments yet"
            body="Add a holding, then log buys, sells and dividends. Monetr works out quantity, average cost and profit."
            action={
              <Button size="sm" onClick={openNew}>
                <Plus className="h-3.5 w-3.5" /> Add investment
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {holdings.map((h) => {
            const inv = h.investment
            const prof = profileOf(inv.profileId)
            const open = expanded === inv.id
            const cur = inv.currency
            return (
              <Card key={inv.id} className="p-0">
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {inv.name} {inv.symbol ? <span className="text-muted">· {inv.symbol}</span> : null}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge>{TYPES.find((t) => t.id === inv.type)?.label}</Badge>
                        {prof ? (
                          <Badge>
                            {prof.emoji} {prof.name}
                          </Badge>
                        ) : null}
                        <Badge>{cur}</Badge>
                        {inv.account ? <Badge>{inv.account}</Badge> : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="tnum text-sm font-bold text-ink">{formatMoney(h.value, cur)}</p>
                      {h.valueKnown ? (
                        <p className="text-[11px]">
                          <Pnl minor={h.unrealised} currency={cur} pct={h.cost ? (h.unrealised / h.cost) * 100 : null} />
                        </p>
                      ) : (
                        <p className="text-[10px] text-warn">at cost · add a price</p>
                      )}
                      {cur !== base ? <p className="tnum text-[10px] text-muted">≈ {formatMoney(h.base.value, base)}</p> : null}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted">
                    <span>
                      {h.qty > 0 ? (
                        <>
                          Qty <span className="tnum font-semibold text-ink">{h.qty}</span>
                        </>
                      ) : (
                        'Amount-based'
                      )}
                    </span>
                    <span>
                      {h.qty > 0 ? (
                        <>
                          Avg <span className="tnum font-semibold text-ink">{formatMoney(h.avgCost, cur)}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="text-right">
                      Cost <span className="tnum font-semibold text-ink">{formatMoney(h.cost, cur)}</span>
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="soft" onClick={() => openTx(inv)}>
                      <Plus className="h-3 w-3" /> Transaction
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openPrice(h)}>
                      <Pencil className="h-3 w-3" /> {h.qty > 0 ? 'Update price' : 'Update value'}
                    </Button>
                    <Button size="sm" variant="plain" className="px-1.5 text-muted" onClick={() => setDeleting(inv)} aria-label="Delete investment">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <button type="button" onClick={() => setExpanded(open ? null : inv.id)} className="ml-auto flex items-center gap-1 text-[10px] font-medium text-muted">
                      {h.txs.length} transaction{h.txs.length === 1 ? '' : 's'}
                      <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
                    </button>
                  </div>
                  {inv.priceUpdatedAt ? <p className="mt-1 text-[9px] text-muted">Price updated {formatDate(toISO(new Date(inv.priceUpdatedAt)), 'short')}</p> : null}
                </div>

                {open ? (
                  <div className="border-t border-line/60 bg-surface2/30 px-3.5 py-3">
                    {h.txs.length ? (
                      <div className="space-y-1.5">
                        {[...h.txs].reverse().map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-[11px]">
                            <span className="w-16 shrink-0 text-muted">{formatDate(t.date, 'short')}</span>
                            <span className="w-20 shrink-0 font-medium capitalize text-ink">{t.type}</span>
                            <span className="min-w-0 flex-1 truncate text-muted">
                              {t.qty ? `${t.qty} × ${t.price ? formatMoney(t.price, t.currency) : '?'}` : ''}
                              {t.note ? ` ${t.note}` : ''}
                            </span>
                            <span className="tnum font-semibold text-ink">{formatMoney(t.amount, t.currency)}</span>
                            <button
                              type="button"
                              className="text-muted hover:text-bad"
                              aria-label="Delete transaction"
                              onClick={async () => {
                                await deleteInvestmentTx(t.id)
                                await refresh()
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        {h.realised || h.income || h.feesPaid ? (
                          <p className="pt-1.5 text-[10px] text-muted">
                            Realised {formatMoney(h.realised, cur)} · income {formatMoney(h.income, cur)} · fees {formatMoney(h.feesPaid, cur)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted">No transactions yet. Log a buy (or deposit) to start.</p>
                    )}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      {/* ----------------------------- modals ------------------------------ */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="Add investment"
        subtitle="A holding inside one of your currency profiles"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={createInv} loading={busy}>
              Create
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Profile">
              <Select
                value={form.profileId}
                onChange={(e) => setForm({ ...form, profileId: e.target.value, currency: profileOf(e.target.value)?.code ?? form.currency })}
              >
                {profileOptions}
              </Select>
            </Field>
            <Field label="Currency" hint="Defaults to the profile's currency">
              <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as InvestmentType })}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Vanguard S&P 500" />
            </Field>
            <Field label="Symbol (optional)">
              <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="e.g. VOO" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account / broker">
              <Input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="optional" />
            </Field>
            <Field label="Opened">
              <Input type="date" value={form.openedAt} onChange={(e) => setForm({ ...form, openedAt: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(txFor)}
        onClose={() => setTxFor(null)}
        title={`Transaction · ${txFor?.name ?? ''}`}
        subtitle={txFor ? `Amounts in ${txFor.currency}` : undefined}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setTxFor(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={addTx} loading={busy}>
              Add
            </Button>
          </div>
        }
      >
        {txFor ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value as InvestmentTxType })}>
                  {TX_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date">
                <Input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} />
              </Field>
            </div>
            {['buy', 'sell', 'transfer'].includes(txForm.type) ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity (optional)">
                  <Input value={txForm.qty} onChange={(e) => setTxForm({ ...txForm, qty: e.target.value })} inputMode="decimal" />
                </Field>
                <Field label="Price per unit">
                  <Input value={txForm.price} onChange={(e) => setTxForm({ ...txForm, price: e.target.value })} inputMode="decimal" />
                </Field>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total amount" hint={Number.isFinite(txAuto) && !txForm.amount ? `= ${txAuto.toFixed(2)} from qty × price` : undefined}>
                <Input value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} inputMode="decimal" placeholder={Number.isFinite(txAuto) ? txAuto.toFixed(2) : ''} />
              </Field>
              <Field label="Fees">
                <Input value={txForm.fees} onChange={(e) => setTxForm({ ...txForm, fees: e.target.value })} inputMode="decimal" placeholder="0" />
              </Field>
            </div>
            {txFor.currency !== base ? (
              <Field label={`Rate · 1 ${txFor.currency} = ? ${base}`}>
                <Input value={txForm.fx} onChange={(e) => setTxForm({ ...txForm, fx: e.target.value })} inputMode="decimal" />
              </Field>
            ) : null}
            <Field label="Note">
              <Input value={txForm.note} onChange={(e) => setTxForm({ ...txForm, note: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(priceFor)}
        onClose={() => setPriceFor(null)}
        title={priceFor?.qty ? 'Update price' : 'Update value'}
        subtitle={priceFor ? `${priceFor.investment.name} · ${priceFor.investment.currency}` : undefined}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPriceFor(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={savePrice}>
              Save
            </Button>
          </div>
        }
      >
        <Field label={priceFor?.qty ? 'Current price per unit' : 'Current total value'} hint="Copy it from your broker or bank app.">
          <Input value={priceInput} onChange={(e) => setPriceInput(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
      </Modal>

      <Modal
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        title="Transfer between profiles"
        subtitle="Use the amounts your bank actually debited and credited"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setShowTransfer(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={doTransfer} loading={busy}>
              Record transfer
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From profile">
              <Select value={tr.fromProfileId} onChange={(e) => setTr({ ...tr, fromProfileId: e.target.value, fromInvestmentId: '' })}>
                <option value="">Choose…</option>
                {profileOptions}
              </Select>
            </Field>
            <Field label="To profile">
              <Select value={tr.toProfileId} onChange={(e) => setTr({ ...tr, toProfileId: e.target.value, toInvestmentId: '' })}>
                <option value="">Choose…</option>
                {profileOptions}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From holding" hint="Leave empty for money from a bank account">
              <Select value={tr.fromInvestmentId} onChange={(e) => setTr({ ...tr, fromInvestmentId: e.target.value })}>
                <option value="">Bank / not tracked</option>
                {investments
                  .filter((i) => i.profileId === tr.fromProfileId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="To holding" hint="Empty creates a cash holding">
              <Select value={tr.toInvestmentId} onChange={(e) => setTr({ ...tr, toInvestmentId: e.target.value })}>
                <option value="">New cash holding</option>
                {investments
                  .filter((i) => i.profileId === tr.toProfileId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Debited (${fromCur})`}>
              <Input value={tr.fromAmount} onChange={(e) => setTr({ ...tr, fromAmount: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={`Credited (${toCur})`}>
              <Input value={tr.toAmount} onChange={(e) => setTr({ ...tr, toAmount: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Fees (${fromCur})`}>
              <Input value={tr.fees} onChange={(e) => setTr({ ...tr, fees: e.target.value })} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Date">
              <Input type="date" value={tr.date} onChange={(e) => setTr({ ...tr, date: e.target.value })} />
            </Field>
          </div>
          {bankRate ? (
            <p className="text-[11px] text-muted">
              Bank rate: 1 {fromCur} = {bankRate.toFixed(4)} {toCur}
            </p>
          ) : null}
          <Field label="Note">
            <Input value={tr.note} onChange={(e) => setTr({ ...tr, note: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? 'investment'}?`}
        body="The holding and all of its transactions are removed. This cannot be undone."
        confirmLabel="Delete investment"
        onConfirm={async () => {
          if (!deleting) return
          await deleteInvestment(deleting.id)
          await refresh()
          setDeleting(null)
          notify('Investment deleted', 'info')
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {label}
      </p>
      <p className="tnum mt-1 text-base font-bold text-ink">{value}</p>
      {hint ? <p className="text-[10px] text-warn">{hint}</p> : null}
    </Card>
  )
}
