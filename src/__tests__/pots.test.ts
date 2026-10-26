import { describe, expect, it } from 'vitest'
import { cyclesSince, perCycleFor, potStatus, potTxnIds, rebasePot } from '../lib/pots'
import { budgetRows } from '../lib/analytics'
import type { Budget, Pot, Txn } from '../types'

const settings = { payCycleStartDay: 1 }
const txn = (id: string, date: string, amount: number, extra: Partial<Txn> = {}): Txn => ({
  id, date, amount, currency: 'USD', fxRate: 1, baseAmount: amount, type: 'expense', categoryId: 'shopping', merchant: id,
  source: 'manual', categorySource: 'manual', createdAt: '', updatedAt: '', ...extra,
})
const pot = (p: Partial<Pot>): Pot => ({ id: 'p', name: 'Pot', kind: 'save', target: 0, perCycle: 10000, startDate: '2026-08-05', createdAt: '', updatedAt: '', ...p })

describe('savings pots', () => {
  it('counts pay cycles inclusively', () => {
    expect(cyclesSince('2026-08-05', '2026-10-26', 1)).toBe(3)
    expect(cyclesSince('2026-11-02', '2026-10-26', 1)).toBe(0)
  })

  it('save pot fills each cycle until the goal', () => {
    const s = potStatus(pot({ target: 150000, perCycle: 30000 }), [], settings, '2026-10-26')
    expect(s.setAside).toBe(90000)
    expect(s.thisCycle).toBe(30000)
    expect(s.state).toBe('saving')
    expect(s.finishDate?.slice(0, 7)).toBe('2026-12')
  })

  it('ready pots stop holding money back', () => {
    const s = potStatus(pot({ target: 20000, perCycle: 10000 }), [], settings, '2026-10-26')
    expect(s.state).toBe('ready')
    expect(s.thisCycle).toBe(0)
  })

  it('pay-back pot starts below zero and fills back', () => {
    const phone = txn('phone', '2026-10-03', 120000, { potId: 'p' })
    const s = potStatus(pot({ kind: 'payback', perCycle: 20000, startDate: '2026-10-03' }), [phone], settings, '2026-12-10')
    expect(s.need).toBe(120000)
    expect(s.setAside).toBe(60000)
    expect(s.balance).toBe(-60000)
    expect(s.state).toBe('paying-back')
  })

  it('a refund of a pot purchase reduces what the pot must cover', () => {
    const phone = txn('phone', '2026-10-03', 120000, { potId: 'p' })
    const back = txn('back', '2026-10-09', 20000, { type: 'refund', refundOf: 'phone' })
    const s = potStatus(pot({ kind: 'payback', perCycle: 20000, startDate: '2026-10-03' }), [phone, back], settings, '2026-10-26')
    expect(s.need).toBe(100000)
    expect(potTxnIds([phone, back], new Set(['p']))).toEqual(new Set(['phone', 'back']))
  })

  it('buying above the goal keeps the pot going for the difference', () => {
    const laptop = txn('laptop', '2026-10-20', 170000, { potId: 'p' })
    const s = potStatus(pot({ target: 150000, perCycle: 50000, startDate: '2026-07-01' }), [laptop], settings, '2026-10-26')
    expect(s.need).toBe(170000)
    expect(s.setAside).toBe(170000)
    expect(s.state).toBe('done')
  })

  it('changing the per-cycle amount keeps what was already set aside', () => {
    const p = pot({ target: 150000, perCycle: 30000 })
    const r = rebasePot(p, [], settings, '2026-10-26')
    expect(r.carried).toBe(60000)
    const after = potStatus({ ...p, ...r, perCycle: 50000 }, [], settings, '2026-10-26')
    expect(after.setAside).toBe(110000)
  })

  it('pot purchases are left out of budgets when filtered', () => {
    const b: Budget = { id: 'b', categoryId: 'shopping', amount: 50000, rollover: false, period: 'cycle', createdAt: '', updatedAt: '' }
    const all = [txn('laptop', '2026-10-20', 170000, { potId: 'p' }), txn('shirt', '2026-10-21', 4000)]
    const ids = potTxnIds(all, new Set(['p']))
    const [row] = budgetRows([b], all.filter((t) => !ids.has(t.id)), [], { payCycleStartDay: 1, weekStart: 1 } as never, '2026-10-26')
    expect(row.spent).toBe(4000)
    expect(perCycleFor(100000, 3)).toBe(33334)
  })
})
