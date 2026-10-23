import { useState } from 'react'
import { CalendarRange, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useApp } from '../store'
import type { Budget } from '../types'
import { deleteBudget, saveBudget } from '../db/db'
import { addDays, formatDate, payCycle } from '../lib/dates'
import { formatMoney, fromMajorString, majorString } from '../lib/money'
import {
  Badge,
  Button,
  Card,
  Confirm,
  EmptyState,
  Field,
  Input,
  Modal,
  ProgressBar,
  SectionTitle,
  Select,
  Toggle,
  cn,
} from '../components/ui'

export function Budgets() {
  const { rows, budgets, categories, settings, safe, today, refresh, notify, saveSettings } = useApp()
  const currency = settings.currency
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [deleting, setDeleting] = useState<Budget | null>(null)
  const [cycleDraft, setCycleDraft] = useState(String(settings.payCycleStartDay))
  const [cycleOpen, setCycleOpen] = useState(false)
  const [allowance, setAllowance] = useState(
    settings.monthlyAllowance ? majorString(settings.monthlyAllowance, currency) : '',
  )
  const [savingAllowance, setSavingAllowance] = useState(false)

  const cycle = payCycle(today, settings.payCycleStartDay)

  const totalBudget = rows.reduce((s, r) => s + r.limit, 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)

  async function saveAllowance() {
    setSavingAllowance(true)
    try {
      const minor = allowance.trim() ? fromMajorString(allowance, currency) ?? 0 : 0
      await saveSettings({ monthlyAllowance: minor })
      notify('Monthly allowance updated', 'success')
    } finally {
      setSavingAllowance(false)
    }
  }

  return (
    <div className="space-y-3.5">
      <Card className="border-accent/20 bg-gradient-to-br from-accent/[0.1] to-surface">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Target className="h-3.5 w-3.5" /> Budget cycle
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {formatDate(cycle.start, 'medium')} – {formatDate(cycle.end, 'medium')}
            </p>
            <p className="text-[11px] text-muted">
              {safe.daysLeft} day{safe.daysLeft === 1 ? '' : 's'} left · starts on day {settings.payCycleStartDay}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCycleOpen(true)}>
            <CalendarRange className="h-3.5 w-3.5" /> Change
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label="Budgeted" value={formatMoney(totalBudget, currency)} />
          <Metric label="Spent" value={formatMoney(totalSpent, currency)} tone={totalSpent > totalBudget && totalBudget > 0 ? 'bad' : undefined} />
          <Metric
            label="Safe / day"
            value={formatMoney(safe.perDay, currency)}
            tone={safe.basis === 'none' ? undefined : 'good'}
          />
        </div>
        {safe.basis !== 'none' ? (
          <div className="mt-3">
            <ProgressBar value={safe.limit ? (safe.spent / safe.limit) * 100 : 0} tone={safe.overBudget ? 'bad' : 'accent'} />
            <p className="mt-1.5 text-[10px] text-muted">
              {formatMoney(Math.max(0, safe.remainingBudget), currency)} of budget left ·{' '}
              {formatMoney(safe.billsReserved, currency)} reserved for bills
            </p>
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Category budgets</h2>
        <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {rows.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rows.map((row) => {
            const cat = row.category
            const over = row.status === 'over'
            return (
              <Card key={row.budget.id} className="p-3.5">
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm"
                    style={{ background: `${cat?.color ?? '#7C5CFF'}1f` }}
                  >
                    {cat?.emoji ?? '🎯'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-ink">{cat?.name ?? 'Everything'}</p>
                      <Badge tone={over ? 'bad' : row.status === 'warn' ? 'warn' : 'good'}>
                        {over ? 'over' : `${Math.round(row.usedPct)}%`}
                      </Badge>
                    </div>
                    <p className="tnum mt-0.5 text-[11px] text-muted">
                      {formatMoney(row.spent, currency)} of {formatMoney(row.limit, currency)}
                      {row.rollover > 0 ? ` · +${formatMoney(row.rollover, currency)} rolled` : ''}
                    </p>

                    <ProgressBar
                      value={row.usedPct}
                      tone={over ? 'bad' : row.status === 'warn' ? 'warn' : 'accent'}
                      height={6}
                      className="mt-2"
                    />

                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted">
                      <span>
                        {row.remaining >= 0
                          ? `${formatMoney(row.remaining, currency)} left`
                          : `${formatMoney(Math.abs(row.remaining), currency)} over`}
                      </span>
                      <span>{row.remaining > 0 ? `${formatMoney(row.dailyAllowance, currency)}/day` : '—'}</span>
                    </div>

                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(row.budget)
                          setEditorOpen(true)
                        }}
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:text-ink"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(row.budget)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:text-bad"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                      <span className="ml-auto text-[9px] text-muted/70">
                        {row.budget.period === 'weekly' ? 'weekly' : 'per cycle'}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Target className="h-6 w-6" />}
            title="No budgets yet"
            body="Budgets turn your spending into a daily number you can act on. Start with one category, or set a single allowance for everything."
            action={
              <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}>
                Create a budget
              </Button>
            }
          />
        </Card>
      )}

      <Card>
        <SectionTitle title="Fallback allowance" sub="Used for safe-to-spend when you have no budgets." />
        <div className="flex gap-2">
          <Input
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            inputMode="decimal"
            placeholder={`Monthly allowance in ${currency}`}
          />
          <Button variant="ghost" onClick={saveAllowance} loading={savingAllowance}>
            Save
          </Button>
        </div>
      </Card>

      <BudgetEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        budget={editing}
        onSaved={async () => {
          await refresh()
          setEditorOpen(false)
        }}
      />

      <Modal
        open={cycleOpen}
        onClose={() => setCycleOpen(false)}
        title="Budget cycle"
        subtitle="Match your budgets to the day you get paid."
        size="sm"
        footer={
          <Button
            className="w-full"
            onClick={async () => {
              const day = Math.min(28, Math.max(1, Number(cycleDraft) || 1))
              await saveSettings({ payCycleStartDay: day })
              notify(`Cycle now starts on day ${day}`, 'success')
              setCycleOpen(false)
            }}
          >
            Save cycle
          </Button>
        }
      >
        <Field label="Cycle start day (1–28)" hint={`Next cycle: ${formatDate(addDays(cycle.end, 1), 'medium')} onwards`}>
          <Input value={cycleDraft} onChange={(e) => setCycleDraft(e.target.value)} inputMode="numeric" />
        </Field>
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        title="Remove budget?"
        body="Your transactions stay untouched — only the limit is removed."
        confirmLabel="Remove"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteBudget(deleting.id)
          await refresh()
          notify('Budget removed', 'info')
          setDeleting(null)
        }}
      />
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface/60 px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('tnum mt-0.5 truncate text-[13px] font-bold', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </p>
    </div>
  )
}

function BudgetEditor({
  open,
  onClose,
  budget,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  budget: Budget | null
  onSaved: () => Promise<void>
}) {
  const { categories, budgets, settings, notify } = useApp()
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? 'all')
  const [amount, setAmount] = useState(budget ? majorString(budget.amount, settings.currency) : '')
  const [rollover, setRollover] = useState(budget?.rollover ?? true)
  const [period, setPeriod] = useState<Budget['period']>(budget?.period ?? 'cycle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset when a different budget is opened.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const key = open ? budget?.id ?? 'new' : null
  if (key && key !== loadedFor) {
    setLoadedFor(key)
    setCategoryId(budget?.categoryId ?? 'all')
    setAmount(budget ? majorString(budget.amount, settings.currency) : '')
    setRollover(budget?.rollover ?? true)
    setPeriod(budget?.period ?? 'cycle')
    setError('')
  }

  async function save() {
    const minor = fromMajorString(amount, settings.currency) ?? 0
    if (!minor || minor <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    setSaving(true)
    try {
      await saveBudget({ categoryId, amount: minor, rollover, period }, budget?.id)
      notify(budget ? 'Budget updated' : 'Budget created', 'success')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save budget')
    } finally {
      setSaving(false)
    }
  }

  const expense = categories.filter((c) => c.kind === 'expense')
  const existing = new Set(budgets.map((b) => b.categoryId))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={budget ? 'Edit budget' : 'New budget'}
      subtitle={`Amounts are in ${settings.currency}.`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-[2]" onClick={save} loading={saving}>
            {budget ? 'Save changes' : 'Create budget'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <Field label="Applies to">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="all">🎯 Everything (overall budget)</option>
            {expense.map((c) => (
              <option key={c.id} value={c.id} disabled={existing.has(c.id) && budget?.categoryId !== c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`Limit per ${period === 'weekly' ? 'week' : 'cycle'} (${settings.currency})`}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
        </Field>

        <Field label="Period">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-line/70 bg-surface2 p-1">
            {(['cycle', 'weekly'] as Budget['period'][]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  'rounded-lg py-2 text-xs font-medium capitalize transition',
                  period === p ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                )}
              >
                {p === 'cycle' ? 'Pay cycle' : 'Weekly'}
              </button>
            ))}
          </div>
        </Field>

        <Toggle
          checked={rollover}
          onChange={setRollover}
          label="Roll over unused budget"
          hint="Unspent money carries into the next period, capped at one limit."
        />

        {error ? <p className="text-xs font-medium text-bad">{error}</p> : null}
      </div>
    </Modal>
  )
}
