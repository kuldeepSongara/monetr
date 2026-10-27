import { describe, expect, it } from 'vitest'
import { predictBill } from '../lib/bills'
import type { Bill, BillPayment } from '../types'

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1',
  name: 'Rent',
  categoryId: 'cat_home',
  amount: 100000,
  currency: 'USD',
  fxRate: 1,
  baseAmount: 100000,
  frequency: 'monthly',
  dueDay: 1,
  anchorDate: '2026-01-01',
  autoPay: false,
  leadDays: 3,
  active: true,
  createdAt: '',
  updatedAt: '',
  ...over,
})
const pay = (paidDate: string, id = paidDate): BillPayment => ({ id, billId: 'b1', paidDate, amount: 100000, currency: 'USD', fxRate: 1, baseAmount: 100000, createdAt: '' })

describe('predictBill — fixed day', () => {
  it('treats a payment a few days early as covering the upcoming due date', () => {
    // Paid 29 Oct for the 1 Nov rent: next due must be 1 Dec, not 1 Nov again.
    const s = predictBill(bill(), [pay('2026-10-01'), pay('2026-10-29')], '2026-10-30')
    expect(s.nextDue).toBe('2026-12-01')
    expect(s.status).toBe('upcoming')
  })

  it('treats a late payment as covering the missed due date', () => {
    const s = predictBill(bill({ dueDay: 15 }), [pay('2026-09-15'), pay('2026-10-20')], '2026-10-25')
    expect(s.nextDue).toBe('2026-11-15')
  })

  it('counts missed payments instead of silently skipping ahead', () => {
    const s = predictBill(bill({ dueDay: 5 }), [pay('2026-08-05')], '2026-10-25')
    expect(s.nextDue).toBe('2026-09-05')
    expect(s.status).toBe('overdue')
    expect(s.missed).toBe(2) // 5 Sep and 5 Oct
  })

  it('clamps due day 31 to short months', () => {
    const s = predictBill(bill({ dueDay: 31, anchorDate: '2026-01-31' }), [pay('2026-01-31')], '2026-02-10')
    expect(s.nextDue).toBe('2026-02-28')
  })

  it('keeps quarterly bills aligned to the anchor month', () => {
    const s = predictBill(bill({ frequency: 'quarterly', dueDay: 15, anchorDate: '2026-01-15' }), [pay('2026-07-13')], '2026-08-01')
    expect(s.nextDue).toBe('2026-10-15')
  })

  it('first due date without payments is the first one on/after the anchor', () => {
    const s = predictBill(bill({ dueDay: 10, anchorDate: '2026-11-03' }), [], '2026-10-25')
    expect(s.nextDue).toBe('2026-11-10')
    expect(s.missed).toBe(0)
  })
})

describe('predictBill — last paid date drives the schedule', () => {
  it('moving the last payment moves the next due date', () => {
    const b = bill({ dueDay: undefined, anchorDate: '2026-10-01' })
    expect(predictBill(b, [pay('2026-10-01')], '2026-10-20').nextDue).toBe('2026-11-01')
    expect(predictBill(b, [pay('2026-10-15')], '2026-10-20').nextDue).toBe('2026-11-15')
  })
  it('not paid yet: the first payment is due on the bill date', () => {
    const b = bill({ dueDay: undefined, frequency: 'weekly', anchorDate: '2026-11-03' })
    expect(predictBill(b, [], '2026-10-26').nextDue).toBe('2026-11-03')
  })
})

describe('predictBill — edited amount', () => {
  it('uses the edited amount until a newer payment is recorded', () => {
    const p = { ...pay('2026-10-01'), createdAt: '2026-10-01T10:00:00Z', baseAmount: 6000 }
    const b = bill({ baseAmount: 7000, amountChangedAt: '2026-10-20T10:00:00Z' })
    expect(predictBill(b, [p], '2026-10-21').typicalAmount).toBe(7000)
    expect(predictBill({ ...b, amountChangedAt: undefined }, [p], '2026-10-21').typicalAmount).toBe(6000)
  })
})

describe('predictBill — variable bills', () => {
  it('expects about what was paid recently and ignores payments with no amount', () => {
    const b = bill({ variable: true, baseAmount: 0, amount: 0 })
    const p = (d: string, amt: number, unknown = false): BillPayment => ({ ...pay(d), baseAmount: amt, amount: amt, amountUnknown: unknown || undefined })
    expect(predictBill(b, [p('2026-07-01', 0, true)], '2026-07-10').typicalAmount).toBe(0)
    expect(predictBill(b, [p('2026-07-01', 8000), p('2026-08-01', 12000), p('2026-09-01', 9000), p('2026-10-01', 0, true)], '2026-10-10').typicalAmount).toBe(9000)
  })
})
