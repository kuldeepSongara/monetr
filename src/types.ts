export type ISODate = string

export type ProviderId =
  | 'google'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'xai'
  | 'together'
  | 'cerebras'
  | 'ollama'
  | 'custom'

export type ThemeMode = 'system' | 'light' | 'dark'

export type WidgetId = 'safe' | 'alerts' | 'trend' | 'categories' | 'budgets' | 'bills' | 'recent'

/** Seconds the app may stay hidden before it locks. 0 = lock the moment it is hidden. */
export type AutoLockDelay = 0 | 30 | 60 | 300

export interface Settings {
  id: 'settings'
  onboarded: boolean
  currency: string
  theme: ThemeMode
  accent: string
  weekStart: 0 | 1
  /** Day of month your pay cycle starts on (1-28). */
  payCycleStartDay: number
  /** Optional fallback monthly spending allowance in base minor units. 0 = unset. */
  monthlyAllowance: number
  defaultBillLeadDays: number
  notifications: boolean

  /* ---- lock (device-local, never synced) ---- */
  lockEnabled: boolean
  pinHash?: string
  pinSalt?: string
  autoLockDelay?: AutoLockDelay
  /** Also lock when the window loses focus (e.g. switching apps on a laptop). */
  lockOnBlur?: boolean
  /** WebAuthn platform credential used for fingerprint / Touch ID unlock. */
  biometricCredentialId?: string
  biometricPublicKey?: string
  biometricAlg?: number
  pinFailCount?: number
  pinLockedUntil?: string

  activeProfileId?: string
  failoverEnabled: boolean
  autoSwitchActive: boolean
  dashboardWidgets: WidgetId[]
  schemaVersion: number
  /** When a recovery kit was last created (on any linked device). */
  recoveryKitAt?: string
  /** Last time a setting that syncs across devices changed. */
  sharedUpdatedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * Settings that follow you across linked devices — set things up once on the laptop and the phone
 * matches. Only things tied to one device's hardware or browser stay local: the fingerprint key,
 * wrong-PIN counters, notification permission and onboarding state.
 */
export const SHARED_SETTING_KEYS = [
  'currency',
  'weekStart',
  'payCycleStartDay',
  'monthlyAllowance',
  'defaultBillLeadDays',
  'theme',
  'accent',
  'dashboardWidgets',
  'lockEnabled',
  'pinHash',
  'pinSalt',
  'autoLockDelay',
  'lockOnBlur',
  'activeProfileId',
  'failoverEnabled',
  'autoSwitchActive',
  'recoveryKitAt',
] as const satisfies readonly (keyof Settings)[]

export interface ProfileHealth {
  status: 'unknown' | 'ok' | 'error'
  message?: string
  checkedAt?: string
  latencyMs?: number
}

export interface AIProfile {
  id: string
  name: string
  provider: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  /** Tried in order with the same key when `model` is overloaded or out of quota. */
  fallbackModels?: string[]
  enabled: boolean
  priority: number
  temperature?: number
  maxTokens?: number
  extraHeaders?: Record<string, string>
  health?: ProfileHealth
  createdAt: string
  updatedAt: string
}

export type CategoryKind = 'expense' | 'income' | 'transfer'

export interface Category {
  id: string
  name: string
  emoji: string
  color: string
  kind: CategoryKind
  order: number
  archived?: boolean
  updatedAt?: string
}

/**
 * `transfer` = money moving between your own accounts (card payments, savings) — never spend or income.
 * `refund` = money back for an expense (a return, or a roommate paying their share); it reduces
 * spending in the same category instead of counting as income.
 */
export type TxnType = 'expense' | 'income' | 'transfer' | 'refund'

export type CategorySource = 'manual' | 'ai' | 'rule' | 'default'

export interface Txn {
  id: string
  date: ISODate
  /** Amount in minor units of `currency`. */
  amount: number
  currency: string
  /** Units of base currency per 1 unit of `currency`. */
  fxRate: number
  /** Amount in minor units of the base currency at entry time. */
  baseAmount: number
  profileId?: string
  type: TxnType
  categoryId: string
  merchant: string
  note?: string
  tags?: string[]
  source: 'manual' | 'ai' | 'receipt' | 'import' | 'bill'
  categorySource: CategorySource
  /** For refunds: the expense this money came back for. */
  refundOf?: string
  /** Transactions you confirmed are separate real payments, not duplicates of this one. */
  notDuplicateOf?: string[]
  /** Paid from a savings pot: counted in history and charts, but not against the cycle budget. */
  potId?: string
  createdAt: string
  updatedAt: string
}

/** Someone (e.g. a roommate) who pays part of a bill back to you. */
export interface BillSplit {
  name: string
  mode: 'percent' | 'amount'
  /** Percent (0-100) or a fixed amount in the bill's minor units. */
  value: number
}

export type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

export interface Bill {
  id: string
  name: string
  merchant?: string
  categoryId: string
  /** For bills whose amount changes (electricity, water): `amount` is only an estimate and may be 0. */
  variable?: boolean
  amount: number
  currency: string
  fxRate: number
  baseAmount: number
  profileId?: string
  frequency: BillFrequency
  /** Only for frequency = custom. */
  intervalDays?: number
  /** Preferred day of month for monthly/quarterly/yearly bills. */
  dueDay?: number
  /** First known payment / start date. */
  anchorDate: ISODate
  autoPay: boolean
  leadDays: number
  active: boolean
  notes?: string
  split?: BillSplit
  /** When the amount was last edited — newer than the last payment means it's the amount to expect. */
  amountChangedAt?: string
  snoozedUntil?: ISODate
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface BillPayment {
  id: string
  billId: string
  paidDate: ISODate
  amount: number
  currency: string
  fxRate: number
  baseAmount: number
  profileId?: string
  txnId?: string
  note?: string
  /** Recorded automatically for an autopay bill on its due date. */
  autoRecorded?: boolean
  /** The date is known but not the amount (a variable bill's past payment you didn't note). */
  amountUnknown?: boolean
  /** For auto-recorded payments: the user confirmed the deducted amount. */
  verified?: boolean
  /** Share owed back by the bill's split partner for this payment (bill minor units). */
  splitAmount?: number
  splitName?: string
  splitCollectedAt?: string
  /** The refund transaction recorded when the share was collected. */
  splitTxnId?: string
  createdAt: string
  updatedAt?: string
}

export interface Budget {
  id: string
  /** Category id, `all` for the whole budget, or `group` for a budget shared by `categoryIds`. */
  categoryId: string
  /** Group budgets only: the categories that share this limit (e.g. Shopping + Dining). */
  categoryIds?: string[]
  /** Group budgets only. */
  name?: string
  emoji?: string
  amount: number
  rollover: boolean
  period: 'cycle' | 'weekly'
  archived?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * A savings pot for one-time purchases (laptop, phone…).
 * `save`: set money aside each pay cycle before buying. `payback`: you already bought it, and the
 * pot starts below zero and is filled back from future cycles. Either way the purchase is paid
 * from the pot instead of the budget of the cycle it landed in, and the pot's per-cycle amount is
 * held back from safe-to-spend.
 */
export interface Pot {
  id: string
  name: string
  emoji?: string
  kind: 'save' | 'payback'
  /** Save pots: the goal, base minor units. Payback pots: 0 (the goal is what was spent). */
  target: number
  /** Set aside each pay cycle, base minor units. */
  perCycle: number
  /** Setting aside starts in the pay cycle that contains this date. */
  startDate: ISODate
  /** Already set aside before `startDate` (kept when the per-cycle amount is changed later). */
  carried?: number
  /** Save pots: when you want to buy. */
  targetDate?: ISODate
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export interface Rule {
  id: string
  merchant: string
  categoryId: string
  hits: number
  updatedAt: string
}

export interface AILogEntry {
  id: string
  at: string
  task: string
  profileId: string
  profileName: string
  provider: string
  model: string
  ok: boolean
  ms: number
  error?: string
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface Tombstone {
  /** `${table}:${recordId}` */
  id: string
  table: string
  recordId: string
  deletedAt: string
}

export interface DigestCache {
  text: string
  at: string
  rangeStart: ISODate
  rangeEnd: ISODate
  profileName?: string
}

export type AnomalyKind = 'category-spike' | 'merchant-spike' | 'duplicate' | 'large'
export type Severity = 'low' | 'medium' | 'high'

export interface Anomaly {
  id: string
  kind: AnomalyKind
  severity: Severity
  title: string
  detail: string
  amount: number
  date?: ISODate
  categoryId?: string
}

export interface SubscriptionCandidate {
  id: string
  merchant: string
  occurrences: number
  avgAmount: number
  monthlyAmount: number
  lastDate: ISODate
  intervalDays: number
  priceChangePct: number
  categoryId?: string
}

export interface SubscriptionVerdict {
  id: string
  verdict: 'keep' | 'review' | 'cancel'
  reason: string
}

export interface AIAttempt {
  profileId: string
  profileName: string
  provider: string
  model: string
  ok: boolean
  error?: string
  ms: number
}

export interface CurrencyProfile {
  id: string
  name: string
  code: string
  country?: string
  emoji?: string
  isBase: boolean
  isDefault: boolean
  /** Units of base currency per 1 unit of `code`. */
  fxToBase: number
  updatedAt: string
  createdAt: string
}

export type InvestmentType = 'stock' | 'etf' | 'mutualfund' | 'crypto' | 'fd' | 'bond' | 'other'

export interface Investment {
  id: string
  profileId: string
  currency: string
  type: InvestmentType
  symbol?: string
  name: string
  account?: string
  /** Legacy fields; holdings are now derived from transactions. */
  qty: number
  avgCost: number
  fees?: number
  /** Latest known price per unit, minor units of `currency`. */
  currentPrice?: number
  /** Latest known total value (for FDs, cash and other non-unit holdings), minor units of `currency`. */
  currentValue?: number
  priceUpdatedAt?: string
  notes?: string
  openedAt?: ISODate
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export type InvestmentTxType = 'buy' | 'sell' | 'dividend' | 'fee' | 'interest' | 'transfer'

export interface InvestmentTx {
  id: string
  investmentId: string
  profileId: string
  type: InvestmentTxType
  date: ISODate
  qty?: number
  /** Price per unit, minor units of `currency`. */
  price?: number
  amount: number
  currency: string
  fxRate: number
  baseAmount: number
  fees?: number
  note?: string
  createdAt: string
  updatedAt?: string
}

export interface InvestmentTransfer {
  id: string
  type: string
  date: ISODate
  fromProfileId: string
  fromCurrency: string
  fromInvestmentId?: string
  fromAmount: number
  toProfileId: string
  toCurrency: string
  toInvestmentId?: string
  toAmount: number
  /** Rate the bank actually used: units of `toCurrency` per 1 `fromCurrency`. */
  fxRate: number
  fees: number
  feeCurrency: string
  feeBaseAmount: number
  note?: string
  linkedTxIds: string[]
  createdAt: string
  updatedAt?: string
}

export interface FlagEntry {
  id: string
  kind: 'weekly' | 'habits'
  status: 'open' | 'done'
  title: string
  body: string
  createdAt: string
  updatedAt?: string
}

export interface FlagIdea {
  id: string
  status: 'open' | 'bought' | 'skipped'
  title: string
  price: string
  url: string
  notes: string
  analysis: string
  createdAt: string
  updatedAt?: string
}

/** One line of a statement waiting for your review. */
export interface ImportLine {
  key: string
  date: string
  merchant: string
  amount: number
  currency: string
  type: 'expense' | 'income' | 'transfer' | 'refund'
  categoryId: string
  note?: string
  confidence: number
  include: boolean
  duplicateOf?: string
}

/**
 * A statement import, kept in IndexedDB so it survives leaving the screen, the app going to the
 * background, or a reload. Local to this device (not synced).
 */
export interface ImportRecord {
  id: string
  status: 'queued' | 'processing' | 'review' | 'failed' | 'interrupted' | 'imported' | 'discarded'
  fileName?: string
  fileSize?: number
  /** SHA-256 of the file contents — spots the same file uploaded twice. */
  fileHash?: string
  /** Kept until the import is finished so a failed/interrupted read can be retried without re-uploading. */
  source?: { kind: 'image' | 'pdf'; dataUrl: string } | { kind: 'text'; text: string }
  lines?: ImportLine[]
  rates?: Record<string, string>
  error?: string
  /** 'device' = read locally (CSV), otherwise the AI profile that read it. */
  readBy?: string
  count: number
  importedCount?: number
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export interface BackupFile {
  app: 'monetr'
  schemaVersion: number
  exportedAt: string
  data: {
    settings: Settings
    profiles: AIProfile[]
    categories: Category[]
    transactions: Txn[]
    bills: Bill[]
    billPayments: BillPayment[]
    budgets: Budget[]
    rules: Rule[]
    currencyProfiles?: CurrencyProfile[]
    investments?: Investment[]
    investmentTxs?: InvestmentTx[]
    investmentTransfers?: InvestmentTransfer[]
    flags?: FlagEntry[]
    flagIdeas?: FlagIdea[]
    pots?: Pot[]
  }
}
