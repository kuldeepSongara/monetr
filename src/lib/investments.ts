import type { CurrencyProfile, Investment, InvestmentTx } from '../types'
import { toBaseMinor } from './money'

export interface Holding {
  investment: Investment
  /** Units held (0 for cash-like holdings tracked by amount only). */
  qty: number
  /** Remaining cost basis, minor units of the investment currency. */
  cost: number
  avgCost: number
  realised: number
  income: number
  feesPaid: number
  value: number
  valueKnown: boolean
  unrealised: number
  txs: InvestmentTx[]
  /** Base-currency figures. */
  base: { cost: number; value: number; unrealised: number; realised: number; income: number }
  fxToBase: number
  fxKnown: boolean
}

/** Rate currency → base: base currency, then a currency profile, then the latest rate used on a transaction. */
export function fxToBaseFor(currency: string, base: string, profiles: CurrencyProfile[], txs: InvestmentTx[]): { rate: number; known: boolean } {
  if (currency === base) return { rate: 1, known: true }
  const profile = profiles.find((p) => p.code === currency && p.fxToBase > 0)
  if (profile) return { rate: profile.fxToBase, known: true }
  const latest = txs.filter((t) => t.currency === currency && t.fxRate > 0 && t.fxRate !== 1).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (latest) return { rate: latest.fxRate, known: true }
  return { rate: 1, known: false }
}

/** Average-cost accounting over the investment's transactions. */
export function computeHolding(
  investment: Investment,
  allTxs: InvestmentTx[],
  baseCurrency: string,
  profiles: CurrencyProfile[],
): Holding {
  const txs = allTxs
    .filter((t) => t.investmentId === investment.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  let qty = 0
  let cost = 0
  let realised = 0
  let income = 0
  let feesPaid = 0
  for (const t of txs) {
    const fees = t.fees ?? 0
    const q = t.qty ?? 0
    switch (t.type) {
      case 'buy':
        qty += q
        cost += t.amount + fees
        feesPaid += fees
        break
      case 'sell':
      case 'transfer': {
        feesPaid += fees
        if (q > 0 && qty > 0) {
          const sold = Math.min(q, qty)
          const basis = (cost / qty) * sold
          cost -= basis
          qty -= sold
          realised += t.amount - fees - basis
        } else {
          // Cash-like holding (FD, savings): moving money out reduces the balance at cost.
          const out = Math.min(cost, t.amount)
          realised += t.amount - fees - out
          cost -= out
        }
        break
      }
      case 'dividend':
      case 'interest':
        income += t.amount
        break
      case 'fee':
        feesPaid += t.amount
        break
    }
  }
  cost = Math.max(0, Math.round(cost))
  qty = Math.round(qty * 1e8) / 1e8
  let value = cost
  let valueKnown = false
  if (investment.currentPrice !== undefined && qty > 0) {
    value = Math.round(investment.currentPrice * qty)
    valueKnown = true
  } else if (investment.currentValue !== undefined) {
    value = investment.currentValue
    valueKnown = true
  }
  const { rate, known } = fxToBaseFor(investment.currency, baseCurrency, profiles, allTxs)
  const toBase = (minor: number) => toBaseMinor(minor, investment.currency, rate, baseCurrency)
  return {
    investment,
    qty,
    cost,
    avgCost: qty > 0 ? Math.round(cost / qty) : 0,
    realised: Math.round(realised),
    income,
    feesPaid,
    value,
    valueKnown,
    unrealised: value - cost,
    txs,
    base: {
      cost: toBase(cost),
      value: toBase(value),
      unrealised: toBase(value - cost),
      realised: toBase(Math.round(realised)),
      income: toBase(income),
    },
    fxToBase: rate,
    fxKnown: known,
  }
}

export function portfolioTotals(holdings: Holding[]) {
  return holdings.reduce(
    (acc, h) => ({
      cost: acc.cost + h.base.cost,
      value: acc.value + h.base.value,
      unrealised: acc.unrealised + h.base.unrealised,
      realised: acc.realised + h.base.realised,
      income: acc.income + h.base.income,
    }),
    { cost: 0, value: 0, unrealised: 0, realised: 0, income: 0 },
  )
}
