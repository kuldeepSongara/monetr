import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ExternalLink, Sparkles, Wallet } from 'lucide-react'
import { useApp } from '../store'
import { BrandMark } from './Shell'
import { Button, Field, Input, Select, Toggle, cn } from './ui'
import { CURRENCIES, fromMajorString, majorString } from '../lib/money'
import { PROVIDERS, PROVIDER_ORDER, createProfile } from '../ai/providers'
import { testProfile } from '../ai/client'
import { saveProfile } from '../db/db'
import type { ProviderId, ThemeMode } from '../types'

const ACCENTS = ['#6366F1', '#8B5CF6', '#22D3EE', '#22C55E', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6']

export function Onboarding() {
  const { settings, saveSettings, loadSample, notify } = useApp()
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState(settings.currency)
  const [payDay, setPayDay] = useState(String(settings.payCycleStartDay))
  const [weekStart, setWeekStart] = useState<'mon' | 'sun'>(settings.weekStart === 1 ? 'mon' : 'sun')
  const [allowance, setAllowance] = useState(
    settings.monthlyAllowance ? majorString(settings.monthlyAllowance, settings.currency) : '',
  )
  const [accent, setAccent] = useState(settings.accent)
  const [theme, setTheme] = useState<ThemeMode>(settings.theme)

  const [provider, setProvider] = useState<ProviderId>('google')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(PROVIDERS.google.defaultModel)
  const [profName, setProfName] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [startSample, setStartSample] = useState(false)
  const [saving, setSaving] = useState(false)

  const def = PROVIDERS[provider]

  function chooseProvider(next: ProviderId) {
    setProvider(next)
    setModel(PROVIDERS[next].defaultModel)
    setTestMsg(null)
  }

  async function runTest() {
    if (def.requiresKey && !apiKey.trim()) {
      setTestMsg({ ok: false, text: 'Enter an API key first.' })
      return
    }
    setTesting(true)
    setTestMsg(null)
    const profile = { ...createProfile(provider, 0), apiKey: apiKey.trim(), model, name: profName || def.label }
    const res = await testProfile(profile)
    setTesting(false)
    setTestMsg({ ok: res.ok, text: res.ok ? `Connected in ${res.ms} ms` : res.error ?? 'Connection failed' })
  }

  async function finish(skipAll = false) {
    setSaving(true)
    try {
      const week = weekStart === 'mon' ? 1 : 0
      const day = Math.min(28, Math.max(1, Number(payDay) || 1))
      await saveSettings({
        onboarded: true,
        currency,
        payCycleStartDay: day,
        weekStart: week,
        theme,
        accent,
        monthlyAllowance: allowance.trim() ? fromMajorString(allowance, currency) ?? 0 : 0,
        defaultBillLeadDays: settings.defaultBillLeadDays || 3,
      })
      if (!skipAll && apiKey.trim()) {
        const profile = {
          ...createProfile(provider, 0),
          apiKey: apiKey.trim(),
          model,
          name: profName.trim() || def.label,
        }
        await saveProfile(profile)
        await saveSettings({ activeProfileId: profile.id })
        notify(`${def.short} profile saved`, 'success')
      }
      if (!skipAll && startSample) {
        await loadSample()
      }
      await saveSettings({ onboarded: true })
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Setup failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg px-4 pb-10 pt-6">
      <div className="mx-auto flex w-full max-w-lg flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandMark size={34} />
            <span className="text-sm font-bold text-ink">Spendwise</span>
          </div>
          <button
            type="button"
            onClick={() => finish(true)}
            className="text-[11px] font-medium text-muted underline underline-offset-4"
          >
            Skip setup
          </button>
        </div>

        <div className="mt-6 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-surface2')} />
          ))}
        </div>

        {step === 0 ? (
          <div className="mt-7 animate-fade-in">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <Wallet className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-ink">
              Your money, on your device.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              No sign-up, no server, no database to host. Everything is stored in this browser — and you can export a
              backup any time.
            </p>

            <div className="mt-6 space-y-3.5">
              <Field label="Main currency">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pay day" hint="Your cycle starts on this day.">
                  <Input value={payDay} onChange={(e) => setPayDay(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Week starts">
                  <Select value={weekStart} onChange={(e) => setWeekStart(e.target.value as 'mon' | 'sun')}>
                    <option value="mon">Monday</option>
                    <option value="sun">Sunday</option>
                  </Select>
                </Field>
              </div>
              <Field
                label={`Monthly spending allowance (${currency}, optional)`}
                hint="Used for the safe-to-spend number when you have no budgets yet."
              >
                <Input
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 2500"
                />
              </Field>

              <div>
                <p className="label">Accent</p>
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setAccent(hex)}
                      aria-label={`Accent ${hex}`}
                      className={cn(
                        'h-8 w-8 rounded-full border-2 transition',
                        accent === hex ? 'border-ink scale-105' : 'border-transparent',
                      )}
                      style={{ background: hex }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="label">Theme</p>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-line/70 bg-surface2 p-1">
                  {(['system', 'dark', 'light'] as ThemeMode[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTheme(t)}
                      className={cn(
                        'rounded-lg py-2 text-[11px] font-semibold capitalize transition',
                        theme === t ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button size="lg" className="mt-6 w-full" onClick={() => setStep(1)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-7 animate-fade-in">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
              <Sparkles className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-ink">Add an AI brain (optional)</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Used for quick entry, categorising, receipt scanning and spending insights. You can add several profiles
              later and switch or fail over automatically.
            </p>

            <div className="mt-6 space-y-3.5">
              <Field label="Provider">
                <Select value={provider} onChange={(e) => chooseProvider(e.target.value as ProviderId)}>
                  {PROVIDER_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDERS[p].label}
                    </option>
                  ))}
                </Select>
              </Field>

              {def.requiresKey ? (
                <Field
                  label="API key"
                  hint={
                    def.keyUrl ? (
                      <a href={def.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent">
                        Get a {def.short} key <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : def.keyHint
                  }
                >
                  <Input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type="password"
                    autoComplete="off"
                    placeholder={def.keyHint ?? 'Paste your key'}
                  />
                </Field>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Model">
                  <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
                </Field>
                <Field label="Profile name">
                  <Input value={profName} onChange={(e) => setProfName(e.target.value)} placeholder={def.short} />
                </Field>
              </div>

              <div className="rounded-xl border border-line/70 bg-surface2/50 p-3 text-[11px] leading-relaxed text-muted">
                <p>
                  Keys are stored in this browser only and sent straight to the provider. On a shared device, use the
                  PIN lock in Settings.
                </p>
                {def.notes ? <p className="mt-1.5">{def.notes}</p> : null}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={runTest} loading={testing}>
                  Test connection
                </Button>
                {testMsg ? (
                  <span className={cn('text-[11px] font-medium', testMsg.ok ? 'text-good' : 'text-bad')}>
                    {testMsg.text}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button className="flex-1" onClick={() => setStep(2)}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mt-3 w-full text-center text-[11px] font-medium text-muted underline underline-offset-4"
            >
              Skip AI for now
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-7 animate-fade-in">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-good/12 text-good">
              <Check className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-ink">Ready when you are.</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              You can change every one of these settings later. Nothing is sent anywhere unless you tap an AI action.
            </p>

            <div className="mt-6 card card-pad">
              <Toggle
                checked={startSample}
                onChange={setStartSample}
                label="Start with sample data"
                hint="90 days of realistic spending, bills and budgets. Remove it instantly from Settings → Data. (Off by default.)"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-muted">
              <Summary label="Currency" value={currency} />
              <Summary label="Pay day" value={`Day ${payDay}`} />
              <Summary label="Week starts" value={weekStart === 'mon' ? 'Monday' : 'Sunday'} />
              <Summary label="AI" value={apiKey ? def.short : 'Not configured'} />
            </div>

            <Button size="lg" className="mt-6 w-full" onClick={() => finish(false)} loading={saving}>
              Start using Spendwise
            </Button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="mt-3 w-full text-center text-[11px] font-medium text-muted underline underline-offset-4"
            >
              Back
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted/80">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</p>
    </div>
  )
}
