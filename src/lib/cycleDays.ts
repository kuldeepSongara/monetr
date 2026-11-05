import type { Bill, BillPayment, Category, ISODate, SubscriptionCandidate, Txn } from '../types'
import { spendDelta } from './analytics'
import { comparePeriods } from './compare'
import { addDays, daysBetween, formatDate, type Range } from './dates'
import { formatMoney, minorFactor } from './money'
import { normalizeMerchant } from './utils'

/*
 * The pay cycle, day by day, for the Home hero: what each day cost, split into fixed costs (bills,
 * rent, subscriptions) and everyday spending, with a per-category breakdown — plus a short,
 * useful line about the cycle that isn't just "rent was the biggest day".
 */

export interface DayCategory {
  id: string
  name: string
  emoji: string
  color: string
  amount: number
}

export interface CycleDay {
  i: number
  date: ISODate
  total: number
  /** Bills, rent and subscriptions — the same every cycle. */
  fixed: number
  everyday: number
  categories: DayCategory[]
  count: number
}

/** Transactions that are fixed costs: paid as a bill, made to a bill's payee, or a detected monthly subscription. */
export function fixedTxnIds(
  txns: Txn[],
  bills: Bill[],
  payments: BillPayment[],
  subscriptions: Pick<SubscriptionCandidate, 'merchant' | 'intervalDays'>[],
): Set<string> {
  const ids = new Set(payments.map((p) => p.txnId).filter((x): x is string => Boolean(x)))
  const names = new Set<string>()
  for (const b of bills) {
    if (b.archived) continue
    names.add(normalizeMerchant(b.name))
    if (b.merchant) names.add(normalizeMerchant(b.merchant))
  }
  // Only monthly-or-longer cadences: a café you visit every few days isn't a subscription.
  for (const s of subscriptions) if (s.intervalDays >= 25) names.add(normalizeMerchant(s.merchant))
  for (const t of txns) {
    if (t.type !== 'expense') continue
    if (t.source === 'bill' || names.has(normalizeMerchant(t.merchant))) ids.add(t.id)
  }
  return ids
}

export function cycleDays(txns: Txn[], categories: Category[], range: Range, fixed: Set<string>): CycleDay[] {
  const len = daysBetween(range.start, range.end) + 1
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const days: CycleDay[] = Array.from({ length: len }, (_, i) => ({ i, date: addDays(range.start, i), total: 0, fixed: 0, everyday: 0, categories: [], count: 0 }))
  const perDayCat: Map<string, number>[] = days.map(() => new Map())
  for (const t of txns) {
    if ((t.type !== 'expense' && t.type !== 'refund') || t.date < range.start || t.date > range.end) continue
    const i = daysBetween(range.start, t.date)
    const v = spendDelta(t)
    const d = days[i]
    d.total += v
    if (fixed.has(t.id) || (t.refundOf && fixed.has(t.refundOf))) d.fixed += v
    else d.everyday += v
    if (t.type === 'expense') d.count++
    perDayCat[i].set(t.categoryId, (perDayCat[i].get(t.categoryId) ?? 0) + v)
  }
  days.forEach((d, i) => {
    d.total = Math.max(0, d.total)
    d.fixed = Math.max(0, d.fixed)
    d.everyday = Math.max(0, d.everyday)
    d.categories = [...perDayCat[i].entries()]
      .filter(([, v]) => v > 0)
      .map(([id, amount]) => {
        const c = catMap.get(id)
        return { id, name: c?.name ?? 'Other', emoji: c?.emoji ?? '•', color: c?.color ?? '#9CA3AF', amount }
      })
      .sort((a, b) => b.amount - a.amount)
  })
  return days
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "September" when cycles follow calendar months, otherwise "last cycle". */
export function cycleName(r: Range, fallback: string): string {
  return r.start.endsWith('-01') && addDays(r.end, 1).endsWith('-01') ? MONTHS[Number(r.start.slice(5, 7)) - 1] : fallback
}

/**
 * One or two sentences worth reading about a cycle. Fixed costs are left out — they're the same
 * every month — so this talks about what you actually chose to spend.
 */
export function cycleInsights(opts: {
  txns: Txn[]
  categories: Category[]
  range: Range
  prevRange: Range
  today: ISODate
  fixed: Set<string>
  currency: string
  /** A finished cycle (past tense) or the one in progress. */
  finished: boolean
}): string[] {
  const { categories, range, prevRange, today, fixed, currency, finished } = opts
  // Whole amounts read faster in a sentence; keep cents only for small sums.
  const money = (m: number) => formatMoney(Math.round(m), currency, Math.abs(m) >= 20 * minorFactor(currency) ? { decimals: 0 } : {})
  const everyday = opts.txns.filter((t) => !fixed.has(t.id) && !(t.refundOf && fixed.has(t.refundOf)))
  const out: string[] = []
  const prevName = cycleName(prevRange, finished ? 'the cycle before' : 'last cycle')

  // 1. The category that moved most against the previous cycle (same days so far, if still running).
  const cmp = comparePeriods(everyday, categories, range, prevRange, finished ? addDays(range.end, 1) : today)
  const everydayTotal = cmp.a.spent
  const threshold = Math.max(everydayTotal * 0.08, 10 * minorFactor(currency))
  const mover = cmp.categories.find((c) => Math.abs(c.delta) >= threshold)
  if (mover) {
    const name = `${mover.emoji} ${mover.name}`
    if (finished) {
      out.push(
        mover.b === 0
          ? `${name}: ${money(mover.a)} — nothing there in ${prevName}.`
          : `${name} came to ${money(mover.a)}, ${money(Math.abs(mover.delta))} ${mover.delta > 0 ? 'more' : 'less'} than ${prevName}.`,
      )
    } else {
      out.push(`${name} is ${money(Math.abs(mover.delta))} ${mover.delta > 0 ? 'ahead of' : 'below'} the same point in ${prevName}.`)
    }
  }

  // 2. The heaviest day of everyday spending, when one clearly stands out.
  const days = cycleDays(everyday, categories, range, new Set()).filter((d) => d.date <= today)
  const spending = days.filter((d) => d.total > 0)
  if (spending.length >= 3) {
    const heaviest = spending.reduce((a, d) => (d.total > a.total ? d : a))
    const mean = spending.reduce((s, d) => s + d.total, 0) / spending.length
    if (heaviest.total >= mean * 2) {
      const top = heaviest.categories[0]
      out.push(`Heaviest everyday day: ${formatDate(heaviest.date, 'day')} ${formatDate(heaviest.date, 'short').split(' ')[1]}, ${money(heaviest.total)}${top ? ` — mostly ${top.name}` : ''}.`)
    }
  }

  // 3. Otherwise, the everyday daily average.
  if (out.length < 2 && days.length && everydayTotal > 0) {
    out.push(`Everyday spending ${finished ? 'averaged' : 'is averaging'} ${money(everydayTotal / days.length)} a day, bills and subscriptions aside.`)
  }
  return out.slice(0, 2)
}
