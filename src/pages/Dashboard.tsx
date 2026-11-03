import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  BarChart3,
  BarChartHorizontal,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Rows3,
} from 'lucide-react'
import { useApp } from '../store'
import type { EditorSeed } from '../components/TransactionEditor'
import { TransactionEditor } from '../components/TransactionEditor'
import { QuickAddBar } from '../components/QuickAddBar'
import { CategoryBars, CategoryDonut, CategoryStrip, ChartStylePicker, CumulativeChart, DailyBars, SpendTrendChart } from '../components/charts'
import { ShareCharts } from '../components/ShareCharts'
import { CycleHero } from '../components/CycleHero'
import { OverspendPrompts } from '../components/OverspendPrompts'
import { NotifyPrompt } from '../components/NotifyPrompt'
import { Badge, Button, Card, EmptyState, ProgressBar, SectionTitle, cn } from '../components/ui'
import { addDays, daysBetween, dueLabel, formatDate, shiftPeriod, type Range } from '../lib/dates'
import { budgetRows, changePct, byCategory, computeSafeToSpend, dailySeries, totals, txnRange } from '../lib/analytics'
import { formatMoney } from '../lib/money'
import type { Bill, ChartStyles, WidgetId } from '../types'
import { expectedAmount, type BillSchedule } from '../lib/bills'

export function Dashboard() {
  const {
    settings,
    transactions,
    categories,
    rows: liveRows,
    safe,
    anomalies,
    bills,
    payments,
    schedules,
    today,
    categoryMap,
    budgets,
    everyday,
    budgetAdjust,
  } = useApp()
  const toVerify = useMemo(() => payments.filter((p) => p.autoRecorded && !p.verified), [payments])
  const { duplicates, saveSettings, nudges } = useApp()
  const paceNudges = useMemo(() => nudges.filter((n) => n.kind === 'pace' || n.kind === 'over' || n.kind === 'projection'), [nudges])
  // Chart shapes are a preference that follows you to your other devices.
  const catStyle = settings.chartStyles?.categories ?? 'bars'
  const trendStyle = settings.chartStyles?.trend ?? 'line'
  const setChartStyle = (patch: ChartStyles) => void saveSettings({ chartStyles: { ...settings.chartStyles, ...patch } })
  const owedCount = useMemo(() => payments.filter((p) => p.splitAmount && !p.splitCollectedAt).length, [payments])
  const { openAdd } = useOutletContext<{ openAdd: (seed?: EditorSeed) => void }>()
  const [editId, setEditId] = useState<string | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)

  const currency = settings.currency
  // Home-screen shortcuts open `#/?quick=1`, `#/?add=expense` or `#/?scan=1`.
  const [params, setParams] = useSearchParams()
  const [launch] = useState(() => (params.get('quick') ? 'quick' : params.get('scan') ? 'scan' : params.get('add') ? 'add' : null))
  useEffect(() => {
    if (!launch) return
    if (launch === 'add') openAdd()
    setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 0 = this pay cycle, -1 = the one before, and so on. Lets you look back once a month is over.
  const [offset, setOffset] = useState(0)
  const isPast = offset < 0
  const range = useMemo(() => (offset ? shiftPeriod(safe.range, offset, false) : safe.range), [safe.range, offset])
  const rangeLabel = cycleLabel(range)
  // Budgets as they stood at the end of the cycle you're looking at.
  const rows = useMemo(
    () => (isPast ? budgetRows(budgets, everyday, categories, settings, range.end, budgetAdjust) : liveRows),
    [isPast, budgets, everyday, categories, settings, range.end, liveRows, budgetAdjust],
  )
  const pastCycle = useMemo(() => {
    if (!isPast) return undefined
    const s = computeSafeToSpend(rows, everyday, [], new Map(), settings, range.end)
    return { range, label: rangeLabel, spent: s.spent, limit: s.limit }
  }, [isPast, rows, everyday, settings, range, rangeLabel])
  const prevRange = useMemo(() => shiftPeriod(range, -1, false), [range])
  const current = useMemo(() => txnRange(transactions, range), [transactions, range])
  const previous = useMemo(() => txnRange(transactions, prevRange), [transactions, prevRange])
  const nowTotals = totals(current)
  const prevTotals = totals(previous)
  const spendChange = changePct(nowTotals.expense, prevTotals.expense)
  const cats = useMemo(() => byCategory(current, categories), [current, categories])
  const last30 = useMemo(
    () => dailySeries(transactions, isPast ? range : { start: addDays(today, -29), end: today }),
    [transactions, today, isPast, range],
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
      [...(isPast ? current : transactions)]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
    [transactions, current, isPast],
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
    // Alerts and upcoming bills are about today, so they stay out of past cycles.
    if (isPast && (id === 'alerts' || id === 'bills')) return null
    switch (id) {
      case 'safe':
        return (
          <div className={cn(span.safe, 'flex')} key={id}>
            <CycleHero
              past={pastCycle}
              onAdd={(type) => {
                // Adding from a past cycle dates the entry inside that cycle (its last day; change it in the form).
                const seed: EditorSeed = { ...(type ? { type } : {}), ...(isPast ? { date: range.end } : {}) }
                openAdd(Object.keys(seed).length ? seed : undefined)
              }}
            />
          </div>
        )

      case 'alerts':
        if (!alertBills.length && !anomalies.length && !toVerify.length && !owedCount && !duplicates.length && !paceNudges.length) return null
        return (
          <div className={cn(span.alerts, 'flex')} key={id}>
            <Card className="flex w-full flex-col border-line bg-surface2/30">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warn" />
                <p className="text-xs font-semibold text-ink">
                  {alertBills.length
                    ? `${alertBills.length} bill${alertBills.length > 1 ? 's' : ''} need attention`
                    : paceNudges.length
                      ? paceNudges[0].title
                    : duplicates.length
                      ? 'Possible double charge'
                    : toVerify.length
                      ? 'Check your autopay amounts'
                      : owedCount
                        ? 'Money to collect'
                      : 'Unusual spending detected'}
                </p>
              </div>
              <div className="space-y-1.5">
                {paceNudges.slice(0, 3).map((n) => (
                  <Link key={n.id} to={n.url} className="block text-[11px]">
                    <span className="font-medium text-ink">{n.title}.</span> <span className="text-muted">{n.body}</span>
                  </Link>
                ))}
                {duplicates.length ? (
                  <Link to="/transactions" className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink/90">
                      {duplicates.length} possible duplicate{duplicates.length > 1 ? 's' : ''} — charged twice?
                    </span>
                    <Badge tone="warn">Review</Badge>
                  </Link>
                ) : null}
                {owedCount ? (
                  <Link to="/bills" className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink/90">
                      {owedCount} bill share{owedCount > 1 ? 's' : ''} to collect
                    </span>
                    <Badge tone="good">Collect</Badge>
                  </Link>
                ) : null}
                {toVerify.length ? (
                  <Link to="/bills" className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink/90">
                      {toVerify.length} autopay payment{toVerify.length > 1 ? 's' : ''} recorded — confirm the amount taken
                    </span>
                    <Badge tone="accent">Review</Badge>
                  </Link>
                ) : null}
                {alertBills.slice(0, 2).map(({ bill, schedule }) => (
                  <div key={bill.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink/90">
                      {bill.name}
                      <span className="text-muted">
                        {' '}
                        · {billAmountText(bill, schedule!, currency)}
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
          <div className={cn(span.trend, 'flex')} key={id}>
            <Card className="flex w-full flex-col">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Spending trend</p>
                  <p className="text-[12px] text-muted">
                    {isPast ? rangeLabel : 'Last 30 days'} ·{' '}
                    {trendStyle === 'bars' ? 'each day against your daily average' : trendStyle === 'cumulative' ? 'running total' : 'daily spend and 7-day average'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <ChartStylePicker
                    value={trendStyle}
                    onChange={(v) => setChartStyle({ trend: v })}
                    options={[
                      { value: 'line', label: 'Line with average', icon: LineChartIcon },
                      { value: 'bars', label: 'Daily bars', icon: BarChart3 },
                      { value: 'cumulative', label: 'Running total', icon: TrendingUp },
                    ]}
                  />
                </div>
              </div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="tnum text-[17px] font-semibold text-ink">{formatMoney(last30.reduce((s, d) => s + d.expense, 0), currency)}</p>
                {spendChange !== null ? (
                  <p className={cn('flex items-center gap-0.5 text-[11px] font-medium', spendChange > 0 ? 'text-bad' : 'text-good')}>
                    {spendChange > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(Math.round(spendChange))}% vs {isPast ? 'the cycle before' : 'last cycle'}
                  </p>
                ) : null}
              </div>
              {trendStyle === 'bars' ? <DailyBars data={last30} /> : trendStyle === 'cumulative' ? <CumulativeChart data={last30} height={190} /> : <SpendTrendChart data={last30} />}
              <div className="mt-2 flex gap-4 text-[11px] text-muted">
                {trendStyle === 'line' ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-3 rounded-full bg-accent" /> Daily
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0 w-3 border-t-2 border-dashed border-warn" /> 7-day average
                    </span>
                  </>
                ) : trendStyle === 'bars' ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0 w-3 border-t-2 border-dashed border-warn" /> Daily average
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-[2px] bg-warn" /> More than twice the average
                    </span>
                  </>
                ) : (
                  <span>Everything spent {isPast ? 'in the cycle' : 'in the 30 days'}, added up day by day</span>
                )}
              </div>
            </Card>
          </div>
        )

      case 'categories':
        return (
          <div className={cn(span.categories, 'flex')} key={id}>
            <Card className="flex w-full flex-col">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Where it went</p>
                  <p className="text-[12px] text-muted">
                    {formatDate(range.start, 'short')} – {formatDate(range.end, 'short')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <ChartStylePicker
                    value={catStyle}
                    onChange={(v) => setChartStyle({ categories: v })}
                    options={[
                      { value: 'bars', label: 'Ranked bars', icon: BarChartHorizontal },
                      { value: 'strip', label: 'Share strip', icon: Rows3 },
                      { value: 'donut', label: 'Donut', icon: PieChartIcon },
                    ]}
                  />
                  <ShareCharts variant="ghost" label="" className="!h-7 !px-2" />
                </div>
              </div>
              {cats.length ? (
                catStyle === 'donut' ? (
                  <CategoryDonut data={cats} total={nowTotals.expense} />
                ) : catStyle === 'strip' ? (
                  <CategoryStrip data={cats} total={nowTotals.expense} />
                ) : (
                  <CategoryBars data={cats} total={nowTotals.expense} />
                )
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
          <div className={cn(span.budgets, 'flex')} key={id}>
            <Card className="flex w-full flex-col">
              <SectionTitle
                title="Budgets"
                action={
                  <Link to="/budgets" className="flex items-center gap-0.5 text-[11px] font-semibold text-ink">
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
                          {row.emoji} {row.label}
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
          <div className={cn(span.bills, 'flex')} key={id}>
            <Card className="flex w-full flex-col">
              <SectionTitle
                title="Upcoming bills"
                action={
                  <Link to="/bills" className="flex items-center gap-0.5 text-[11px] font-semibold text-ink">
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
                          {billAmountText(bill, schedule!, currency)}
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
                  body="Add your recurring bills and Monetr predicts when they're next due."
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
          <div className={cn(span.recent, 'flex')} key={id}>
            <Card className="flex w-full flex-col">
              <SectionTitle
                title={isPast ? `Latest in ${rangeLabel}` : 'Recent activity'}
                action={
                  <Link to="/transactions" className="flex items-center gap-0.5 text-[11px] font-semibold text-ink">
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
                            t.type === 'income' || t.type === 'refund' ? 'text-good' : t.type === 'transfer' ? 'text-muted' : 'text-ink',
                          )}
                        >
                          {t.type === 'income' || t.type === 'refund' ? '+' : t.type === 'transfer' ? '↔ ' : '−'}
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
        focusOnMount={launch === 'quick'}
        scanOnMount={launch === 'scan'}
        onSeed={(seed) => {
          setEditId(undefined)
          setEditorOpen(true)
          openAdd(seed)
        }}
      />

      <CycleSwitcher
        label={offset === 0 ? 'This cycle' : rangeLabel}
        range={range}
        isPast={isPast}
        onPrev={() => setOffset((o) => o - 1)}
        onNext={() => setOffset((o) => Math.min(0, o + 1))}
        onNow={() => setOffset(0)}
        nudge={
          offset === 0 && daysBetween(safe.range.start, today) < 5 && previous.some((t) => t.type === 'expense')
            ? cycleLabel(shiftPeriod(safe.range, -1, false))
            : null
        }
      />

      {!isPast ? <NotifyPrompt /> : null}
      {!isPast ? <OverspendPrompts /> : null}

      <div className="grid grid-cols-1 items-stretch gap-3.5 lg:grid-cols-12">
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

function billAmountText(bill: Bill, schedule: BillSchedule, currency: string): string {
  const e = expectedAmount(bill, schedule)
  return e ? `${e.approx ? '~' : ''}${formatMoney(e.amount, currency)}` : 'amount varies'
}

/** "October 2026" for a calendar-month cycle, otherwise "15 Oct – 14 Nov". */
function cycleLabel(r: Range): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  if (r.start.endsWith('-01') && addDays(r.end, 1).endsWith('-01')) return `${MONTHS[Number(r.start.slice(5, 7)) - 1]} ${r.start.slice(0, 4)}`
  return `${formatDate(r.start, 'short')} – ${formatDate(r.end, 'short')}`
}

function CycleSwitcher({
  label,
  range,
  isPast,
  onPrev,
  onNext,
  onNow,
  nudge,
}: {
  label: string
  range: Range
  isPast: boolean
  onPrev: () => void
  onNext: () => void
  onNow: () => void
  nudge: string | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-[12px] border border-line/80 bg-surface p-[3px]">
        <button type="button" onClick={onPrev} className="btn btn-icon h-8 w-8 rounded-[9px] text-muted hover:bg-surface2 hover:text-ink" aria-label="Previous cycle">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-[9.5rem] px-2 text-center">
          <p className="text-[13px] font-semibold leading-tight text-ink">{label}</p>
          <p className="text-[11px] leading-tight text-muted">
            {formatDate(range.start, 'short')} – {formatDate(range.end, 'short')}
          </p>
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={!isPast}
          className="btn btn-icon h-8 w-8 rounded-[9px] text-muted hover:bg-surface2 hover:text-ink"
          aria-label="Next cycle"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {isPast ? (
        <button type="button" onClick={onNow} className="btn btn-sm btn-ghost">
          Back to this cycle
        </button>
      ) : nudge ? (
        <button type="button" onClick={onPrev} className="text-[12px] font-medium text-muted underline underline-offset-2 hover:text-ink">
          Wrapping up {nudge}? See how it went
        </button>
      ) : null}
    </div>
  )
}
