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
  | 'ollama'
  | 'custom'

export type ThemeMode = 'system' | 'light' | 'dark'

export type WidgetId = 'safe' | 'alerts' | 'trend' | 'categories' | 'budgets' | 'bills' | 'recent'

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
  lockEnabled: boolean
  pinHash?: string
  pinSalt?: string
  activeProfileId?: string
  failoverEnabled: boolean
  autoSwitchActive: boolean
  dashboardWidgets: WidgetId[]
  schemaVersion: number
  createdAt: string
  updatedAt: string
}

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
}

export type TxnType = 'expense' | 'income'
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
  type: TxnType
  categoryId: string
  merchant: string
  note?: string
  tags?: string[]
  source: 'manual' | 'ai' | 'receipt' | 'import' | 'bill'
  categorySource: CategorySource
  createdAt: string
  updatedAt: string
}

export type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

export interface Bill {
  id: string
  name: string
  merchant?: string
  categoryId: string
  amount: number
  currency: string
  fxRate: number
  baseAmount: number
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
  txnId?: string
  note?: string
  createdAt: string
}

export interface Budget {
  id: string
  /** Category id or `all` for the whole budget. */
  categoryId: string
  amount: number
  rollover: boolean
  period: 'cycle' | 'weekly'
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

export interface BackupFile {
  app: 'spendwise'
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
  }
}
