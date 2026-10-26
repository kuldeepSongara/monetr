import { describe, expect, it } from 'vitest'
import { detectSubscriptions, totals } from '../lib/analytics'
import type { Txn } from '../types'

let n = 0
const txn = (date: string, merchant: string, amount: number, type: Txn['type'] = 'expense'): Txn => ({
  id: `t${n++}`,
  date,
  amount,
  currency: 'USD',
  fxRate: 1,
  baseAmount: amount,
  type,
  categoryId: 'cat_other',
  merchant,
  source: 'manual',
  categorySource: 'manual',
  createdAt: date,
  updatedAt: date,
})

describe('totals', () => {
  it('never counts transfers as spending or income', () => {
    const t = totals([txn('2026-10-01', 'Shop', 1000), txn('2026-10-02', 'Payroll', 5000, 'income'), txn('2026-10-03', 'Card payment', 9999, 'transfer')])
    expect(t).toMatchObject({ expense: 1000, income: 5000, net: 4000 })
  })
})

describe('detectSubscriptions', () => {
  it('finds monthly subscriptions', () => {
    const subs = detectSubscriptions(['2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'].map((d) => txn(d, 'Netflix', 1549)), '2026-10-25')
    expect(subs.map((s) => s.merchant)).toEqual(['Netflix'])
  })

  it('finds yearly subscriptions from two identical charges', () => {
    const subs = detectSubscriptions([txn('2025-03-01', 'Domain Renewal', 2000), txn('2026-03-01', 'Domain Renewal', 2000)], '2026-10-25')
    expect(subs[0]?.intervalDays).toBeGreaterThan(350)
  })

  it('ignores two unrelated purchases a year apart', () => {
    const subs = detectSubscriptions([txn('2025-03-01', 'Amazon', 2000), txn('2026-03-04', 'Amazon', 8700)], '2026-10-25')
    expect(subs).toEqual([])
  })
})
