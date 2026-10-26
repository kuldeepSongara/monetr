import { useMemo, useState } from 'react'
import { CalendarDays, Search, Sparkles } from 'lucide-react'
import { useApp } from '../store'
import type { Txn } from '../types'
import { TransactionEditor, type EditorSeed } from '../components/TransactionEditor'
import { QuickAddBar } from '../components/QuickAddBar'
import { DuplicateBanner } from '../components/DuplicateReview'
import { CategorizeModal } from '../components/CategorizeModal'
import { Badge, Button, Card, EmptyState, Input, Select, cn } from '../components/ui'
import { addDays, formatDate, payCycle, shiftPeriod, type Range } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { spendDelta, totals } from '../lib/analytics'

type RangeKey = 'cycle' | 'last' | '30' | '90' | 'all'
type TypeKey = 'all' | 'expense' | 'income' | 'transfer' | 'refund'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'cycle', label: 'This cycle' },
  { key: 'last', label: 'Last cycle' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'all', label: 'All time' },
]

export function Transactions() {
  const { transactions, categories, categoryMap, settings, today, duplicates } = useApp()
  const dupIds = useMemo(() => new Set(duplicates.flatMap((d) => [d.a.id, d.b.id])), [duplicates])
  const [q, setQ] = useState('')
  const [rangeKey, setRangeKey] = useState<RangeKey>('cycle')
  const [type, setType] = useState<TypeKey>('all')
  const [categoryId, setCategoryId] = useState('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editId, setEditId] = useState<string | undefined>()
  const [seed, setSeed] = useState<EditorSeed | null>(null)
  const [catOpen, setCatOpen] = useState(false)

  const currency = settings.currency

  const range: Range = useMemo(() => {
    const cycle = payCycle(today, settings.payCycleStartDay)
    if (rangeKey === 'last') return shiftPeriod(cycle, -1, false)
    if (rangeKey === '30') return { start: addDays(today, -29), end: today }
    if (rangeKey === '90') return { start: addDays(today, -89), end: today }
    if (rangeKey === 'all') return { start: '1970-01-01', end: today }
    return cycle
  }, [rangeKey, today, settings.payCycleStartDay])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return transactions
      .filter((t) => t.date >= range.start && t.date <= range.end)
      .filter((t) => (type === 'all' ? true : t.type === type))
      .filter((t) => (categoryId === 'all' ? true : t.categoryId === categoryId))
      .filter((t) => {
        if (!needle) return true
        const cat = categoryMap.get(t.categoryId)?.name ?? ''
        return `${t.merchant} ${t.note ?? ''} ${cat} ${t.currency}`.toLowerCase().includes(needle)
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [transactions, range, type, categoryId, q, categoryMap])

  const sums = totals(filtered)
  const refundedIds = useMemo(() => new Set(transactions.filter((t) => t.refundOf).map((t) => t.refundOf as string)), [transactions])

  const groups = useMemo(() => {
    const map = new Map<string, Txn[]>()
    for (const t of filtered) {
      const arr = map.get(t.date) ?? []
      arr.push(t)
      map.set(t.date, arr)
    }
    return [...map.entries()]
  }, [filtered])

  function openTxn(id: string) {
    setSeed(null)
    setEditId(id)
    setEditorOpen(true)
  }

  return (
    <div className="space-y-3.5">
      <DuplicateBanner />
      <QuickAddBar
        onSeed={(s) => {
          setSeed(s)
          setEditId(undefined)
          setEditorOpen(true)
        }}
      />

      <Card className="space-y-2.5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search merchant, note, category…"
              className="pl-9"
            />
          </div>
          <Button
            variant="soft"
            onClick={() => setCatOpen(true)}
            className="shrink-0"
            title="Categorise with AI"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">AI categorise</span>
          </Button>
        </div>

        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRangeKey(r.key)}
              className={cn('chip whitespace-nowrap', rangeKey === r.key && 'chip-active')}
            >
              {r.label}
            </button>
          ))}
          <span className="mx-1 w-px shrink-0 bg-line" />
          {(['all', 'expense', 'income', 'refund', 'transfer'] as TypeKey[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn('chip whitespace-nowrap capitalize', type === t && 'chip-active')}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 py-1.5 text-xs">
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center justify-between border-t border-line/60 pt-2 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(range.start, 'short')} – {formatDate(range.end, 'short')} · {sums.count} entries
          </span>
          <span className="tnum flex gap-3">
            <span className="text-good">+{formatMoney(sums.income, currency)}</span>
            <span>−{formatMoney(sums.expense, currency)}</span>
          </span>
        </div>
      </Card>

      {groups.length ? (
        <div className="space-y-3">
          {groups.map(([date, items]) => {
            const dayExpense = items.reduce((s, t) => s + spendDelta(t), 0)
            return (
              <div key={date}>
                <div className="mb-1.5 flex items-center justify-between px-1 text-[11px]">
                  <span className="font-semibold text-muted">{formatDate(date, 'long')}</span>
                  <span className="tnum text-muted">{dayExpense ? `−${formatMoney(dayExpense, currency)}` : ''}</span>
                </div>
                <div className="card divide-y divide-line/60 overflow-hidden">
                  {items.map((t) => {
                    const cat = categoryMap.get(t.categoryId)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => openTxn(t.id)}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-surface2/50"
                      >
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm"
                          style={{ background: `${cat?.color ?? '#64748B'}1f` }}
                        >
                          {cat?.emoji ?? '📦'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink">{t.merchant}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-muted">
                            {cat?.name ?? 'Uncategorised'}
                            {t.categorySource === 'ai' ? <Badge tone="accent">AI</Badge> : null}
                            {t.categorySource === 'rule' ? <Badge tone="neutral">rule</Badge> : null}
                            {t.type === 'refund' ? <Badge tone="good">refund</Badge> : null}
                            {dupIds.has(t.id) ? <Badge tone="warn">possible duplicate</Badge> : null}
                            {refundedIds.has(t.id) ? <Badge tone="good">refunded</Badge> : null}
                            {t.source === 'bill' ? <Badge tone="neutral">bill</Badge> : null}
                            {t.currency !== currency ? <span>· {formatMoney(t.amount, t.currency)}</span> : null}
                            {t.note ? <span className="truncate">· {t.note}</span> : null}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'tnum shrink-0 text-[13px] font-semibold',
                            t.type === 'income' || t.type === 'refund' ? 'text-good' : t.type === 'transfer' ? 'text-muted' : 'text-ink',
                          )}
                        >
                          {t.type === 'income' || t.type === 'refund' ? '+' : t.type === 'transfer' ? '↔ ' : '−'}
                          {formatMoney(t.baseAmount, currency)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="Nothing matches"
            body="Try a different range or clear the search. You can also add a transaction with the box above."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQ('')
                  setType('all')
                  setCategoryId('all')
                  setRangeKey('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      )}

      <TransactionEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false)
          setSeed(null)
          setEditId(undefined)
        }}
        txnId={editId}
        seed={seed}
      />

      <CategorizeModal open={catOpen} onClose={() => setCatOpen(false)} txns={filtered} />
    </div>
  )
}
