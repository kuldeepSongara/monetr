import { describe, expect, it } from 'vitest'
import { budgetRows, computeSafeToSpend } from '../lib/analytics'
import type { Budget, Category, Settings, Txn } from '../types'

const cat = (id: string, name: string): Category => ({ id, name, emoji: '•', color: '#111111', kind: 'expense', order: 0 })
const cats = [cat('dining', 'Dining'), cat('shopping', 'Shopping'), cat('groceries', 'Groceries')]
const settings = { payCycleStartDay: 1, weekStart: 1, monthlyAllowance: 0 } as Settings
const txn = (id: string, categoryId: string, amount: number, type: Txn['type'] = 'expense'): Txn => ({
  id, date: '2026-10-10', amount, currency: 'USD', fxRate: 1, baseAmount: amount, type, categoryId, merchant: id,
  source: 'manual', categorySource: 'manual', createdAt: '', updatedAt: '',
})
const at = { createdAt: '', updatedAt: '', rollover: false, period: 'cycle' as const }

describe('group budgets', () => {
  const group: Budget = { id: 'g', categoryId: 'group', categoryIds: ['dining', 'shopping'], name: 'Fun money', amount: 50000, ...at }
  const txns = [txn('a', 'dining', 12000), txn('b', 'shopping', 30000), txn('c', 'groceries', 9000), txn('r', 'shopping', 5000, 'refund')]

  it('counts every member category against one limit, refunds included', () => {
    const [row] = budgetRows([group], txns, cats, settings, '2026-10-20')
    expect(row.spent).toBe(37000)
    expect(row.label).toBe('Fun money')
    expect(row.parts?.map((p) => [p.category.id, p.spent])).toEqual([['shopping', 25000], ['dining', 12000]])
  })

  it('names an unnamed group after its categories', () => {
    const [row] = budgetRows([{ ...group, name: undefined }], txns, cats, settings, '2026-10-20')
    expect(row.label).toBe('Dining + Shopping')
  })

  it('adds groups and single budgets into safe-to-spend without double counting', () => {
    const groc: Budget = { id: 's', categoryId: 'groceries', amount: 20000, ...at }
    const rows = budgetRows([group, groc], txns, cats, settings, '2026-10-20')
    const safe = computeSafeToSpend(rows, txns, [], new Map(), settings, '2026-10-20')
    expect(safe.limit).toBe(70000)
    expect(safe.spent).toBe(46000)
  })
})
