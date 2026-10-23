import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useApp } from '../store'
import type { CategorySource, Txn, TxnType } from '../types'
import { addTransaction, deleteTransaction, learnRules, updateTransaction } from '../db/db'
import { todayISO } from '../lib/dates'
import { CURRENCIES, formatMoney, fromMajorString, majorString, toBaseMinor, currencyInfo } from '../lib/money'
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
  const { transactions, categories, settings, refresh, notify } = useApp()
  const existing = useMemo(() => transactions.find((t) => t.id === txnId), [transactions, txnId])

  const [type, setType] = useState<TxnType>('expense')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(settings.currency)
  const [fxRate, setFxRate] = useState('1')
  const [date, setDate] = useState(todayISO())
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('cat_other')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
      return
    }
    const t = seed?.type ?? 'expense'
    setType(t)
    setAmount(seed?.amountMajor !== undefined ? String(seed.amountMajor) : '')
    setCurrency(seed?.currency ?? settings.currency)
    setFxRate('1')
    setDate(seed?.date ?? todayISO())
    setMerchant(seed?.merchant ?? '')
    setCategoryId(seed?.categoryId ?? (t === 'income' ? 'cat_salary' : 'cat_other'))
    setNote(seed?.note ?? '')
  }, [open, txnId, seed, settings.currency])

  const relevantCategories = categories.filter((c) => (type === 'income' ? c.kind === 'income' : c.kind === 'expense'))
  const isForeign = currency !== settings.currency
  const amountMinor = fromMajorString(amount, currency) ?? 0
  const basePreview = toBaseMinor(amountMinor, currency, Number(fxRate) || 1, settings.currency)

  async function handleSave() {
    if (!amountMinor || amountMinor <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const input = {
        date,
        amount: amountMinor,
        currency,
        fxRate: Number(fxRate) || 1,
        type,
        categoryId,
        merchant: merchant.trim(),
        note,
        categorySource: 'manual' as const,
        source: existing?.source ?? seed?.source ?? 'manual',
      }
      if (existing) {
        await updateTransaction(existing.id, input, settings.currency)
      } else {
        await addTransaction(input, settings.currency)
        if (merchant.trim()) await learnRules([{ merchant, categoryId }])
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
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-line/70 bg-surface2 p-1">
            {(['expense', 'income'] as TxnType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t)
                  const first = categories.find((c) => c.kind === (t === 'income' ? 'income' : 'expense'))
                  if (first && (categoryId === 'cat_other' || categoryId === 'cat_salary')) setCategoryId(first.id)
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
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
                <Input value={fxRate} onChange={(e) => setFxRate(e.target.value)} inputMode="decimal" />
              </Field>
              <p className="mt-2 text-[11px] text-muted">
                This entry counts as <span className="font-semibold text-ink">{formatMoney(basePreview, settings.currency)}</span> in
                your totals.
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
                onChange={(e) => setMerchant(e.target.value)}
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

          <Field label="Category">
            <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
              {relevantCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
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

          <Field label="Note (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was this for?" rows={2} />
          </Field>

          {error ? <p className="text-xs font-medium text-bad">{error}</p> : null}
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
