import { describe, expect, it } from 'vitest'
import { budgetRows, computeSafeToSpend } from '../lib/analytics'
import { computeNudges, dueNudges } from '../lib/nudges'
import type { Bill, Budget, Settings, Txn } from '../types'
import { predictBill } from '../lib/bills'

const settings = { payCycleStartDay: 1, weekStart: 1, monthlyAllowance: 0, currency: 'USD' } as Settings
const t = (id: string, date: string, amount: number, categoryId = 'shopping'): Txn => ({ id, date, amount, currency: 'USD', fxRate: 1, baseAmount: amount, type: 'expense', categoryId, merchant: id, source: 'manual', categorySource: 'manual', createdAt: '', updatedAt: '' })
const shop: Budget = { id: 'shop', categoryId: 'shopping', amount: 40000, rollover: false, period: 'cycle', createdAt: '', updatedAt: '' }

function run(txns: Txn[], today: string, bills: Bill[] = []) {
  const rows = budgetRows([shop], txns, [], settings, today)
  const schedules = new Map(bills.map((b) => [b.id, predictBill(b, [], today)]))
  const safe = computeSafeToSpend(rows, txns, bills, schedules, settings, today)
  return computeNudges({ today, currency: 'USD', rows, safe, txns, bills, schedules, pots: [], overspendCount: 0 })
}

describe('nudges', () => {
  it('tells you to slow down when a budget is half gone in the first week', () => {
    const n = run([t('a', '2026-11-02', 12000), t('b', '2026-11-05', 9000)], '2026-11-06')
    const pace = n.find((x) => x.kind === 'pace')!
    expect(pace.title.startsWith('Slow down on ')).toBe(true)
    expect(pace.body).toMatch(/53% used, only 20% of the cycle gone/)
    expect(pace.at).toBe('2026-11-06T20:00')
  })
  it('warns when the pace projects an overspend, and sums up the day', () => {
    const n = run([t('a', '2026-11-02', 4000), t('b', '2026-11-08', 14000), t('c', '2026-11-10', 2000)], '2026-11-10')
    expect(n.some((x) => x.kind === 'projection')).toBe(true)
    expect(n.find((x) => x.kind === 'summary')?.title).toBe('Today: $20.00 spent')
  })
  it('reminds about a bill the day before, in the morning', () => {
    const bill = { id: 'e', name: 'Electricity', categoryId: 'u', amount: 9000, currency: 'USD', fxRate: 1, baseAmount: 9000, frequency: 'monthly', anchorDate: '2026-11-12', autoPay: false, leadDays: 3, active: true, createdAt: '', updatedAt: '' } as Bill
    const n = run([], '2026-11-11', [bill])
    expect(n[0]).toMatchObject({ kind: 'bill', title: 'Electricity is due tomorrow', at: '2026-11-11T09:00' })
    expect(n.some((x) => x.kind === 'unlogged')).toBe(true)
  })
  it('only delivers what is due today and not shown yet', () => {
    const n = run([t('a', '2026-11-02', 30000)], '2026-11-03')
    expect(dueNudges(n, new Set(), '2026-11-03T12:00').length).toBe(0)
    const evening = dueNudges(n, new Set(), '2026-11-03T21:30')
    expect(evening.length).toBeGreaterThan(0)
    expect(dueNudges(n, new Set(evening.map((x) => x.id)), '2026-11-03T21:30').length).toBe(0)
    expect(dueNudges(n, new Set(), '2026-11-04T21:30').length).toBe(0)
  })
})

describe('nudges — edge cases', () => {
  it('flags a budget as over even when pots and catch-up used its whole limit', () => {
    const rows = budgetRows([shop], [t('a', '2026-11-03', 2000)], [], settings, '2026-11-04', () => [{ kind: 'catchup', label: 'Catch-up', amount: 40000 }])
    const safe = computeSafeToSpend(rows, [], [], new Map(), settings, '2026-11-04')
    const n = computeNudges({ today: '2026-11-04', currency: 'USD', rows, safe, txns: [], bills: [], schedules: new Map(), pots: [], overspendCount: 0 })
    expect(n.some((x) => x.kind === 'over')).toBe(true)
  })
})
