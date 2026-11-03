import type { Bill, ISODate, Txn } from '../types'
import type { BudgetRow, SafeToSpend } from './analytics'
import { spendDelta } from './analytics'
import type { BillSchedule } from './bills'
import { addDays, daysBetween, parseISO } from './dates'
import { formatMoney } from './money'
import type { PotStatus } from './pots'

/*
 * Nudges: short, specific heads-ups worked out from your own numbers on this device — no server.
 * They show inside the app and, where notifications are on, as system notifications at sensible
 * times of day (bills in the morning, pace and the day's summary in the evening).
 */

export type NudgeKind = 'pace' | 'over' | 'projection' | 'summary' | 'unlogged' | 'bill' | 'weekend' | 'cycle' | 'pot'

export interface Nudge {
  /** Stable for the day, so one nudge is never shown twice. */
  id: string
  kind: NudgeKind
  title: string
  body: string
  /** Local date-time when it's useful, `YYYY-MM-DDTHH:MM`. */
  at: string
  /** App route to open. */
  url: string
  /** Higher first when several are due together. */
  priority: number
}

export interface NudgeInput {
  today: ISODate
  currency: string
  rows: BudgetRow[]
  safe: SafeToSpend
  txns: Txn[]
  bills: Bill[]
  schedules: Map<string, BillSchedule>
  pots: PotStatus[]
  /** Budgets still waiting for an overspend decision. */
  overspendCount: number
}

const at = (date: ISODate, hhmm: string) => `${date}T${hhmm}`

/** How far into its period a budget is, 0–1 (counting today as used). */
function elapsed(row: BudgetRow, today: ISODate): { frac: number; daysLeft: number; len: number; gone: number } {
  const len = daysBetween(row.range.start, row.range.end) + 1
  const gone = Math.min(len, Math.max(1, daysBetween(row.range.start, today) + 1))
  return { frac: gone / len, daysLeft: Math.max(1, len - gone + 1), len, gone }
}

export function computeNudges(input: NudgeInput): Nudge[] {
  const { today, currency, rows, safe, txns, bills, schedules, pots } = input
  const money = (m: number) => formatMoney(Math.round(m), currency)
  const out: Nudge[] = []

  // 1. Budget pace — evening, one per budget per day, only when it's worth saying.
  for (const row of rows) {
    if (row.budget.archived || !row.budget.amount) continue
    const { frac, daysLeft, gone, len } = elapsed(row, today)
    const name = row.label
    // Checked first: a budget whose whole limit went to pots or catch-up can still be over.
    if (row.spent > row.limit) {
      out.push({
        id: `over_${row.budget.id}_${today}`,
        kind: 'over',
        title: `${name} is over budget`,
        body: `${money(row.spent - row.limit)} over with ${daysLeft} day${daysLeft === 1 ? '' : 's'} to go. Anything more here comes out of next cycle.`,
        at: at(today, '20:00'),
        url: '/budgets',
        priority: 80,
      })
      continue
    }
    if (!row.limit) continue
    const used = row.spent / row.limit
    const ahead = used - frac
    if (used >= 0.5 && ahead >= 0.25) {
      const perDay = (row.limit - row.spent) / daysLeft
      out.push({
        id: `pace_${row.budget.id}_${today}`,
        kind: 'pace',
        title: `Slow down on ${name}`,
        body: `${Math.round(used * 100)}% used, only ${Math.round(frac * 100)}% of the ${row.budget.period === 'weekly' ? 'week' : 'cycle'} gone. About ${money(perDay)} a day keeps you on track for the next ${daysLeft} days.`,
        at: at(today, '20:00'),
        url: '/budgets',
        priority: 70 + Math.round(ahead * 20),
      })
      continue
    }
    // Projection: early enough to change course, late enough to mean something.
    if (gone >= 5 && frac < 0.85) {
      const projected = (row.spent / gone) * len
      if (projected > row.limit * 1.1) {
        out.push({
          id: `proj_${row.budget.id}_${today}`,
          kind: 'projection',
          title: `${name} is heading over`,
          body: `At this pace it ends about ${money(projected - row.limit)} over. ${money((row.limit - row.spent) / daysLeft)} a day from here keeps it on budget.`,
          at: at(today, '20:00'),
          url: '/budgets',
          priority: 60,
        })
      }
    }
  }

  // 2. The day's summary — what you spent and what tomorrow looks like.
  const todays = txns.filter((t) => t.date === today && (t.type === 'expense' || t.type === 'refund'))
  if (todays.length) {
    const spentToday = todays.reduce((s, t) => s + spendDelta(t), 0)
    const tomorrow = safe.basis === 'none' || safe.daysLeft <= 1 ? '' : ` Tomorrow you can spend about ${money(Math.max(0, safe.discretionary) / (safe.daysLeft - 1))}.`
    out.push({
      id: `summary_${today}`,
      kind: 'summary',
      title: `Today: ${money(spentToday)} spent`,
      body: `${todays.length} entr${todays.length === 1 ? 'y' : 'ies'}.${tomorrow}`,
      at: at(today, '21:00'),
      url: '/transactions',
      priority: 40,
    })
  } else {
    out.push({
      id: `unlogged_${today}`,
      kind: 'unlogged',
      title: 'Nothing logged today',
      body: 'Spent anything? A quick “coffee 4.50” keeps your numbers right.',
      at: at(today, '21:00'),
      url: '/',
      priority: 20,
    })
  }

  // 3. Bills — the morning they're due, and the day before.
  for (const bill of bills) {
    if (!bill.active || bill.archived) continue
    const s = schedules.get(bill.id)
    if (!s?.nextDue || s.snoozed) continue
    const amount = s.typicalAmount || bill.baseAmount
    const amt = amount ? ` (${bill.variable ? '~' : ''}${money(amount)})` : ''
    if (s.nextDue === addDays(today, 1)) {
      out.push({ id: `bill_${bill.id}_${s.nextDue}_pre`, kind: 'bill', title: `${bill.name} is due tomorrow`, body: `${bill.autoPay ? 'Autopay' : 'Due'}${amt}.`, at: at(today, '09:00'), url: '/bills', priority: 90 })
    } else if (s.nextDue === today && !bill.autoPay) {
      out.push({ id: `bill_${bill.id}_${s.nextDue}_due`, kind: 'bill', title: `${bill.name} is due today`, body: `Mark it paid once it's done${amt}.`, at: at(today, '09:00'), url: '/bills', priority: 95 })
    } else if (s.status === 'overdue' && !bill.autoPay) {
      out.push({ id: `bill_${bill.id}_${today}_late`, kind: 'bill', title: `${bill.name} is overdue`, body: `${s.overdueDays} day${s.overdueDays === 1 ? '' : 's'} late${amt}.`, at: at(today, '09:00'), url: '/bills', priority: 85 })
    }
  }

  // 4. Friday: the weekend ahead.
  if (parseISO(today).getDay() === 5 && safe.basis !== 'none' && safe.daysLeft >= 3) {
    out.push({
      id: `weekend_${today}`,
      kind: 'weekend',
      title: 'Weekend ahead',
      body: `About ${money(Math.max(0, safe.perDay) * 3)} for Friday to Sunday keeps the cycle on track.`,
      at: at(today, '17:00'),
      url: '/',
      priority: 50,
    })
  }

  // 5. A new cycle that needs a decision about last one.
  if (input.overspendCount) {
    out.push({
      id: `cycle_${safe.range.start}`,
      kind: 'cycle',
      title: 'New cycle — one decision waiting',
      body: `${input.overspendCount} budget${input.overspendCount === 1 ? '' : 's'} went over last cycle. Choose whether to catch up or start fresh.`,
      at: at(today, '09:30'),
      url: '/budgets',
      priority: 75,
    })
  }

  // 6. Savings pots that just reached their goal.
  for (const p of pots) {
    if (p.state === 'ready') {
      out.push({ id: `pot_${p.pot.id}_ready`, kind: 'pot', title: `${p.pot.name} is ready`, body: `${money(p.setAside)} saved. Link the purchase to the pot when you buy.`, at: at(today, '10:00'), url: '/budgets', priority: 55 })
    }
  }

  return out.sort((a, b) => b.priority - a.priority)
}

/** Most notifications Monetr sends in one day, across morning and evening, so it never nags. */
export const DAILY_NOTIFICATION_CAP = 4

/** Nudges worth a system notification now: due, not shown before, at most `limit` at once. */
export function dueNudges(all: Nudge[], shown: Set<string>, nowLocal: string, limit = 3): Nudge[] {
  // Only today's: a nudge worked out yesterday is stale by now.
  const day = nowLocal.slice(0, 10)
  return all.filter((n) => n.at.slice(0, 10) === day && n.at <= nowLocal && !shown.has(n.id)).slice(0, limit)
}

/** Local `YYYY-MM-DDTHH:MM` for a Date. */
export function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
