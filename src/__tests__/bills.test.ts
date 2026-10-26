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
