import type { CurrencyProfile, Rule, Txn } from '../types'
import { normalizeMerchant } from './utils'

/**
 * Category from a learned merchant rule. Exact match first; otherwise a rule whose merchant is the
 * leading word(s) of a longer bank descriptor ("starbucks" matches "starbucks 0423 toronto on").
 */
export function ruleCategory(merchant: string, rules: Rule[]): string | undefined {
  const key = normalizeMerchant(merchant)
  if (!key) return undefined
  let best: Rule | undefined
  for (const r of rules) {
    if (r.merchant === key) return r.categoryId
    if (r.merchant.length >= 4 && key.startsWith(`${r.merchant} `)) {
      if (!best || r.merchant.length > best.merchant.length) best = r
    }
  }
  return best?.categoryId
}

/**
 * A sensible default exchange rate for `currency` → base: the rate you used most recently for that
 * currency, else the rate on a matching currency profile. Undefined means "ask the user".
 */
export function suggestedFxRate(
  currency: string,
  base: string,
  transactions: Txn[],
  currencyProfiles: CurrencyProfile[],
): number | undefined {
  if (currency === base) return 1
  let latest: Txn | undefined
  for (const t of transactions) {
    if (t.currency !== currency || !(t.fxRate > 0) || t.fxRate === 1) continue
    if (!latest || t.date > latest.date || (t.date === latest.date && t.createdAt > latest.createdAt)) latest = t
  }
  if (latest) return latest.fxRate
  const profile = currencyProfiles.find((p) => p.code === currency && !p.isBase && p.fxToBase > 0)
  return profile?.fxToBase
}

/** Same merchant, same amount, within a day or two — very likely already recorded. */
export function findDuplicate(
  candidate: { date: string; merchant: string; amount: number; currency: string },
  transactions: Txn[],
): Txn | undefined {
  const key = normalizeMerchant(candidate.merchant)
  const day = Date.parse(candidate.date)
  return transactions.find((t) => {
    if (t.currency !== candidate.currency || t.amount !== candidate.amount) return false
    if (Math.abs(Date.parse(t.date) - day) > 2 * 86_400_000) return false
    const tk = normalizeMerchant(t.merchant)
    return tk === key || tk.startsWith(key) || key.startsWith(tk)
  })
}
