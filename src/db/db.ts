import Dexie, { type Table } from 'dexie'
import type {
  AILogEntry,
  AIProfile,
  BackupFile,
  Bill,
  BillPayment,
  Budget,
  Category,
  CurrencyProfile,
  FlagEntry,
  FlagIdea,
  Pot,
  ImportRecord,
  Investment,
  InvestmentTransfer,
  InvestmentTx,
  ISODate,
  MetaRow,
  Rule,
  Settings,
  Tombstone,
  Txn,
  WidgetId,
} from '../types'
import { SHARED_SETTING_KEYS } from '../types'
import { addDays, addMonths, daysBetween, todayISO, nowISO, toISO } from '../lib/dates'
import { minorFactor, toBaseMinor, toMinor } from '../lib/money'
import { downloadFile, median, normalizeMerchant, pickFile, safeJsonParse, uid } from '../lib/utils'
import { predictBill } from '../lib/bills'

export const SCHEMA_VERSION = 3

export const DB_NAME = 'monetr'

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
  currencyProfiles!: Table<CurrencyProfile, string>
  investments!: Table<Investment, string>
  investmentTxs!: Table<InvestmentTx, string>
  investmentTransfers!: Table<InvestmentTransfer, string>
  flags!: Table<FlagEntry, string>
  flagIdeas!: Table<FlagIdea, string>
  imports!: Table<ImportRecord, string>
  tombstones!: Table<Tombstone, string>
  pots!: Table<Pot, string>

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      settings: 'id',
      profiles: 'id, priority',
      categories: 'id, order',
      transactions: 'id, date, categoryId, merchant, type, profileId',
      bills: 'id, name, active, profileId',
      billPayments: 'id, billId, paidDate, profileId',
      budgets: 'id, categoryId',
      rules: 'id, merchant',
      aiLog: 'id, at',
      meta: 'key',
      currencyProfiles: 'id, code, isDefault, isBase',
      investments: 'id, profileId, type, symbol',
      investmentTxs: 'id, investmentId, profileId, date, type',
      investmentTransfers: 'id, fromProfileId, toProfileId, date',
      flags: 'id, kind, status, createdAt',
      flagIdeas: 'id, status, createdAt',
      imports: 'id, status, createdAt',
    })
    // v2: tombstones for sync, transfer categories. Never edit a released version block — add a new one.
    this.version(2)
      .stores({ tombstones: 'id, table, deletedAt' })
      .upgrade(async (tx) => {
        const cats = tx.table('categories')
        for (const cat of TRANSFER_CATEGORIES) {
          if (!(await cats.get(cat.id))) await cats.put(cat)
        }
        await tx.table('settings').toCollection().modify((s: Settings) => {
          s.schemaVersion = 2
          if (s.autoLockDelay === undefined) s.autoLockDelay = 0
        })
      })
    // v3: savings pots for one-time purchases.
    this.version(3)
      .stores({ pots: 'id, kind, archived' })
      .upgrade(async (tx) => {
        await tx.table('settings').toCollection().modify((s: Settings) => {
          s.schemaVersion = 3
        })
      })
  }
}

export const db = new MonetrDB()

/** Tables that sync between linked devices (AI profiles are opt-in, see lib/sync). */
export const SYNC_TABLES = [
  'categories',
  'transactions',
  'bills',
  'billPayments',
  'budgets',
  'rules',
  'currencyProfiles',
  'investments',
  'investmentTxs',
  'investmentTransfers',
  'flags',
  'flagIdeas',
  'pots',
  'profiles',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/** Remember a deletion so sync can propagate it instead of resurrecting the record from another device. */
export async function recordDeletion(table: SyncTable, ids: string[]): Promise<void> {
  if (!ids.length) return
  const at = nowISO()
  await db.tombstones.bulkPut(ids.map((recordId) => ({ id: `${table}:${recordId}`, table, recordId, deletedAt: at })))
}

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
  { slug: 'transfer', name: 'Transfer', emoji: '🔄', color: CATEGORY_COLORS.slate, kind: 'transfer' },
  { slug: 'card-payment', name: 'Card payment', emoji: '💳', color: CATEGORY_COLORS.slate, kind: 'transfer' },
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
  transfer: 'cat_transfer',
  cardPayment: 'cat_card-payment',
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

const TRANSFER_CATEGORIES: Category[] = makeCategories().filter((c) => c.kind === 'transfer')

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
    autoLockDelay: 0,
    lockOnBlur: false,
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

/* ---------------------------- currency profiles ---------------------------- */

export async function listCurrencyProfiles(): Promise<CurrencyProfile[]> {
  const rows = await db.currencyProfiles.toArray()
  if (rows.length) return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  const settings = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const at = nowISO()
  const base: CurrencyProfile = {
    id: uid('cp_'),
    name: settings.currency,
    code: settings.currency,
    emoji: '🏠',
    isBase: true,
    isDefault: true,
    fxToBase: 1,
    createdAt: at,
    updatedAt: at,
  }
  await db.currencyProfiles.put(base)
  return [base]
}

export async function saveCurrencyProfile(profile: CurrencyProfile): Promise<void> {
  await db.currencyProfiles.put({ ...profile, updatedAt: nowISO() })
}

export async function deleteCurrencyProfile(id: string): Promise<void> {
  const all = await db.currencyProfiles.toArray()
  if (all.length <= 1) throw new Error('Keep at least one currency profile')
  const prof = all.find((p) => p.id === id)
  if (prof?.isBase) throw new Error('Cannot delete the base currency profile')
  const def = all.find((p) => p.isDefault && p.id !== id) || all.find((p) => p.id !== id)
  if (!def) return
  await recordDeletion('currencyProfiles', [id])
  await db.transaction('rw', [db.currencyProfiles, db.transactions, db.bills, db.billPayments, db.investments, db.investmentTxs], async () => {
    await db.currencyProfiles.delete(id)
    await db.transactions.where('profileId').equals(id).modify({ profileId: def.id, updatedAt: nowISO() })
    await db.bills.where('profileId').equals(id).modify({ profileId: def.id, updatedAt: nowISO() })
    await db.billPayments.where('profileId').equals(id).modify({ profileId: def.id, updatedAt: nowISO() })
    await db.investments.where('profileId').equals(id).modify({ profileId: def.id, updatedAt: nowISO() })
    await db.investmentTxs.where('profileId').equals(id).modify({ profileId: def.id, updatedAt: nowISO() })
  })
}

export async function setDefaultCurrencyProfile(id: string): Promise<void> {
  const all = await db.currencyProfiles.toArray()
  await db.currencyProfiles.bulkPut(
    all.map((p) => ({ ...p, isDefault: p.id === id, updatedAt: nowISO() })),
  )
}

/* ---------------------------------- investments ---------------------------- */

export async function addInvestment(input: Partial<Investment> & { name: string; profileId: string; type: Investment['type'] }): Promise<Investment> {
  const at = nowISO()
  const inv: Investment = {
    id: input.id ?? uid('inv_'),
    profileId: input.profileId,
    currency: input.currency || (await db.currencyProfiles.get(input.profileId))?.code || 'USD',
    type: input.type,
    symbol: input.symbol?.toUpperCase(),
    name: input.name,
    account: input.account,
    qty: input.qty ?? 0,
    avgCost: input.avgCost ?? 0,
    fees: input.fees ?? 0,
    notes: input.notes,
    openedAt: input.openedAt,
    archived: false,
    createdAt: at,
    updatedAt: at,
  }
  await db.investments.put(inv)
  return inv
}

export async function updateInvestment(id: string, patch: Partial<Investment>): Promise<void> {
  const ex = await db.investments.get(id)
  if (!ex) return
  await db.investments.put({ ...ex, ...patch, id, updatedAt: nowISO() })
}

export async function deleteInvestment(id: string): Promise<void> {
  const txIds = (await db.investmentTxs.where('investmentId').equals(id).primaryKeys()) as string[]
  await recordDeletion('investments', [id])
  await recordDeletion('investmentTxs', txIds)
  await db.transaction('rw', [db.investments, db.investmentTxs], async () => {
    await db.investments.delete(id)
    await db.investmentTxs.where('investmentId').equals(id).delete()
  })
}

export async function addInvestmentTx(input: Omit<InvestmentTx, 'id' | 'createdAt'> & { id?: string }): Promise<InvestmentTx> {
  const tx: InvestmentTx = {
    id: input.id ?? uid('itx_'),
    investmentId: input.investmentId,
    profileId: input.profileId,
    type: input.type,
    date: input.date,
    qty: input.qty,
    price: input.price,
    amount: input.amount,
    currency: input.currency,
    fxRate: input.fxRate ?? 1,
    baseAmount: input.baseAmount,
    fees: input.fees,
    note: input.note,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  await db.investmentTxs.put(tx)
  return tx
}

export async function deleteInvestmentTx(id: string): Promise<void> {
  await recordDeletion('investmentTxs', [id])
  await db.investmentTxs.delete(id)
}

/* -------------------------------- settings --------------------------------- */

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const at = nowISO()
  const touchesShared = SHARED_SETTING_KEYS.some((k) => k in patch && patch[k] !== current[k])
  const next: Settings = {
    ...current,
    ...patch,
    id: 'settings',
    updatedAt: at,
    ...(touchesShared ? { sharedUpdatedAt: at } : {}),
  }
  await db.settings.put(next)
  return next
}

export async function setWidgetOrder(order: WidgetId[]): Promise<void> {
  await updateSettings({ dashboardWidgets: order })
}

/* -------------------------------- categories ------------------------------- */

export async function saveCategory(category: Category): Promise<void> {
  await db.categories.put({ ...category, updatedAt: nowISO() })
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
        categoryId:
          t.categoryId === id
            ? t.type === 'income'
              ? DEFAULT_CATEGORY_IDS.otherIncome
              : t.type === 'transfer'
                ? DEFAULT_CATEGORY_IDS.transfer
                : fallback
            : t.categoryId,
        updatedAt: nowISO(),
      })),
    )
  }
  const budgetIds = (await db.budgets.where('categoryId').equals(id).primaryKeys()) as string[]
  // Group budgets lose the category; a group left with nothing to count is removed with it.
  const groups = await db.budgets.where('categoryId').equals('group').toArray()
  for (const g of groups) {
    if (!g.categoryIds?.includes(id)) continue
    const left = g.categoryIds.filter((c) => c !== id)
    if (left.length) await db.budgets.put({ ...g, categoryIds: left, updatedAt: nowISO() })
    else budgetIds.push(g.id)
  }
  await recordDeletion('budgets', budgetIds)
  await recordDeletion('categories', [id])
  await db.budgets.bulkDelete(budgetIds)
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
  refundOf?: string
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
    refundOf: input.refundOf,
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
    refundOf: input.refundOf ?? existing.refundOf,
    updatedAt: nowISO(),
  })
}

/** You confirmed two similar transactions are both real; never flag this pair again (syncs). */
export async function markNotDuplicate(aId: string, bId: string): Promise<void> {
  const [a, b] = await db.transactions.bulkGet([aId, bId])
  const at = nowISO()
  const put: Txn[] = []
  if (a) put.push({ ...a, notDuplicateOf: [...new Set([...(a.notDuplicateOf ?? []), bId])], updatedAt: at })
  if (b) put.push({ ...b, notDuplicateOf: [...new Set([...(b.notDuplicateOf ?? []), aId])], updatedAt: at })
  if (put.length) await db.transactions.bulkPut(put)
}

/** Record money back for an expense (full or partial return). Same category, so it reduces that spending. */
export async function addRefund(
  original: Txn,
  opts: { amountMinor: number; date: ISODate; note?: string; merchant?: string },
  baseCurrency: string,
): Promise<Txn> {
  return addTransaction(
    {
      date: opts.date,
      amount: opts.amountMinor,
      currency: original.currency,
      // Same rate as the purchase so a full refund cancels it exactly in your base currency.
      fxRate: original.fxRate,
      type: 'refund',
      categoryId: original.categoryId,
      merchant: opts.merchant ?? original.merchant,
      note: opts.note,
      source: 'manual',
      categorySource: 'manual',
      refundOf: original.id,
    },
    baseCurrency,
  )
}

export async function deleteTransaction(id: string): Promise<void> {
  await recordDeletion('transactions', [id])
  await db.transactions.delete(id)
  // A bill payment pointing at this transaction no longer has one.
  const linked = await db.billPayments.filter((p) => p.txnId === id).toArray()
  if (linked.length) await db.billPayments.bulkPut(linked.map((p) => ({ ...p, txnId: undefined, updatedAt: nowISO() })))
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
  split?: Bill['split'] | null
}

/** The split partner's share of one payment, in the bill's minor units. */
export function splitShare(bill: Pick<Bill, 'split'>, amountMinor: number): number {
  const s = bill.split
  if (!s || !(s.value > 0)) return 0
  return s.mode === 'percent' ? Math.round((amountMinor * Math.min(100, s.value)) / 100) : Math.min(amountMinor, s.value)
}

function splitFields(bill: Bill, amountMinor: number): Pick<BillPayment, 'splitAmount' | 'splitName'> {
  const share = splitShare(bill, amountMinor)
  return share ? { splitAmount: share, splitName: bill.split?.name } : {}
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
    split: input.split ?? undefined,
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
      updatedAt: at,
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
    split: input.split === undefined ? existing.split : (input.split ?? undefined),
    updatedAt: nowISO(),
  })
}

export async function deleteBill(id: string): Promise<void> {
  const paymentIds = (await db.billPayments.where('billId').equals(id).primaryKeys()) as string[]
  await recordDeletion('bills', [id])
  await recordDeletion('billPayments', paymentIds)
  await db.bills.delete(id)
  await db.billPayments.bulkDelete(paymentIds)
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
    ...splitFields(bill, amount),
    createdAt: at,
    updatedAt: at,
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
  if (deleteTxn && p.txnId) {
    await recordDeletion('transactions', [p.txnId])
    await db.transactions.delete(p.txnId)
  }
  await recordDeletion('billPayments', [id])
  await db.billPayments.delete(id)
}

/* ---------------------------------- budgets -------------------------------- */

export interface BudgetInput {
  categoryId: string
  categoryIds?: string[]
  name?: string
  emoji?: string
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
    ...(input.categoryId === 'group'
      ? { categoryIds: [...new Set(input.categoryIds ?? [])], name: input.name?.trim() || undefined, emoji: input.emoji?.trim() || undefined }
      : {}),
    amount: Math.max(0, input.amount),
    rollover: input.rollover,
    period: input.period,
    archived: false,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  })
}

export async function deleteBudget(id: string): Promise<void> {
  await recordDeletion('budgets', [id])
  await db.budgets.delete(id)
}

/* ----------------------------------- pots ---------------------------------- */

export type PotInput = Omit<Pot, 'id' | 'createdAt' | 'updatedAt'>

export async function savePot(input: PotInput, id?: string): Promise<string> {
  const existing = id ? await db.pots.get(id) : undefined
  const at = nowISO()
  const pot: Pot = {
    ...input,
    id: id ?? uid('pot_'),
    name: input.name.trim() || 'Savings pot',
    target: Math.max(0, Math.round(input.target)),
    perCycle: Math.max(1, Math.round(input.perCycle)),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  }
  await db.pots.put(pot)
  return pot.id
}

/** Link (or unlink, with null) purchases to a pot. */
export async function setTxnPot(txnIds: string[], potId: string | null): Promise<void> {
  const txns = (await db.transactions.bulkGet(txnIds)).filter((t): t is Txn => Boolean(t))
  const at = nowISO()
  await db.transactions.bulkPut(txns.map((t) => ({ ...t, potId: potId ?? undefined, updatedAt: at })))
}

/** Removes the pot; its purchases stay and count against their cycle's budget again. */
export async function deletePot(id: string): Promise<void> {
  const linked = await db.transactions.filter((t) => t.potId === id).primaryKeys()
  await setTxnPot(linked as string[], null)
  await recordDeletion('pots', [id])
  await db.pots.delete(id)
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
  await recordDeletion('rules', [id])
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
  await recordDeletion('profiles', [id])
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

/** Every table that holds user data. Backups, restores and wipes must cover all of them. */
const DATA_TABLES = [
  'profiles',
  'categories',
  'transactions',
  'bills',
  'billPayments',
  'budgets',
  'rules',
  'currencyProfiles',
  'investments',
  'investmentTxs',
  'investmentTransfers',
  'flags',
  'flagIdeas',
  'pots',
] as const
type DataTable = (typeof DATA_TABLES)[number]

function table(name: DataTable): Table<{ id: string }, string> {
  return db.table(name) as unknown as Table<{ id: string }, string>
}

export async function buildBackup(): Promise<BackupFile> {
  const settings = await db.settings.get('settings')
  const entries = await Promise.all(DATA_TABLES.map(async (name) => [name, await table(name).toArray()] as const))
  const data = Object.fromEntries(entries) as unknown as Omit<BackupFile['data'], 'settings'>
  return {
    app: 'monetr',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    data: { settings: settings ?? makeDefaultSettings(), ...data },
  }
}

export async function exportBackup(): Promise<void> {
  const backup = await buildBackup()
  await setMeta('lastBackupAt', nowISO())
  downloadFile(`monetr-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2))
}

/** Device-local settings (lock, PIN, fingerprint) are never taken from a backup. */
function withLocalSettings(incoming: Settings, current: Settings): Settings {
  return {
    ...makeDefaultSettings(),
    ...incoming,
    lockEnabled: current.lockEnabled,
    pinHash: current.pinHash,
    pinSalt: current.pinSalt,
    autoLockDelay: current.autoLockDelay,
    lockOnBlur: current.lockOnBlur,
    biometricCredentialId: current.biometricCredentialId,
    biometricPublicKey: current.biometricPublicKey,
    biometricAlg: current.biometricAlg,
    pinFailCount: 0,
    pinLockedUntil: undefined,
    schemaVersion: SCHEMA_VERSION,
    onboarded: true,
  }
}

export async function importBackup(backup: BackupFile, mode: 'replace' | 'merge'): Promise<{ added: number }> {
  if (backup?.app !== 'monetr' || !backup.data) {
    throw new Error('That file is not a Monetr backup.')
  }
  const d = backup.data as unknown as Record<string, { id: string }[] | undefined> & { settings?: Settings }
  const current = (await db.settings.get('settings')) ?? makeDefaultSettings()

  if (mode === 'replace') {
    await db.transaction('rw', [db.settings, db.tombstones, ...DATA_TABLES.map(table)], async () => {
      await Promise.all(DATA_TABLES.map((name) => table(name).clear()))
      await db.tombstones.clear()
      await db.settings.put(withLocalSettings(d.settings ?? makeDefaultSettings(), current))
      for (const name of DATA_TABLES) {
        const rows = d[name]
        if (rows?.length) await table(name).bulkPut(rows)
      }
      if (!d.categories?.length) await db.categories.bulkPut(makeCategories())
    })
    return { added: (d.transactions ?? []).length }
  }

  let added = 0
  for (const name of DATA_TABLES) {
    const rows = d[name]
    if (!rows?.length) continue
    const existing = await table(name).bulkGet(rows.map((r) => r.id))
    const fresh = rows.filter((_, i) => !existing[i])
    if (fresh.length) await table(name).bulkPut(fresh)
    added += fresh.length
  }
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

/** Factory reset of this device. Sync is unlinked by the caller so nothing is deleted on other devices. */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', [db.settings, db.meta, db.aiLog, db.tombstones, db.imports, ...DATA_TABLES.map(table)], async () => {
    await Promise.all([...DATA_TABLES.map((name) => table(name).clear()), db.meta.clear(), db.aiLog.clear(), db.tombstones.clear(), db.imports.clear()])
    await db.categories.bulkPut(makeCategories())
    await db.settings.clear()
    await db.settings.put({ ...makeDefaultSettings(), onboarded: false })
  })
}

/** Re-label stored base amounts after the base currency changes. */
export async function changeBaseCurrency(newCode: string): Promise<void> {
  const settings = (await db.settings.get('settings')) ?? makeDefaultSettings()
  const oldCode = settings.currency
  if (oldCode === newCode) return
  const factor = minorFactor(newCode) / minorFactor(oldCode)
  const at = nowISO()

  const [txns, bills, payments, budgets, invTxs, currencyProfiles, pots] = await Promise.all([
    db.transactions.toArray(),
    db.bills.toArray(),
    db.billPayments.toArray(),
    db.budgets.toArray(),
    db.investmentTxs.toArray(),
    db.currencyProfiles.toArray(),
    db.pots.toArray(),
  ])

  // Anything already recorded in the new base currency is now 1:1.
  const rebase = <T extends { amount: number; currency: string; fxRate: number }>(r: T): T & { baseAmount: number } => {
    const fxRate = r.currency === newCode ? 1 : r.fxRate
    return { ...r, fxRate, baseAmount: toBaseMinor(r.amount, r.currency, fxRate, newCode) }
  }

  await db.transaction(
    'rw',
    [db.transactions, db.bills, db.billPayments, db.budgets, db.settings, db.investmentTxs, db.currencyProfiles, db.pots],
    async () => {
      await db.pots.bulkPut(pots.map((p) => ({ ...p, target: Math.round(p.target * factor), perCycle: Math.round(p.perCycle * factor), updatedAt: at })))
      await db.transactions.bulkPut(txns.map((t) => ({ ...rebase(t), updatedAt: at })))
      await db.bills.bulkPut(bills.map((b) => ({ ...rebase(b), updatedAt: at })))
      await db.billPayments.bulkPut(payments.map((p) => ({ ...rebase(p), updatedAt: at })))
      await db.investmentTxs.bulkPut(invTxs.map((t) => ({ ...rebase(t), updatedAt: at })))
      await db.budgets.bulkPut(budgets.map((b) => ({ ...b, amount: Math.round(b.amount * factor), updatedAt: at })))
      await db.currencyProfiles.bulkPut(
        currencyProfiles.map((p) =>
          p.isBase
            ? { ...p, code: newCode, name: p.name === oldCode ? newCode : p.name, fxToBase: 1, updatedAt: at }
            : p.code === newCode
              ? { ...p, fxToBase: 1, updatedAt: at }
              : p,
        ),
      )
      await db.settings.put({
        ...settings,
        currency: newCode,
        monthlyAllowance: Math.round(settings.monthlyAllowance * factor),
        updatedAt: at,
        sharedUpdatedAt: at,
      })
    },
  )
}

/* ---------------------------------- splits --------------------------------- */

/**
 * The split partner paid you back. Recorded as a refund in the bill's category, so your own spend
 * on that bill drops to your share.
 */
export async function collectSplit(paymentId: string, baseCurrency: string, amountMinor?: number): Promise<void> {
  const p = await db.billPayments.get(paymentId)
  if (!p || !p.splitAmount || p.splitCollectedAt) return
  const bill = await db.bills.get(p.billId)
  const amount = amountMinor ?? p.splitAmount
  const at = nowISO()
  const txn = await addTransaction(
    {
      date: todayISO(),
      amount,
      currency: p.currency,
      fxRate: p.fxRate,
      type: 'refund',
      categoryId: bill?.categoryId ?? DEFAULT_CATEGORY_IDS.other,
      merchant: p.splitName ?? 'Split',
      note: `Share of ${bill?.name ?? 'bill'} (${p.paidDate})`,
      source: 'bill',
      categorySource: 'manual',
      refundOf: p.txnId,
    },
    baseCurrency,
  )
  await db.billPayments.put({ ...p, splitCollectedAt: at, splitTxnId: txn.id, updatedAt: at })
}

/** Nothing to collect for this payment (e.g. they paid the provider directly). */
export async function waiveSplit(paymentId: string): Promise<void> {
  const p = await db.billPayments.get(paymentId)
  if (!p) return
  await db.billPayments.put({ ...p, splitAmount: 0, updatedAt: nowISO() })
}

/* --------------------------------- autopay --------------------------------- */

let reconciling: Promise<number> | null = null

/**
 * Autopay bills are paid by the bank on their due date, so record those payments (and the matching
 * expense) automatically instead of letting the bill show as overdue. Each one is flagged for the
 * user to confirm the deducted amount. Ids are deterministic, so running this twice (or on two
 * synced devices) never double-records a payment.
 */
export function reconcileAutopay(baseCurrency: string, today: ISODate = todayISO()): Promise<number> {
  if (reconciling) return reconciling
  reconciling = (async () => {
    let created = 0
    const [bills, payments, tombstones] = await Promise.all([
      db.bills.toArray(),
      db.billPayments.toArray(),
      db.tombstones.where('table').equals('billPayments').primaryKeys(),
    ])
    const deleted = new Set((tombstones as string[]).map((k) => k.slice('billPayments:'.length)))
    const all = [...payments]
    for (const bill of bills) {
      if (!bill.autoPay || !bill.active || bill.archived) continue
      for (let guard = 0; guard < 24; guard++) {
        const schedule = predictBill(bill, all, today)
        if (!schedule.nextDue || schedule.nextDue > today) break
        const due = schedule.nextDue
        const paymentId = `bp_auto_${bill.id}_${due}`
        // The user removed this auto payment — respect that and leave the bill overdue.
        if (deleted.has(paymentId) || all.some((p) => p.id === paymentId)) break
        const at = nowISO()
        // Always record autopay as its own entry. If you also logged it yourself, the duplicate check
        // flags the pair and you decide which to keep — nothing is merged or removed automatically.
        const txnId = `t_auto_${bill.id}_${due}`
        await db.transactions.put({
          id: txnId,
          date: due,
          amount: bill.amount,
          currency: bill.currency,
          fxRate: bill.fxRate,
          baseAmount: toBaseMinor(bill.amount, bill.currency, bill.fxRate, baseCurrency),
          type: 'expense',
          categoryId: bill.categoryId,
          merchant: bill.merchant || bill.name,
          note: 'Autopay · check the deducted amount',
          source: 'bill',
          categorySource: 'manual',
          createdAt: at,
          updatedAt: at,
        })
        const payment: BillPayment = {
          id: paymentId,
          billId: bill.id,
          paidDate: due,
          currency: bill.currency,
          fxRate: bill.fxRate,
          amount: bill.amount,
          baseAmount: toBaseMinor(bill.amount, bill.currency, bill.fxRate, baseCurrency),
          txnId,
          autoRecorded: true,
          verified: false,
          ...splitFields(bill, bill.amount),
          createdAt: at,
          updatedAt: at,
        }
        await db.billPayments.put(payment)
        all.push(payment)
        created++
      }
    }
    return created
  })().finally(() => {
    reconciling = null
  })
  return reconciling
}

/** Confirm (optionally correcting) the amount an autopay actually took. */
export async function verifyPayment(id: string, baseCurrency: string, amountMinor?: number): Promise<void> {
  const p = await db.billPayments.get(id)
  if (!p) return
  const at = nowISO()
  const amount = amountMinor ?? p.amount
  const baseAmount = toBaseMinor(amount, p.currency, p.fxRate, baseCurrency)
  const bill = await db.bills.get(p.billId)
  const resplit = bill && !p.splitCollectedAt ? splitFields(bill, amount) : {}
  await db.billPayments.put({ ...p, amount, baseAmount, ...resplit, verified: true, updatedAt: at })
  if (p.txnId) {
    const t = await db.transactions.get(p.txnId)
    if (t) {
      await db.transactions.put({
        ...t,
        amount,
        baseAmount,
        note: amount === p.amount ? 'Autopay · verified' : 'Autopay · amount corrected',
        updatedAt: at,
      })
    }
  }
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
  downloadFile(`monetr-transactions-${todayISO()}.csv`, csv, 'text/csv')
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
    'PRODID:-//Monetr//Bills//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Monetr bills',
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
      `UID:${bill.id}@monetr`,
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
  downloadFile(`monetr-bills-${today}.ics`, lines.join('\r\n'), 'text/calendar')
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
  push(addDays(today, -9), 'Uniqlo', 'cat_shopping', 89.9, 'expense', 'Jacket + 2 tees')
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
    // Anchor where the payment history starts so quarterly bills line up with their payments.
    const anchor = addMonths(today, def.frequency === 'quarterly' ? -3 : -4)
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
      split: def.name === 'Rent' ? { name: 'Roommate', mode: 'percent', value: 50 } : undefined,
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
        updatedAt: at,
      })
    }
  }

  // Budgets
  const budgets: Budget[] = [
    { id: uid('demo_bg_'), categoryId: 'all', amount: Math.round(2600 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_groceries', amount: Math.round(520 * unit), rollover: true, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_transport', amount: Math.round(180 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'group', categoryIds: ['cat_dining', 'cat_shopping'], name: 'Fun money', emoji: '🛍️', amount: Math.round(480 * unit), rollover: true, period: 'cycle', createdAt: at, updatedAt: at },
    { id: uid('demo_bg_'), categoryId: 'cat_subscriptions', amount: Math.round(120 * unit), rollover: false, period: 'cycle', createdAt: at, updatedAt: at },
  ]

  // Show off a partial refund in the demo.
  const uniqlo = txns.find((t) => t.merchant === 'Uniqlo')
  if (uniqlo) {
    const back = Math.round(29.9 * unit)
    txns.push({ ...uniqlo, id: uid('demo_t_'), date: addDays(today, -4), amount: back, baseAmount: back, type: 'refund', refundOf: uniqlo.id, note: 'Returned the tees' })
  }

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
  const demo = (rows: { id: string }[]) => rows.filter((r) => r.id.startsWith('demo_')).map((r) => r.id)
  const [txns, bills, payments, budgets] = await Promise.all([
    db.transactions.toArray(),
    db.bills.toArray(),
    db.billPayments.toArray(),
    db.budgets.toArray(),
  ])
  // Auto-recorded autopay entries for demo bills are demo data too.
  const demoBillIds = new Set(demo(bills))
  const autoPayments = payments.filter((p) => demoBillIds.has(p.billId) && !p.id.startsWith('demo_'))
  const ids = {
    transactions: [...demo(txns), ...autoPayments.map((p) => p.txnId).filter((x): x is string => Boolean(x))],
    bills: demo(bills),
    billPayments: [...demo(payments), ...autoPayments.map((p) => p.id)],
    budgets: demo(budgets),
  }
  await db.transaction('rw', [db.transactions, db.bills, db.billPayments, db.budgets, db.tombstones], async () => {
    for (const [name, list] of Object.entries(ids) as [SyncTable, string[]][]) await recordDeletion(name, list)
    await db.transactions.bulkDelete(ids.transactions)
    await db.bills.bulkDelete(ids.bills)
    await db.billPayments.bulkDelete(ids.billPayments)
    await db.budgets.bulkDelete(ids.budgets)
  })
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const est = await navigator.storage.estimate()
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
}

export { toMinor, toBaseMinor, median, toISO }
