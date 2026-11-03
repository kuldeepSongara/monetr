import type { Budget, BudgetCarry, CarryPlan, ISODate, Pot, Settings, Txn } from '../types'
import type { AdjustFn, BudgetAdjustment } from './analytics'
import { budgetCovers } from './analytics'
import { addMonths, payCycle, type Range } from './dates'
import { potStatus } from './pots'

/*
 * Everything that is taken off a budget's limit before you spend a cent of it:
 *  - savings pots: each pot's per-cycle amount comes out of the budget that pays for it;
 *  - catch-up: going over in one cycle is taken from the following ones (never more than half of
 *    the budget in any one cycle — the rest moves on to the next).
 * Works on existing data with no migration: pots made before you could choose a budget are paid by
 * the budget that covers their purchase, and catch-up only exists for decisions you make.
 */

/** Share of a budget that catch-up may take in one cycle. */
export const CATCHUP_CAP = 0.5

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (iso: ISODate) => MONTHS[Number(iso.slice(5, 7)) - 1]

/** Budgets a pot can be paid from: per-cycle ones (a weekly limit can't carry a monthly amount). */
export function fundingBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter((b) => !b.archived && b.period === 'cycle')
}

/**
 * The budget that pays a pot: the one you chose, or — for pots made before you could choose — the
 * budget covering the purchase's category, else your overall budget. 'none' / no budgets → none.
 */
export function potFundingBudget(pot: Pot, budgets: Budget[], txns: Txn[]): Budget | undefined {
  const usable = fundingBudgets(budgets)
  if (pot.budgetId === 'none') return undefined
  if (pot.budgetId) return usable.find((b) => b.id === pot.budgetId)
  return suggestFundingBudget(
    txns.filter((t) => t.potId === pot.id).map((t) => t.categoryId),
    usable,
  )
}

/** Best budget for a purchase in these categories: a category or group budget first, then overall. */
export function suggestFundingBudget(categoryIds: string[], budgets: Budget[]): Budget | undefined {
  const usable = fundingBudgets(budgets)
  for (const c of categoryIds) {
    const specific = usable.find((b) => b.categoryId !== 'all' && budgetCovers(b, c))
    if (specific) return specific
  }
  return usable.find((b) => b.categoryId === 'all')
}

/** Pots not paid by any budget: their per-cycle amount is held back from safe-to-spend instead. */
export function unfundedPots(pots: Pot[], budgets: Budget[], txns: Txn[]): Pot[] {
  return pots.filter((p) => !p.archived && !potFundingBudget(p, budgets, txns))
}

const SPREAD: Record<CarryPlan, number> = { next: 1, spread3: 3, spread6: 6, waive: 0 }

/**
 * Catch-up taken from `budget` in the cycle starting `cycleStart`, from every decision so far.
 * Simulated cycle by cycle so the half-budget cap is shared fairly and nothing is lost.
 */
export function catchUpFor(budget: Budget, carries: BudgetCarry[], cycleStart: ISODate): BudgetAdjustment[] {
  const mine = carries
    .filter((c) => c.budgetId === budget.id && c.plan !== 'waive' && c.amount > 0 && c.cycleStart < cycleStart)
    .sort((a, b) => a.cycleStart.localeCompare(b.cycleStart))
  if (!mine.length) return []
  const cap = Math.floor(budget.amount * CATCHUP_CAP)
  const left = new Map(mine.map((c) => [c.id, c.amount]))
  let cursor = addMonths(mine[0].cycleStart, 1)
  for (let guard = 0; guard < 240 && cursor <= cycleStart; guard++) {
    let room = cap
    const taken: BudgetAdjustment[] = []
    for (const c of mine) {
      if (c.cycleStart >= cursor) continue
      const remaining = left.get(c.id) ?? 0
      if (remaining <= 0 || room <= 0) continue
      const per = Math.ceil(c.amount / SPREAD[c.plan])
      const take = Math.min(remaining, per, room)
      left.set(c.id, remaining - take)
      room -= take
      taken.push({ kind: 'catchup', label: `Catch-up for ${monthName(c.cycleStart)} ${c.cycleStart.slice(0, 4)}`, amount: take })
    }
    if (cursor === cycleStart) return taken
    cursor = addMonths(cursor, 1)
  }
  return []
}

/** Builds the deduction function used by budgetRows. */
export function makeAdjust(opts: { budgets: Budget[]; pots: Pot[]; carries: BudgetCarry[]; txns: Txn[]; settings: Pick<Settings, 'payCycleStartDay'> }): AdjustFn {
  const { budgets, pots, carries, txns, settings } = opts
  const overall = fundingBudgets(budgets).find((b) => b.categoryId === 'all')
  const funding = new Map(pots.filter((p) => !p.archived).map((p) => [p.id, potFundingBudget(p, budgets, txns)]))
  return (b: Budget, range: Range): BudgetAdjustment[] => {
    if (b.period !== 'cycle') return []
    const out: BudgetAdjustment[] = []
    for (const pot of pots) {
      if (pot.archived) continue
      const payer = funding.get(pot.id)
      if (!payer) continue
      // The paying budget feels it; so does the overall budget, because the money is gone for the cycle.
      if (payer.id !== b.id && !(overall && b.id === overall.id)) continue
      const amount = potStatus(pot, txns, settings, range.end).thisCycle
      if (amount > 0) out.push({ kind: 'pot', label: `${pot.emoji ? `${pot.emoji} ` : ''}${pot.name}`, amount })
    }
    out.push(...catchUpFor(b, carries, payCycle(range.start, settings.payCycleStartDay).start))
    return out
  }
}

export interface OverspendPrompt {
  budget: Budget
  cycleStart: ISODate
  label: string
  over: number
  /** Over by more than a whole cycle's budget — spreading it out is the sensible default. */
  large: boolean
}
