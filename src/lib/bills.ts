import type { Bill, BillPayment, ISODate } from '../types'
import { addDays, addMonths, daysBetween, daysInMonth, parseISO, toISO, todayISO } from './dates'
import { median, stdDev } from './utils'

export type BillStatus = 'overdue' | 'due-soon' | 'upcoming' | 'paid' | 'inactive'

export interface BillSchedule {
  nextDue: ISODate | null
  lastPaid: ISODate | null
  status: BillStatus
  daysUntil: number | null
  overdueDays: number
  confidence: number
  cadenceDays: number | null
  basis: 'fixed-day' | 'history' | 'anchor' | 'none'
  paymentCount: number
  typicalAmount: number
  snoozed: boolean
}

const EXPECTED_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  quarterly: 91.31,
  yearly: 365.25,
}

function setDayOfMonth(iso: ISODate, day: number): ISODate {
  const d = parseISO(iso)
  const dim = daysInMonth(d.getFullYear(), d.getMonth())
  return toISO(new Date(d.getFullYear(), d.getMonth(), Math.min(day, dim)))
}

function monthsFor(frequency: Bill['frequency']): number | null {
  if (frequency === 'monthly') return 1
  if (frequency === 'quarterly') return 3
  if (frequency === 'yearly') return 12
  return null
}

/**
 * Predict the next due date of a bill from its actual payment history.
 * Fixed-day bills use the calendar day; everything else uses the median gap
 * between recent payments (which tolerates weekends / shifting due dates).
 */
export function predictBill(bill: Bill, payments: BillPayment[], today: ISODate = todayISO()): BillSchedule {
  const mine = payments
    .filter((p) => p.billId === bill.id)
    .sort((a, b) => a.paidDate.localeCompare(b.paidDate))

  const last = mine.length ? mine[mine.length - 1] : null
  const lastPaid = last?.paidDate ?? null
  const recent = mine.slice(-6)
  const typicalAmount = recent.length ? Math.round(median(recent.map((p) => p.baseAmount))) : bill.baseAmount

  const gaps: number[] = []
  for (let i = 1; i < mine.length; i++) {
    const gap = daysBetween(mine[i - 1].paidDate, mine[i].paidDate)
    if (gap > 0 && gap < 800) gaps.push(gap)
  }
  const recentGaps = gaps.slice(-5)
  const medianGap = recentGaps.length ? Math.round(median(recentGaps)) : null
  const consistency = recentGaps.length >= 2 && medianGap ? 1 - Math.min(1, stdDev(recentGaps) / medianGap) : 0

  const anchor = bill.anchorDate || today
  const startFrom = lastPaid ?? anchor
  let nextDue: ISODate | null = null
  let basis: BillSchedule['basis'] = 'none'
  let cadenceDays: number | null = EXPECTED_DAYS[bill.frequency] ?? bill.intervalDays ?? null
  let confidence = 0.3

  const monthStep = monthsFor(bill.frequency)

  if (bill.dueDay && monthStep) {
    // Calendar-anchored bills: next occurrence of the preferred day.
    let cursor = setDayOfMonth(addMonths(startFrom, 1), bill.dueDay)
    if (lastPaid) {
      // If the bill was paid early, the next due date may still be this month's day.
      const sameMonth = setDayOfMonth(lastPaid, bill.dueDay)
      if (sameMonth > lastPaid) cursor = sameMonth
      if (daysBetween(today, cursor) < -31) {
        while (cursor < today) cursor = addMonths(cursor, monthStep)
      }
    } else {
      cursor = setDayOfMonth(anchor, bill.dueDay)
      let guard = 0
      while (cursor < today && guard < 36) {
        cursor = addMonths(cursor, monthStep)
        guard++
      }
    }
    nextDue = cursor
    basis = 'fixed-day'
    confidence = mine.length >= 2 ? 0.78 + 0.12 * consistency : 0.62
    cadenceDays = monthStep * 30.44
  } else if (bill.frequency === 'custom' && bill.intervalDays && bill.intervalDays > 0) {
    nextDue = addDays(startFrom, bill.intervalDays)
    basis = lastPaid ? 'history' : 'anchor'
    confidence = lastPaid ? 0.55 + 0.25 * consistency : 0.4
    cadenceDays = bill.intervalDays
  } else if (medianGap && recentGaps.length >= 2) {
    nextDue = addDays(startFrom, medianGap)
    basis = 'history'
    cadenceDays = medianGap
    confidence = 0.48 + 0.11 * Math.min(recentGaps.length, 4) + 0.18 * consistency
  } else if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    nextDue = addDays(startFrom, EXPECTED_DAYS[bill.frequency])
    basis = lastPaid ? 'history' : 'anchor'
    confidence = lastPaid ? 0.55 : 0.35
  } else if (monthStep) {
    nextDue = addMonths(startFrom, monthStep)
    basis = lastPaid ? 'history' : 'anchor'
    confidence = lastPaid ? 0.5 : 0.3
  } else if (bill.intervalDays) {
    nextDue = addDays(startFrom, bill.intervalDays)
    basis = lastPaid ? 'history' : 'anchor'
    confidence = 0.4
  }

  confidence = Math.max(0.15, Math.min(0.95, confidence))
  const daysUntil = nextDue ? daysBetween(today, nextDue) : null
  const snoozed = Boolean(bill.snoozedUntil && bill.snoozedUntil >= today)

  let status: BillStatus = 'upcoming'
  if (!bill.active || bill.archived) status = 'inactive'
  else if (daysUntil !== null && daysUntil < 0) status = 'overdue'
  else if (!snoozed && daysUntil !== null && daysUntil <= Math.max(0, bill.leadDays ?? 3)) status = 'due-soon'
  else if (snoozed) status = 'upcoming'

  return {
    nextDue,
    lastPaid,
    status,
    daysUntil,
    overdueDays: daysUntil !== null && daysUntil < 0 ? Math.abs(daysUntil) : 0,
    confidence,
    cadenceDays: cadenceDays ? Math.round(cadenceDays) : null,
    basis,
    paymentCount: mine.length,
    typicalAmount,
    snoozed,
  }
}

export function frequencyLabel(bill: Bill): string {
  if (bill.frequency === 'custom') return bill.intervalDays ? `Every ${bill.intervalDays}d` : 'Custom'
  if (bill.frequency === 'biweekly') return 'Every 2 weeks'
  if (bill.frequency === 'yearly') return 'Yearly'
  if (bill.frequency === 'quarterly') return 'Quarterly'
  if (bill.frequency === 'weekly') return 'Weekly'
  return 'Monthly'
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High confidence'
  if (confidence >= 0.55) return 'Fairly confident'
  if (confidence >= 0.35) return 'Low confidence'
  return 'Needs more history'
}
