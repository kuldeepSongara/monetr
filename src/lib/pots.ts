import type { ISODate, Pot, Settings, Txn } from '../types'
import { addMonths, payCycle, todayISO } from './dates'
import { spendDelta } from './analytics'

export interface PotStatus {
  pot: Pot
  /** Purchases paid from this pot, and refunds of those purchases. */
  linked: Txn[]
  /** Net spent from the pot (purchases minus refunds), base minor. */
  spent: number
  /** What the pot has to cover: the goal, or what was actually spent if more. */
  need: number
  /** Set aside so far, including this cycle. */
  setAside: number
  /** Held back from this cycle's safe-to-spend. */
  thisCycle: number
  /** Still to set aside after this cycle. */
  remaining: number
  /** setAside − spent: positive = money waiting in the pot, negative = still paying back. */
  balance: number
  cyclesLeft: number
  /** Last day of the cycle in which the pot is fully covered. */
  finishDate?: ISODate
  state: 'saving' | 'ready' | 'paying-back' | 'done'
}

function monthIndex(iso: ISODate): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1
}

/** Pay cycles from the one containing `start` to the one containing `today`, inclusive (0 if start is later). */
export function cyclesSince(start: ISODate, today: ISODate, startDay: number): number {
  const a = payCycle(start, startDay).start
  const b = payCycle(today, startDay).start
  return Math.max(0, monthIndex(b) - monthIndex(a) + 1)
}

/** Every transaction paid from a pot, plus refunds of those purchases. */
export function potTxnIds(txns: Txn[], potIds: Set<string>): Set<string> {
  const ids = new Set(txns.filter((t) => t.potId && potIds.has(t.potId)).map((t) => t.id))
  for (const t of txns) if (t.refundOf && ids.has(t.refundOf)) ids.add(t.id)
  return ids
}

export function potStatus(pot: Pot, txns: Txn[], settings: Pick<Settings, 'payCycleStartDay'>, today: ISODate = todayISO()): PotStatus {
  const direct = txns.filter((t) => t.potId === pot.id)
  const directIds = new Set(direct.map((t) => t.id))
  const linked = [...direct, ...txns.filter((t) => t.refundOf && directIds.has(t.refundOf))].sort((a, b) => a.date.localeCompare(b.date))
  const spent = Math.max(0, linked.reduce((s, t) => s + spendDelta(t), 0))
  const need = pot.kind === 'save' ? Math.max(pot.target, spent) : spent
  const per = Math.max(1, pot.perCycle)

  const n = cyclesSince(pot.startDate, today, settings.payCycleStartDay)
  const before = Math.min(need, (pot.carried ?? 0) + per * Math.max(0, n - 1))
  const thisCycle = n > 0 && !pot.archived ? Math.max(0, Math.min(per, need - before)) : 0
  const setAside = before + thisCycle
  const remaining = Math.max(0, need - setAside)
  const cyclesLeft = Math.ceil(remaining / per)
  // Started already: the last set-aside is `cyclesLeft` cycles after this one. Not started yet:
  // the first set-aside is in the start cycle, so the last is `cyclesLeft − 1` after it.
  const finishDate =
    need <= 0
      ? undefined
      : n > 0
        ? addMonths(payCycle(today, settings.payCycleStartDay).end, cyclesLeft)
        : addMonths(payCycle(pot.startDate, settings.payCycleStartDay).end, Math.max(0, cyclesLeft - 1))

  let state: PotStatus['state']
  if (spent === 0) state = need > 0 && setAside >= need ? 'ready' : pot.kind === 'payback' && need === 0 ? 'done' : 'saving'
  else state = setAside >= need ? 'done' : 'paying-back'

  return { pot, linked, spent, need, setAside, thisCycle, remaining, balance: setAside - spent, cyclesLeft, finishDate, state }
}

export function potStatuses(pots: Pot[], txns: Txn[], settings: Pick<Settings, 'payCycleStartDay'>, today: ISODate = todayISO()): PotStatus[] {
  return pots.filter((p) => !p.archived).map((p) => potStatus(p, txns, settings, today))
}

/**
 * Changing the per-cycle amount only applies from this cycle on: what was set aside in earlier
 * cycles is carried over, so progress never jumps.
 */
export function rebasePot(pot: Pot, txns: Txn[], settings: Pick<Settings, 'payCycleStartDay'>, today: ISODate = todayISO()): Pick<Pot, 'carried' | 'startDate'> {
  const n = cyclesSince(pot.startDate, today, settings.payCycleStartDay)
  if (n <= 1) return { carried: pot.carried, startDate: pot.startDate }
  const status = potStatus({ ...pot, archived: false }, txns, settings, today)
  return { carried: status.setAside - status.thisCycle, startDate: payCycle(today, settings.payCycleStartDay).start }
}

/** Per-cycle amount that covers `amount` in `cycles` pay cycles. */
export function perCycleFor(amount: number, cycles: number): number {
  return Math.max(1, Math.ceil(amount / Math.max(1, cycles)))
}

/** Pay cycles between today and a target date (at least 1). */
export function cyclesUntil(target: ISODate, settings: Pick<Settings, 'payCycleStartDay'>, today: ISODate = todayISO()): number {
  return Math.max(1, cyclesSince(today, target, settings.payCycleStartDay))
}
