import type { Txn } from '../types'
import { daysBetween } from './dates'
import { normalizeMerchant } from './utils'

/**
 * Possible duplicate transactions. These are only ever flagged — the app never merges or deletes
 * anything on its own, because two identical charges can be real (and catching an unexpected
 * double charge is exactly the point). You choose: delete one, or mark the pair as both real.
 */
export interface DuplicatePair {
  id: string
  a: Txn
  b: Txn
  reason: string
}

function sameMerchant(a: Txn, b: Txn): boolean {
  const x = normalizeMerchant(a.merchant)
  const y = normalizeMerchant(b.merchant)
  if (!x || !y) return false
  return x === y || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y))
}

export function findDuplicates(txns: Txn[], today: string, windowDays = 120, maxGapDays = 3): DuplicatePair[] {
  const recent = txns
    .filter((t) => (t.type === 'expense' || t.type === 'income') && t.date <= today && daysBetween(t.date, today) <= windowDays)
    .sort((a, b) => a.date.localeCompare(b.date))
  const out: DuplicatePair[] = []
  const used = new Set<string>()
  for (let i = 0; i < recent.length; i++) {
    const a = recent[i]
    for (let j = i + 1; j < recent.length; j++) {
      const b = recent[j]
      const gap = daysBetween(a.date, b.date)
      if (gap > maxGapDays) break
      if (a.type !== b.type || a.currency !== b.currency || a.amount !== b.amount) continue
      if (a.notDuplicateOf?.includes(b.id) || b.notDuplicateOf?.includes(a.id)) continue
      const merchantMatch = sameMerchant(a, b)
      // An autopay entry and a hand-logged / imported one for the same bill often have different names.
      const billMatch = (a.source === 'bill') !== (b.source === 'bill') && a.categoryId === b.categoryId
      if (!merchantMatch && !billMatch) continue
      const id = [a.id, b.id].sort().join('|')
      if (used.has(id)) continue
      used.add(id)
      const when = gap === 0 ? 'on the same day' : `${gap} day${gap === 1 ? '' : 's'} apart`
      out.push({
        id,
        a,
        b,
        reason: billMatch && !merchantMatch ? `Autopay entry and another ${a.type} of the same amount ${when}` : `Same amount at the same merchant ${when}`,
      })
    }
  }
  return out.sort((x, y) => y.b.date.localeCompare(x.b.date))
}
