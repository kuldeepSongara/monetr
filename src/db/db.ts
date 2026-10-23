import Dexie, { type Table } from 'dexie'
import type {
  AILogEntry,
  AIProfile,
  BackupFile,
  Bill,
  BillPayment,
  Budget,
  Category,
  ISODate,
  MetaRow,
  Rule,
  Settings,
  Txn,
  WidgetId,
} from '../types'
import { addDays, addMonths, daysBetween, todayISO, nowISO, toISO } from '../lib/dates'
import { minorFactor, toBaseMinor, toMinor } from '../lib/money'
import { downloadFile, median, normalizeMerchant, pickFile, safeJsonParse, uid } from '../lib/utils'
import { predictBill } from '../lib/bills'

export const SCHEMA_VERSION = 1

export const DB_NAME = 'spendwise'

class MonetrDB extends Dexie {
  settings!: Table<Settings, string>
  profiles!: Table<AIProfile, string>
  categories!: Table<Category, string>
  transactions!: Table<Txn, string>
  bills!: Table<Bill, string>
  billPayments!: Table<BillPayment, string>
  budgets!: Table<Budget, string>
  rules!: Table<Rule, string>
  aiLog!: Table<AILogEntry, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      settings: 'id',
      profiles: 'id, priority',
      categories: 'id, order',
      transactions: 'id, date, categoryId, merchant, type',
      bills: 'id, name, active',
      billPayments: 'id, billId, paidDate',
      budgets: 'id, categoryId',
      rules: 'id, merchant',
      aiLog: 'id, at',
      meta: 'key',
    })
    // Future schema changes: add `this.version(2).stores({...}).upgrade(tx => ...)`
    // Never edit version 1 — migrations keep existing data intact.
  }
}

export const db = new MonetrDB()

/* --------------------------------- defaults -------------------------------- */

const CATEGORY_COLORS = {
  green: '#34D399',
  rose: '#FB7185',
  blue: '#60A5FA',
  violet: '#A78BFA',
  amber: '#FBBF24',
  pink: '#F472B6',
  cyan: '#22D3EE',
  orange: '#F59E0B',
  purple: '#7C5CFF',
  sky: '#38BDF8',
  lilac: '#C084FC',
  slate: '#94A3B8',
}

interface SeedCategory {
  slug: string
  name: string
  emoji: string
  color: string
  kind: Category['kind']
}

const SEED_CATEGORIES: SeedCategory[] = [
  { slug: 'groceries', name: 'Groceries', emoji: '🛒', color: CATEGORY_COLORS.green, kind: 'expense' },
  { slug: 'dining', name: 'Dining', emoji: '🍜', color: CATEGORY_COLORS.rose, kind: 'expense' },
  { slug: 'transport', name: 'Transport', emoji: '🚗', color: CATEGORY_COLORS.blue, kind: 'expense' },
  { slug: 'home', name: 'Home', emoji: '🏠', color: CATEGORY_COLORS.violet, kind: 'expense' },
  { slug: 'utilities', name: 'Utilities', emoji: '💡', color: CATEGORY_COLORS.amber, kind: 'expense' },
  { slug: 'shopping', name: 'Shopping', emoji: '🛍️', color: CATEGORY_COLORS.pink, kind: 'expense' },
  { slug: 'health', name: 'Health', emoji: '💊', color: CATEGORY_COLORS.cyan, kind: 'expense' },
  { slug: 'entertainment', name: 'Entertainment', emoji: '🎬', color: CATEGORY_COLORS.orange, kind: 'expense' },
  { slug: 'subscriptions', name: 'Subscriptions', emoji: '🔁', color: CATEGORY_COLORS.purple, kind: 'expense' },
  { slug: 'travel', name: 'Travel', emoji: '✈️', color: CATEGORY_COLORS.sky, kind: 'expense' },
  { slug: 'education', name: 'Education', emoji: '📚', color: CATEGORY_COLORS.lilac, kind: 'expense' },
  { slug: 'fees', name: 'Fees & charges', emoji: '🏦', color: CATEGORY_COLORS.slate, kind: 'expense' },
  { slug: 'other', name: 'Other', emoji: '📦', color: '#64748B', kind: 'expense' },
  { slug: 'salary', name: 'Salary', emoji: '💼', color: CATEGORY_COLORS.green, kind: 'income' },
  { slug: 'freelance', name: 'Freelance', emoji: '🧾', color: CATEGORY_COLORS.cyan, kind: 'income' },
  { slug: 'interest', name: 'Interest', emoji: '📈', color: CATEGORY_COLORS.amber, kind: 'income' },
  { slug: 'gifts', name: 'Gifts', emoji: '🎁', color: CATEGORY_COLORS.rose, kind: 'income' },
  { slug: 'other-income', name: 'Other income', emoji: '💰', color: CATEGORY_COLORS.slate, kind: 'income' },
]

export const DEFAULT_CATEGORY_IDS = {
  groceries: 'cat_groceries',
  dining: 'cat_dining',
  transport: 'cat_transport',
  home: 'cat_home',
  utilities: 'cat_utilities',
  shopping: 'cat_shopping',
  health: 'cat_health',
  entertainment: 'cat_entertainment',
  subscriptions: 'cat_subscriptions',
  travel: 'cat_travel',
  education: 'cat_education',
  fees: 'cat_fees',
  other: 'cat_other',
  salary: 'cat_salary',
  freelance: 'cat_freelance',
  interest: 'cat_interest',
  gifts: 'cat_gifts',
  otherIncome: 'cat_other-income',
}

export function makeCategories(): Category[] {
  return SEED_CATEGORIES.map((c, i) => ({
    id: `cat_${c.slug}`,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    kind: c.kind,
    order: i,
  }))
}

export function makeDefaultSettings(): Settings {
  const at = nowISO()
  return {
    id: 'settings',
    onboarded: false,
    currency: 'USD',
    theme: 'dark',
    accent: '#7C5CFF',
    weekStart: 1,
    payCycleStartDay: 1,
    monthlyAllowance: 0,
    defaultBillLeadDays: 3,
    notifications: false,
    lockEnabled: false,
    failoverEnabled: true,
    autoSwitchActive: true,
    dashboardWidgets: ['safe', 'alerts', 'trend', 'categories', 'budgets', 'bills', 'recent'],
    schemaVersion: SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
  }
}

/* ---------------------------------- seeding --------------------------------- */

export async function ensureSeeded(): Promise<void> {
  await db.open()
  const settings = await db.settings.get('settings')
  if (!settings) {
    await db.settings.put(makeDefaultSettings())
  }
  if ((await db.categories.count()) === 0) {
    await db.categories.bulkPut(makeCategories())
  }
}

/* -------------------------------- settings --------------------------------- */

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const next: Settings = { ...current, ...patch, id: 'settings', updatedAt: nowISO() }
  await db.settings.put(next)
  return next
}

export async function setWidgetOrder(order: WidgetId[]): Promise<void> {
  await updateSettings({ dashboardWidgets: order })
}

/* -------------------------------- categories ------------------------------- */

export async function saveCategory(category: Category): Promise<void> {
  await db.categories.put(category)
}

export async function deleteCategory(id: string): Promise<void> {
  const others = await db.categories.count()
  if (others <= 1) throw new Error('Keep at least one category')
  const fallback =
    (await db.categories.filter((c) => c.kind === 'expense' && c.id !== id).first())?.id ?? DEFAULT_CATEGORY_IDS.other
  const txns = await db.transactions.where('categoryId').equals(id).toArray()
  if (txns.length) {
    await db.transactions.bulkPut(
      txns.map((t) => ({
        ...t,
        categoryId: t.categoryId === id ? (t.type === 'income' ? DEFAULT_CATEGORY_IDS.otherIncome : fallback) : t.categoryId,
        updatedAt: nowISO(),
      })),
    )
  }
  await db.budgets.where('categoryId').equals(id).delete()
  await db.categories.delete(id)
}

/* ------------------------------- transactions ------------------------------ */

export interface TxnInput {
  date: ISODate
  amount: number
  currency?: string
  fxRate?: number
  type: Txn['type']
  categoryId: string
  merchant: string
  note?: string
  source?: Txn['source']
  categorySource?: Txn['categorySource']
  tags?: string[]
}

export async function addTransaction(input: TxnInput, baseCurrency: string): Promise<Txn> {
  const currency = input.currency ?? baseCurrency
  const fxRate = input.fxRate ?? 1
  const at = nowISO()
  const txn: Txn = {
    id: uid('t_'),
    date: input.date,
    amount: Math.abs(input.amount),
    currency,
    fxRate,
    baseAmount: toBaseMinor(Math.abs(input.amount), currency, fxRate, baseCurrency),
    type: input.type,
    categoryId: input.categoryId,
    merchant: input.merchant.trim() || 'Unknown',
    note: input.note?.trim() || undefined,
    tags: input.tags,
    source: input.source ?? 'manual',
    categorySource: input.categorySource ?? 'manual',
    createdAt: at,
    updatedAt: at,
  }
  await db.transactions.put(txn)
  return txn
}

export async function updateTransaction(id: string, input: TxnInput, baseCurrency: string): Promise<void> {
  const existing = await db.transactions.get(id)
  if (!existing) return
  const currency = input.currency ?? existing.currency
  const fxRate = input.fxRate ?? existing.fxRate
  await db.transactions.put({
    ...existing,
    date: input.date,
    amount: Math.abs(input.amount),
    currency,
    fxRate,
    baseAmount: toBaseMinor(Math.abs(input.amount), currency, fxRate, baseCurrency),
    type: input.type,
    categoryId: input.categoryId,
    merchant: input.merchant.trim() || 'Unknown',
    note: input.note?.trim() || undefined,
    tags: input.tags ?? existing.tags,
    categorySource: input.categorySource ?? existing.categorySource,
    updatedAt: nowISO(),
  })
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transactions.delete(id)
}

export async function bulkUpdateCategory(
  assignments: { id: string; categoryId: string }[],
  source: Txn['categorySource'],
): Promise<void> {
  const ids = assignments.map((a) => a.id)
  const rows = await db.transactions.bulkGet(ids)
  const next = rows
    .filter((r): r is Txn => Boolean(r))
    .map((r) => {
      const a = assignments.find((x) => x.id === r.id)
      return a ? { ...r, categoryId: a.categoryId, categorySource: source, updatedAt: nowISO() } : r
    })
  if (next.length) await db.transactions.bulkPut(next)
}

/* ----------------------------------- bills --------------------------------- */

export interface BillInput {
  name: string
  merchant?: string
  categoryId: string
  amount: number
  currency?: string
  fxRate?: number
  frequency: Bill['frequency']
  intervalDays?: number
  dueDay?: number
  anchorDate: ISODate
  autoPay: boolean
  leadDays: number
  notes?: string
}

export async function addBill(input: BillInput, baseCurrency: string): Promise<Bill> {
  const currency = input.currency ?? baseCurrency
  const at = nowISO()
  const bill: Bill = {
    id: uid('b_'),
    name: input.name.trim() || 'Bill',
    merchant: input.merchant?.trim() || undefined,
    categoryId: input.categoryId,
    amount: Math.abs(input.amount),
    currency,
    fxRate: input.fxRate ?? 1,
    baseAmount: toBaseMinor(Math.abs(input.amount), currency, input.fxRate ?? 1, baseCurrency),
    frequency: input.frequency,
    intervalDays: input.intervalDays,
    dueDay: input.dueDay,
    anchorDate: input.anchorDate,
    autoPay: input.autoPay,
    leadDays: input.leadDays,
    active: true,
    notes: input.notes?.trim() || undefined,
    createdAt: at,
    updatedAt: at,
  }
  await db.bills.put(bill)

  // Seed one payment record from the anchor so predictions have a starting point.
  if (input.anchorDate <= todayISO()) {
    await db.billPayments.put({
      id: uid('bp_'),
      billId: bill.id,
      paidDate: input.anchorDate,
      amount: bill.amount,
      currency: bill.currency,
      fxRate: bill.fxRate,
      baseAmount: bill.baseAmount,
      createdAt: at,
    })
  }
  return bill
}

export async function updateBill(id: string, input: BillInput, baseCurrency: string): Promise<void> {
  const existing = await db.bills.get(id)
  if (!existing) return
  const currency = input.currency ?? existing.currency
  const fxRate = input.fxRate ?? existing.fxRate
  await db.bills.put({
    ...existing,
    name: input.name.trim() || existing.name,
    merchant: input.merchant?.trim() || undefined,
    categoryId: input.categoryId,
    amount: Math.abs(input.amount),
    currency,
    fxRate,
    baseAmount: toBaseMinor(Math.abs(input.amount), currency, fxRate, baseCurrency),
    frequency: input.frequency,
    intervalDays: input.intervalDays,
    dueDay: input.dueDay,
    anchorDate: input.anchorDate,
    autoPay: input.autoPay,
    leadDays: input.leadDays,
    notes: input.notes?.trim() || undefined,
    updatedAt: nowISO(),
  })
}

export async function deleteBill(id: string): Promise<void> {
  await db.bills.delete(id)
  await db.billPayments.where('billId').equals(id).delete()
}

export async function snoozeBill(id: string, until: ISODate): Promise<void> {
  const bill = await db.bills.get(id)
  if (!bill) return
  await db.bills.put({ ...bill, snoozedUntil: until, updatedAt: nowISO() })
}

export async function markBillPaid(
  bill: Bill,
  baseCurrency: string,
  opts: { paidDate?: ISODate; amountMinor?: number; createTxn?: boolean; note?: string; categoryId?: string } = {},
): Promise<BillPayment> {
  const paidDate = opts.paidDate ?? todayISO()
  const amount = opts.amountMinor ?? bill.amount
  const at = nowISO()
  const payment: BillPayment = {
    id: uid('bp_'),
    billId: bill.id,
    paidDate,
    amount,
    currency: bill.currency,
    fxRate: bill.fxRate,
    baseAmount: toBaseMinor(amount, bill.currency, bill.fxRate, baseCurrency),
    note: opts.note,
    createdAt: at,
  }

  if (opts.createTxn !== false) {
    const txn = await addTransaction(
      {
        date: paidDate,
        amount,
        currency: bill.currency,
        fxRate: bill.fxRate,
        type: 'expense',
        categoryId: opts.categoryId ?? bill.categoryId,
        merchant: bill.merchant || bill.name,
        note: `Bill payment${opts.note ? ` · ${opts.note}` : ''}`,
        source: 'bill',
        categorySource: 'manual',
      },
      baseCurrency,
    )
    payment.txnId = txn.id
  }

  await db.billPayments.put(payment)
  await db.bills.put({ ...bill, snoozedUntil: undefined, updatedAt: at })
  return payment
}

export async function deletePayment(id: string, deleteTxn = true): Promise<void> {
  const p = await db.billPayments.get(id)
  if (!p) return
  if (deleteTxn && p.txnId) await db.transactions.delete(p.txnId)
  await db.billPayments.delete(id)
}

/* ---------------------------------- budgets -------------------------------- */

export interface BudgetInput {
  categoryId: string
  amount: number
  rollover: boolean
  period: Budget['period']
}

export async function saveBudget(input: BudgetInput, id?: string): Promise<void> {
  const existing = id ? await db.budgets.get(id) : undefined
  const at = nowISO()
  await db.budgets.put({
    id: id ?? uid('bg_'),
    categoryId: input.categoryId,
    amount: Math.max(0, input.amount),
    rollover: input.rollover,
    period: input.period,
    archived: false,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  })
}

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id)
}

/* ----------------------------------- rules --------------------------------- */

export async function learnRules(assignments: { merchant: string; categoryId: string }[]): Promise<void> {
  const at = nowISO()
  for (const a of assignments) {
    const merchant = normalizeMerchant(a.merchant)
    if (!merchant) continue
    const id = `rule_${merchant}`
    const existing = await db.rules.get(id)
    await db.rules.put({
      id,
      merchant,
      categoryId: a.categoryId,
      hits: (existing?.hits ?? 0) + 1,
      updatedAt: at,
    })
  }
}

export async function deleteRule(id: string): Promise<void> {
  await db.rules.delete(id)
}

export async function getRuleMap(): Promise<Map<string, string>> {
  const rules = await db.rules.toArray()
  return new Map(rules.map((r) => [r.merchant, r.categoryId]))
}

/* --------------------------------- profiles -------------------------------- */

export async function saveProfile(profile: AIProfile): Promise<void> {
  await db.profiles.put(profile)
}

export async function deleteProfile(id: string): Promise<void> {
  await db.profiles.delete(id)
  const settings = await db.settings.get('settings')
  if (settings?.activeProfileId === id) {
    const next = await db.profiles.orderBy('priority').first()
    await updateSettings({ activeProfileId: next?.id })
  }
}

export async function setProfileHealth(id: string, health: AIProfile['health']): Promise<void> {
  const p = await db.profiles.get(id)
  if (!p) return
  await db.profiles.put({ ...p, health })
}

export async function moveProfile(id: string, direction: -1 | 1): Promise<void> {
  const profiles = await db.profiles.orderBy('priority').toArray()
  const index = profiles.findIndex((p) => p.id === id)
  const swapIndex = index + direction
  if (index < 0 || swapIndex < 0 || swapIndex >= profiles.length) return
  const a = profiles[index]
  const b = profiles[swapIndex]
  await db.profiles.bulkPut([
    { ...a, priority: b.priority },
    { ...b, priority: a.priority },
  ])
}

/* --------------------------------- ai log ---------------------------------- */

export async function logAI(entry: Omit<AILogEntry, 'id'>): Promise<void> {
  await db.aiLog.put({ ...entry, id: uid('log_') })
  const count = await db.aiLog.count()
  if (count > 120) {
    const stale = await db.aiLog.orderBy('at').limit(count - 120).primaryKeys()
    await db.aiLog.bulkDelete(stale)
  }
}

export async function clearAILog(): Promise<void> {
  await db.aiLog.clear()
}

/* ----------------------------------- meta ---------------------------------- */

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await db.meta.get(key)
  return (row?.value as T) ?? null
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key)
}

/* --------------------------------- backups --------------------------------- */

export async function buildBackup(): Promise<BackupFile> {
  const [settings, profiles, categories, transactions, bills, billPayments, budgets, rules] = await Promise.all([
    db.settings.toArray(),
    db.profiles.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.bills.toArray(),
    db.billPayments.toArray(),
    db.budgets.toArray(),
    db.rules.toArray(),
  ])
  return {
    app: 'spendwise',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    data: {
      settings: settings[0] ?? makeDefaultSettings(),
      profiles,
      categories,
      transactions,
      bills,
      billPayments,
      budgets,
      rules,
    },
  }
}

export async function exportBackup(): Promise<void> {
  const backup = await buildBackup()
  await setMeta('lastBackupAt', nowISO())
  downloadFile(`spendwise-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2))
}

export async function importBackup(backup: BackupFile, mode: 'replace' | 'merge'): Promise<{ added: number }> {
  if (backup?.app !== 'spendwise' || !backup.data) {
    throw new Error('That file is not a Spendwise backup.')
  }
  const d = backup.data
  if (mode === 'replace') {
    await db.transaction(
      'rw',
      [db.settings, db.profiles, db.categories, db.transactions, db.bills, db.billPayments, db.budgets, db.rules],
      async () => {
        await Promise.all([
          db.settings.clear(),
          db.profiles.clear(),
          db.categories.clear(),
          db.transactions.clear(),
          db.bills.clear(),
          db.billPayments.clear(),
          db.budgets.clear(),
          db.rules.clear(),
        ])
        await db.settings.put({ ...makeDefaultSettings(), ...d.settings, onboarded: true })
        await db.profiles.bulkPut(d.profiles ?? [])
        await db.categories.bulkPut(d.categories ?? [])
        await db.transactions.bulkPut(d.transactions ?? [])
        await db.bills.bulkPut(d.bills ?? [])
        await db.billPayments.bulkPut(d.billPayments ?? [])
        await db.budgets.bulkPut(d.budgets ?? [])
        await db.rules.bulkPut(d.rules ?? [])
      },
    )
    return { added: (d.transactions ?? []).length }
  }

  let added = 0
  const merge = async <T>(table: Table<T, string>, rows: T[] | undefined) => {
    if (!rows?.length) return
    const existing = await table.bulkGet(rows.map((r) => (r as unknown as { id: string }).id))
    const fresh = rows.filter((_, i) => !existing[i])
    if (fresh.length) await table.bulkPut(fresh)
    added += fresh.length
  }
  await merge(db.profiles, d.profiles)
  await merge(db.categories, d.categories)
  await merge(db.transactions, d.transactions)
  await merge(db.bills, d.bills)
  await merge(db.billPayments, d.billPayments)
  await merge(db.budgets, d.budgets)
  await merge(db.rules, d.rules)
  return { added }
}

export async function pickAndImport(mode: 'replace' | 'merge'): Promise<number | null> {
  const file = await pickFile('application/json,.json')
  if (!file) return null
  const text = await file.text()
  const parsed = safeJsonParse<BackupFile>(text)
  if (!parsed) throw new Error('Could not read that JSON file.')
  const res = await importBackup(parsed, mode)
  return res.added
}

export async function wipeAll(): Promise<void> {
  await Promise.all([
    db.transactions.clear(),
    db.bills.clear(),
    db.billPayments.clear(),
    db.budgets.clear(),
    db.rules.clear(),
    db.meta.clear(),
    db.aiLog.clear(),
    db.profiles.clear(),
  ])
  await db.categories.clear()
  await db.categories.bulkPut(makeCategories())
  await db.settings.clear()
  await db.settings.put({ ...makeDefaultSettings(), onboarded: false })
}

export async function deleteEverythingButProfiles(): Promise<void> {
  await Promise.all([
    db.transactions.clear(),
    db.bills.clear(),
    db.billPayments.clear(),
    db.budgets.clear(),
    db.rules.clear(),
    db.meta.clear(),
  ])
}

/** Re-label stored base amounts after the base currency changes. */
export async function changeBaseCurrency(newCode: string): Promise<void> {
  const settings = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const oldCode = settings.currency
  if (oldCode === newCode) return
  const factor = minorFactor(newCode) / minorFactor(oldCode)

  const [txns, bills, payments, budgets] = await Promise.all([
    db.transactions.toArray(),
    db.bills.toArray(),
    db.billPayments.toArray(),
    db.budgets.toArray(),
  ])

  await db.transaction('rw', [db.transactions, db.bills, db.billPayments, db.budgets, db.settings], async () => {
    await db.transactions.bulkPut(
      txns.map((t) => ({
        ...t,
        baseAmount: toBaseMinor(t.amount, t.currency, t.fxRate, newCode),
        updatedAt: nowISO(),
      })),
    )
    await db.bills.bulkPut(
      bills.map((b) => ({ ...b, baseAmount: toBaseMinor(b.amount, b.currency, b.fxRate, newCode), updatedAt: nowISO() })),
    )
    await db.billPayments.bulkPut(
      payments.map((p) => ({ ...p, baseAmount: toBaseMinor(p.amount, p.currency, p.fxRate, newCode) })),
    )
    await db.budgets.bulkPut(budgets.map((b) => ({ ...b, amount: Math.round(b.amount * factor), updatedAt: nowISO() })))
    await db.settings.put({
      ...settings,
      currency: newCode,
      monthlyAllowance: Math.round(settings.monthlyAllowance * factor),
      updatedAt: nowISO(),
    })
  })
}

/* ---------------------------------- exports -------------------------------- */

export async function exportCsv(): Promise<void> {
  const [txns, categories] = await Promise.all([db.transactions.toArray(), db.categories.toArray()])
  const base = (await db.settings.get('settings'))?.currency ?? 'USD'
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const header = ['date', 'type', 'merchant', 'category', 'note', 'amount', 'currency', 'fx_rate', 'base_amount', 'base_currency']
  const rows = txns
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => [
      t.date,
      t.type,
      t.merchant,
      catName.get(t.categoryId) ?? t.categoryId,
      t.note ?? '',
      (t.amount / minorFactor(t.currency)).toFixed(2),
      t.currency,
      String(t.fxRate),
      (t.baseAmount / minorFactor(base)).toFixed(2),
      base,
    ])
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n')
  downloadFile(`spendwise-transactions-${todayISO()}.csv`, csv, 'text/csv')
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export async function exportBillsIcs(): Promise<void> {
  const [bills, payments, categories] = await Promise.all([
    db.bills.toArray(),
    db.billPayments.toArray(),
    db.categories.toArray(),
  ])
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const today = todayISO()
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Spendwise//Bills//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Spendwise bills',
  ]

  for (const bill of bills.filter((b) => b.active && !b.archived)) {
    const schedule = predictBill(bill, payments, today)
    if (!schedule.nextDue) continue
    const start = schedule.nextDue < today ? today : schedule.nextDue
    const dt = `${start.replace(/-/g, '')}T090000`
    const rrule =
      bill.frequency === 'weekly'
        ? 'RRULE:FREQ=WEEKLY'
        : bill.frequency === 'biweekly'
          ? 'RRULE:FREQ=WEEKLY;INTERVAL=2'
          : bill.frequency === 'quarterly'
            ? 'RRULE:FREQ=MONTHLY;INTERVAL=3'
            : bill.frequency === 'yearly'
              ? 'RRULE:FREQ=YEARLY'
              : bill.frequency === 'custom' && bill.intervalDays
                ? `RRULE:FREQ=DAILY;INTERVAL=${bill.intervalDays}`
                : 'RRULE:FREQ=MONTHLY'
    lines.push(
      'BEGIN:VEVENT',
      `UID:${bill.id}@spendwise`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dt}`,
      `SUMMARY:${icsEscape(`💳 ${bill.name}`)}`,
      `DESCRIPTION:${icsEscape(`Bill reminder · ${catName.get(bill.categoryId) ?? 'Bill'}${bill.autoPay ? ' · autopay' : ''}`)}`,
      rrule,
      'BEGIN:VALARM',
      `TRIGGER:-P${Math.max(0, bill.leadDays)}D`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`Upcoming bill: ${bill.name}`)}`,
      'END:VALARM',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  downloadFile(`spendwise-bills-${today}.ics`, lines.join('\r\n'), 'text/calendar')
}

/* -------------------------------- sample data ------------------------------ */

export async function seedSampleData(): Promise<void> {
  const settings = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const base = settings.currency
  const unit = minorFactor(base)
  const today = todayISO()
  const at = nowISO()
  const txns: Txn[] = []
  const bills: Bill[] = []
  const payments: BillPayment[] = []

  const push = (
    date: ISODate,
    merchant: string,
    categoryId: string,
    major: number,
    type: Txn['type'] = 'expense',
    note?: string,
    source: Txn['source'] = 'manual',
  ) => {
    const amount = Math.round(major * unit)
    txns.push({
      id: uid('demo_t_'),
      date,
      amount,
      currency: base,
      fxRate: 1,
      baseAmount: amount,
      type,
      categoryId,
      merchant,
      note,
      source,
      categorySource: 'manual',
      createdAt: at,
      updatedAt: at,
    })
  }

  // Income: two salaries + a little freelance
  push(addDays(today, -daysBetween(addMonths(today, -2), today)), 'Acme Payroll', 'cat_salary', 4200, 'income', 'Monthly salary')
  push(addDays(today, -daysBetween(addMonths(today, -1), today)), 'Acme Payroll', 'cat_salary', 4200, 'income', 'Monthly salary')
  push(addDays(today, -3), 'Acme Payroll', 'cat_salary', 4200, 'income', 'Monthly salary')
  push(addDays(today, -12), 'Studio Client', 'cat_freelance', 640, 'income', 'Logo project')

  // Rent
  for (let m = 3; m >= 0; m--) {
    const d = addMonths(today, -m)
    push(`${d.slice(0, 7)}-01`, 'Harbor Apartments', 'cat_home', 1780, 'expense', 'Rent', 'manual')
  }

  // Groceries — weekly-ish with variation
  const groceryStores = ['Whole Foods', 'Trader Joe\'s', 'Local Market', 'Costco']
  for (let i = 0; i < 18; i++) {
    const date = addDays(today, -Math.round(i * 4.3) - 1)
    push(date, groceryStores[i % groceryStores.length], 'cat_groceries', 35 + Math.random() * 65)
  }

  // Coffee & dining
  for (let i = 0; i < 26; i++) {
    const date = addDays(today, -Math.round(i * 3.1))
    push(date, i % 3 === 0 ? 'Blue Bottle Coffee' : i % 3 === 1 ? 'Sushi Bar' : 'Taqueria Sol', 'cat_dining', i % 3 === 0 ? 5.5 : 18 + Math.random() * 35)
  }

  // Transport
  for (let i = 0; i < 12; i++) {
    push(addDays(today, -i * 7 - 2), i % 4 === 0 ? 'Shell' : 'Metro Transit', 'cat_transport', i % 4 === 0 ? 52 : 2.9)
  }

  // Shopping / health / fun
  push(addDays(today, -9), 'Uniqlo', 'cat_shopping', 89.9)
  push(addDays(today, -21), 'Amazon', 'cat_shopping', 43.2)
  push(addDays(today, -6), 'CVS Pharmacy', 'cat_health', 24.6)
  push(addDays(today, -15), 'Cinema 9', 'cat_entertainment', 28)
  push(addDays(today, -27), 'Steam', 'cat_entertainment', 19.99)
  push(addDays(today, -33), 'IKEA', 'cat_home', 129)
  push(addDays(today, -18), 'Delta Airlines', 'cat_travel', 312)

  // Subscriptions (regular intervals so detection works)
  const subs: { name: string; amount: number; dayOffset: number; category?: string }[] = [
    { name: 'Netflix', amount: 15.49, dayOffset: 18 },
    { name: 'Spotify', amount: 11.99, dayOffset: 7 },
    { name: 'iCloud+', amount: 2.99, dayOffset: 23 },
    { name: 'ChatGPT Plus', amount: 20, dayOffset: 12 },
    { name: 'Gym Membership', amount: 39, dayOffset: 5 },
  ]
  for (const s of subs) {
    for (let m = 0; m < 4; m++) {
      const date = addDays(addMonths(today, -m), -s.dayOffset % 28)
      push(date, s.name, s.category ?? 'cat_subscriptions', s.amount)
    }
  }

  // Bills + payment history
  const billDefs: {
    name: string
    merchant: string
    categoryId: string
    amount: number
    frequency: Bill['frequency']
    dueDay: number
    jitter: number
    autoPay: boolean
  }[] = [
    { name: 'Rent', merchant: 'Harbor Apartments', categoryId: 'cat_home', amount: 1780, frequency: 'monthly', dueDay: 1, jitter: 0, autoPay: true },
    { name: 'Electricity', merchant: 'City Power', categoryId: 'cat_utilities', amount: 92, frequency: 'monthly', dueDay: 8, jitter: 0, autoPay: false },
    { name: 'Internet', merchant: 'Fiberline', categoryId: 'cat_utilities', amount: 65, frequency: 'monthly', dueDay: 12, jitter: 1, autoPay: true },
    { name: 'Phone', merchant: 'Telco Mobile', categoryId: 'cat_utilities', amount: 45, frequency: 'monthly', dueDay: 22, jitter: 0, autoPay: true },
    { name: 'Netflix', merchant: 'Netflix', categoryId: 'cat_subscriptions', amount: 15.49, frequency: 'monthly', dueDay: 18, jitter: 0, autoPay: true },
    { name: 'Gym', merchant: 'Gym Membership', categoryId: 'cat_health', amount: 39, frequency: 'monthly', dueDay: 5, jitter: 0, autoPay: true },
    { name: 'Car insurance', merchant: 'SafeDrive', categoryId: 'cat_transport', amount: 118, frequency: 'quarterly', dueDay: 15, jitter: 2, autoPay: false },
  ]

  for (const def of billDefs) {
    const anchor = addMonths(today, -4)
    const bill: Bill = {
      id: uid('demo_b_'),
      name: def.name,
      merchant: def.merchant,
      categoryId: def.categoryId,
      amount: Math.round(def.amount * unit),
      currency: base,
      fxRate: 1,
      baseAmount: Math.round(def.amount * unit),
      frequency: def.frequency,
      dueDay: def.dueDay,
      anchorDate: `${anchor.slice(0, 7)}-${String(def.dueDay).padStart(2, '0')}`,
      autoPay: def.autoPay,
      leadDays: def.autoPay ? 2 : 5,
      active: true,
      createdAt: at,
      updatedAt: at,
    }
    bills.push(bill)

    // 3-4 historical payments, occasionally a day or two late
    const monthsBack = def.frequency === 'quarterly' ? [3] : [3, 2, 1]
    for (const m of monthsBack) {
      const paidDate = `${addMonths(today, -m).slice(0, 7)}-${String(
        Math.min(28, def.dueDay + (Math.random() < 0.3 ? def.jitter + 1 : 0)),
      ).padStart(2, '0')}`
      if (paidDate > today) continue
      payments.push({
        id: uid('demo_bp_'),
        billId: bill.id,
        paidDate,
        amount: bill.amount,
        currency: base,
        fxRate: 1,
        baseAmount: bill.amount,
        createdAt: at,
      })
    }
  }

  // Budgets
  const budgets: Budget[] = [
    { id: uid('demo_bg_'), categoryId: 'all', amount: Math.round(2600 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_groceries', amount: Math.round(520 * unit), rollover: true, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_dining', amount: Math.round(260 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_transport', amount: Math.round(180 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_shopping', amount: Math.round(220 * unit), rollover: true, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_subscriptions', amount: Math.round(120 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
  ]

  await db.transaction('rw', [db.transactions, db.bills, db.billPayments, db.budgets, db.settings], async () => {
    await db.transactions.bulkPut(txns)
    await db.bills.bulkPut(bills)
    await db.billPayments.bulkPut(payments)
    await db.budgets.bulkPut(budgets)
    await db.settings.put({
      ...settings,
      onboarded: true,
      monthlyAllowance: Math.round(2600 * unit),
      dashboardWidgets: settings.dashboardWidgets?.length
        ? settings.dashboardWidgets
        : (['safe', 'alerts', 'trend', 'categories', 'budgets', 'bills', 'recent'] as WidgetId[]),
      updatedAt: at,
    })
  })
}

export async function clearDemoData(): Promise<void> {
  const [txns, bills, payments, budgets] = await Promise.all([
    db.transactions.toArray(),
    db.bills.toArray(),
    db.billPayments.toArray(),
    db.budgets.toArray(),
  ])
  await db.transaction('rw', [db.transactions, db.bills, db.billPayments, db.budgets], async () => {
    await db.transactions.bulkDelete(txns.filter((t) => t.id.startsWith('demo_')).map((t) => t.id))
    await db.bills.bulkDelete(bills.filter((b) => b.id.startsWith('demo_')).map((b) => b.id))
    await db.billPayments.bulkDelete(payments.filter((p) => p.id.startsWith('demo_')).map((p) => p.id))
    await db.budgets.bulkDelete(budgets.filter((b) => b.id.startsWith('demo_')).map((b) => b.id))
  })
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const est = await navigator.storage.estimate()
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
}

export { toMinor, toBaseMinor, median, toISO }
