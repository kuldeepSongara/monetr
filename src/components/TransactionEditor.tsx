import { useEffect, useMemo, useState } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { useApp } from '../store'
import type { CategorySource, Txn, TxnType } from '../types'
import { addRefund, addTransaction, deleteTransaction, learnRules, savePot, setTxnPot, updateTransaction } from '../db/db'
import { perCycleFor } from '../lib/pots'
import { isBigPurchase } from './Pots'
import { formatDate, todayISO } from '../lib/dates'
import { CURRENCIES, formatMoney, fromMajorString, majorString, toBaseMinor, currencyInfo } from '../lib/money'
import { ruleCategory, suggestedFxRate } from '../lib/suggest'
import { Button, Confirm, Field, Input, Modal, Select, Textarea, cn } from './ui'

export interface EditorSeed {
  type?: TxnType
  amountMajor?: number
  date?: string
  merchant?: string
  categoryId?: string
  note?: string
  currency?: string
  source?: Txn['source']
}

interface Props {
  open: boolean
  onClose: () => void
  txnId?: string
  seed?: EditorSeed | null
}

const SOURCE_LABEL: Record<CategorySource, string> = {
  manual: '',
  ai: 'Categorised by AI',
  rule: 'Matched your rule',
  default: 'Uncategorised',
}

export function TransactionEditor({ open, onClose, txnId, seed }: Props) {
  const { transactions, categories, settings, rules, currencyProfiles, potList, safe, refresh, notify } = useApp()
  const existing = useMemo(() => transactions.find((t) => t.id === txnId), [transactions, txnId])

  const [type, setType] = useState<TxnType>('expense')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(settings.currency)
  const [fxRate, setFxRate] = useState('1')
  const [date, setDate] = useState(todayISO())
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('cat_other')
  const [note, setNote] = useState('')
  /** Where the current category came from; a manual pick stops rules from overriding it. */
  const [catSource, setCatSource] = useState<CategorySource>('manual')
  const [refundOpen, setRefundOpen] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundDate, setRefundDate] = useState(todayISO())
  const [refundNote, setRefundNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** '' = counts in this cycle's budget, a pot id, or 'new' for a new pay-back pot. */
  const [potChoice, setPotChoice] = useState('')
  const [potMonths, setPotMonths] = useState(6)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (existing) {
      setType(existing.type)
      setAmount(majorString(existing.amount, existing.currency))
      setCurrency(existing.currency)
      setFxRate(String(existing.fxRate))
      setDate(existing.date)
      setMerchant(existing.merchant)
      setCategoryId(existing.categoryId)
      setNote(existing.note ?? '')
      setCatSource(existing.categorySource)
      setPotChoice(existing.potId ?? '')
      setPotMonths(6)
      return
    }
    setPotChoice('')
    setPotMonths(6)
    const t = seed?.type ?? 'expense'
    setType(t)
    setAmount(seed?.amountMajor !== undefined ? String(seed.amountMajor) : '')
    const cur = seed?.currency ?? settings.currency
    setCurrency(cur)
    setFxRate(String(suggestedFxRate(cur, settings.currency, transactions, currencyProfiles) ?? ''))
    setDate(seed?.date ?? todayISO())
    setMerchant(seed?.merchant ?? '')
    const ruled = seed?.merchant && t !== 'transfer' ? ruleCategory(seed.merchant, rules) : undefined
    setCategoryId(ruled ?? seed?.categoryId ?? defaultCategory(t))
    setCatSource(ruled ? 'rule' : seed?.source === 'ai' || seed?.source === 'receipt' ? 'ai' : 'default')
    setNote(seed?.note ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, txnId, seed, settings.currency])

  function defaultCategory(t: TxnType): string {
    return t === 'income' ? 'cat_salary' : t === 'transfer' ? 'cat_transfer' : 'cat_other'
  }

  function changeMerchant(value: string) {
    setMerchant(value)
    if (catSource === 'manual' || type === 'transfer') return
    const ruled = ruleCategory(value, rules)
    const kind = categories.find((c) => c.id === ruled)?.kind
    if (ruled && kind === type) {
      setCategoryId(ruled)
      setCatSource('rule')
    }
  }

  function changeCurrency(code: string) {
    setCurrency(code)
    setFxRate(String(suggestedFxRate(code, settings.currency, transactions, currencyProfiles) ?? ''))
  }

  const relevantCategories = categories.filter((c) => c.kind === (type === 'refund' ? 'expense' : type))
  const refunds = existing ? transactions.filter((t) => t.refundOf === existing.id) : []
  const refundedMinor = refunds.reduce((s, t) => s + t.amount, 0)
  const original = existing?.refundOf ? transactions.find((t) => t.id === existing.refundOf) : undefined
  const isForeign = currency !== settings.currency
  const amountMinor = fromMajorString(amount, currency) ?? 0
  const fxValue = isForeign ? Number(fxRate) : 1
  const fxValid = !isForeign || (Number.isFinite(fxValue) && fxValue > 0)
  const basePreview = fxValid ? toBaseMinor(amountMinor, currency, fxValue, settings.currency) : 0

  async function handleSave() {
    if (!amountMinor || amountMinor <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    if (!fxValid) {
      setError(`Enter the exchange rate: how many ${settings.currency} is 1 ${currency}?`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const input = {
        date,
        amount: amountMinor,
        currency,
        fxRate: fxValue,
        type,
        categoryId,
        merchant: merchant.trim(),
        note,
        categorySource: catSource === 'default' ? ('manual' as const) : catSource,
        source: existing?.source ?? seed?.source ?? 'manual',
      }
      let id = existing?.id
      if (existing) {
        await updateTransaction(existing.id, input, settings.currency)
      } else {
        id = (await addTransaction(input, settings.currency)).id
      }
      const wantPot = type === 'expense' ? potChoice : ''
      if (id && wantPot === 'new') {
        const potId = await savePot({
          name: merchant.trim() || 'Pay back',
          kind: 'payback',
          target: 0,
          perCycle: perCycleFor(basePreview, potMonths),
          startDate: todayISO(),
        })
        await setTxnPot([id], potId)
      } else if (id && wantPot !== (existing?.potId ?? '')) {
        await setTxnPot([id], wantPot || null)
      }
      // Learn merchant → category whenever you picked (or confirmed) a category yourself.
      if (merchant.trim() && type !== 'transfer' && (catSource === 'manual' || !existing)) {
        await learnRules([{ merchant, categoryId }])
      }
      await refresh()
      notify(existing ? 'Transaction updated' : 'Transaction added', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that transaction')
    } finally {
      setSaving(false)
    }
  }

  function openRefund() {
    if (!existing) return
    setRefundAmount(majorString(Math.max(0, existing.amount - refundedMinor), existing.currency))
    setRefundDate(todayISO())
    setRefundNote('')
    setRefundOpen(true)
  }

  async function saveRefund() {
    if (!existing) return
    const minor = fromMajorString(refundAmount, existing.currency)
    if (!minor || minor <= 0) return notify('Enter how much came back', 'error')
    if (minor > existing.amount - refundedMinor) return notify('That is more than what is left to refund', 'error')
    await addRefund(existing, { amountMinor: minor, date: refundDate, note: refundNote.trim() || (minor === existing.amount ? 'Returned' : 'Partial refund') }, settings.currency)
    await refresh()
    setRefundOpen(false)
    notify(minor === existing.amount - refundedMinor ? 'Refund recorded — this spend is fully reversed' : 'Partial refund recorded', 'success')
    onClose()
  }

  async function handleDelete() {
    if (!existing) return
    await deleteTransaction(existing.id)
    await refresh()
    notify('Transaction deleted', 'success')
    setConfirmDelete(false)
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={existing ? 'Edit transaction' : 'Add transaction'}
        subtitle={existing ? `${SOURCE_LABEL[existing.categorySource] || 'Recorded manually'}` : 'Log a spend or income'}
        footer={
          <div className="flex gap-2">
            {existing ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-[2]" onClick={handleSave} loading={saving}>
              {existing ? 'Save changes' : 'Add'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {type === 'refund' ? (
            <div className="rounded-xl border border-good/30 bg-good/10 px-3 py-2 text-[11px] text-good">
              Refund{original ? ` for ${original.merchant} on ${formatDate(original.date, 'short')} (${formatMoney(original.amount, original.currency)})` : ''} —
              reduces spending in this category.
            </div>
          ) : (
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-line/70 bg-surface2 p-1">
            {(['expense', 'income', 'transfer'] as TxnType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t)
                  if (categories.find((c) => c.id === categoryId)?.kind !== t) {
                    setCategoryId(categories.find((c) => c.kind === t)?.id ?? defaultCategory(t))
                    setCatSource('default')
                  }
                }}
                className={cn(
                  'rounded-lg py-2 text-xs font-semibold capitalize transition',
                  type === t ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          )}

          <div className="flex items-end gap-2">
            <Field label="Amount" className="flex-1">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoFocus={!existing}
                className="tnum text-2xl font-semibold"
              />
            </Field>
            <Field label="Currency" className="w-28">
              <Select value={currency} onChange={(e) => changeCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {isForeign ? (
            <div className="rounded-xl border border-line/70 bg-surface2/60 p-3">
              <Field label={`Exchange rate · 1 ${currency} = ? ${settings.currency}`}>
                <Input value={fxRate} onChange={(e) => setFxRate(e.target.value)} inputMode="decimal" placeholder="Required" />
              </Field>
              <p className="mt-2 text-[11px] text-muted">
                {fxValid ? (
                  <>
                    This entry counts as <span className="font-semibold text-ink">{formatMoney(basePreview, settings.currency)}</span> in
                    your totals. Prefilled from the last rate you used for {currency}.
                  </>
                ) : (
                  <span className="font-medium text-warn">Enter the rate from your bank or card app so totals stay right.</span>
                )}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Merchant">
              <Input
                value={merchant}
                onChange={(e) => changeMerchant(e.target.value)}
                placeholder="e.g. Trader Joe's"
                list="merchant-suggestions"
              />
            </Field>
          </div>

          <datalist id="merchant-suggestions">
            {[...new Set(transactions.map((t) => t.merchant))].slice(0, 40).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          <Field label={catSource === 'rule' ? 'Category · from your rule' : catSource === 'ai' ? 'Category · suggested by AI' : 'Category'}>
            <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
              {relevantCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(c.id)
                    setCatSource('manual')
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-2 text-left text-[11px] font-medium transition',
                    categoryId === c.id
                      ? 'border-accent/60 bg-accent/10 text-ink'
                      : 'border-line/70 bg-surface2/40 text-muted hover:text-ink',
                  )}
                >
                  <span className="text-sm leading-none">{c.emoji}</span>
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </Field>

          {type === 'expense' && (potList.length || isBigPurchase(basePreview, safe.limit) || existing?.potId) ? (
            <div className="rounded-xl border border-line/70 bg-surface2/40 p-3">
              {potChoice === '' && isBigPurchase(basePreview, safe.limit) ? (
                <p className="mb-2 text-[11px] text-warn">That’s more than half this cycle’s budget. One-time buy? Pay it from a pot instead of this cycle.</p>
              ) : null}
              <Field label="Paid from">
                <Select value={potChoice} onChange={(e) => setPotChoice(e.target.value)}>
                  <option value="">This cycle’s budget</option>
                  {potList
                    .filter((p) => p.state !== 'done' || p.pot.id === existing?.potId)
                    .map((p) => (
                      <option key={p.pot.id} value={p.pot.id}>
                        {p.pot.emoji || (p.pot.kind === 'save' ? '🐷' : '↩️')} {p.pot.name}
                      </option>
                    ))}
                  <option value="new">＋ New pay-back pot…</option>
                </Select>
              </Field>
              {potChoice === 'new' ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted">Pay back over</span>
                  {[3, 6, 12].map((m) => (
                    <button key={m} type="button" onClick={() => setPotMonths(m)} className={cn('chip', potMonths === m && 'chip-active')}>
                      {m} cycles
                    </button>
                  ))}
                  {basePreview ? (
                    <span className="text-[11px] text-muted">≈ {formatMoney(perCycleFor(basePreview, potMonths), settings.currency)}/cycle</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <Field label="Note (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was this for?" rows={2} />
          </Field>

          {existing && existing.type === 'expense' ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line/70 px-3 py-2">
              <p className="text-[11px] text-muted">
                {refundedMinor
                  ? `${formatMoney(refundedMinor, existing.currency)} refunded so far`
                  : 'Returned it or got money back?'}
              </p>
              {refundedMinor < existing.amount ? (
                <Button size="sm" variant="soft" onClick={openRefund}>
                  <Undo2 className="h-3.5 w-3.5" /> Refund / return
                </Button>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-xs font-medium text-bad">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title="Record a refund"
        subtitle={existing ? `${existing.merchant} · ${formatMoney(existing.amount, existing.currency)} on ${formatDate(existing.date, 'short')}` : undefined}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={saveRefund}>
              Save refund
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount back (${existing?.currency ?? ''})`} hint="Full amount reverses the spend; less is a partial refund.">
              <Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Refunded on">
              <Input type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Note">
            <Input value={refundNote} onChange={(e) => setRefundNote(e.target.value)} placeholder="e.g. Returned — wrong size" />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={confirmDelete}
        title="Delete transaction?"
        body="This removes it from your history, charts and budgets. This cannot be undone."
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}

export function amountHint(minor: number, currency: string): string {
  return `${formatMoney(minor, currency)} ${currencyInfo(currency).code}`
}
