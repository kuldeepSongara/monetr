import { describe, expect, it } from 'vitest'
import { findDuplicates } from '../lib/duplicates'
import type { Txn } from '../types'

let n = 0
const txn = (over: Partial<Txn>): Txn => ({
  id: `d${n++}`,
  date: '2026-10-10',
  amount: 178000,
  currency: 'USD',
  fxRate: 1,
  baseAmount: 178000,
  type: 'expense',
  categoryId: 'cat_home',
  merchant: 'Harbor Apartments',
  source: 'manual',
  categorySource: 'manual',
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('findDuplicates', () => {
  it('flags the same charge twice within a few days', () => {
    const pairs = findDuplicates([txn({}), txn({ date: '2026-10-11' })], '2026-10-25')
    expect(pairs).toHaveLength(1)
  })
  it('flags an autopay entry against a hand-logged one with a different name', () => {
    const pairs = findDuplicates([txn({ merchant: 'Rent' }), txn({ source: 'bill', merchant: 'Harbor Apartments' })], '2026-10-25')
    expect(pairs[0].reason).toMatch(/Autopay/)
  })
  it('stops flagging once you mark them as both real', () => {
    const a = txn({})
    const b = txn({ notDuplicateOf: [a.id] })
    expect(findDuplicates([a, b], '2026-10-25')).toEqual([])
  })
  it('ignores different amounts and far-apart dates', () => {
    expect(findDuplicates([txn({}), txn({ amount: 178001 })], '2026-10-25')).toEqual([])
    expect(findDuplicates([txn({}), txn({ date: '2026-10-20' })], '2026-10-25')).toEqual([])
  })
})
