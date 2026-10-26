import { describe, expect, it } from 'vitest'
import { budgetRows, byCategory, totals } from '../lib/analytics'
import { parseQuickLocal } from '../lib/quickParse'
import { parseStatementCsv } from '../lib/csvImport'
import { buildReportHtml } from '../lib/report'
import { splitShare } from '../db/db'
import { makeCategories, makeDefaultSettings } from '../db/db'
import type { Budget, Txn } from '../types'

let n = 0
const txn = (over: Partial<Txn>): Txn => ({
  id: `t${n++}`,
  date: '2026-10-10',
  amount: 1000,
  currency: 'USD',
  fxRate: 1,
  baseAmount: over.amount ?? 1000,
  type: 'expense',
  categoryId: 'cat_shopping',
  merchant: 'Shop',
  source: 'manual',
  categorySource: 'manual',
  createdAt: '2026-10-10',
  updatedAt: '2026-10-10',
  ...over,
})
const cats = makeCategories()
const settings = { ...makeDefaultSettings(), currency: 'USD', payCycleStartDay: 1 }

describe('refunds', () => {
  const buy = txn({ amount: 9000, baseAmount: 9000 })
  const back = txn({ type: 'refund', amount: 3000, baseAmount: 3000, refundOf: buy.id })
  it('reduce spending instead of counting as income', () => {
    expect(totals([buy, back])).toMatchObject({ expense: 6000, income: 0 })
  })
  it('reduce the category total', () => {
    expect(byCategory([buy, back], cats)[0]).toMatchObject({ categoryId: 'cat_shopping', total: 6000, count: 1 })
  })
  it('free up the budget', () => {
    const b: Budget = { id: 'b', categoryId: 'cat_shopping', amount: 10000, rollover: false, period: 'cycle', createdAt: '', updatedAt: '' }
    expect(budgetRows([b], [buy, back], cats, settings, '2026-10-20')[0].spent).toBe(6000)
  })
})

describe('bill split', () => {
  it('computes percent and fixed shares', () => {
    expect(splitShare({ split: { name: 'R', mode: 'percent', value: 50 } }, 178000)).toBe(89000)
    expect(splitShare({ split: { name: 'R', mode: 'amount', value: 50000 } }, 178000)).toBe(50000)
    expect(splitShare({ split: { name: 'R', mode: 'amount', value: 500000 } }, 178000)).toBe(178000)
    expect(splitShare({}, 178000)).toBe(0)
  })
})

describe('offline quick add', () => {
  const today = '2026-10-25' // a Sunday
  const p = (s: string) => parseQuickLocal(s, cats, [], 'CAD', today)
  it('reads amount, merchant, date and category', () => {
    expect(p('coffee 4.50 yesterday')).toMatchObject({ amount: 4.5, date: '2026-10-24', categoryId: 'cat_dining', type: 'expense' })
    expect(p('uber 18 last friday')).toMatchObject({ amount: 18, date: '2026-10-23', categoryId: 'cat_transport', merchant: 'Uber' })
    expect(p('salary 4200 on 1st')).toMatchObject({ type: 'income', amount: 4200, date: '2026-10-01', categoryId: 'cat_salary' })
    expect(p('€12 lunch at Café Rio')).toMatchObject({ currency: 'EUR', amount: 12, categoryId: 'cat_dining' })
    expect(p('groceries 2 days ago 63.20')).toMatchObject({ amount: 63.2, date: '2026-10-23', categoryId: 'cat_groceries' })
  })
  it('returns null without an amount', () => {
    expect(p('coffee')).toBeNull()
  })
})

describe('offline CSV import', () => {
  it('reads a bank export with negative spending', () => {
    const csv = 'Date,Description,Amount\n2026-10-01,STARBUCKS 0423 TORONTO,-5.25\n2026-10-02,PAYROLL ACME,4200.00\n2026-10-03,Payment received - thank you,-300\n'
    const lines = parseStatementCsv(csv, 'CAD', [], '2026-10-25')!
    expect(lines.map((l) => [l.type, l.amount])).toEqual([
      ['expense', 5.25],
      ['income', 4200],
      ['transfer', 300],
    ])
  })
  it('reads a card statement with debit/credit columns and dd/mm dates', () => {
    const csv = 'Transaction Date,Details,Debit,Credit\n25/09/2026,Amazon,49.99,\n26/09/2026,Refund Amazon,,10.00\n'
    const lines = parseStatementCsv(csv, 'INR', [], '2026-10-25')!
    expect(lines[0]).toMatchObject({ date: '2026-09-25', amount: 49.99, type: 'expense' })
    expect(lines[1]).toMatchObject({ date: '2026-09-26', type: 'refund' })
  })
  it('returns null for files it does not understand', () => {
    expect(parseStatementCsv('hello,world\n1,2', 'USD', [], '2026-10-25')).toBeNull()
  })
})

describe('HTML report', () => {
  it('embeds only the chosen period and survives tricky merchant names', () => {
    const html = buildReportHtml(
      [txn({ merchant: '$\'& </script> shop', date: '2026-10-05' }), txn({ merchant: 'Old', date: '2025-01-01' })],
      cats,
      settings,
      { range: { start: '2026-10-01', end: '2026-10-31' }, includeNotes: false },
    )
    expect(html).toContain("$'&")
    expect(html).not.toContain('</script> shop')
    expect(html).not.toContain('"Old"')
    const json = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]
    expect(JSON.parse(json).txns).toHaveLength(1)
  })
})
