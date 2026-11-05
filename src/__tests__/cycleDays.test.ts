import { describe, expect, it } from 'vitest'
import { cycleDays, cycleInsights, cycleName, fixedTxnIds } from '../lib/cycleDays'
import type { Bill, BillPayment, Category, Txn } from '../types'

const t = (id: string, date: string, amount: number, categoryId = 'food', merchant = id, extra: Partial<Txn> = {}): Txn => ({
  id, date, amount, currency: 'USD', fxRate: 1, baseAmount: amount, type: 'expense', categoryId, merchant, source: 'manual', categorySource: 'manual', createdAt: '', updatedAt: '', ...extra,
})
const cats = [
  { id: 'food', name: 'Dining', emoji: '🍜', color: '#f00' },
  { id: 'home', name: 'Rent', emoji: '🏠', color: '#0f0' },
  { id: 'shop', name: 'Shopping', emoji: '🛍️', color: '#00f' },
] as Category[]
const rent = { id: 'b1', name: 'Room rent', merchant: 'Landlord', archived: false } as Bill
const oct = { start: '2026-10-01', end: '2026-10-31' }
const sep = { start: '2026-09-01', end: '2026-09-30' }

describe('fixedTxnIds', () => {
  it('treats bill payments, bill-sourced entries, bill payees and subscriptions as fixed', () => {
    const txns = [t('a', '2026-10-01', 90000, 'home', 'Landlord'), t('b', '2026-10-02', 1500, 'shop', 'Netflix'), t('c', '2026-10-03', 800), t('d', '2026-10-04', 5000, 'home', 'x', { source: 'bill' }), t('e', '2026-10-05', 700), t('f', '2026-10-06', 550, 'food', 'Blue Bottle')]
    const payments = [{ txnId: 'e' }] as BillPayment[]
    const ids = fixedTxnIds(txns, [rent], payments, [{ merchant: 'netflix', intervalDays: 30 }, { merchant: 'Blue Bottle', intervalDays: 3 }])
    expect([...ids].sort()).toEqual(['a', 'b', 'd', 'e'])
  })
})

describe('cycleDays', () => {
  it('splits each day into fixed and everyday with a category breakdown', () => {
    const txns = [t('rent', '2026-10-01', 90000, 'home', 'Landlord'), t('lunch', '2026-10-01', 1200), t('bag', '2026-10-01', 4000, 'shop'), t('r', '2026-10-01', 1000, 'shop', 'r', { type: 'refund' })]
    const days = cycleDays(txns, cats, oct, new Set(['rent']))
    expect(days).toHaveLength(31)
    const d = days[0]
    expect(d.total).toBe(94200)
    expect(d.fixed).toBe(90000)
    expect(d.everyday).toBe(4200)
    expect(d.count).toBe(3)
    expect(d.categories.map((c) => [c.name, c.amount])).toEqual([['Rent', 90000], ['Shopping', 3000], ['Dining', 1200]])
    expect(days[1].total).toBe(0)
  })
})

describe('cycleInsights', () => {
  const base = { categories: cats, range: oct, prevRange: sep, currency: 'USD' }
  // Rent is by far the biggest day, but it's fixed, so it never leads the insights.
  const txns = [
    t('rent9', '2026-09-01', 90000, 'home', 'Landlord'), t('s1', '2026-09-05', 2000), t('s2', '2026-09-12', 2000),
    t('rent10', '2026-10-01', 90000, 'home', 'Landlord'), t('o1', '2026-10-03', 1000), t('o2', '2026-10-04', 1200), t('o3', '2026-10-18', 14000, 'shop'), t('o4', '2026-10-20', 1500),
  ]
  const fixed = fixedTxnIds(txns, [rent], [], [])

  it('for a finished month, names the category that moved and the heaviest everyday day — not rent', () => {
    const lines = cycleInsights({ ...base, txns, today: '2026-11-04', fixed, finished: true })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Shopping')
    expect(lines[0]).toContain('September')
    expect(lines[1]).toMatch(/^Heaviest everyday day: Sun 18 Oct, \$140 — mostly Shopping\.$/)
    expect(lines.join(' ')).not.toContain('Rent')
  })

  it('mid-cycle compares with the same point last month', () => {
    const lines = cycleInsights({ ...base, txns, today: '2026-10-20', fixed, finished: false })
    expect(lines[0]).toBe('🛍️ Shopping is $140 ahead of the same point in September.')
  })

  it('falls back to the everyday daily average when nothing stands out', () => {
    const flat = [t('a', '2026-10-01', 1000), t('b', '2026-10-02', 1000), t('c', '2026-10-03', 1000), t('d', '2026-09-02', 1000), t('e', '2026-09-03', 1000), t('f', '2026-09-04', 1000)]
    const lines = cycleInsights({ ...base, txns: flat, today: '2026-10-04', fixed: new Set(), finished: false })
    expect(lines).toEqual(['Everyday spending is averaging $7.50 a day, bills and subscriptions aside.'])
  })

  it('names calendar months, and falls back for custom cycles', () => {
    expect(cycleName(sep, 'last cycle')).toBe('September')
    expect(cycleName({ start: '2026-09-25', end: '2026-10-24' }, 'last cycle')).toBe('last cycle')
  })
})
