import { db } from '../db/db'
import { budgetRows, computeSafeToSpend } from '../lib/analytics'
import { predictBill, type BillSchedule } from '../lib/bills'
import { makeAdjust, unfundedPots } from '../lib/budgetAdjust'
import { payCycle, shiftPeriod, todayISO } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { computeNudges, type Nudge } from '../lib/nudges'
import { potStatuses, potTxnIds } from '../lib/pots'
import { authToken, decryptSnapshot, mergeSnapshots, syncedTables, type Snapshot, type SyncState } from '../lib/sync'
import type { Bill, BillPayment, Budget, BudgetCarry, Category, Pot, Settings, Txn } from '../types'
import { makeDefaultSettings } from '../db/db'

/*
 * The morning check, run by the service worker when the daily wake-up push arrives — the app
 * doesn't need to be open. It reads your data on this device, folds in the latest encrypted copy
 * from your other devices (if sync is on), and works out what's worth telling you this morning.
 */

interface Data {
  settings: Settings
  categories: Category[]
  txns: Txn[]
  bills: Bill[]
  payments: BillPayment[]
  budgets: Budget[]
  pots: Pot[]
  carries: BudgetCarry[]
}

async function localData(): Promise<{ data: Data; snapshot: Snapshot; include: boolean }> {
  const settings = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const mirror = (await db.meta.get('syncMirror'))?.value as SyncState | undefined
  const include = mirror?.includeAiProfiles !== false
  const names = syncedTables(include)
  const rows = await Promise.all(names.map((n) => db.table(n).toArray() as Promise<Record<string, unknown>[]>))
  const tables: Snapshot['tables'] = {}
  names.forEach((n, i) => (tables[n] = rows[i]))
  const snapshot: Snapshot = { v: 2, exportedAt: new Date().toISOString(), deviceId: 'sw', settings: { values: {}, updatedAt: '' }, tables, tombstones: await db.tombstones.toArray() }
  return { data: fromTables(settings, tables), snapshot, include }
}

function fromTables(settings: Settings, t: Snapshot['tables']): Data {
  const get = <T>(n: keyof Snapshot['tables']) => ((t[n] ?? []) as unknown as T[])
  return {
    settings,
    categories: get<Category>('categories'),
    txns: get<Txn>('transactions'),
    bills: get<Bill>('bills'),
    payments: get<BillPayment>('billPayments'),
    budgets: get<Budget>('budgets'),
    pots: get<Pot>('pots'),
    carries: get<BudgetCarry>('budgetCarries'),
  }
}

/** Your data plus anything newer from your other devices (read-only: nothing is written here). */
async function freshestData(): Promise<Data> {
  const { data, snapshot } = await localData()
  const state = (await db.meta.get('syncMirror'))?.value as SyncState | undefined
  if (!state?.enabled || !state.key) return data
  try {
    const base = (state.server || self.location.origin).replace(/\/+$/, '')
    const res = await fetch(`${base}/api/sync/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncId: state.syncId, auth: await authToken(state.key) }),
    })
    if (!res.ok) return data
    const json = (await res.json()) as { data?: string }
    if (typeof json.data !== 'string') return data
    const remote = await decryptSnapshot(json.data, state.key)
    const merged = mergeSnapshots(snapshot, remote)
    const settings = { ...data.settings, ...(remote.settings?.values ?? {}) } as Settings
    return fromTables(settings, merged.tables)
  } catch {
    return data
  }
}

export async function morningNudges(today: ISODateLike = todayISO()): Promise<Nudge[]> {
  const d = await freshestData()
  const potIds = new Set(d.pots.map((p) => p.id))
  const hidden = potTxnIds(d.txns, potIds)
  const everyday = hidden.size ? d.txns.filter((t) => !hidden.has(t.id)) : d.txns
  const adjust = makeAdjust({ budgets: d.budgets, pots: d.pots, carries: d.carries, txns: d.txns, settings: d.settings })
  const rows = budgetRows(d.budgets, everyday, d.categories, d.settings, today, adjust)
  const schedules = new Map<string, BillSchedule>(d.bills.map((b) => [b.id, predictBill(b, d.payments, today)]))
  const pots = potStatuses(d.pots, d.txns, d.settings, today)
  const unfunded = new Set(unfundedPots(d.pots, d.budgets, d.txns).map((p) => p.id))
  const potsReserved = pots.filter((p) => unfunded.has(p.pot.id)).reduce((s, p) => s + p.thisCycle, 0)
  const safe = computeSafeToSpend(rows, everyday, d.bills, schedules, d.settings, today, potsReserved)

  // Same overspend check the app shows on Home, so the morning can mention a waiting decision.
  const prev = shiftPeriod(payCycle(today, d.settings.payCycleStartDay), -1, false)
  const decided = new Set(d.carries.map((c) => c.id))
  let overspendCount = 0
  for (const b of d.budgets) {
    if (b.archived || b.period !== 'cycle' || (b.overspendPlan && b.overspendPlan !== 'ask')) continue
    if (b.createdAt && b.createdAt.slice(0, 10) > prev.end) continue
    if (decided.has(`carry_${b.id}_${prev.start}`)) continue
    const [row] = budgetRows([b], everyday, d.categories, d.settings, prev.end, adjust)
    if (row && row.spent > row.limit) overspendCount++
  }

  const all = computeNudges({ today, currency: d.settings.currency, rows, safe, txns: everyday, bills: d.bills, schedules, pots, overspendCount })
  return pickMorning(all, safe.basis === 'none' ? null : safe.perDay, d.settings.currency, today)
}

type ISODateLike = string

/** The morning's message: the most useful heads-up, plus today's amount when nothing else stands out. */
export function pickMorning(all: Nudge[], perDay: number | null, currency: string, today: string): Nudge[] {
  const urgent = all.filter((n) => ['pace', 'projection', 'over', 'bill', 'cycle'].includes(n.kind))
  const picked = urgent.slice(0, 2)
  if (!picked.length && perDay !== null) {
    picked.push({
      id: `morning_${today}`,
      kind: 'summary',
      title: 'Good morning',
      body: `You can spend about ${formatMoney(perDay, currency)} today and stay on track.`,
      at: `${today}T00:00`,
      url: '/',
      priority: 0,
    })
  }
  return picked
}

