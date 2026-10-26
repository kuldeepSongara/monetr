import { useEffect, useMemo, useState } from 'react'
import { Check, Sparkles, Wand2 } from 'lucide-react'
import { useApp } from '../store'
import type { Txn } from '../types'
import { bulkUpdateCategory, learnRules } from '../db/db'
import { categorizeTransactions } from '../ai/tasks'
import { majorString } from '../lib/money'
import { Badge, Button, Modal, Spinner, cn } from './ui'

interface Proposal {
  id: string
  merchant: string
  currentId: string
  suggestedId: string
  checked: boolean
  amount: number
  currency: string
  date: string
}

export function CategorizeModal({
  open,
  onClose,
  txns,
}: {
  open: boolean
  onClose: () => void
  txns: Txn[]
}) {
  const { categories, settings, refresh, notify } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [model, setModel] = useState('')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [saving, setSaving] = useState(false)
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProposals([])
    setError('')
    setModel('')

    // Leave alone anything you categorised yourself (unless it's still in a catch-all bucket) and transfers.
    const batch = [...txns]
      .filter((t) => t.type !== 'transfer')
      .filter((t) => t.categorySource !== 'manual' || t.categoryId === 'cat_other' || t.categoryId === 'cat_other-income')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 60)
      .map((t) => ({
        id: t.id,
        merchant: t.merchant,
        note: t.note,
        amount: Number(majorString(t.amount, t.currency)),
        type: t.type,
      }))

    if (!batch.length) {
      setError('Nothing to categorise here — everything in this view was categorised by you already.')
      return
    }

    setLoading(true)
    categorizeTransactions(batch, categories, settings.currency)
      .then(({ assignments, result }) => {
        if (cancelled) return
        setModel(`${result.profileName} · ${result.model}`)
        const byId = new Map(txns.map((t) => [t.id, t]))
        const next: Proposal[] = []
        for (const a of assignments) {
          const t = byId.get(a.id)
          if (!t || t.categoryId === a.categoryId) continue
          next.push({
            id: t.id,
            merchant: t.merchant,
            currentId: t.categoryId,
            suggestedId: a.categoryId,
            checked: true,
            amount: t.baseAmount,
            currency: settings.currency,
            date: t.date,
          })
        }
        setProposals(next)
        if (!next.length) setError('Everything in this batch already looks correctly categorised.')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Categorisation failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, txns, categories, settings.currency])

  async function apply() {
    const chosen = proposals.filter((p) => p.checked)
    if (!chosen.length) return
    setSaving(true)
    try {
      await bulkUpdateCategory(
        chosen.map((p) => ({ id: p.id, categoryId: p.suggestedId })),
        'ai',
      )
      await learnRules(chosen.map((p) => ({ merchant: p.merchant, categoryId: p.suggestedId })))
      await refresh()
      notify(`${chosen.length} transaction${chosen.length > 1 ? 's' : ''} categorised`, 'success')
      onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not apply categories', 'error')
    } finally {
      setSaving(false)
    }
  }

  const checkedCount = proposals.filter((p) => p.checked).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI categorise"
      subtitle="Review the suggestions before anything changes"
      size="lg"
      footer={
        proposals.length ? (
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-[2]" onClick={apply} loading={saving} disabled={!checkedCount}>
              Apply {checkedCount} change{checkedCount === 1 ? '' : 's'}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <Wand2 className="h-3.5 w-3.5 text-accent" />
          <span>
            {loading
              ? 'Reading your merchants…'
              : model
                ? `Suggestions from ${model}`
                : 'Checks up to 60 transactions from your current filter.'}
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <Spinner className="h-5 w-5" />
            <p className="text-xs text-muted">Asking the model to categorise…</p>
          </div>
        ) : null}

        {error && !loading ? (
          <div className="rounded-xl border border-line/70 bg-surface2/50 p-3 text-xs leading-relaxed text-muted">{error}</div>
        ) : null}

        {!loading && proposals.length ? (
          <div className="divide-y divide-line/60">
            {proposals.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 py-2.5">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
                    p.checked ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-transparent',
                  )}
                >
                  {p.checked ? <Check className="h-3 w-3" /> : null}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={p.checked}
                  onChange={() =>
                    setProposals((prev) => prev.map((x) => (x.id === p.id ? { ...x, checked: !x.checked } : x)))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">{p.merchant}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted">
                    {catMap.get(p.currentId)?.emoji} {catMap.get(p.currentId)?.name ?? 'Other'}
                    <span className="text-muted/60">→</span>
                    <Badge tone="accent">
                      {catMap.get(p.suggestedId)?.emoji} {catMap.get(p.suggestedId)?.name ?? 'Other'}
                    </Badge>
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {!loading && !proposals.length && !error ? (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <Sparkles className="h-5 w-5 text-accent" />
            <p className="text-xs text-muted">No transactions to review.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
