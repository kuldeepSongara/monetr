import type { Category, ISODate, Txn } from '../types'
import { addDays, daysBetween, type Range } from './dates'
import { spendDelta } from './analytics'

export interface PeriodSide {
  range: Range
  spent: number
  income: number
  count: number
}

export interface CategoryChange {
  id: string
  name: string
  emoji: string
  color: string
  a: number
  b: number
  delta: number
}

export interface Comparison {
  a: PeriodSide
  b: PeriodSide
  /** When A is still running: B's spending over the same number of days, for a fair "so far" view. */
  bSameDays: number | null
  daysElapsed: number
  /** Day-by-day running totals, aligned by day number. */
  cumulative: { day: number; a?: number; b?: number }[]
  categories: CategoryChange[]
}

const inRange = (t: Txn, r: Range) => t.date >= r.start && t.date <= r.end
const isSpend = (t: Txn) => t.type === 'expense' || t.type === 'refund'

function side(txns: Txn[], r: Range): PeriodSide {
  const list = txns.filter((t) => inRange(t, r))
  return {
    range: r,
    spent: Math.max(0, list.filter(isSpend).reduce((s, t) => s + spendDelta(t), 0)),
    income: list.filter((t) => t.type === 'income').reduce((s, t) => s + t.baseAmount, 0),
    count: list.filter((t) => t.type === 'expense').length,
  }
}

export function comparePeriods(txns: Txn[], categories: Category[], a: Range, b: Range, today: ISODate): Comparison {
  const lenA = daysBetween(a.start, a.end) + 1
  const lenB = daysBetween(b.start, b.end) + 1
  const ongoing = today >= a.start && today < a.end
  const daysElapsed = ongoing ? daysBetween(a.start, today) + 1 : lenA

  const spendA = txns.filter((t) => isSpend(t) && inRange(t, a))
  const spendB = txns.filter((t) => isSpend(t) && inRange(t, b))

  const daily = (list: Txn[], start: ISODate, len: number) => {
    const out = new Array<number>(len).fill(0)
    for (const t of list) {
      const i = daysBetween(start, t.date)
      if (i >= 0 && i < len) out[i] += spendDelta(t)
    }
    return out
  }
  const dA = daily(spendA, a.start, lenA)
  const dB = daily(spendB, b.start, lenB)
  const cumulative: Comparison['cumulative'] = []
  let ra = 0
  let rb = 0
  for (let i = 0; i < Math.max(lenA, lenB); i++) {
    const point: { day: number; a?: number; b?: number } = { day: i + 1 }
    if (i < lenA && i < daysElapsed) point.a = ra += dA[i]
    if (i < lenB) point.b = rb += dB[i]
    cumulative.push(point)
  }

  const bSameDays = ongoing ? Math.max(0, dB.slice(0, daysElapsed).reduce((s, v) => s + v, 0)) : null

  const byCat = (list: Txn[]) => {
    const m = new Map<string, number>()
    for (const t of list) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + spendDelta(t))
    return m
  }
  const ca = byCat(spendA)
  // Compare like with like: when A is still running, compare categories over the same days of B.
  const cb = byCat(ongoing ? spendB.filter((t) => daysBetween(b.start, t.date) < daysElapsed) : spendB)
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const ids = new Set([...ca.keys(), ...cb.keys()])
  const cats: CategoryChange[] = [...ids]
    .map((id) => {
      const c = catMap.get(id)
      const va = Math.max(0, ca.get(id) ?? 0)
      const vb = Math.max(0, cb.get(id) ?? 0)
      return { id, name: c?.name ?? 'Other', emoji: c?.emoji ?? '•', color: c?.color ?? '#9CA3AF', a: va, b: vb, delta: va - vb }
    })
    .filter((c) => c.a || c.b)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))

  return { a: side(txns, a), b: side(txns, b), bSameDays, daysElapsed, cumulative, categories: cats }
}

/** The same dates a year earlier. */
export function lastYear(r: Range): Range {
  const shift = (d: ISODate) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28')
  return { start: shift(r.start), end: shift(r.end) }
}

/** A period of the same length as `r`, starting on `start`. */
export function sameLength(r: Range, start: ISODate): Range {
  return { start, end: addDays(start, daysBetween(r.start, r.end)) }
}
