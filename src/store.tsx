import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AILogEntry,
  Pot,
  BudgetCarry,
  CarryPlan,
  AIProfile,
  Bill,
  BillPayment,
  Budget,
  Category,
  CurrencyProfile,
  Investment,
  InvestmentTx,
  Rule,
  Settings,
  Txn,
} from './types'
import {
  ensureSeeded,
  makeDefaultSettings,
  db,
  updateSettings as dbUpdateSettings,
  storageEstimate,
  seedSampleData,
  listCurrencyProfiles,
  reconcileAutopay,
  wipeAll,
  decideOverspend,
} from './db/db'
import { isAutoLockSuspended } from './lib/lockGuard'
import { hashPin, lockoutMs, verifyPin } from './lib/pin'
import { verifyBiometric, type BiometricCredential } from './lib/biometric'
import { mirrorSyncState, requestAutoSync, setSyncState, startAutoSync } from './lib/sync'
import { accentVars } from './lib/theme'
import { makeAdjust, unfundedPots, type OverspendPrompt } from './lib/budgetAdjust'
import { potStatuses, potTxnIds, type PotStatus } from './lib/pots'
import { budgetRows, computeSafeToSpend, detectAnomalies, detectSubscriptions, type AdjustFn, type BudgetRow, type SafeToSpend } from './lib/analytics'
import { predictBill, type BillSchedule } from './lib/bills'
import { findDuplicates, type DuplicatePair } from './lib/duplicates'
import { resumeImports } from './lib/importJobs'
import { addDays, payCycle, shiftPeriod, todayISO } from './lib/dates'
import { computeNudges, type Nudge } from './lib/nudges'
import { deliverDue, publishNudges, registerBackgroundNudges, subscribeMorningPush } from './lib/notify'
import { randomSalt } from './lib/utils'

export interface Toast {
  id: string
  message: string
  kind: 'info' | 'success' | 'error'
}

interface AppState {
  ready: boolean
  settings: Settings
  categories: Category[]
  transactions: Txn[]
  bills: Bill[]
  payments: BillPayment[]
  budgets: Budget[]
  profiles: AIProfile[]
  rules: Rule[]
  logs: AILogEntry[]
  currencyProfiles: CurrencyProfile[]
  investments: Investment[]
  investmentTxs: InvestmentTx[]
  pots: Pot[]
  carries: BudgetCarry[]
}

export type UnlockResult = { ok: true } | { ok: false; retryInMs?: number }

interface StoreValue extends AppState {
  today: string
  categoryMap: Map<string, Category>
  schedules: Map<string, BillSchedule>
  rows: BudgetRow[]
  safe: SafeToSpend
  /** Savings pots with their progress; purchases paid from them skip the cycle budget. */
  potList: PotStatus[]
  /** Transactions minus purchases paid from savings pots — what budgets count. */
  everyday: Txn[]
  /** Deductions (pot contributions, catch-up) for any budget and period — pass to budgetRows. */
  budgetAdjust: AdjustFn
  /** Budgets that went over last cycle and are waiting for you to decide what happens next. */
  overspendPrompts: OverspendPrompt[]
  /** Today's heads-ups (budget pace, bills, summary), most important first. */
  nudges: Nudge[]
  anomalies: ReturnType<typeof detectAnomalies>
  subscriptions: ReturnType<typeof detectSubscriptions>
  /** Possible double entries / double charges, for you to review. Never acted on automatically. */
  duplicates: DuplicatePair[]
  refresh: (opts?: { fromSync?: boolean }) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  notify: (message: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  dismissToast: (id: string) => void
  locked: boolean
  unlock: (pin: string) => Promise<UnlockResult>
  unlockWithBiometric: () => Promise<boolean>
  lock: () => void
  setPin: (pin: string) => Promise<void>
  removePin: () => Promise<void>
  setBiometric: (cred: BiometricCredential | null) => Promise<void>
  resetDevice: () => Promise<void>
  canInstall: boolean
  installApp: () => Promise<void>
  loadSample: () => Promise<void>
  usage: { usage: number; quota: number } | null
}

const defaultState: AppState = {
  ready: false,
  settings: makeDefaultSettings(),
  categories: [],
  transactions: [],
  bills: [],
  payments: [],
  budgets: [],
  profiles: [],
  rules: [],
  logs: [],
  currencyProfiles: [],
  investments: [],
  investmentTxs: [],
  pots: [],
  carries: [],
}

const AppContext = createContext<StoreValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState)
  const [today, setToday] = useState(todayISO())
  const [toasts, setToasts] = useState<Toast[]>([])
  const [locked, setLocked] = useState(false)
  const [canInstall, setCanInstall] = useState(false)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const installEvent = useRef<{ prompt: () => Promise<void> } | null>(null)

  const notify = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3800)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const firstLoad = useRef(true)
  const refresh = useCallback(async (opts?: { fromSync?: boolean }) => {
    const [settingsArr, categories, transactions, bills, payments, budgets, profiles, rules, logs, currencyProfiles, investments, investmentTxs, pots, carries] = await Promise.all([
      db.settings.toArray(),
      db.categories.orderBy('order').toArray(),
      db.transactions.toArray(),
      db.bills.toArray(),
      db.billPayments.toArray(),
      db.budgets.toArray(),
      db.profiles.orderBy('priority').toArray(),
      db.rules.toArray(),
      db.aiLog.orderBy('at').reverse().limit(30).toArray(),
      listCurrencyProfiles().catch(() => []),
      db.investments.toArray().catch(() => []),
      db.investmentTxs.toArray().catch(() => []),
      db.pots.toArray().catch(() => []),
      db.budgetCarries.toArray().catch(() => []),
    ])
    const settings = settingsArr[0] ?? makeDefaultSettings()
    if (firstLoad.current) {
      firstLoad.current = false
      // Decide the lock before the first paint so the app never flashes unlocked.
      if (settings.lockEnabled && settings.pinHash) setLocked(true)
    }
    setState({
      ready: true,
      settings,
      categories: categories.filter((c) => !c.archived),
      transactions,
      bills,
      payments,
      budgets,
      profiles,
      rules,
      logs,
      currencyProfiles,
      investments,
      investmentTxs,
      pots,
      carries,
    })
    storageEstimate().then(setUsage).catch(() => {})
    if (!opts?.fromSync) requestAutoSync()
  }, [])

  useEffect(() => {
    ensureSeeded()
      .then(async () => {
        const s = await db.settings.get('settings')
        if (s?.onboarded) await reconcileAutopay(s.currency).catch(() => 0)
      })
      .then(() => refresh())
      .then(() => resumeImports())
      .catch((err) => {
        console.error('Failed to open local database', err)
        notify(err instanceof Error ? err.message : 'Could not open local storage', 'error')
      })
  }, [refresh])

  useEffect(() => startAutoSync(() => refresh({ fromSync: true })), [refresh])

  // Record autopay payments that came due (on start, and when the date rolls over).
  useEffect(() => {
    if (!state.ready || !state.settings.onboarded) return
    reconcileAutopay(state.settings.currency, today)
      .then((n) => (n ? refresh() : undefined))
      .catch(() => {})
  }, [state.ready, state.settings.onboarded, state.settings.currency, state.bills, today, refresh])

  // Keep derived dates fresh when the app is left open overnight.
  useEffect(() => {
    const tick = () => setToday(todayISO())
    const interval = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  // Theme + accent
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = state.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.settings.theme
      document.documentElement.dataset.theme = resolved
      const { accent, accentFg } = accentVars(state.settings.accent, resolved === 'dark' ? 'dark' : 'light')
      document.documentElement.style.setProperty('--accent', accent)
      document.documentElement.style.setProperty('--accent-fg', accentFg)
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b0d12' : '#f5f6fa')
    }
    apply()
    if (state.settings.theme === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
  }, [state.settings.theme, state.settings.accent])

  // Auto-lock: when the tab is switched / the phone switches apps (page hidden), and optionally when
  // the window loses focus. Pickers, the camera and the fingerprint prompt suspend this (lockGuard).
  const lockOn = state.settings.lockEnabled && Boolean(state.settings.pinHash)
  const delayMs = (state.settings.autoLockDelay ?? 0) * 1000
  const lockOnBlur = Boolean(state.settings.lockOnBlur)
  useEffect(() => {
    if (!lockOn) return
    let hiddenAt = 0
    let timer: number | undefined
    const lockNow = () => {
      if (!isAutoLockSuspended()) setLocked(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        if (delayMs === 0) lockNow()
      } else {
        if (hiddenAt && Date.now() - hiddenAt >= delayMs) lockNow()
        hiddenAt = 0
      }
    }
    const onBlur = () => {
      window.clearTimeout(timer)
      // Small grace period: focus briefly moving to a browser prompt shouldn't lock.
      timer = window.setTimeout(() => {
        if (!document.hasFocus()) lockNow()
      }, Math.max(1500, delayMs))
    }
    const onFocus = () => window.clearTimeout(timer)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', lockNow)
    if (lockOnBlur) {
      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onFocus)
    }
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', lockNow)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [lockOn, delayMs, lockOnBlur])

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      installEvent.current = event as unknown as { prompt: () => Promise<void> }
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      await dbUpdateSettings(patch)
      await refresh()
    },
    [refresh],
  )


  const unlock = useCallback(
    async (pin: string): Promise<UnlockResult> => {
      const current = (await db.settings.get('settings')) ?? state.settings
      const { pinSalt, pinHash } = current
      if (!pinSalt || !pinHash) {
        setLocked(false)
        return { ok: true }
      }
      const until = current.pinLockedUntil ? Date.parse(current.pinLockedUntil) : 0
      if (until > Date.now()) return { ok: false, retryInMs: until - Date.now() }
      if (await verifyPin(pin, pinSalt, pinHash)) {
        // Quietly upgrade legacy SHA-256 PIN hashes to PBKDF2.
        const upgrade = !pinHash.startsWith('pbkdf2$') && crypto.subtle ? { pinHash: await hashPin(pin, pinSalt) } : {}
        await dbUpdateSettings({ pinFailCount: 0, pinLockedUntil: undefined, ...upgrade })
        setLocked(false)
        await refresh({ fromSync: true })
        return { ok: true }
      }
      const fails = (current.pinFailCount ?? 0) + 1
      const wait = lockoutMs(fails)
      await dbUpdateSettings({
        pinFailCount: fails,
        pinLockedUntil: wait ? new Date(Date.now() + wait).toISOString() : undefined,
      })
      await refresh({ fromSync: true })
      return { ok: false, retryInMs: wait || undefined }
    },
    [state.settings, refresh],
  )

  const unlockWithBiometric = useCallback(async () => {
    const s = state.settings
    if (!s.biometricCredentialId) return false
    const ok = await verifyBiometric({ id: s.biometricCredentialId, publicKey: s.biometricPublicKey, alg: s.biometricAlg })
    if (ok) {
      setLocked(false)
      if (s.pinFailCount) {
        await dbUpdateSettings({ pinFailCount: 0, pinLockedUntil: undefined })
        await refresh({ fromSync: true })
      }
    }
    return ok
  }, [state.settings, refresh])

  const lock = useCallback(() => {
    if (state.settings.lockEnabled && state.settings.pinHash) setLocked(true)
  }, [state.settings.lockEnabled, state.settings.pinHash])

  const setPin = useCallback(
    async (pin: string) => {
      const salt = randomSalt()
      const hash = await hashPin(pin, salt)
      await saveSettings({ pinSalt: salt, pinHash: hash, lockEnabled: true, pinFailCount: 0, pinLockedUntil: undefined })
      setLocked(false)
    },
    [saveSettings],
  )

  const removePin = useCallback(async () => {
    await saveSettings({
      pinSalt: undefined,
      pinHash: undefined,
      lockEnabled: false,
      biometricCredentialId: undefined,
      biometricPublicKey: undefined,
      biometricAlg: undefined,
      pinFailCount: 0,
      pinLockedUntil: undefined,
    })
    setLocked(false)
  }, [saveSettings])

  const setBiometric = useCallback(
    async (cred: BiometricCredential | null) => {
      await saveSettings({
        biometricCredentialId: cred?.id,
        biometricPublicKey: cred?.publicKey,
        biometricAlg: cred?.alg,
      })
    },
    [saveSettings],
  )

  /** Forgot-PIN escape hatch: erase this device (other linked devices and backups are untouched). */
  const resetDevice = useCallback(async () => {
    setSyncState(null)
    await wipeAll()
    setLocked(false)
    await refresh({ fromSync: true })
  }, [refresh])

  const installApp = useCallback(async () => {
    const evt = installEvent.current
    if (!evt) {
      notify('Use your browser menu → “Install app” or “Add to Home screen”.', 'info')
      return
    }
    await evt.prompt()
    installEvent.current = null
    setCanInstall(false)
  }, [notify])

  const loadSample = useCallback(async () => {
    await seedSampleData()
    await refresh()
  }, [refresh])

  const categoryMap = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories])

  const schedules = useMemo(() => {
    const map = new Map<string, BillSchedule>()
    for (const bill of state.bills) map.set(bill.id, predictBill(bill, state.payments, today))
    return map
  }, [state.bills, state.payments, today])

  const potList = useMemo(() => potStatuses(state.pots, state.transactions, state.settings, today), [state.pots, state.transactions, state.settings, today])

  // Purchases paid from a pot stay in history and charts, but budgets, safe-to-spend and spike
  // alerts look at everyday spending only — the pot covers them over several cycles instead.
  const everyday = useMemo(() => {
    const ids = potTxnIds(state.transactions, new Set(state.pots.map((p) => p.id)))
    return ids.size ? state.transactions.filter((t) => !ids.has(t.id)) : state.transactions
  }, [state.transactions, state.pots])

  const budgetAdjust = useMemo(
    () => makeAdjust({ budgets: state.budgets, pots: state.pots, carries: state.carries, txns: state.transactions, settings: state.settings }),
    [state.budgets, state.pots, state.carries, state.transactions, state.settings],
  )

  const rows = useMemo(
    () => budgetRows(state.budgets, everyday, state.categories, state.settings, today, budgetAdjust),
    [state.budgets, everyday, state.categories, state.settings, today, budgetAdjust],
  )

  // Pots paid by a budget already lower that budget (and so safe-to-spend); only the rest are held back here.
  const potsReserved = useMemo(() => {
    const unfunded = new Set(unfundedPots(state.pots, state.budgets, state.transactions).map((p) => p.id))
    return potList.filter((p) => unfunded.has(p.pot.id)).reduce((s, p) => s + p.thisCycle, 0)
  }, [potList, state.pots, state.budgets, state.transactions])

  const overspendPrompts = useMemo<OverspendPrompt[]>(() => {
    const cycle = payCycle(today, state.settings.payCycleStartDay)
    const prev = shiftPeriod(cycle, -1, false)
    const decided = new Set(state.carries.map((c) => c.id))
    const out: OverspendPrompt[] = []
    for (const b of state.budgets) {
      if (b.archived || b.period !== 'cycle') continue
      if (b.createdAt && b.createdAt.slice(0, 10) > prev.end) continue
      if (decided.has(`carry_${b.id}_${prev.start}`)) continue
      const [row] = budgetRows([b], everyday, state.categories, state.settings, prev.end, budgetAdjust)
      if (!row || row.spent <= row.limit) continue
      const over = row.spent - row.limit
      out.push({ budget: b, cycleStart: prev.start, label: row.label, over, large: over > b.amount })
    }
    return out
  }, [state.budgets, state.carries, everyday, state.categories, state.settings, today, budgetAdjust])

  // A budget set to "always" handles its overspend without asking.
  useEffect(() => {
    const auto = overspendPrompts.filter((p) => p.budget.overspendPlan && p.budget.overspendPlan !== 'ask')
    if (!auto.length) return
    void Promise.all(auto.map((p) => decideOverspend(p.budget.id, p.cycleStart, p.over, p.budget.overspendPlan as CarryPlan))).then(() => refresh())
  }, [overspendPrompts, refresh])

  const safe = useMemo(
    () => computeSafeToSpend(rows, everyday, state.bills, schedules, state.settings, today, potsReserved),
    [rows, everyday, state.bills, schedules, state.settings, today, potsReserved],
  )

  const anomalies = useMemo(
    () => detectAnomalies(everyday, state.categories, state.settings, today),
    [everyday, state.categories, state.settings, today],
  )

  const subscriptions = useMemo(() => detectSubscriptions(state.transactions, today), [state.transactions, today])
  const duplicates = useMemo(() => findDuplicates(state.transactions, today), [state.transactions, today])

  // Nudges: worked out from your numbers whenever they change, stored for the service worker, and
  // shown as notifications when due (see lib/notify). Overspend decisions are counted below.
  const askCount = overspendPrompts.filter((p) => !p.budget.overspendPlan || p.budget.overspendPlan === 'ask').length
  const nudges = useMemo(() => {
    if (!state.ready) return []
    const base = { currency: state.settings.currency, rows, safe, txns: everyday, bills: state.bills, schedules, pots: potList, overspendCount: askCount }
    const todayNudges = computeNudges({ ...base, today })
    // Tomorrow morning's bill reminders too, so they can fire even if Monetr isn't opened first.
    const tomorrow = computeNudges({ ...base, today: addDays(today, 1), overspendCount: 0 }).filter((n) => n.kind === 'bill')
    return [...todayNudges, ...tomorrow]
  }, [state.ready, state.settings.currency, rows, safe, everyday, state.bills, schedules, potList, askCount, today])

  useEffect(() => {
    if (!state.ready) return
    void publishNudges(nudges).then(() => deliverDue(state.settings.notifications))
  }, [nudges, state.ready, state.settings.notifications])

  useEffect(() => {
    if (!state.ready || !state.settings.notifications) return
    void registerBackgroundNudges()
    // Keep this device's morning wake-up registered (refreshes the subscription; harmless if unset).
    void subscribeMorningPush()
    mirrorSyncState()
    const tick = () => void deliverDue(true)
    const timer = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [state.ready, state.settings.notifications])

  const value: StoreValue = {
    ...state,
    today,
    categoryMap,
    schedules,
    rows,
    safe,
    potList,
    everyday,
    budgetAdjust,
    nudges,
    overspendPrompts: overspendPrompts.filter((p) => !p.budget.overspendPlan || p.budget.overspendPlan === 'ask'),
    anomalies,
    subscriptions,
    duplicates,
    refresh,
    saveSettings,
    notify,
    toasts,
    dismissToast,
    locked,
    unlock,
    unlockWithBiometric,
    lock,
    setPin,
    removePin,
    setBiometric,
    resetDevice,
    canInstall,
    installApp,
    loadSample,
    usage,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): StoreValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
