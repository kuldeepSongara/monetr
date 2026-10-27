import { describe, expect, it } from 'vitest'
import { comparePeriods, lastYear } from '../lib/compare'
import type { Txn } from '../types'

const t = (id: string, date: string, amount: number, categoryId = 'food', type: Txn['type'] = 'expense'): Txn => ({
  id, date, amount, currency: 'USD', fxRate: 1, baseAmount: amount, type, categoryId, merchant: id, source: 'manual', categorySource: 'manual', createdAt: '', updatedAt: '',
})

describe('comparePeriods', () => {
  const txns = [t('a', '2026-09-03', 5000), t('b', '2026-09-20', 9000, 'fun'), t('c', '2026-10-02', 4000), t('d', '2026-10-05', 2000, 'fun'), t('r', '2026-10-06', 1000, 'fun', 'refund')]
  const oct = { start: '2026-10-01', end: '2026-10-31' }
  const sep = { start: '2026-09-01', end: '2026-09-30' }

  it('compares a running period with the same days of the other one', () => {
    const c = comparePeriods(txns, [], oct, sep, '2026-10-10')
    expect(c.a.spent).toBe(5000)
    expect(c.b.spent).toBe(14000)
    expect(c.daysElapsed).toBe(10)
    expect(c.bSameDays).toBe(5000)
    expect(c.cumulative[9].a).toBe(5000)
    expect(c.cumulative[15].a).toBeUndefined()
    expect(c.cumulative[29].b).toBe(14000)
    const fun = c.categories.find((x) => x.id === 'fun')!
    expect([fun.a, fun.b]).toEqual([1000, 0])
  })
  it('finished periods compare in full', () => {
    const c = comparePeriods(txns, [], oct, sep, '2026-11-02')
    expect(c.bSameDays).toBeNull()
  })
  it('same time last year handles leap days', () => {
    expect(lastYear({ start: '2028-02-01', end: '2028-02-29' })).toEqual({ start: '2027-02-01', end: '2027-02-28' })
  })
})
