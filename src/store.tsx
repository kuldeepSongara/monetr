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
} from './db/db'
import { isAutoLockSuspended } from './lib/lockGuard'
import { hashPin, lockoutMs, verifyPin } from './lib/pin'
import { verifyBiometric, type BiometricCredential } from './lib/biometric'
import { requestAutoSync, setSyncState, startAutoSync } from './lib/sync'
import { budgetRows, computeSafeToSpend, detectAnomalies, detectSubscriptions, type BudgetRow, type SafeToSpend } from './lib/analytics'
import { predictBill, type BillSchedule } from './lib/bills'
import { findDuplicates, type DuplicatePair } from './lib/duplicates'
import { todayISO } from './lib/dates'
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
}

export type UnlockResult = { ok: true } | { ok: false; retryInMs?: number }

interface StoreValue extends AppState {
  today: string
  categoryMap: Map<string, Category>
  schedules: Map<string, BillSchedule>
  rows: BudgetRow[]
  safe: SafeToSpend
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
}

const AppContext = createContext<StoreValue | null>(null)

function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = Number.parseInt(full, 16)
  if (!Number.isFinite(num)) return '124 92 255'
  return `${(num >> 16) & 255} ${(num >> 8) & 255} ${num & 255}`
}

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
    const [settingsArr, categories, transactions, bills, payments, budgets, profiles, rules, logs, currencyProfiles, investments, investmentTxs] = await Promise.all([
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
      document.documentElement.style.setProperty('--accent', hexToRgbTriplet(state.settings.accent))
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

  const rows = useMemo(
    () => budgetRows(state.budgets, state.transactions, state.categories, state.settings, today),
    [state.budgets, state.transactions, state.categories, state.settings, today],
  )

  const safe = useMemo(
    () => computeSafeToSpend(rows, state.transactions, state.bills, schedules, state.settings, today),
    [rows, state.transactions, state.bills, schedules, state.settings, today],
  )

  const anomalies = useMemo(
    () => detectAnomalies(state.transactions, state.categories, state.settings, today),
    [state.transactions, state.categories, state.settings, today],
  )

  const subscriptions = useMemo(() => detectSubscriptions(state.transactions, today), [state.transactions, today])
  const duplicates = useMemo(() => findDuplicates(state.transactions, today), [state.transactions, today])

  // Local notification for bills due soon (only while the app is open — no server).
  useEffect(() => {
    if (!state.ready || !state.settings.notifications) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const key = `monetr:notified:${today}`
    if (localStorage.getItem(key)) return
    const due = state.bills
      .filter((b) => b.active && !b.archived)
      .map((b) => ({ bill: b, schedule: schedules.get(b.id) }))
      .filter(
        ({ schedule }) =>
          schedule &&
          !schedule.snoozed &&
          (schedule.status === 'overdue' || schedule.status === 'due-soon'),
      )
    if (!due.length) return
    const first = due[0]
    const body =
      due.length === 1
        ? `${first.bill.name} · ${first.schedule?.status === 'overdue' ? 'overdue' : 'due soon'}`
        : `${first.bill.name} and ${due.length - 1} more bill${due.length > 2 ? 's' : ''} need attention`
    try {
      new Notification('Monetr · bills', { body, icon: './icon-192.png', tag: 'monetr-bills' })
      localStorage.setItem(key, '1')
    } catch {
      /* notifications may be blocked */
    }
  }, [state.ready, state.settings.notifications, state.bills, schedules, today])

  const value: StoreValue = {
    ...state,
    today,
    categoryMap,
    schedules,
    rows,
    safe,
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
