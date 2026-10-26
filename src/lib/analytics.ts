import type {
  Anomaly,
  Bill,
  Budget,
  Category,
  ISODate,
  Settings,
  SubscriptionCandidate,
  Txn,
} from '../types'
import { BillSchedule } from './bills'
import {
  addDays,
  addMonths,
  daysBetween,
  endOfWeek,
  monthKey,
  monthLabel,
  payCycle,
  shiftPeriod,
  startOfWeek,
  todayISO,
  type Range,
} from './dates'
import { formatMoney, minorFactor } from './money'
import { clamp, mean, median, normalizeMerchant, pct, stdDev, sum } from './utils'

export interface Totals {
  expense: number
  income: number
  net: number
  count: number
}

/** Effect of a transaction on spending: expenses add, refunds subtract, everything else is 0. */
export function spendDelta(t: Txn): number {
  return t.type === 'expense' ? t.baseAmount : t.type === 'refund' ? -t.baseAmount : 0
}

export function txnRange(txns: Txn[], range: Range): Txn[] {
  return txns.filter((t) => t.date >= range.start && t.date <= range.end)
}

export function totals(txns: Txn[]): Totals {
  let expense = 0
  let income = 0
  for (const t of txns) {
    if (t.type === 'expense' || t.type === 'refund') expense += spendDelta(t)
    else if (t.type === 'income') income += t.baseAmount
  }
  // Refunds reduce spending. Transfers between your own accounts are listed but never counted as spend or income.
  return { expense, income, net: income - expense, count: txns.length }
}

export interface CategoryTotal {
  categoryId: string
  name: string
  emoji: string
  color: string
  total: number
  count: number
  share: number
}

export function byCategory(txns: Txn[], categories: Category[], type: 'expense' | 'income' = 'expense'): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>()
  for (const t of txns) {
    const isRefund = type === 'expense' && t.type === 'refund'
    if (t.type !== type && !isRefund) continue
    const prev = map.get(t.categoryId) ?? { total: 0, count: 0 }
    map.set(t.categoryId, { total: prev.total + (isRefund ? -t.baseAmount : t.baseAmount), count: prev.count + (isRefund ? 0 : 1) })
  }
  const grand = sum([...map.values()].map((v) => v.total))
  const catMap = new Map(categories.map((c) => [c.id, c]))
  return [...map.entries()]
    .map(([categoryId, v]) => {
      const cat = catMap.get(categoryId)
      return {
        categoryId,
        name: cat?.name ?? 'Uncategorised',
        emoji: cat?.emoji ?? '📦',
        color: cat?.color ?? '#8d97ab',
        total: v.total,
        count: v.count,
        share: grand ? (v.total / grand) * 100 : 0,
      }
    })
    .sort((a, b) => b.total - a.total)
}

export interface MerchantTotal {
  merchant: string
  total: number
  count: number
  lastDate: ISODate
}

export function byMerchant(txns: Txn[], limit = 8): MerchantTotal[] {
  const map = new Map<string, MerchantTotal>()
  for (const t of txns) {
    if (t.type !== 'expense' && t.type !== 'refund') continue
    const key = t.merchant || 'Unknown'
    const prev = map.get(key) ?? { merchant: key, total: 0, count: 0, lastDate: t.date }
    prev.total += spendDelta(t)
    if (t.type === 'expense') prev.count += 1
    if (t.date > prev.lastDate) prev.lastDate = t.date
    map.set(key, prev)
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit)
}

export interface DayPoint {
  date: ISODate
  label: string
  expense: number
  income: number
  cumulative: number
}

export function dailySeries(txns: Txn[], range: Range): DayPoint[] {
  const days: DayPoint[] = []
  let running = 0
  const byDay = new Map<string, { expense: number; income: number }>()
  for (const t of txns) {
    if (t.date < range.start || t.date > range.end) continue
    const prev = byDay.get(t.date) ?? { expense: 0, income: 0 }
    if (t.type === 'expense' || t.type === 'refund') prev.expense += spendDelta(t)
    else if (t.type === 'income') prev.income += t.baseAmount
    byDay.set(t.date, prev)
  }
  const total = daysBetween(range.start, range.end)
  for (let i = 0; i <= total; i++) {
    const date = addDays(range.start, i)
    const v = byDay.get(date) ?? { expense: 0, income: 0 }
    running += v.expense
    days.push({
      date,
      label: `${Number(date.slice(8, 10))}`,
      expense: v.expense,
      income: v.income,
      cumulative: running,
    })
  }
  return days
}

export interface MonthPoint {
  key: string
  label: string
  expense: number
  income: number
  net: number
}

export function monthlySeries(txns: Txn[], months = 6, today: ISODate = todayISO()): MonthPoint[] {
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(addMonths(today, -i)))
  const map = new Map<string, { expense: number; income: number }>()
  for (const t of txns) {
    const k = monthKey(t.date)
    if (!keys.includes(k)) continue
    const prev = map.get(k) ?? { expense: 0, income: 0 }
    if (t.type === 'expense' || t.type === 'refund') prev.expense += spendDelta(t)
    else if (t.type === 'income') prev.income += t.baseAmount
    map.set(k, prev)
  }
  return keys.map((k) => {
    const v = map.get(k) ?? { expense: 0, income: 0 }
    return { key: k, label: monthLabel(k), expense: v.expense, income: v.income, net: v.income - v.expense }
  })
}

export interface WeekdayPoint {
  day: string
  total: number
  avg: number
}

export function weekdayPattern(txns: Txn[], weekStart: 0 | 1 = 1): WeekdayPoint[] {
  const order = weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const buckets = new Map<number, { total: number; days: Set<string> }>()
  for (const d of order) buckets.set(d, { total: 0, days: new Set() })
  for (const t of txns) {
    if (t.type !== 'expense' && t.type !== 'refund') continue
    const [y, m, d] = t.date.split('-').map(Number)
    const wd = new Date(y, m - 1, d).getDay()
    const b = buckets.get(wd)
    if (!b) continue
    b.total += spendDelta(t)
    if (t.type === 'expense') b.days.add(t.date)
  }
  return order.map((d) => {
    const b = buckets.get(d)!
    return { day: names[d], total: b.total, avg: b.days.size ? Math.round(b.total / b.days.size) : 0 }
  })
}

export function heatmap(txns: Txn[], range: Range): Map<ISODate, number> {
  const map = new Map<ISODate, number>()
  for (const t of txns) {
    if ((t.type !== 'expense' && t.type !== 'refund') || t.date < range.start || t.date > range.end) continue
    map.set(t.date, (map.get(t.date) ?? 0) + spendDelta(t))
  }
  return map
}

export function changePct(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? null : 0
  return ((current - previous) / previous) * 100
}

/* ---------------------------------- budgets --------------------------------- */

export interface BudgetRow {
  budget: Budget
  /** Single-category budgets only. */
  category?: Category
  /** Display name, emoji and color — the category's, the group's, or "Everything". */
  label: string
  emoji: string
  color: string
  /** Group budgets: each member category and what it spent this period, biggest first. */
  parts?: { category: Category; spent: number }[]
  spent: number
  limit: number
  rollover: number
  remaining: number
  usedPct: number
  daysLeft: number
  dailyAllowance: number
  status: 'ok' | 'warn' | 'over'
  range: Range
}

export function periodFor(period: 'cycle' | 'weekly', settings: Settings, today: ISODate = todayISO()): Range {
  if (period === 'weekly') {
    const start = startOfWeek(today, settings.weekStart)
    return { start, end: endOfWeek(today, settings.weekStart) }
  }
  return payCycle(today, settings.payCycleStartDay)
}

/** Categories a budget counts. Empty = everything. */
export function budgetCategoryIds(b: Budget): string[] {
  if (b.categoryId === 'all') return []
  if (b.categoryId === 'group') return b.categoryIds ?? []
  return [b.categoryId]
}

/** Does this budget count spending in `categoryId`? */
export function budgetCovers(b: Budget, categoryId: string): boolean {
  if (b.categoryId === 'all') return true
  return budgetCategoryIds(b).includes(categoryId)
}

export function budgetRows(
  budgets: Budget[],
  txns: Txn[],
  categories: Category[],
  settings: Settings,
  today: ISODate = todayISO(),
): BudgetRow[] {
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const rows: BudgetRow[] = []

  for (const b of budgets) {
    if (b.archived) continue
    const range = periodFor(b.period, settings, today)
    const prevRange = shiftPeriod(range, -1, b.period === 'weekly')
    const inPeriod = (t: Txn, r: Range) =>
      (t.type === 'expense' || t.type === 'refund') && t.date >= r.start && t.date <= r.end && budgetCovers(b, t.categoryId)

    const spent = sum(txns.filter((t) => inPeriod(t, range)).map(spendDelta))
    const prevSpent = sum(txns.filter((t) => inPeriod(t, prevRange)).map(spendDelta))
    // Only roll over from a period the budget actually existed in.
    const existedBefore = !b.createdAt || b.createdAt.slice(0, 10) <= prevRange.end
    const rollover = b.rollover && existedBefore ? Math.min(b.amount, Math.max(0, b.amount - prevSpent)) : 0
    const limit = b.amount + rollover
    const remaining = limit - spent
    const daysLeft = Math.max(1, daysBetween(today, range.end) + 1)
    const usedPct = limit ? (spent / limit) * 100 : 0

    const isGroup = b.categoryId === 'group'
    const category = b.categoryId === 'all' || isGroup ? undefined : catMap.get(b.categoryId)
    let parts: BudgetRow['parts']
    if (isGroup) {
      const current = txns.filter((t) => inPeriod(t, range))
      parts = budgetCategoryIds(b)
        .map((id) => catMap.get(id))
        .filter((c): c is Category => Boolean(c))
        .map((c) => ({ category: c, spent: sum(current.filter((t) => t.categoryId === c.id).map(spendDelta)) }))
        .sort((x, y) => y.spent - x.spent)
    }
    const groupName =
      budgetCategoryIds(b)
        .map((id) => catMap.get(id)?.name)
        .filter(Boolean)
        .join(' + ') || 'Group'

    rows.push({
      budget: b,
      category,
      label: isGroup ? b.name?.trim() || groupName : category?.name ?? (b.categoryId === 'all' ? 'Everything' : 'Removed category'),
      emoji: isGroup ? b.emoji || '🧺' : category?.emoji ?? '🎯',
      color: isGroup ? '#7C5CFF' : category?.color ?? '#7C5CFF',
      parts,
      spent,
      limit,
      rollover,
      remaining,
      usedPct,
      daysLeft,
      dailyAllowance: remaining > 0 ? Math.round(remaining / daysLeft) : 0,
      status: spent > limit ? 'over' : usedPct >= 85 ? 'warn' : 'ok',
      range,
    })
  }

  return rows.sort((a, b) => b.usedPct - a.usedPct)
}

export interface SafeToSpend {
  basis: 'budgets' | 'allowance' | 'none'
  limit: number
  spent: number
  remainingBudget: number
  billsReserved: number
  /** Set aside this cycle for savings pots. */
  potsReserved: number
  discretionary: number
  perDay: number
  daysLeft: number
  range: Range
  overBudget: boolean
  billsDue: { bill: Bill; schedule: BillSchedule }[]
}

export function computeSafeToSpend(
  rows: BudgetRow[],
  txns: Txn[],
  bills: Bill[],
  schedules: Map<string, BillSchedule>,
  settings: Settings,
  today: ISODate = todayISO(),
  potsReserved = 0,
): SafeToSpend {
  const range = payCycle(today, settings.payCycleStartDay)
  const daysLeft = Math.max(1, daysBetween(today, range.end) + 1)
  const allRow = rows.find((r) => r.budget.categoryId === 'all')

  let limit = 0
  let spent = 0
  let basis: SafeToSpend['basis'] = 'none'

  if (allRow) {
    limit = allRow.limit
    spent = allRow.spent
    basis = 'budgets'
  } else if (rows.length) {
    limit = sum(rows.map((r) => r.limit))
    spent = sum(rows.map((r) => r.spent))
    basis = 'budgets'
  } else if (settings.monthlyAllowance > 0) {
    limit = settings.monthlyAllowance
    spent = sum(txnRange(txns, range).map(spendDelta))
    basis = 'allowance'
  }

  const billsDue = bills
    .filter((b) => b.active && !b.archived)
    .map((b) => ({ bill: b, schedule: schedules.get(b.id) }))
    .filter((x): x is { bill: Bill; schedule: BillSchedule } => Boolean(x.schedule?.nextDue))
    .filter((x) => !x.schedule.snoozed && x.schedule.nextDue! <= range.end)
    .sort((a, b) => (a.schedule.nextDue ?? '').localeCompare(b.schedule.nextDue ?? ''))

  const billsReserved = sum(billsDue.map((x) => x.schedule.typicalAmount || x.bill.baseAmount))
  const remainingBudget = limit - spent
  const discretionary = Math.max(0, remainingBudget - billsReserved - potsReserved)

  return {
    basis,
    limit,
    spent,
    remainingBudget,
    billsReserved,
    potsReserved,
    discretionary,
    perDay: Math.round(discretionary / daysLeft),
    daysLeft,
    range,
    overBudget: limit > 0 && spent > limit,
    billsDue,
  }
}

/* --------------------------------- anomalies -------------------------------- */

const SEVERITY_RANK: Record<Anomaly['severity'], number> = { high: 0, medium: 1, low: 2 }

export function detectAnomalies(
  txns: Txn[],
  categories: Category[],
  settings: Settings,
  today: ISODate = todayISO(),
): Anomaly[] {
  const out: Anomaly[] = []
  const unit = minorFactor(settings.currency)
  const minCategorySpend = 15 * unit
  const minDiff = 10 * unit
  const cycle = payCycle(today, settings.payCycleStartDay)
  const dayOffset = daysBetween(cycle.start, today)
  if (dayOffset < 2) return out

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const priorCycles = [1, 2, 3].map((i) => {
    const shifted = shiftPeriod(cycle, -i as -1 | 1, false)
    return { start: shifted.start, end: addDays(shifted.start, dayOffset) }
  })

  const spendIn = (categoryId: string, range: Range) =>
    sum(
      txns
        .filter((t) => t.categoryId === categoryId && t.date >= range.start && t.date <= range.end)
        .map(spendDelta),
    )

  const categoryIds = new Set(txns.filter((t) => t.type === 'expense').map((t) => t.categoryId))
  for (const categoryId of categoryIds) {
    const current = spendIn(categoryId, cycle)
    const prior = priorCycles.map((r) => spendIn(categoryId, r))
    const baseline = mean(prior.filter((v) => v > 0))
    if (baseline < minCategorySpend) continue
    const diff = current - baseline
    if (current > baseline * 1.55 && diff >= minDiff) {
      const cat = catMap.get(categoryId)
      const ratio = Math.round((current / baseline - 1) * 100)
      out.push({
        id: `spike-${categoryId}`,
        kind: 'category-spike',
        severity: ratio >= 90 ? 'high' : ratio >= 45 ? 'medium' : 'low',
        title: `${cat?.name ?? 'Spending'} is up ${ratio}%`,
        detail: `You've spent ${formatMoney(current, settings.currency)} so far this cycle vs your usual ${formatMoney(
          Math.round(baseline),
          settings.currency,
        )} by this point in the cycle.`,
        amount: diff,
        categoryId,
      })
    }
  }

  // Unusually large single expenses
  const expenses = txns.filter((t) => t.type === 'expense' && t.date <= today && daysBetween(t.date, today) <= 90)
  if (expenses.length >= 8) {
    const med = median(expenses.map((t) => t.baseAmount))
    const big = expenses
      .filter((t) => daysBetween(t.date, today) <= 14 && t.baseAmount > Math.max(med * 3, 40 * unit))
      .sort((a, b) => b.baseAmount - a.baseAmount)
      .slice(0, 2)
    for (const t of big) {
      out.push({
        id: `large-${t.id}`,
        kind: 'large',
        severity: 'low',
        title: `Large charge at ${t.merchant}`,
        detail: `About ${(t.baseAmount / Math.max(1, med)).toFixed(1)}× your typical expense.`,
        amount: t.baseAmount,
        date: t.date,
        categoryId: t.categoryId,
      })
    }
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.amount - a.amount).slice(0, 8)
}

/* ------------------------------- subscriptions ------------------------------ */

/** Gap ranges (days) that look like a real billing cadence. */
const CADENCES: [number, number][] = [
  [5, 9], // weekly
  [12, 16], // biweekly
  [26, 35], // monthly
  [55, 65], // every two months
  [84, 98], // quarterly
  [170, 195], // half-yearly
  [350, 380], // yearly
]

function isCadence(gap: number): boolean {
  return CADENCES.some(([lo, hi]) => gap >= lo && gap <= hi)
}

export function detectSubscriptions(txns: Txn[], today: ISODate = todayISO()): SubscriptionCandidate[] {
  const groups = new Map<string, Txn[]>()
  for (const t of txns) {
    if (t.type !== 'expense' || t.date > today) continue
    if (daysBetween(t.date, today) > 800) continue
    const key = normalizeMerchant(t.merchant)
    if (!key) continue
    const arr = groups.get(key) ?? []
    arr.push(t)
    groups.set(key, arr)
  }

  const out: SubscriptionCandidate[] = []
  for (const [, group] of groups) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date))
    const amounts = sorted.map((t) => t.baseAmount)
    const med = median(amounts)
    if (med <= 0) continue

    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date))
    const recentGaps = gaps.slice(-6)
    const medGap = median(recentGaps)
    if (!isCadence(medGap)) continue

    const longCycle = medGap >= 80
    // Short cycles need three charges; quarterly/yearly ones can be spotted from two, but only when
    // the amounts are nearly identical (so two random Amazon orders a year apart don't qualify).
    const tolerance = longCycle && sorted.length < 3 ? 0.12 : 0.35
    const consistent = amounts.filter((a) => Math.abs(a - med) / med <= tolerance)
    if (consistent.length < (longCycle ? 2 : 3)) continue

    const cv = medGap ? stdDev(recentGaps) / medGap : 1
    if (recentGaps.length >= 2 && cv > 0.4) continue

    const lastDate = sorted[sorted.length - 1].date
    if (daysBetween(lastDate, today) > Math.max(50, medGap * 1.6)) continue

    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const priceChangePct = first.baseAmount ? ((last.baseAmount - first.baseAmount) / first.baseAmount) * 100 : 0

    out.push({
      id: `sub-${normalizeMerchant(sorted[0].merchant).replace(/\s+/g, '-')}`,
      merchant: last.merchant || first.merchant,
      occurrences: sorted.length,
      avgAmount: Math.round(mean(consistent)),
      monthlyAmount: Math.round(mean(consistent) * (30.44 / medGap)),
      lastDate,
      intervalDays: Math.round(medGap),
      priceChangePct,
      categoryId: last.categoryId,
    })
  }

  return out.sort((a, b) => b.monthlyAmount - a.monthlyAmount).slice(0, 20)
}

export function sparklineData(txns: Txn[], days = 14, today: ISODate = todayISO()): number[] {
  const start = addDays(today, -(days - 1))
  const series = dailySeries(txns, { start, end: today })
  return series.map((p) => p.expense)
}

export function topCategoriesWithTrend(
  txns: Txn[],
  categories: Category[],
  current: Range,
  previous: Range,
  limit = 5,
): (CategoryTotal & { previous: number; change: number | null })[] {
  const now = byCategory(txnRange(txns, current), categories)
  const before = byCategory(txnRange(txns, previous), categories)
  const prevMap = new Map(before.map((b) => [b.categoryId, b.total]))
  return now.slice(0, limit).map((c) => {
    const prev = prevMap.get(c.categoryId) ?? 0
    return { ...c, previous: prev, change: changePct(c.total, prev) }
  })
}

export { pct, clamp }
