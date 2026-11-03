import { describe, expect, it } from 'vitest'
import { budgetRows, computeSafeToSpend } from '../lib/analytics'
import { catchUpFor, makeAdjust, potFundingBudget, unfundedPots } from '../lib/budgetAdjust'
import type { Budget, BudgetCarry, Pot, Settings, Txn } from '../types'

const settings = { payCycleStartDay: 1, weekStart: 1, monthlyAllowance: 0 } as Settings
const bud = (id: string, categoryId: string, amount: number, extra: Partial<Budget> = {}): Budget => ({ id, categoryId, amount, rollover: false, period: 'cycle', createdAt: '2026-01-01T00:00:00Z', updatedAt: '', ...extra })
const txn = (id: string, date: string, amount: number, categoryId: string, extra: Partial<Txn> = {}): Txn => ({
  id, date, amount, currency: 'USD', fxRate: 1, baseAmount: amount, type: 'expense', categoryId, merchant: id, source: 'manual', categorySource: 'manual', createdAt: '', updatedAt: '', ...extra,
})
const carry = (budgetId: string, cycleStart: string, amount: number, plan: BudgetCarry['plan']): BudgetCarry => ({ id: `carry_${budgetId}_${cycleStart}`, budgetId, cycleStart, amount, plan, createdAt: '', updatedAt: '' })

describe('pots paid from budgets', () => {
  const fun = bud('fun', 'shopping', 48000)
  const all = bud('all', 'all', 260000)
  // A pot made before pots could choose a budget (no budgetId): inferred from its purchase.
  const phone = txn('phone', '2026-10-03', 120000, 'shopping', { potId: 'p' })
  const oldPot: Pot = { id: 'p', name: 'Phone', kind: 'payback', target: 0, perCycle: 10000, startDate: '2026-10-03', createdAt: '', updatedAt: '' }

  it('old pots are paid by the budget covering their purchase', () => {
    expect(potFundingBudget(oldPot, [fun, all], [phone])?.id).toBe('fun')
    expect(potFundingBudget(oldPot, [all], [phone])?.id).toBe('all')
    expect(potFundingBudget({ ...oldPot, budgetId: 'none' }, [fun, all], [phone])).toBeUndefined()
    expect(unfundedPots([oldPot], [], [phone]).length).toBe(1)
  })

  it('takes the per-cycle amount off the paying budget and Everything, once from safe-to-spend', () => {
    const txns = [phone, txn('shirt', '2026-11-02', 5000, 'shopping')]
    const adjust = makeAdjust({ budgets: [fun, all], pots: [oldPot], carries: [], txns, settings })
    const everyday = txns.filter((t) => !t.potId)
    const rows = budgetRows([fun, all], everyday, [], settings, '2026-11-10', adjust)
    const f = rows.find((r) => r.budget.id === 'fun')!
    const a = rows.find((r) => r.budget.id === 'all')!
    expect(f.limit).toBe(38000)
    expect(f.adjustments[0]).toMatchObject({ kind: 'pot', amount: 10000 })
    expect(a.limit).toBe(250000)
    const safe = computeSafeToSpend(rows, everyday, [], new Map(), settings, '2026-11-10', 0)
    expect(safe.limit).toBe(250000)
  })

  it('unused pot money does not roll over as if it were free', () => {
    const rolling = { ...fun, rollover: true }
    const adjust = makeAdjust({ budgets: [rolling], pots: [oldPot], carries: [], txns: [phone], settings })
    const [row] = budgetRows([rolling], [], [], settings, '2026-11-10', adjust)
    // October: 48000 − 10000 for the pot, nothing spent → 38000 free, capped at one budget's worth.
    expect(row.rollover).toBe(38000)
  })
})

describe('catch-up for going over', () => {
  const fun = bud('fun', 'shopping', 48000)

  it('takes it from the next cycle, never more than half the budget at once', () => {
    const c = [carry('fun', '2026-10-01', 30000, 'next')]
    expect(catchUpFor(fun, c, '2026-11-01').map((a) => a.amount)).toEqual([24000])
    expect(catchUpFor(fun, c, '2026-12-01').map((a) => a.amount)).toEqual([6000])
    expect(catchUpFor(fun, c, '2027-01-01')).toEqual([])
    expect(catchUpFor(fun, c, '2026-10-01')).toEqual([])
  })

  it('spreads over three cycles and shares the cap between decisions', () => {
    const c = [carry('fun', '2026-09-01', 30000, 'spread3'), carry('fun', '2026-10-01', 30000, 'next')]
    // November: 10000 (spread) + 14000 (rest of the half-budget room) for October's.
    expect(catchUpFor(fun, c, '2026-11-01').map((a) => a.amount)).toEqual([10000, 14000])
    expect(catchUpFor(fun, [carry('fun', '2026-10-01', 9000, 'waive')], '2026-11-01')).toEqual([])
  })

  it('reduces the budget row with a labelled line', () => {
    const adjust = makeAdjust({ budgets: [fun], pots: [], carries: [carry('fun', '2026-10-01', 12000, 'next')], txns: [], settings })
    const [row] = budgetRows([fun], [], [], settings, '2026-11-05', adjust)
    expect(row.limit).toBe(36000)
    expect(row.adjustments[0].label).toBe('Catch-up for Oct 2026')
  })
})
