import { describe, expect, it } from 'vitest'
import { computeHolding } from '../lib/investments'
import type { CurrencyProfile, Investment, InvestmentTx } from '../types'

const inv: Investment = { id: 'i1', profileId: 'p', currency: 'USD', type: 'stock', name: 'X', qty: 0, avgCost: 0, createdAt: '', updatedAt: '', currentPrice: 15000 }
const tx = (type: InvestmentTx['type'], date: string, amount: number, qty?: number, fees = 0): InvestmentTx => ({
  id: `${type}${date}`,
  investmentId: 'i1',
  profileId: 'p',
  type,
  date,
  qty,
  amount,
  currency: 'USD',
  fxRate: 1,
  baseAmount: amount,
  fees,
  createdAt: date,
})

describe('computeHolding', () => {
  it('uses average cost for sells and values the rest at the current price', () => {
    const h = computeHolding(
      inv,
      [tx('buy', '2026-01-01', 100000, 10), tx('buy', '2026-02-01', 120000, 10), tx('sell', '2026-03-01', 75000, 5, 500), tx('dividend', '2026-04-01', 1000)],
      'USD',
      [],
    )
    expect(h.qty).toBe(15)
    expect(h.avgCost).toBe(11000) // (1000 + 1200) / 20 = 110 per unit
    expect(h.cost).toBe(165000)
    expect(h.realised).toBe(75000 - 500 - 55000)
    expect(h.value).toBe(225000)
    expect(h.unrealised).toBe(60000)
    expect(h.income).toBe(1000)
  })

  it('converts to base with the currency profile rate, respecting decimals', () => {
    const jpy: Investment = { ...inv, currency: 'JPY', currentPrice: undefined, currentValue: 100000 }
    const profiles: CurrencyProfile[] = [{ id: 'p', name: 'Japan', code: 'JPY', isBase: false, isDefault: false, fxToBase: 0.0067, createdAt: '', updatedAt: '' }]
    const h = computeHolding(jpy, [{ ...tx('buy', '2026-01-01', 100000), currency: 'JPY' }], 'USD', profiles)
    expect(h.base.value).toBe(67000) // ¥100,000 ≈ $670.00
  })
})
