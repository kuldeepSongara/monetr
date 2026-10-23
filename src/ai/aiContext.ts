import type { Anomaly, Bill, Category, ISODate, Settings, SubscriptionCandidate, Txn } from '../types'
import type { BillSchedule } from '../lib/bills'
import type { BudgetRow } from '../lib/analytics'
import type { Range } from '../lib/dates'
import { byCategory, byMerchant, monthlySeries, totals, weekdayPattern } from '../lib/analytics'
import { formatDate } from '../lib/dates'
import { minorFactor } from '../lib/money'

export interface SpendContext {
  today: ISODate
  baseCurrency: string
  period: { label: string; start: ISODate; end: ISODate; daysLeft: number }
  totals: { expense: number; income: number; net: number }
  previousPeriod: { expense: number; income: number; net: number }
  categories: { name: string; total: number; count: number; previous: number; changePct: number | null }[]
  merchants: { name: string; total: number; count: number }[]
  budgets: { name: string; limit: number; spent: number; remaining: number; daysLeft: number }[]
  upcomingBills: { name: string; due: ISODate; amount: number; autoPay: boolean; status: string }[]
  anomalies: { title: string; detail: string; amount: number }[]
  monthly: { month: string; expense: number; income: number }[]
  weekdayAverages: { day: string; avg: number }[]
  subscriptions?: { merchant: string; monthly: number; lastCharge: ISODate; occurrences: number }[]
  notes?: string
}

export interface BuildContextInput {
  txns: Txn[]
  categories: Category[]
  settings: Settings
  today: ISODate
  range: Range
  previousRange: Range
  rows: BudgetRow[]
  bills: Bill[]
  schedules: Map<string, BillSchedule>
  anomalies: Anomaly[]
  subscriptions?: SubscriptionCandidate[]
  daysLeft?: number
}

export function buildSpendContext(input: BuildContextInput): SpendContext {
  const { txns, categories, settings, range, previousRange, rows, bills, schedules, anomalies } = input
  const unit = minorFactor(settings.currency)
  const toMajor = (minor: number) => Math.round((minor / unit) * 100) / 100

  const current = txns.filter((t) => t.date >= range.start && t.date <= range.end)
  const previous = txns.filter((t) => t.date >= previousRange.start && t.date <= previousRange.end)
  const nowTotals = totals(current)
  const prevTotals = totals(previous)

  const nowCats = byCategory(current, categories)
  const prevCats = byCategory(previous, categories)
  const prevMap = new Map(prevCats.map((c) => [c.categoryId, c.total]))

  return {
    today: input.today,
    baseCurrency: settings.currency,
    period: {
      label: `${formatDate(range.start, 'short')} → ${formatDate(range.end, 'short')}`,
      start: range.start,
      end: range.end,
      daysLeft: input.daysLeft ?? 0,
    },
    totals: { expense: toMajor(nowTotals.expense), income: toMajor(nowTotals.income), net: toMajor(nowTotals.net) },
    previousPeriod: {
      expense: toMajor(prevTotals.expense),
      income: toMajor(prevTotals.income),
      net: toMajor(prevTotals.net),
    },
    categories: nowCats.slice(0, 10).map((c) => {
      const prev = prevMap.get(c.categoryId) ?? 0
      return {
        name: c.name,
        total: toMajor(c.total),
        count: c.count,
        previous: toMajor(prev),
        changePct: prev > 0 ? Math.round(((c.total - prev) / prev) * 100) : null,
      }
    }),
    merchants: byMerchant(current, 8).map((m) => ({
      name: m.merchant,
      total: toMajor(m.total),
      count: m.count,
    })),
    budgets: rows.map((r) => ({
      name: r.category?.name ?? 'Everything',
      limit: toMajor(r.limit),
      spent: toMajor(r.spent),
      remaining: toMajor(r.remaining),
      daysLeft: r.daysLeft,
    })),
    upcomingBills: bills
      .filter((b) => b.active && !b.archived)
      .map((b) => ({ bill: b, schedule: schedules.get(b.id) }))
      .filter((x): x is { bill: Bill; schedule: BillSchedule } => Boolean(x.schedule?.nextDue))
      .sort((a, b) => (a.schedule.nextDue ?? '').localeCompare(b.schedule.nextDue ?? ''))
      .slice(0, 8)
      .map((x) => ({
        name: x.bill.name,
        due: x.schedule.nextDue!,
        amount: toMajor(x.schedule.typicalAmount || x.bill.baseAmount),
        autoPay: x.bill.autoPay,
        status: x.schedule.status,
      })),
    anomalies: anomalies.map((a) => ({ title: a.title, detail: a.detail, amount: toMajor(a.amount) })),
    monthly: monthlySeries(txns, 6).map((m) => ({
      month: m.label,
      expense: toMajor(m.expense),
      income: toMajor(m.income),
    })),
    weekdayAverages: weekdayPattern(current, settings.weekStart).map((w) => ({ day: w.day, avg: toMajor(w.avg) })),
    subscriptions: input.subscriptions?.map((s) => ({
      merchant: s.merchant,
      monthly: toMajor(s.monthlyAmount),
      lastCharge: s.lastDate,
      occurrences: s.occurrences,
    })),
  }
}
