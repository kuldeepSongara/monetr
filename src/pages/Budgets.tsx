import { useState } from 'react'
import { CalendarRange, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useApp } from '../store'
import type { Budget } from '../types'
import { deleteBudget, saveBudget } from '../db/db'
import { budgetCategoryIds } from '../lib/analytics'
import { PotsSection } from '../components/Pots'
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
  Segmented,
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

  // With an overall budget, it already includes every category — adding the others would double count.
  const overall = rows.find((r) => r.budget.categoryId === 'all')
  const totalBudget = overall ? overall.limit : rows.reduce((s, r) => s + r.limit, 0)
  const totalSpent = overall ? overall.spent : rows.reduce((s, r) => s + r.spent, 0)

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
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
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
              {safe.potsReserved ? ` · ${formatMoney(safe.potsReserved, currency)} set aside for pots` : ''}
            </p>
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Budgets</h2>
        <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true) }}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {rows.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rows.map((row) => {
            const over = row.status === 'over'
            return (
              <Card key={row.budget.id} className="p-3.5">
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm"
                    style={{ background: `${row.color}1f` }}
                  >
                    {row.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-semibold text-ink">{row.label}</p>
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

                    {row.parts ? <GroupParts parts={row.parts} total={row.spent} currency={currency} /> : null}

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

      <PotsSection />

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

/** Which categories in a group are using the shared limit. */
function GroupParts({ parts, total, currency }: { parts: NonNullable<import('../lib/analytics').BudgetRow['parts']>; total: number; currency: string }) {
  const positive = parts.filter((p) => p.spent > 0)
  const base = Math.max(1, positive.reduce((s, p) => s + p.spent, 0))
  return (
    <div className="mt-2 rounded-lg bg-surface2/70 p-2">
      {total > 0 && positive.length ? (
        <div className="mb-1.5 flex h-1.5 overflow-hidden rounded-full bg-line/50">
          {positive.map((p) => (
            <div key={p.category.id} style={{ width: `${(p.spent / base) * 100}%`, background: p.category.color }} title={p.category.name} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.map((p) => (
          <span key={p.category.id} className="flex items-center gap-1 text-[10px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.category.color }} />
            {p.category.emoji} {p.category.name}
            <span className="tnum text-ink/80">{formatMoney(p.spent, currency)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface/60 px-2.5 py-2">
      <p className="text-[11px] font-medium text-muted">{label}</p>
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
  type Mode = 'all' | 'single' | 'group'
  const modeOf = (b: Budget | null): Mode => (!b || b.categoryId === 'all' ? (b ? 'all' : 'single') : b.categoryId === 'group' ? 'group' : 'single')
  const [mode, setMode] = useState<Mode>(modeOf(budget))
  const [categoryId, setCategoryId] = useState(budget && budget.categoryId !== 'all' && budget.categoryId !== 'group' ? budget.categoryId : '')
  const [groupIds, setGroupIds] = useState<string[]>(budget?.categoryIds ?? [])
  const [groupName, setGroupName] = useState(budget?.name ?? '')
  const [groupEmoji, setGroupEmoji] = useState(budget?.emoji ?? '')
  const [amount, setAmount] = useState(budget ? majorString(budget.amount, settings.currency) : '')
  const [rollover, setRollover] = useState(budget?.rollover ?? true)
  const [period, setPeriod] = useState<Budget['period']>(budget?.period ?? 'cycle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset when a different budget is opened.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  // Forget what was loaded once the editor closes, so reopening ("add" again, or the same item) always starts fresh.
  if (!open && loadedFor !== null) setLoadedFor(null)
  const key = open ? budget?.id ?? 'new' : null
  if (key && key !== loadedFor) {
    setLoadedFor(key)
    setMode(modeOf(budget))
    setCategoryId(budget && budget.categoryId !== 'all' && budget.categoryId !== 'group' ? budget.categoryId : '')
    setGroupIds(budget?.categoryIds ?? [])
    setGroupName(budget?.name ?? '')
    setGroupEmoji(budget?.emoji ?? '')
    setAmount(budget ? majorString(budget.amount, settings.currency) : '')
    setRollover(budget?.rollover ?? true)
    setPeriod(budget?.period ?? 'cycle')
    setError('')
  }

  // A category belongs to at most one budget, so totals and safe-to-spend never count it twice.
  const others = budgets.filter((b) => b.id !== budget?.id && !b.archived)
  const takenBy = new Map<string, Budget>()
  for (const b of others) for (const id of budgetCategoryIds(b)) takenBy.set(id, b)
  const hasOverall = others.some((b) => b.categoryId === 'all')
  const budgetName = (b: Budget) => (b.categoryId === 'group' ? b.name || 'a group' : categories.find((c) => c.id === b.categoryId)?.name ?? 'another budget')

  async function save() {
    const minor = fromMajorString(amount, settings.currency) ?? 0
    if (!minor || minor <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    if (mode === 'single' && !categoryId) {
      setError('Pick a category.')
      return
    }
    if (mode === 'group' && groupIds.length < 2) {
      setError('Pick at least two categories for a group.')
      return
    }
    if (mode === 'all' && hasOverall) {
      setError('You already have an overall budget.')
      return
    }
    setSaving(true)
    try {
      const target = mode === 'all' ? 'all' : mode === 'group' ? 'group' : categoryId
      await saveBudget(
        { categoryId: target, categoryIds: groupIds, name: groupName, emoji: groupEmoji, amount: minor, rollover, period },
        budget?.id,
      )
      notify(budget ? 'Budget updated' : 'Budget created', 'success')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save budget')
    } finally {
      setSaving(false)
    }
  }

  const expense = categories.filter((c) => c.kind === 'expense' && !c.archived)
  const toggleGroup = (id: string) => setGroupIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  const autoName = groupIds
    .map((id) => categories.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(' + ')

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
          <Segmented<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m)
              setError('')
            }}
            options={[
              { value: 'single', label: 'One category' },
              { value: 'group', label: 'Group' },
              { value: 'all', label: 'Everything' },
            ]}
          />
        </Field>

        {mode === 'single' ? (
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {expense.map((c) => {
                const owner = takenBy.get(c.id)
                return (
                  <option key={c.id} value={c.id} disabled={Boolean(owner)}>
                    {c.emoji} {c.name}
                    {owner ? ` — in ${budgetName(owner)}` : ''}
                  </option>
                )
              })}
            </Select>
          </Field>
        ) : null}

        {mode === 'group' ? (
          <>
            <Field label="Categories in this group" hint="They share one limit — overspend on dining is fine if shopping was quiet.">
              <div className="flex flex-wrap gap-1.5">
                {expense.map((c) => {
                  const owner = takenBy.get(c.id)
                  const on = groupIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={Boolean(owner)}
                      onClick={() => toggleGroup(c.id)}
                      title={owner ? `Already in ${budgetName(owner)}` : undefined}
                      className={cn('chip', on && 'chip-active', owner && 'cursor-not-allowed opacity-40')}
                    >
                      {c.emoji} {c.name}
                    </button>
                  )
                })}
              </div>
              {takenBy.size ? <p className="mt-1.5 text-[10px] text-muted">Greyed-out categories already have their own budget. Remove it there to group them.</p> : null}
            </Field>
            <div className="grid grid-cols-[4.5rem_1fr] gap-2">
              <Field label="Icon">
                <Input value={groupEmoji} onChange={(e) => setGroupEmoji(e.target.value.slice(0, 4))} placeholder="🧺" className="text-center" />
              </Field>
              <Field label="Group name">
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={autoName || 'e.g. Fun money'} />
              </Field>
            </div>
          </>
        ) : null}

        {mode === 'all' ? (
          <p className="rounded-lg bg-surface2 p-2.5 text-[11px] text-muted">
            {hasOverall ? 'You already have an overall budget — edit that one instead.' : 'One limit for all spending. Category and group budgets still show alongside it.'}
          </p>
        ) : null}

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
