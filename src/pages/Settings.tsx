import { SyncPanel } from '../components/sync/SyncPanel'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarPlus,
  Check,
  CircleAlert,
  Download,
  HardDrive,
  Info,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  Wallet,
  Zap,
} from 'lucide-react'
import { useApp } from '../store'
import type { AIProfile, Category, CategoryKind, ProviderId, ThemeMode, WidgetId } from '../types'
import { PROVIDERS, PROVIDER_ORDER, canUseProfile, createProfile, profileLabel } from '../ai/providers'
import { testProfile, type TestResult } from '../ai/client'
import {
  changeBaseCurrency,
  clearAILog,
  clearDemoData,
  deleteCategory,
  deleteProfile,
  exportBackup,
  exportBillsIcs,
  exportCsv,
  getMeta,
  moveProfile,
  pickAndImport,
  saveCategory,
  saveProfile,
  wipeAll,
} from '../db/db'
import { CURRENCIES, fromMajorString, majorString } from '../lib/money'
import { formatBytes, uid } from '../lib/utils'
import { formatDate, relativeTime } from '../lib/dates'
import { Badge, Button, Card, Confirm, Field, Input, Modal, SectionTitle, Select, Segmented, Textarea, Toggle, cn } from '../components/ui'

const ACCENTS = ['#6366F1', '#8B5CF6', '#22D3EE', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6']

const WIDGETS: { id: WidgetId; label: string; hint: string }[] = [
  { id: 'safe', label: 'Safe to spend', hint: 'The headline number for this cycle' },
  { id: 'alerts', label: 'Alerts', hint: 'Bills due and unusual activity' },
  { id: 'trend', label: 'Spending trend', hint: 'Daily spend against your pace' },
  { id: 'categories', label: 'Categories', hint: 'Where the money went this cycle' },
  { id: 'budgets', label: 'Budgets', hint: 'Progress for each budget' },
  { id: 'bills', label: 'Bills', hint: 'Upcoming and overdue bills' },
  { id: 'recent', label: 'Recent activity', hint: 'Your latest transactions' },
]

const DEFAULT_WIDGETS: WidgetId[] = ['safe', 'alerts', 'trend', 'categories', 'budgets', 'bills', 'recent']

interface FailoverInfo {
  at: string
  from: string
  to: string
  error: string
  task: string
}

interface ConfirmState {
  kind: 'delete-profile' | 'delete-category' | 'wipe' | 'replace-import' | 'remove-pin' | 'clear-demo'
  id?: string
  label?: string
}

interface ProfileForm {
  provider: ProviderId
  name: string
  apiKey: string
  baseUrl: string
  model: string
  temperature: string
  maxTokens: string
  extraHeaders: string
  enabled: boolean
}

function formFromProfile(p: AIProfile): ProfileForm {
  return {
    provider: p.provider,
    name: p.name,
    apiKey: p.apiKey,
    baseUrl: p.baseUrl,
    model: p.model,
    temperature: p.temperature !== undefined ? String(p.temperature) : '',
    maxTokens: p.maxTokens !== undefined ? String(p.maxTokens) : '',
    extraHeaders: p.extraHeaders && Object.keys(p.extraHeaders).length ? JSON.stringify(p.extraHeaders, null, 2) : '',
    enabled: p.enabled,
  }
}

function draftProfile(base: AIProfile, form: ProfileForm): AIProfile {
  let extraHeaders: Record<string, string> | undefined
  if (form.extraHeaders.trim()) {
    const parsed = JSON.parse(form.extraHeaders) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Extra headers must be a JSON object, e.g. {"X-Custom":"value"}')
    }
    extraHeaders = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    )
  }
  const temperature = form.temperature.trim() === '' ? undefined : Number(form.temperature)
  const maxTokens = form.maxTokens.trim() === '' ? undefined : Math.round(Number(form.maxTokens))
  return {
    ...base,
    provider: form.provider,
    name: form.name.trim() || PROVIDERS[form.provider].short,
    apiKey: form.apiKey.trim(),
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    extraHeaders,
    enabled: form.enabled,
  }
}

export function Settings() {
  const {
    settings,
    profiles,
    categories,
    transactions,
    bills,
    logs,
    saveSettings,
    refresh,
    notify,
    usage,
    setPin,
    removePin,
    canInstall,
    installApp,
    loadSample,
    today,
  } = useApp()

  const [failover, setFailover] = useState<FailoverInfo | null>(null)
  const [profileModal, setProfileModal] = useState<{ base: AIProfile; isNew: boolean } | null>(null)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [testBusy, setTestBusy] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const [currencyChoice, setCurrencyChoice] = useState(settings.currency)
  const [allowance, setAllowance] = useState(
    settings.monthlyAllowance ? majorString(settings.monthlyAllowance, settings.currency) : '',
  )
  const [payDay, setPayDay] = useState(String(settings.payCycleStartDay))
  const [weekStart, setWeekStart] = useState<'0' | '1'>(String(settings.weekStart) as '0' | '1')
  const [leadDays, setLeadDays] = useState(String(settings.defaultBillLeadDays))
  const [moneyBusy, setMoneyBusy] = useState(false)

  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPinValue] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState('')

  const [catModal, setCatModal] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState({ name: '', emoji: '📦', color: '#64748B', kind: 'expense' as CategoryKind })
  const [catBusy, setCatBusy] = useState(false)

  useEffect(() => {
    getMeta<FailoverInfo>('ai:lastFailover')
      .then(setFailover)
      .catch(() => {})
  }, [profiles, settings.activeProfileId])

  useEffect(() => {
    setCurrencyChoice(settings.currency)
    setAllowance(settings.monthlyAllowance ? majorString(settings.monthlyAllowance, settings.currency) : '')
    setPayDay(String(settings.payCycleStartDay))
    setWeekStart(String(settings.weekStart) as '0' | '1')
    setLeadDays(String(settings.defaultBillLeadDays))
  }, [
    settings.currency,
    settings.monthlyAllowance,
    settings.payCycleStartDay,
    settings.weekStart,
    settings.defaultBillLeadDays,
    settings.updatedAt,
  ])

  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId)
  const enabledCount = profiles.filter(canUseProfile).length
  const widgetOrder = settings.dashboardWidgets?.length ? settings.dashboardWidgets : DEFAULT_WIDGETS
  const demoCount = useMemo(
    () => transactions.filter((t) => t.id.startsWith('demo_')).length + bills.filter((b) => b.id.startsWith('demo_')).length,
    [transactions, bills],
  )

  /* --------------------------------- profiles -------------------------------- */

  function openNewProfile() {
    const priority = profiles.reduce((max, p) => Math.max(max, p.priority), -1) + 1
    const base = createProfile('google', priority)
    setProfileModal({ base, isNew: true })
    setForm(formFromProfile(base))
  }

  function openEditProfile(profile: AIProfile) {
    setProfileModal({ base: profile, isNew: false })
    setForm(formFromProfile(profile))
  }

  function chooseProvider(provider: ProviderId) {
    if (!form) return
    const def = PROVIDERS[provider]
    setForm({
      ...form,
      provider,
      baseUrl: def.baseUrl,
      model: def.defaultModel,
      name: form.name && form.name !== PROVIDERS[form.provider].label ? form.name : def.label,
    })
  }

  async function testDraft() {
    if (!profileModal || !form) return
    setTestBusy('draft')
    try {
      const draft = draftProfile(profileModal.base, form)
      const result = await testProfile(draft)
      setTestResults((prev) => ({ ...prev, draft: result }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        draft: { ok: false, ms: 0, error: err instanceof Error ? err.message : 'Could not build a profile' },
      }))
    } finally {
      setTestBusy(null)
    }
  }

  async function saveProfileForm() {
    if (!profileModal || !form) return
    setProfileSaving(true)
    try {
      const next = draftProfile(profileModal.base, form)
      await saveProfile(next)
      if (profileModal.isNew) {
        await saveSettings({
          ...(profiles.length === 0 ? { activeProfileId: next.id } : {}),
          ...(settings.failoverEnabled ? {} : { failoverEnabled: true }),
        })
      }
      await refresh()
      setProfileModal(null)
      setForm(null)
      notify(`${profileLabel(next)} saved`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the profile', 'error')
    } finally {
      setProfileSaving(false)
    }
  }

  async function runProfileTest(profile: AIProfile) {
    setTestBusy(profile.id)
    try {
      const result = await testProfile(profile)
      setTestResults((prev) => ({ ...prev, [profile.id]: result }))
      await refresh()
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [profile.id]: { ok: false, ms: 0, error: err instanceof Error ? err.message : 'Test failed' },
      }))
    } finally {
      setTestBusy(null)
    }
  }

  async function toggleProfile(profile: AIProfile, enabled: boolean) {
    await saveProfile({ ...profile, enabled, updatedAt: new Date().toISOString() })
    await refresh()
  }

  async function makeActive(profile: AIProfile) {
    await saveSettings({ activeProfileId: profile.id })
    notify(`${profileLabel(profile)} is now the preferred profile`, 'success')
  }

  async function move(id: string, direction: -1 | 1) {
    await moveProfile(id, direction)
    await refresh()
  }

  /* ---------------------------------- money ---------------------------------- */

  async function saveMoney() {
    const day = Math.min(28, Math.max(1, Math.round(Number(payDay) || 1)))
    const parsedAllowance = allowance.trim() ? fromMajorString(allowance, settings.currency) : 0
    if (parsedAllowance === null) {
      notify('That allowance does not look like a number.', 'error')
      return
    }
    setMoneyBusy(true)
    try {
      await saveSettings({
        payCycleStartDay: day,
        weekStart: weekStart === '1' ? 1 : 0,
        monthlyAllowance: parsedAllowance,
        defaultBillLeadDays: Math.min(30, Math.max(0, Math.round(Number(leadDays) || 0))),
      })
      notify('Money settings saved', 'success')
    } finally {
      setMoneyBusy(false)
    }
  }

  async function confirmCurrency() {
    if (currencyChoice === settings.currency) return
    setConfirmBusy(true)
    try {
      await changeBaseCurrency(currencyChoice)
      await refresh()
      notify(`Base currency changed to ${currencyChoice}`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not change currency', 'error')
    } finally {
      setConfirmBusy(false)
      setConfirm(null)
    }
  }

  /* -------------------------------- appearance ------------------------------- */

  async function toggleWidget(id: WidgetId) {
    const next = widgetOrder.includes(id) ? widgetOrder.filter((w) => w !== id) : [...widgetOrder, id]
    if (!next.length) {
      notify('Keep at least one dashboard widget.', 'error')
      return
    }
    await saveSettings({ dashboardWidgets: next })
  }

  async function moveWidget(id: WidgetId, direction: -1 | 1) {
    const next = [...widgetOrder]
    const index = next.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    await saveSettings({ dashboardWidgets: next })
  }

  /* -------------------------------- reminders -------------------------------- */

  async function toggleNotifications(next: boolean) {
    if (next) {
      if (typeof Notification === 'undefined') {
        notify('This browser does not support notifications. Use the .ics export instead.', 'error')
        return
      }
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          notify('Notifications were not allowed. You can still export a calendar file.', 'error')
          return
        }
      }
      if (Notification.permission !== 'granted') {
        notify('Notifications are blocked in your browser settings.', 'error')
        return
      }
    }
    await saveSettings({ notifications: next })
    if (next) notify('Bill alerts will appear while Spendwise is open.', 'success')
  }

  /* --------------------------------- security -------------------------------- */

  function openPin() {
    setPinValue('')
    setPinConfirm('')
    setPinError('')
    setPinOpen(true)
  }

  async function savePin() {
    if (!/^\d{4,8}$/.test(pin)) {
      setPinError('Use 4–8 digits.')
      return
    }
    if (pin !== pinConfirm) {
      setPinError('The PINs do not match.')
      return
    }
    setPinBusy(true)
    try {
      await setPin(pin)
      setPinOpen(false)
      notify(settings.lockEnabled ? 'PIN updated' : 'PIN lock enabled', 'success')
    } finally {
      setPinBusy(false)
    }
  }

  /* -------------------------------- categories ------------------------------- */

  function openCategory(category?: Category) {
    setCatModal(
      category ?? {
        id: uid('cat_'),
        name: '',
        emoji: '📦',
        color: '#64748B',
        kind: 'expense',
        order: categories.length,
      },
    )
    setCatForm(
      category
        ? { name: category.name, emoji: category.emoji, color: category.color, kind: category.kind }
        : { name: '', emoji: '📦', color: '#64748B', kind: 'expense' },
    )
  }

  async function saveCategoryForm() {
    if (!catModal) return
    if (!catForm.name.trim()) {
      notify('Give the category a name.', 'error')
      return
    }
    setCatBusy(true)
    try {
      await saveCategory({
        ...catModal,
        name: catForm.name.trim(),
        emoji: catForm.emoji.trim() || '📦',
        color: catForm.color,
        kind: catForm.kind,
      })
      await refresh()
      setCatModal(null)
      notify('Category saved', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the category', 'error')
    } finally {
      setCatBusy(false)
    }
  }

  /* ----------------------------------- data ---------------------------------- */

  async function runConfirm() {
    if (!confirm) return
    setConfirmBusy(true)
    try {
      if (confirm.kind === 'delete-profile' && confirm.id) {
        await deleteProfile(confirm.id)
        await refresh()
        notify('Profile deleted', 'info')
      } else if (confirm.kind === 'delete-category' && confirm.id) {
        await deleteCategory(confirm.id)
        await refresh()
        notify('Category deleted', 'info')
      } else if (confirm.kind === 'wipe') {
        await wipeAll()
        await refresh()
        notify('All local data deleted', 'info')
      } else if (confirm.kind === 'replace-import') {
        const added = await pickAndImport('replace')
        await refresh()
        if (added !== null) notify(`Backup restored · ${added} transactions`, 'success')
      } else if (confirm.kind === 'remove-pin') {
        await removePin()
        notify('PIN removed. Your data is unchanged.', 'info')
      } else if (confirm.kind === 'clear-demo') {
        await clearDemoData()
        await refresh()
        notify('Sample data removed', 'info')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work', 'error')
    } finally {
      setConfirmBusy(false)
      setConfirm(null)
    }
  }

  async function mergeImport() {
    try {
      const added = await pickAndImport('merge')
      await refresh()
      if (added !== null) notify(`Merged backup · ${added} new records`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not import that file', 'error')
    }
  }

  async function downloadBackup() {
    try {
      await exportBackup()
      notify('Backup downloaded', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Backup failed', 'error')
    }
  }

  const confirmCopy: Record<ConfirmState['kind'], { title: string; body: string; label: string; tone: 'danger' | 'primary' }> = {
    'delete-profile': {
      title: 'Delete this AI profile?',
      body: 'The key and settings for this profile will be removed. Other profiles are untouched.',
      label: 'Delete profile',
      tone: 'danger',
    },
    'delete-category': {
      title: 'Delete this category?',
      body: 'Transactions in this category will be moved to another category. Budgets for it will be removed.',
      label: 'Delete category',
      tone: 'danger',
    },
    wipe: {
      title: 'Delete everything on this device?',
      body: 'Transactions, bills, budgets, AI profiles and settings will be erased. Export a backup first if you might need this data.',
      label: 'Erase all data',
      tone: 'danger',
    },
    'replace-import': {
      title: 'Replace current data with a backup?',
      body: 'Everything currently stored will be replaced by the contents of the backup file you choose.',
      label: 'Choose backup',
      tone: 'danger',
    },
    'remove-pin': {
      title: 'Remove the PIN lock?',
      body: 'Spendwise will open without asking for a PIN. Your transactions and settings stay exactly as they are.',
      label: 'Remove PIN',
      tone: 'danger',
    },
    'clear-demo': {
      title: 'Remove the sample data?',
      body: 'Only records created by the sample generator are removed. Anything you entered yourself is kept.',
      label: 'Remove sample',
      tone: 'primary',
    },
  }

  return (
    <div className="space-y-3.5">
        <SyncPanel notify={notify} refresh={refresh} />

      {/* --------------------------------- AI --------------------------------- */}
      <Card>
        <SectionTitle
          title="AI profiles"
          sub={`${enabledCount} ready · ${profiles.length} saved`}
          action={
            <Button size="sm" variant="soft" onClick={openNewProfile}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        />

        <div className="rounded-xl border border-line/70 bg-surface2/40 p-3">
          <div className="flex items-start gap-2">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-ink">
                {activeProfile ? `${profileLabel(activeProfile)} is preferred` : profiles.length ? 'No profile pinned' : 'No AI configured'}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                {activeProfile
                  ? `${PROVIDERS[activeProfile.provider]?.label ?? activeProfile.provider} · ${activeProfile.model || 'no model'}`
                  : 'AI is optional. Everything except AI summaries works offline.'}
              </p>
            </div>
          </div>
          {failover ? (
            <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-[10px] leading-relaxed text-warn">
              Auto-switched from {failover.from} to {failover.to} {relativeTime(failover.at)} · {failover.error}
            </p>
          ) : null}
        </div>

        <div className="mt-3 space-y-2">
          {profiles.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
              Add Gemini or any other provider to unlock quick entry, categorising, receipts and digests.
            </p>
          ) : null}

          {profiles.map((profile, index) => {
            const result = testResults[profile.id]
            const active = profile.id === settings.activeProfileId
            const def = PROVIDERS[profile.provider]
            return (
              <div key={profile.id} className={cn('rounded-xl border p-3', active ? 'border-accent/40 bg-accent/[0.06]' : 'border-line/70')}>
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[12px] font-semibold text-ink">{profileLabel(profile)}</p>
                      {active ? <Badge tone="accent">preferred</Badge> : null}
                      {!profile.enabled ? <Badge>off</Badge> : null}
                      {profile.enabled && !canUseProfile(profile) ? <Badge tone="warn">needs key</Badge> : null}
                      <HealthBadge profile={profile} />
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted">
                      {def?.short ?? profile.provider} · {profile.model || 'no model'} · priority {index + 1}
                    </p>
                    {profile.health?.status === 'error' && profile.health.message ? (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-bad">{profile.health.message}</p>
                    ) : null}
                    {result ? (
                      <p className={cn('mt-1 text-[10px] font-medium', result.ok ? 'text-good' : 'text-bad')}>
                        {result.ok ? `Connected in ${result.ms} ms` : result.error}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(profile.id, -1)}
                      disabled={index === 0}
                      className="btn btn-ghost btn-icon h-7 w-7 rounded-md disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(profile.id, 1)}
                      disabled={index === profiles.length - 1}
                      className="btn btn-ghost btn-icon h-7 w-7 rounded-md disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="soft" onClick={() => runProfileTest(profile)} loading={testBusy === profile.id}>
                    Test
                  </Button>
                  {!active ? (
                    <Button size="sm" variant="ghost" onClick={() => makeActive(profile)}>
                      <Star className="h-3.5 w-3.5" /> Prefer
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => openEditProfile(profile)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={profile.enabled}
                    onClick={() => toggleProfile(profile, !profile.enabled)}
                    className={cn(
                      'relative ml-auto h-5 w-9 shrink-0 rounded-full border transition',
                      profile.enabled ? 'border-accent/60 bg-accent' : 'border-line bg-surface2',
                    )}
                    aria-label="Enable profile"
                  >
                    <span
                      className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all"
                      style={{ left: profile.enabled ? 18 : 2 }}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: 'delete-profile', id: profile.id, label: profileLabel(profile) })}
                    className="btn btn-ghost btn-icon h-7 w-7 rounded-md text-muted hover:text-bad"
                    aria-label="Delete profile"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3 space-y-3 rounded-xl border border-line/70 p-3">
          <Toggle
            checked={settings.failoverEnabled}
            onChange={(v) => saveSettings({ failoverEnabled: v })}
            label="Fail over to another profile"
            hint="If the preferred profile errors, try the next ready profile in priority order."
          />
          <Toggle
            checked={settings.autoSwitchActive}
            onChange={(v) => saveSettings({ autoSwitchActive: v })}
            label="Keep the working profile preferred"
            hint="After a successful failover, remember the profile that actually answered."
            disabled={!settings.failoverEnabled}
          />
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Recent AI activity</p>
            {logs.length ? (
              <button
                type="button"
                onClick={async () => {
                  await clearAILog()
                  await refresh()
                  notify('AI activity cleared', 'info')
                }}
                className="text-[10px] font-medium text-muted underline underline-offset-2 hover:text-ink"
              >
                Clear
              </button>
            ) : null}
          </div>
          {logs.length ? (
            <div className="divide-y divide-line/60 rounded-xl border border-line/70">
              {logs.slice(0, 8).map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 px-2.5 py-2">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      entry.ok ? 'bg-good' : 'bg-bad',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10px] font-medium text-ink">
                      {entry.task} · {entry.profileName}
                    </p>
                    <p className="truncate text-[9px] text-muted">
                      {entry.ok ? `${entry.ms} ms` : entry.error}
                    </p>
                  </div>
                  <span className="shrink-0 text-[9px] text-muted">{relativeTime(entry.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted">No AI calls yet. Tests appear in the profile health badges.</p>
          )}
        </div>
      </Card>

      {/* ----------------------------- appearance ----------------------------- */}
      <Card>
        <SectionTitle title="Appearance" sub="Theme, accent and dashboard layout" />
        <div className="space-y-3.5">
          <div>
            <p className="label">Theme</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-line/70 bg-surface2 p-1">
              {(['system', 'dark', 'light'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => saveSettings({ theme: mode })}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold capitalize transition',
                    settings.theme === mode ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                  )}
                >
                  {mode === 'system' ? <Monitor className="h-3.5 w-3.5" /> : mode === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label flex items-center gap-1.5">
              <Palette className="h-3 w-3" /> Accent colour
            </p>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => saveSettings({ accent: hex })}
                  aria-label={`Accent ${hex}`}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 transition',
                    settings.accent === hex ? 'scale-105 border-ink' : 'border-transparent',
                  )}
                  style={{ background: hex }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="label mb-0">Dashboard widgets</p>
              <button
                type="button"
                onClick={() => saveSettings({ dashboardWidgets: DEFAULT_WIDGETS })}
                className="text-[10px] font-medium text-muted underline underline-offset-2 hover:text-ink"
              >
                Reset order
              </button>
            </div>
            <div className="space-y-1.5">
              {WIDGETS.map((widget) => {
                const index = widgetOrder.indexOf(widget.id)
                const visible = index >= 0
                return (
                  <div
                    key={widget.id}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-2.5 py-2',
                      visible ? 'border-line/70 bg-surface2/30' : 'border-line/50 opacity-60',
                    )}
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={visible}
                      onClick={() => toggleWidget(widget.id)}
                      className={cn(
                        'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border',
                        visible ? 'border-accent bg-accent text-white' : 'border-line bg-surface',
                      )}
                      aria-label={`Show ${widget.label}`}
                    >
                      {visible ? <Check className="h-3 w-3" /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-ink">{widget.label}</p>
                      <p className="truncate text-[9px] text-muted">{widget.hint}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => moveWidget(widget.id, -1)}
                      disabled={!visible || index <= 0}
                      className="btn btn-ghost btn-icon h-6 w-6 rounded-md disabled:opacity-25"
                      aria-label="Move widget up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveWidget(widget.id, 1)}
                      disabled={!visible || index < 0 || index >= widgetOrder.length - 1}
                      className="btn btn-ghost btn-icon h-6 w-6 rounded-md disabled:opacity-25"
                      aria-label="Move widget down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* -------------------------------- money ------------------------------- */}
      <Card>
        <SectionTitle title="Money" sub="Currency, pay cycle and allowance" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Base currency" hint="Changing this relabels every stored amount.">
            <Select value={currencyChoice} onChange={(e) => setCurrencyChoice(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monthly allowance" hint="Optional fallback for safe-to-spend when budgets are empty.">
            <Input value={allowance} onChange={(e) => setAllowance(e.target.value)} inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Pay day" hint="Day of month your cycle starts (1–28).">
            <Input value={payDay} onChange={(e) => setPayDay(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Week starts">
            <Segmented
              value={weekStart}
              onChange={setWeekStart}
              size="sm"
              options={[
                { value: '1', label: 'Monday' },
                { value: '0', label: 'Sunday' },
              ]}
            />
          </Field>
          <Field label="Default bill lead time" hint="Days of warning for new bills. Each bill can override this.">
            <Input value={leadDays} onChange={(e) => setLeadDays(e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        {currencyChoice !== settings.currency ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5">
            <CircleAlert className="h-4 w-4 shrink-0 text-warn" />
            <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-warn">
              Switch base currency to {currencyChoice}? Amounts are relabelled, not converted at today’s rate.
            </p>
            <Button size="sm" variant="soft" onClick={() => setCurrencyChoice(settings.currency)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmCurrency} loading={confirmBusy}>
              Switch
            </Button>
          </div>
        ) : null}

        <div className="mt-3 flex justify-end">
          <Button onClick={saveMoney} loading={moneyBusy}>
            Save money settings
          </Button>
        </div>
      </Card>

      {/* ------------------------------ categories ---------------------------- */}
      <Card>
        <SectionTitle
          title="Categories"
          sub={`${categories.length} active`}
          action={
            <Button size="sm" variant="soft" onClick={() => openCategory()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-2 rounded-xl border border-line/70 px-2.5 py-2">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm"
                style={{ background: `${category.color}22` }}
              >
                {category.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-ink">{category.name}</p>
                <p className="text-[9px] capitalize text-muted">{category.kind}</p>
              </div>
              <button
                type="button"
                onClick={() => openCategory(category)}
                className="btn btn-ghost btn-icon h-7 w-7 rounded-md"
                aria-label={`Edit ${category.name}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setConfirm({ kind: 'delete-category', id: category.id, label: category.name })}
                className="btn btn-ghost btn-icon h-7 w-7 rounded-md text-muted hover:text-bad"
                aria-label={`Delete ${category.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* ------------------------------ reminders ----------------------------- */}
      <Card>
        <SectionTitle title="Reminders" sub="Local alerts and calendar export" />
        <div className="space-y-3">
          <Toggle
            checked={settings.notifications}
            onChange={toggleNotifications}
            label="Browser notifications for due bills"
            hint="These only fire while Spendwise is open — there is no server to push in the background."
          />
          <div className="rounded-xl border border-line/70 bg-surface2/40 p-3">
            <p className="text-[11px] font-semibold text-ink">Reliable reminders on your phone</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              Export your bills as an .ics calendar file. Import it into Google Calendar or Apple Calendar and the
              reminders arrive even when Spendwise is closed.
            </p>
            <Button
              size="sm"
              variant="soft"
              className="mt-2.5"
              onClick={async () => {
                await exportBillsIcs()
                notify('Calendar file downloaded', 'success')
              }}
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Export bills to calendar
            </Button>
          </div>
        </div>
      </Card>

      {/* ------------------------------- security ----------------------------- */}
      <Card>
        <SectionTitle title="Privacy & security" sub="A soft lock for a shared device" />
        <div className="space-y-3">
          <Toggle
            checked={settings.lockEnabled}
            onChange={(v) => {
              if (v) openPin()
              else setConfirm({ kind: 'remove-pin' })
            }}
            label="PIN lock"
            hint="Asks for a PIN when Spendwise opens or after a minute in the background."
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={openPin}>
              <LockKeyhole className="h-3.5 w-3.5" /> {settings.lockEnabled ? 'Change PIN' : 'Set PIN'}
            </Button>
            {settings.lockEnabled ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'remove-pin' })}>
                Remove PIN
              </Button>
            ) : null}
          </div>
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
            This is a privacy screen, not encryption. Everything stays in this browser and nothing is uploaded.
          </p>
        </div>
      </Card>

      {/* --------------------------------- data ------------------------------- */}
      <Card>
        <SectionTitle title="Your data" sub="Export, restore and clean up" />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={downloadBackup}>
            <Download className="h-4 w-4" /> Backup JSON
          </Button>
          <Button variant="ghost" onClick={mergeImport}>
            <Upload className="h-4 w-4" /> Merge backup
          </Button>
          <Button variant="ghost" onClick={async () => { await exportCsv(); notify('CSV downloaded', 'success') }}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="ghost" onClick={() => setConfirm({ kind: 'replace-import' })}>
            <Upload className="h-4 w-4" /> Replace from backup
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <MiniStat label="Transactions" value={String(transactions.length)} />
          <MiniStat label="Bills" value={String(bills.length)} />
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-line/70 bg-surface2/40 px-3 py-2.5">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted">
            {usage
              ? `Using ${formatBytes(usage.usage)} of about ${formatBytes(usage.quota)} available to this browser.`
              : 'Storage usage is not available in this browser.'}{' '}
            Last export is your responsibility — clearing browser data erases everything.
          </p>
        </div>

        <div className="mt-3 space-y-2">
          {demoCount > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-line/70 px-3 py-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-muted" />
              <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted">
                {demoCount} sample records are present.
              </p>
              <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'clear-demo' })}>
                Remove sample
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full"
              onClick={async () => {
                await loadSample()
                notify('Sample data loaded', 'success')
              }}
            >
              <Sparkles className="h-4 w-4" /> Load sample data
            </Button>
          )}
          <Button variant="danger" className="w-full" onClick={() => setConfirm({ kind: 'wipe' })}>
            <Trash2 className="h-4 w-4" /> Erase all data
          </Button>
        </div>
      </Card>

      {/* -------------------------------- install ----------------------------- */}
      <Card>
        <SectionTitle title="Install Spendwise" sub="A real app icon, still local-first" />
        <div className="flex items-start gap-2.5">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] leading-relaxed text-muted">
              On Android, open this site in Chrome, tap the menu and choose <strong className="text-ink">Add to Home screen</strong>.
              On a MacBook, open the same address in a desktop browser for the wide layout and charts.
            </p>
            {canInstall ? (
              <Button size="sm" className="mt-2.5" onClick={installApp}>
                <Download className="h-3.5 w-3.5" /> Install app
              </Button>
            ) : (
              <p className="mt-1.5 text-[10px] text-muted">
                The install prompt appears when your browser supports it — otherwise use the browser menu.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* --------------------------------- about ------------------------------ */}
      <Card>
        <SectionTitle title="About" />
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted">
            <p className="font-semibold text-ink">Spendwise v1.0.0</p>
            <p className="mt-0.5">
              Local-first spending tracker. Data lives in IndexedDB on this device; there is no account, server or cloud
              sync. Backups are plain JSON files you control.
            </p>
            <p className="mt-1.5">
              Schema version {settings.schemaVersion} · today {formatDate(today, 'long')} ·{' '}
              {activeProfile ? `AI: ${profileLabel(activeProfile)}` : 'AI: not configured'}
            </p>
          </div>
        </div>
      </Card>

      {/* -------------------------------- modals ------------------------------ */}
      <Modal
        open={profileModal !== null && form !== null}
        onClose={() => {
          setProfileModal(null)
          setForm(null)
        }}
        title={profileModal?.isNew ? 'Add AI profile' : 'Edit AI profile'}
        subtitle="Keys stay in this browser and go straight to the provider."
        footer={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setProfileModal(null)
                setForm(null)
              }}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={saveProfileForm} loading={profileSaving}>
              Save profile
            </Button>
          </div>
        }
      >
        {form ? (
          <div className="space-y-3.5">
            <Field label="Provider">
              <Select value={form.provider} onChange={(e) => chooseProvider(e.target.value as ProviderId)}>
                {PROVIDER_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDERS[p].label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Profile name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={PROVIDERS[form.provider].short}
                />
              </Field>
              <Field label="Enabled">
                <div className="pt-2.5">
                  <Toggle
                    checked={form.enabled}
                    onChange={(v) => setForm({ ...form, enabled: v })}
                    label=""
                  />
                </div>
              </Field>
            </div>

            {PROVIDERS[form.provider].requiresKey ? (
              <Field
                label="API key"
                hint={
                  PROVIDERS[form.provider].keyUrl ? (
                    <a
                      href={PROVIDERS[form.provider].keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline underline-offset-2"
                    >
                      Get a {PROVIDERS[form.provider].short} key
                    </a>
                  ) : (
                    PROVIDERS[form.provider].keyHint
                  )
                }
              >
                <Input
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  type="password"
                  autoComplete="off"
                  placeholder={PROVIDERS[form.provider].keyHint ?? 'Paste your key'}
                />
              </Field>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Base URL">
                <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              </Field>
              <Field label="Model">
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="model id" />
              </Field>
            </div>

            {PROVIDERS[form.provider].models.length ? (
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
                {PROVIDERS[form.provider].models.map((model) => (
                  <button
                    key={model}
                    type="button"
                    onClick={() => setForm({ ...form, model })}
                    className={cn('chip whitespace-nowrap', form.model === model && 'chip-active')}
                  >
                    {model}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Temperature" hint="Optional. Leave blank for the provider default.">
                <Input
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                  inputMode="decimal"
                  placeholder="e.g. 0.3"
                />
              </Field>
              <Field label="Max tokens" hint="Optional output limit.">
                <Input
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
                  inputMode="numeric"
                  placeholder="e.g. 2048"
                />
              </Field>
            </div>

            <Field label="Extra headers (advanced)" hint='Optional JSON object, for proxies or beta headers.'>
              <Textarea
                value={form.extraHeaders}
                onChange={(e) => setForm({ ...form, extraHeaders: e.target.value })}
                placeholder='{"X-Custom-Header":"value"}'
                className="font-mono text-[11px]"
              />
            </Field>

            {PROVIDERS[form.provider].notes ? (
              <p className="rounded-xl border border-line/70 bg-surface2/40 px-3 py-2 text-[10px] leading-relaxed text-muted">
                {PROVIDERS[form.provider].notes}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="soft" size="sm" onClick={testDraft} loading={testBusy === 'draft'}>
                <RefreshCw className="h-3.5 w-3.5" /> Test connection
              </Button>
              {testResults.draft ? (
                <span className={cn('text-[11px] font-medium', testResults.draft.ok ? 'text-good' : 'text-bad')}>
                  {testResults.draft.ok ? `Connected in ${testResults.draft.ms} ms` : testResults.draft.error}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title={settings.lockEnabled ? 'Change PIN' : 'Set a PIN'}
        subtitle="4–8 digits. This is a privacy curtain, not encryption."
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPinOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={savePin} loading={pinBusy} disabled={pin.length < 4}>
              Save PIN
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="New PIN">
            <Input
              value={pin}
              onChange={(e) => {
                setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))
                setPinError('')
              }}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••"
            />
          </Field>
          <Field label="Confirm PIN">
            <Input
              value={pinConfirm}
              onChange={(e) => {
                setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))
                setPinError('')
              }}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void savePin()
              }}
            />
          </Field>
          {pinError ? <p className="text-[11px] font-medium text-bad">{pinError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={catModal !== null}
        onClose={() => setCatModal(null)}
        title={catModal && categories.some((c) => c.id === catModal.id) ? 'Edit category' : 'New category'}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setCatModal(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={saveCategoryForm} loading={catBusy}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-[64px_1fr] gap-3">
            <Field label="Emoji">
              <Input
                value={catForm.emoji}
                onChange={(e) => setCatForm({ ...catForm, emoji: e.target.value })}
                className="text-center text-lg"
                maxLength={4}
              />
            </Field>
            <Field label="Name">
              <Input
                value={catForm.name}
                onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                placeholder="e.g. Pets"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={catForm.kind} onChange={(e) => setCatForm({ ...catForm, kind: e.target.value as CategoryKind })}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </Select>
            </Field>
            <Field label="Colour">
              <input
                type="color"
                value={catForm.color}
                onChange={(e) => setCatForm({ ...catForm, color: e.target.value })}
                className="h-[42px] w-full cursor-pointer rounded-xl border border-line bg-bg/60 px-1"
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Confirm
        open={confirm !== null}
        title={confirm ? confirmCopy[confirm.kind].title : ''}
        body={
          confirm
            ? confirmCopy[confirm.kind].body + (confirm.label ? `\n\n${confirm.label}` : '')
            : ''
        }
        confirmLabel={confirm ? confirmCopy[confirm.kind].label : 'Continue'}
        tone={confirm ? confirmCopy[confirm.kind].tone : 'danger'}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
        loading={confirmBusy}
      />
    </div>
  )
}

function HealthBadge({ profile }: { profile: AIProfile }) {
  const health = profile.health
  if (!health || health.status === 'unknown') return <Badge>untested</Badge>
  if (health.status === 'ok') {
    return (
      <Badge tone="good">
        <Check className="h-2.5 w-2.5" /> {health.latencyMs ? `${health.latencyMs} ms` : 'ok'}
      </Badge>
    )
  }
  return (
    <Badge tone="bad">
      <CircleAlert className="h-2.5 w-2.5" /> error
    </Badge>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface2/40 px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="tnum mt-0.5 text-sm font-bold text-ink">{value}</p>
    </div>
  )
}
