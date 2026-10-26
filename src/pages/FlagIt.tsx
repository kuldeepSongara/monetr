import { useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, Check, FileCheck2, FileUp, Flag, Lightbulb, Loader2, RotateCw, Trash2, Upload } from 'lucide-react'
import { useApp } from '../store'
import type { FlagEntry, FlagIdea, ImportRecord, TxnType } from '../types'
import { addTransaction, db, learnRules, recordDeletion } from '../db/db'
import { buildSpendContext } from '../ai/aiContext'
import { flagReview, habitForecast, preSpendCheck, type StatementLine } from '../ai/tasks'
import { canUseProfile } from '../ai/providers'
import { payCycle, shiftPeriod, daysBetween, formatDate, relativeTime } from '../lib/dates'
import { CURRENCIES, formatMoney, minorFactor, toMinor } from '../lib/money'
import { computeHolding, portfolioTotals } from '../lib/investments'
import { findDuplicate, suggestedFxRate } from '../lib/suggest'
import { pickFiles, uid } from '../lib/utils'
import { discardImport, markImported, retryImport, saveReview, startImport } from '../lib/importJobs'
import { useImports } from '../components/ImportStatus'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Confirm, Field, Input, Markdown, SectionTitle, Select, cn } from '../components/ui'

type Tab = 'flags' | 'pre' | 'habits' | 'import'

interface ReviewRow extends StatementLine {
  key: string
  include: boolean
  duplicateOf?: string
}

export default function FlagIt() {
  const app = useApp()
  const { notify, profiles, refresh, settings, transactions, categories, rules, today, currencyProfiles } = app
  const base = settings.currency
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') as Tab) || 'flags')
  useEffect(() => {
    const t = params.get('tab') as Tab | null
    if (t) setTab(t)
  }, [params])
  const [flags, setFlags] = useState<FlagEntry[]>([])
  const [ideas, setIdeas] = useState<FlagIdea[]>([])
  const [idea, setIdea] = useState({ title: '', price: '', url: '', notes: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewRow[]>([])
  const [fileName, setFileName] = useState('')
  const [rates, setRates] = useState<Record<string, string>>({})
  const aiReady = profiles.some(canUseProfile)

  async function load() {
    const [f, i] = await Promise.all([db.flags.toArray(), db.flagIdeas.toArray()])
    setFlags(f.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setIdeas(i.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  }

  useEffect(() => {
    void load()
  }, [app.transactions])

  /* ------------------------ context sent to the AI ----------------------- */
  const context = useMemo(() => {
    const unit = minorFactor(base)
    const major = (m: number) => Math.round((m / unit) * 100) / 100
    const range = payCycle(today, settings.payCycleStartDay)
    const spend = buildSpendContext({
      txns: transactions,
      categories,
      settings,
      today,
      range,
      previousRange: shiftPeriod(range, -1, false),
      rows: app.rows,
      bills: app.bills,
      schedules: app.schedules,
      anomalies: app.anomalies,
      subscriptions: app.subscriptions,
      daysLeft: app.safe.daysLeft,
    })
    const recent = transactions.filter((t) => t.date <= today && daysBetween(t.date, today) <= 60)
    const foreign = recent
      .filter((t) => t.currency !== base && t.type === 'expense')
      .slice(0, 25)
      .map((t) => ({ date: t.date, merchant: t.merchant, amount: t.amount / minorFactor(t.currency), currency: t.currency, inBase: major(t.baseAmount) }))
    const feeLines = recent
      .filter((t) => t.categoryId === 'cat_fees' || /\b(fx|forex|foreign|conversion|intl|international)\b/i.test(`${t.merchant} ${t.note ?? ''}`))
      .map((t) => ({ date: t.date, merchant: t.merchant, amount: major(t.baseAmount) }))
    const holdings = app.investments.filter((i) => !i.archived).map((i) => computeHolding(i, app.investmentTxs, base, currencyProfiles))
    const totals = portfolioTotals(holdings)
    return {
      ...spend,
      safeToSpend: { perDay: major(app.safe.perDay), discretionaryLeft: major(app.safe.discretionary), billsReserved: major(app.safe.billsReserved) },
      foreignCurrencySpend: foreign,
      feeLines,
      investments: holdings.length
        ? {
            totals: { cost: major(totals.cost), value: major(totals.value), unrealised: major(totals.unrealised), income: major(totals.income) },
            holdings: holdings.map((h) => ({ name: h.investment.name, type: h.investment.type, currency: h.investment.currency, valueInBase: major(h.base.value), shareOfPortfolio: totals.value ? Math.round((h.base.value / totals.value) * 100) : 0 })),
          }
        : undefined,
    }
  }, [app, transactions, categories, settings, today, base, currencyProfiles])

  async function runReview(kind: 'weekly' | 'habits') {
    setBusy(kind)
    try {
      const { text } = kind === 'weekly' ? await flagReview(context, base) : await habitForecast(context, base)
      const now = new Date().toISOString()
      await db.flags.put({ id: uid('flg_'), kind, status: 'open', title: kind === 'weekly' ? `Review · ${formatDate(today, 'medium')}` : `Habits · ${formatDate(today, 'medium')}`, body: text, createdAt: now, updatedAt: now })
      await load()
      await refresh()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'AI request failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function checkIdea() {
    if (!idea.title.trim()) return notify('What are you thinking of buying?', 'error')
    setBusy('pre')
    try {
      const words = idea.title.toLowerCase().split(/\W+/).filter((w) => w.length >= 4)
      const similar = transactions
        .filter((t) => t.type === 'expense' && words.some((w) => `${t.merchant} ${t.note ?? ''}`.toLowerCase().includes(w)))
        .slice(0, 10)
        .map((t) => ({ date: t.date, merchant: t.merchant, amount: t.baseAmount / minorFactor(base), note: t.note }))
      const { text } = await preSpendCheck(idea, { ...context, similarPastPurchases: similar }, base)
      const now = new Date().toISOString()
      await db.flagIdeas.put({ id: uid('idea_'), status: 'open', ...idea, analysis: text, createdAt: now, updatedAt: now })
      setIdea({ title: '', price: '', url: '', notes: '' })
      await load()
      await refresh()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'AI request failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function removeFlag(id: string, table: 'flags' | 'flagIdeas') {
    await recordDeletion(table, [id])
    await db.table(table).delete(id)
    await load()
    await refresh()
  }

  async function setIdeaStatus(i: FlagIdea, status: FlagIdea['status']) {
    await db.flagIdeas.put({ ...i, status, updatedAt: new Date().toISOString() })
    await load()
    await refresh()
  }

  /* ---------------------------- statement import ------------------------- */
  // Reading happens in a background job (lib/importJobs) that survives leaving this screen.
  const jobs = useImports()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reimport, setReimport] = useState<{ file: File; job: ImportRecord } | null>(null)
  const reviewJobs = jobs.filter((j) => j.status === 'review')
  const activeJob = jobs.find((j) => j.id === activeId && j.status === 'review') ?? reviewJobs[reviewJobs.length - 1]
  const runningJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'processing')
  const problemJobs = jobs.filter((j) => j.status === 'failed' || j.status === 'interrupted')
  const history = jobs.filter((j) => j.status === 'imported').slice(0, 5)

  // Load the selected job's lines into the editable review (once per job).
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!activeJob) {
      loadedFor.current = null
      setReview([])
      return
    }
    if (loadedFor.current === activeJob.id) return
    loadedFor.current = activeJob.id
    // Re-check against what's recorded *now* — e.g. an overlapping screenshot you imported a minute ago.
    setReview(
      ((activeJob.lines ?? []) as ReviewRow[]).map((r) => {
        const dup = findDuplicate({ date: r.date, merchant: r.merchant, amount: toMinor(r.amount, r.currency), currency: r.currency }, transactions)
        return dup && !r.duplicateOf ? { ...r, duplicateOf: dup.id, include: false } : r
      }),
    )
    setRates(activeJob.rates ?? {})
    setFileName(activeJob.fileName ?? 'Statement')
  }, [activeJob])

  // Persist review edits so they survive navigating away.
  useEffect(() => {
    if (!activeJob || loadedFor.current !== activeJob.id) return
    const t = window.setTimeout(() => void saveReview(activeJob.id, review, rates), 400)
    return () => window.clearTimeout(t)
  }, [review, rates, activeJob])

  async function queue(file: File, force = false) {
    try {
      const res = await startImport(file, { force })
      if (res.kind === 'started') notify(`Reading ${file.name}. You can leave this screen — you'll get a notice when it's ready.`, 'info')
      else if (res.kind === 'in-progress') notify(`${file.name} is already being read — no need to upload it again.`, 'info')
      else if (res.kind === 'awaiting-review') {
        setActiveId(res.job.id)
        notify(`${file.name} was already read and is waiting for your review below.`, 'info')
      } else setReimport({ file, job: res.job })
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not read that file', 'error')
    }
  }

  async function scan() {
    const files = await pickFiles('image/*,application/pdf,.pdf,.csv,.txt,text/plain,text/csv')
    for (const f of files) await queue(f)
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setReview((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function commit() {
    const chosen = review.filter((r) => r.include)
    if (!chosen.length) return notify('Tick at least one row to import', 'error')
    for (const cur of new Set(chosen.map((r) => r.currency))) {
      if (cur !== base && !(Number(rates[cur]) > 0)) return notify(`Enter the ${cur} → ${base} rate first`, 'error')
    }
    setBusy('commit')
    try {
      for (const r of chosen) {
        await addTransaction(
          {
            date: r.date,
            // Statement amounts are in major units; storage is minor units (cents).
            amount: toMinor(r.amount, r.currency),
            currency: r.currency,
            fxRate: r.currency === base ? 1 : Number(rates[r.currency]),
            type: r.type,
            categoryId: r.categoryId,
            merchant: r.merchant,
            note: r.note,
            source: 'import',
            categorySource: 'ai',
          },
          base,
        )
      }
      await learnRules(chosen.filter((r) => r.type !== 'transfer').map((r) => ({ merchant: r.merchant, categoryId: r.categoryId })))
      // Refresh first so the next review (e.g. an overlapping screenshot) is checked against these new entries.
      await refresh()
      loadedFor.current = null
      setReview([])
      if (activeJob) await markImported(activeJob.id, chosen.length)
      notify(`Imported ${chosen.length} transaction${chosen.length === 1 ? '' : 's'}`, 'success')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Import failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  const catsFor = (type: TxnType) => categories.filter((c) => c.kind === (type === 'refund' ? 'expense' : type))
  const reviewFlags = flags.filter((f) => f.kind === 'weekly')
  const habitFlags = flags.filter((f) => f.kind === 'habits')

  return (
    <div className="space-y-3.5">
      <p className="text-[11px] text-muted">AI checks on your real numbers: reviews, “should I buy this?”, habits and statement import.</p>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {(
          [
            ['flags', Flag, 'Review'],
            ['pre', Lightbulb, 'Before you buy'],
            ['habits', BrainCircuit, 'Habits'],
            ['import', Upload, 'Statement import'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn('chip flex items-center gap-1.5 whitespace-nowrap', tab === id && 'chip-active')}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {!aiReady ? <p className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">Add an AI profile in Settings → AI profiles to use flagIt.</p> : null}

      {tab === 'flags' ? (
        <Card>
          <SectionTitle
            title="Spending review"
            sub="Flags unusual spend, FX fees, subscriptions and budget pressure"
            action={
              <Button size="sm" onClick={() => runReview('weekly')} loading={busy === 'weekly'} disabled={!aiReady}>
                Run review
              </Button>
            }
          />
          <FlagList items={reviewFlags} empty="No reviews yet. Run one — it uses this cycle's numbers." onDelete={(id) => removeFlag(id, 'flags')} />
        </Card>
      ) : null}

      {tab === 'habits' ? (
        <Card>
          <SectionTitle
            title="Habits & prevention"
            sub="Predicts your next likely spends and cheaper swaps"
            action={
              <Button size="sm" onClick={() => runReview('habits')} loading={busy === 'habits'} disabled={!aiReady}>
                Predict
              </Button>
            }
          />
          <FlagList items={habitFlags} empty="No predictions yet." onDelete={(id) => removeFlag(id, 'flags')} />
        </Card>
      ) : null}

      {tab === 'pre' ? (
        <Card>
          <SectionTitle title="Before you buy" sub="Checks it against your budget, bills and similar past purchases" />
          <div className="space-y-2">
            <Input placeholder="What is it? (e.g. MacBook Air M4)" value={idea.title} onChange={(e) => setIdea({ ...idea, title: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Price (e.g. 1499 CAD)" value={idea.price} onChange={(e) => setIdea({ ...idea, price: e.target.value })} />
              <Input placeholder="Store / link (optional)" value={idea.url} onChange={(e) => setIdea({ ...idea, url: e.target.value })} />
            </div>
            <Input placeholder="Why do you want it? (optional)" value={idea.notes} onChange={(e) => setIdea({ ...idea, notes: e.target.value })} />
            <Button className="w-full" onClick={checkIdea} loading={busy === 'pre'} disabled={!aiReady}>
              Check it
            </Button>
            <p className="text-[10px] text-muted">The AI can't see live prices or browse — it tells you what's worth checking.</p>
          </div>
          <div className="mt-4 space-y-2">
            {ideas.map((i) => (
              <div key={i.id} className="rounded-xl border border-line/70 p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{i.title}</p>
                  {i.price ? <Badge>{i.price}</Badge> : null}
                  {i.status !== 'open' ? <Badge tone={i.status === 'bought' ? 'accent' : 'good'}>{i.status}</Badge> : null}
                </div>
                <div className="mt-2 text-[12px]">
                  <Markdown text={i.analysis} />
                </div>
                <div className="mt-2 flex gap-1.5">
                  {i.status === 'open' ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setIdeaStatus(i, 'skipped')}>
                        <Check className="h-3 w-3" /> Skipped it
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setIdeaStatus(i, 'bought')}>
                        Bought it
                      </Button>
                    </>
                  ) : null}
                  <Button size="sm" variant="plain" className="ml-auto px-1.5 text-muted" onClick={() => removeFlag(i.id, 'flagIdeas')} aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === 'import' ? (
        <Card>
          <SectionTitle title="Import several spendings" sub="Screenshots of your bank app, a PDF/CSV statement or text — review every line before it's added" />
          <Button variant="soft" className="w-full" onClick={scan}>
            <FileUp className="h-4 w-4" /> Choose screenshots or a statement
          </Button>
          <p className="mt-1.5 text-[10px] text-muted">
            Reading continues in the background — leave this screen any time; the header shows progress. CSV exports are read
            on your device with no AI. PDFs need a Gemini, Claude or OpenAI profile; screenshots need a vision model.
          </p>

          {runningJobs.length || problemJobs.length || reviewJobs.length > 1 ? (
            <div className="mt-3 space-y-1.5">
              {runningJobs.map((j) => (
                <div key={j.id} className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/[0.05] px-3 py-2 text-[11px]">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                  <span className="min-w-0 flex-1 truncate text-ink">{j.fileName}</span>
                  <span className="shrink-0 text-muted">{j.status === 'queued' ? 'waiting its turn' : `reading · ${relativeTime(j.startedAt ?? j.createdAt)}`}</span>
                </div>
              ))}
              {problemJobs.map((j) => (
                <div key={j.id} className="rounded-xl border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{j.fileName}</span>
                    {j.source ? (
                      <Button size="sm" variant="soft" onClick={() => retryImport(j.id)}>
                        <RotateCw className="h-3 w-3" /> Retry
                      </Button>
                    ) : null}
                    <Button size="sm" variant="plain" className="px-1.5 text-muted" onClick={() => discardImport(j.id)}>
                      Dismiss
                    </Button>
                  </div>
                  <p className="mt-0.5 text-warn">{j.error}</p>
                </div>
              ))}
              {reviewJobs.length > 1
                ? reviewJobs.map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setActiveId(j.id)}
                      className={cn('flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px]', activeJob?.id === j.id ? 'border-good/50 bg-good/[0.06]' : 'border-line/70')}
                    >
                      <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-good" />
                      <span className="min-w-0 flex-1 truncate text-ink">{j.fileName}</span>
                      <span className="text-muted">{j.count} lines to review</span>
                    </button>
                  ))
                : null}
            </div>
          ) : null}

          {review.length ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>
                  {fileName} · {review.filter((r) => r.include).length} of {review.length} selected
                </span>
                <button type="button" className="underline underline-offset-2" onClick={() => setReview((rows) => rows.map((r) => ({ ...r, include: !rows.every((x) => x.include) })))}>
                  Toggle all
                </button>
              </div>

              {Object.keys(rates).length ? (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-line/70 bg-surface2/40 p-2.5">
                  {Object.keys(rates).map((cur) => (
                    <Field key={cur} label={`1 ${cur} = ? ${base}`}>
                      <Input value={rates[cur]} onChange={(e) => setRates({ ...rates, [cur]: e.target.value })} inputMode="decimal" />
                    </Field>
                  ))}
                </div>
              ) : null}

              {review.map((r) => (
                <div key={r.key} className={cn('rounded-xl border p-2.5', r.include ? 'border-line/70' : 'border-line/40 opacity-60')}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={r.include} onChange={(e) => updateRow(r.key, { include: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" aria-label="Include" />
                    <Input className="h-8 flex-1 py-1 text-[12px]" value={r.merchant} onChange={(e) => updateRow(r.key, { merchant: e.target.value })} />
                    <span className="tnum text-[12px] font-semibold text-ink">{formatMoney(toMinor(r.amount, r.currency), r.currency)}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    <Input type="date" className="h-8 py-1 text-[11px]" value={r.date} onChange={(e) => updateRow(r.key, { date: e.target.value })} />
                    <Input className="h-8 py-1 text-[11px]" inputMode="decimal" value={String(r.amount)} onChange={(e) => updateRow(r.key, { amount: Math.abs(Number(e.target.value)) || 0 })} />
                    <Select className="h-8 py-1 text-[11px]" value={r.currency} onChange={(e) => {
                      const cur = e.target.value
                      updateRow(r.key, { currency: cur })
                      if (cur !== base && rates[cur] === undefined) setRates({ ...rates, [cur]: String(suggestedFxRate(cur, base, transactions, currencyProfiles) ?? '') })
                    }}>
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </Select>
                    <Select
                      className="h-8 py-1 text-[11px]"
                      value={r.type}
                      onChange={(e) => {
                        const type = e.target.value as TxnType
                        updateRow(r.key, { type, categoryId: catsFor(type)[0]?.id ?? r.categoryId })
                      }}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="refund">Refund</option>
                      <option value="transfer">Transfer</option>
                    </Select>
                    <Select className="col-span-2 h-8 py-1 text-[11px] sm:col-span-1" value={r.categoryId} onChange={(e) => updateRow(r.key, { categoryId: e.target.value })}>
                      {catsFor(r.type).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.emoji} {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {r.duplicateOf || r.confidence < 0.5 ? (
                    <p className="mt-1 text-[10px] font-medium text-warn">
                      {r.duplicateOf ? 'Looks like it is already recorded. ' : ''}
                      {r.confidence < 0.5 ? 'Low confidence — check this line.' : ''}
                    </p>
                  ) : null}
                </div>
              ))}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={async () => {
                    if (activeJob) await discardImport(activeJob.id)
                    loadedFor.current = null
                    setReview([])
                  }}
                >
                  Discard
                </Button>
                <Button className="flex-[2]" onClick={commit} loading={busy === 'commit'}>
                  Add {review.filter((r) => r.include).length} to transactions
                </Button>
              </div>
            </div>
          ) : null}
          {history.length && !review.length ? (
            <div className="mt-4">
              <p className="label">Recent imports</p>
              {history.map((j) => (
                <p key={j.id} className="flex justify-between gap-2 py-0.5 text-[11px] text-muted">
                  <span className="truncate">{j.fileName}</span>
                  <span className="shrink-0">
                    {j.importedCount} added · {relativeTime(j.finishedAt ?? j.createdAt)}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Confirm
        open={Boolean(reimport)}
        title="You've imported this file before"
        body={
          reimport
            ? `${reimport.job.fileName} was imported ${relativeTime(reimport.job.finishedAt ?? reimport.job.createdAt)} (${reimport.job.importedCount ?? reimport.job.count} transactions). Reading it again will likely create duplicates — they'd be flagged for review, nothing is removed automatically.`
            : ''
        }
        confirmLabel="Read it again"
        tone="primary"
        onConfirm={async () => {
          if (!reimport) return
          const file = reimport.file
          setReimport(null)
          await queue(file, true)
        }}
        onClose={() => setReimport(null)}
      />
    </div>
  )
}

function FlagList({ items, empty, onDelete }: { items: FlagEntry[]; empty: string; onDelete: (id: string) => void }) {
  if (!items.length) return <p className="text-[11px] text-muted">{empty}</p>
  return (
    <div className="space-y-2">
      {items.map((f) => (
        <div key={f.id} className="rounded-xl border border-line/70 p-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{f.title}</p>
            <button type="button" className="text-muted hover:text-bad" onClick={() => onDelete(f.id)} aria-label="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 text-[12px]">
            <Markdown text={f.body} />
          </div>
        </div>
      ))}
    </div>
  )
}
