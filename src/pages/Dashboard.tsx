import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useApp } from '../store'
import type { EditorSeed } from '../components/TransactionEditor'
import { TransactionEditor } from '../components/TransactionEditor'
import { QuickAddBar } from '../components/QuickAddBar'
import { CategoryDonut, SpendTrendChart } from '../components/charts'
import { Badge, Button, Card, EmptyState, ProgressBar, SectionTitle, cn } from '../components/ui'
import { addDays, dueLabel, formatDate, shiftPeriod } from '../lib/dates'
import { changePct, byCategory, dailySeries, totals, txnRange } from '../lib/analytics'
import { formatMoney } from '../lib/money'
import type { WidgetId } from '../types'

export function Dashboard() {
  const {
    settings,
    transactions,
    categories,
    rows,
    safe,
    anomalies,
    bills,
    schedules,
    today,
    categoryMap,
  } = useApp()
  const { openAdd } = useOutletContext<{ openAdd: (seed?: EditorSeed) => void }>()
  const [editId, setEditId] = useState<string | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)

  const currency = settings.currency
  const range = safe.range
  const prevRange = useMemo(() => shiftPeriod(range, -1, false), [range])
  const current = useMemo(() => txnRange(transactions, range), [transactions, range])
  const previous = useMemo(() => txnRange(transactions, prevRange), [transactions, prevRange])
  const nowTotals = totals(current)
  const prevTotals = totals(previous)
  const spendChange = changePct(nowTotals.expense, prevTotals.expense)
  const cats = useMemo(() => byCategory(current, categories), [current, categories])
  const last30 = useMemo(
    () => dailySeries(transactions, { start: addDays(today, -29), end: today }),
    [transactions, today],
  )

  const dueBills = useMemo(
    () =>
      bills
        .filter((b) => b.active && !b.archived)
        .map((b) => ({ bill: b, schedule: schedules.get(b.id) }))
        .filter((x) => x.schedule?.nextDue)
        .sort((a, b) => (a.schedule!.nextDue ?? '').localeCompare(b.schedule!.nextDue ?? ''))
        .slice(0, 5),
    [bills, schedules],
  )

  const recent = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
    [transactions],
  )

  const alertBills = dueBills.filter((x) => x.schedule!.status === 'overdue' || x.schedule!.status === 'due-soon')

  const widgets = settings.dashboardWidgets?.length
    ? settings.dashboardWidgets
    : (['safe', 'alerts', 'trend', 'categories', 'budgets', 'bills', 'recent'] as WidgetId[])

  const span: Record<WidgetId, string> = {
    safe: 'lg:col-span-12',
    alerts: 'lg:col-span-12',
    trend: 'lg:col-span-7',
    categories: 'lg:col-span-5',
    budgets: 'lg:col-span-6',
    bills: 'lg:col-span-6',
    recent: 'lg:col-span-12',
  }

  function renderWidget(id: WidgetId) {
    switch (id) {
      case 'safe':
        return (
          <div className={span.safe} key={id}>
            <Card className="relative overflow-hidden border-accent/25 bg-gradient-to-br from-accent/12 via-surface to-surface">
              <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                      <Wallet className="h-3.5 w-3.5" /> Safe to spend today
                    </p>
                    {safe.basis === 'none' ? (
                      <>
                        <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink">Set a budget</p>
                        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
                          Add budgets or a monthly allowance and this becomes your daily spending limit after bills.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="tnum mt-1 text-[34px] font-bold leading-none tracking-tight text-ink">
                          {formatMoney(safe.perDay, currency)}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-muted">
                          {formatMoney(Math.max(0, safe.discretionary), currency)} left after{' '}
                          {formatMoney(safe.billsReserved, currency)} of bills · {safe.daysLeft} day
                          {safe.daysLeft === 1 ? '' : 's'} to go
                        </p>
                      </>
                    )}
                  </div>
                  <div className="hidden shrink-0 sm:block">
                    <div className="rounded-xl border border-line/70 bg-surface/70 px-3 py-2 text-right">
                      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Spent this cycle</p>
                      <p className="tnum text-sm font-bold text-ink">{formatMoney(safe.spent, currency)}</p>
                      {safe.limit > 0 ? (
                        <p className="text-[10px] text-muted">of {formatMoney(safe.limit, currency)}</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {safe.basis !== 'none' ? (
                  <div className="mt-4">
                    <ProgressBar value={safe.limit ? (safe.spent / safe.limit) * 100 : 0} tone={safe.overBudget ? 'bad' : 'accent'} />
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
                      <span>{Math.round(safe.limit ? (safe.spent / safe.limit) * 100 : 0)}% of budget used</span>
                      <span>{formatMoney(Math.max(0, safe.remainingBudget), currency)} remaining</span>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => openAdd()}>
                    <Plus className="h-3.5 w-3.5" /> Add expense
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openAdd({ type: 'income' })}>
                    <CircleDollarSign className="h-3.5 w-3.5" /> Add income
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )

      case 'alerts':
        if (!alertBills.length && !anomalies.length) return null
        return (
          <div className={span.alerts} key={id}>
            <Card className="border-warn/25 bg-warn/[0.05]">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warn" />
                <p className="text-xs font-semibold text-ink">
                  {alertBills.length
                    ? `${alertBills.length} bill${alertBills.length > 1 ? 's' : ''} need attention`
                    : 'Unusual spending detected'}
                </p>
              </div>
              <div className="space-y-1.5">
                {alertBills.slice(0, 2).map(({ bill, schedule }) => (
                  <div key={bill.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink/90">
                      {bill.name}
                      <span className="text-muted">
                        {' '}
                        · {formatMoney(schedule!.typicalAmount || bill.baseAmount, currency)}
                      </span>
                    </span>
                    <Badge tone={schedule!.status === 'overdue' ? 'bad' : 'warn'}>
                      {schedule!.status === 'overdue' ? `${schedule!.overdueDays}d overdue` : dueLabel(schedule!.nextDue!)}
                    </Badge>
                  </div>
                ))}
                {anomalies.slice(0, 2).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink/90">{a.title}</span>
                    <span className="tnum shrink-0 font-semibold text-muted">{formatMoney(a.amount, currency)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )

      case 'trend':
        return (
          <div className={span.trend} key={id}>
            <Card>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-ink">Spending trend</p>
                  <p className="text-[10px] text-muted">Last 30 days · daily spend vs 7-day average</p>
                </div>
                <div className="text-right">
                  <p className="tnum text-sm font-bold text-ink">{formatMoney(last30.reduce((s, d) => s + d.expense, 0), currency)}</p>
                  {spendChange !== null ? (
                    <p className={cn('flex items-center justify-end gap-0.5 text-[10px] font-semibold', spendChange > 0 ? 'text-bad' : 'text-good')}>
                      {spendChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(Math.round(spendChange))}% vs last cycle
                    </p>
                  ) : null}
                </div>
              </div>
              <SpendTrendChart data={last30} />
              <div className="mt-2 flex gap-4 text-[10px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-accent" /> Daily
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-warn" /> 7-day avg
                </span>
              </div>
            </Card>
          </div>
        )

      case 'categories':
        return (
          <div className={span.categories} key={id}>
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-ink">Where it went</p>
                <Badge tone="neutral">{formatDate(range.start, 'short')}–{formatDate(range.end, 'short')}</Badge>
              </div>
              {cats.length ? (
                <CategoryDonut data={cats} total={nowTotals.expense} />
              ) : (
                <EmptyState
                  icon={<Sparkles className="h-6 w-6" />}
                  title="No spending yet"
                  body="Add a transaction or load sample data to see your breakdown."
                />
              )}
            </Card>
          </div>
        )

      case 'budgets':
        return (
          <div className={span.budgets} key={id}>
            <Card>
              <SectionTitle
                title="Budgets"
                action={
                  <Link to="/budgets" className="flex items-center gap-0.5 text-[11px] font-semibold text-accent">
                    Manage <ChevronRight className="h-3 w-3" />
                  </Link>
                }
              />
              {rows.length ? (
                <div className="space-y-3">
                  {rows.slice(0, 4).map((row) => (
                    <div key={row.budget.id}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="truncate font-medium text-ink/90">
                          {row.category ? `${row.category.emoji} ${row.category.name}` : '🎯 Everything'}
                        </span>
                        <span className="tnum shrink-0 text-muted">
                          {formatMoney(row.spent, currency)} / {formatMoney(row.limit, currency)}
                        </span>
                      </div>
                      <ProgressBar
                        value={row.usedPct}
                        tone={row.status === 'over' ? 'bad' : row.status === 'warn' ? 'warn' : 'accent'}
                        height={6}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Target className="h-6 w-6" />}
                  title="No budgets yet"
                  body="Set category limits to get a daily safe-to-spend number."
                  action={
                    <Link to="/budgets" className="btn btn-soft btn-sm">
                      Create a budget
                    </Link>
                  }
                />
              )}
            </Card>
          </div>
        )

      case 'bills':
        return (
          <div className={span.bills} key={id}>
            <Card>
              <SectionTitle
                title="Upcoming bills"
                action={
                  <Link to="/bills" className="flex items-center gap-0.5 text-[11px] font-semibold text-accent">
                    All bills <ChevronRight className="h-3 w-3" />
                  </Link>
                }
              />
              {dueBills.length ? (
                <div className="divide-y divide-line/60">
                  {dueBills.map(({ bill, schedule }) => (
                    <div key={bill.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface2 text-sm">
                        {categoryMap.get(bill.categoryId)?.emoji ?? '🧾'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-ink">{bill.name}</p>
                        <p className="text-[10px] text-muted">
                          {schedule!.nextDue ? dueLabel(schedule!.nextDue) : 'No date yet'}
                          {bill.autoPay ? ' · autopay' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tnum text-[12px] font-semibold text-ink">
                          {formatMoney(schedule!.typicalAmount || bill.baseAmount, currency)}
                        </p>
                        {schedule!.status === 'overdue' ? (
                          <p className="text-[10px] font-semibold text-bad">Overdue</p>
                        ) : schedule!.status === 'due-soon' ? (
                          <p className="text-[10px] font-semibold text-warn">Due soon</p>
                        ) : (
                          <p className="text-[10px] text-muted">{Math.round(schedule!.confidence * 100)}% sure</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<CalendarClock className="h-6 w-6" />}
                  title="No bills tracked"
                  body="Add your recurring bills and Spendwise predicts when they're next due."
                  action={
                    <Link to="/bills" className="btn btn-soft btn-sm">
                      Add a bill
                    </Link>
                  }
                />
              )}
            </Card>
          </div>
        )

      case 'recent':
        return (
          <div className={span.recent} key={id}>
            <Card>
              <SectionTitle
                title="Recent activity"
                action={
                  <Link to="/transactions" className="flex items-center gap-0.5 text-[11px] font-semibold text-accent">
                    See all <ChevronRight className="h-3 w-3" />
                  </Link>
                }
              />
              {recent.length ? (
                <div className="divide-y divide-line/60">
                  {recent.map((t) => {
                    const cat = categoryMap.get(t.categoryId)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setEditId(t.id)
                          setEditorOpen(true)
                        }}
                        className="flex w-full items-center gap-3 py-2 text-left first:pt-0 last:pb-0"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface2 text-sm">
                          {cat?.emoji ?? '📦'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium text-ink">{t.merchant}</p>
                          <p className="truncate text-[10px] text-muted">
                            {cat?.name ?? 'Uncategorised'} · {formatDate(t.date, 'short')}
                          </p>
                        </div>
                        <p
                          className={cn(
                            'tnum shrink-0 text-[12px] font-semibold',
                            t.type === 'income' ? 'text-good' : 'text-ink',
                          )}
                        >
                          {t.type === 'income' ? '+' : '−'}
                          {formatMoney(t.baseAmount, currency)}
                        </p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={<TrendingUp className="h-6 w-6" />}
                  title="Nothing logged yet"
                  body="Add your first transaction to start seeing patterns."
                  action={
                    <Button size="sm" onClick={() => openAdd()}>
                      Add transaction
                    </Button>
                  }
                />
              )}
            </Card>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-3.5">
      <QuickAddBar
        onSeed={(seed) => {
          setEditId(undefined)
          setEditorOpen(true)
          openAdd(seed)
        }}
        className="lg:mx-auto lg:max-w-2xl"
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {widgets.map((id) => renderWidget(id))}
      </div>

      <TransactionEditor
        open={editorOpen && Boolean(editId)}
        onClose={() => setEditorOpen(false)}
        txnId={editId}
      />
    </div>
  )
}
