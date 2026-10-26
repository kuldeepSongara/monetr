import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  RefreshCw,
  Send,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react'
import { useApp } from '../store'
import type { DigestCache, ISODate, SubscriptionVerdict } from '../types'
import { buildSpendContext } from '../ai/aiContext'
import { askAboutSpending, auditSubscriptions, generateDigest } from '../ai/tasks'
import { canUseProfile } from '../ai/providers'
import { getMeta, setMeta } from '../db/db'
import { addDays, daysBetween, formatDate, payCycle, relativeTime, shiftPeriod, todayISO, type Range } from '../lib/dates'
import { byMerchant, changePct, monthlySeries, totals, txnRange, weekdayPattern } from '../lib/analytics'
import { formatMoney } from '../lib/money'
import { Badge, Button, Card, EmptyState, Input, Markdown, SectionTitle, Segmented, Spinner, cn } from '../components/ui'
import { Heatmap, MerchantBars, MonthlyBars, WeekdayBars } from '../components/charts'
import { ReportExport } from '../components/ReportExport'
import { ShareCharts } from '../components/ShareCharts'

type RangeKey = 'cycle' | 'last' | '30' | '90'

const ASK_SUGGESTIONS = [
  'Where can I cut back the most?',
  'Why is my spending up this cycle?',
  'Which subscriptions should I cancel?',
  'Can I afford a 200 spend right now?',
]

export function Insights() {
  const {
    transactions,
    categories,
    settings,
    rows,
    bills,
    schedules,
    anomalies,
    subscriptions,
    profiles,
    today,
    notify,
  } = useApp()
  const currency = settings.currency
  const aiReady = profiles.some(canUseProfile)

  const [rangeKey, setRangeKey] = useState<RangeKey>('cycle')
  const [digest, setDigest] = useState<DigestCache | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)
  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [answers, setAnswers] = useState<{ id: string; q: string; a: string; model: string; at: string }[]>([])
  const [verdicts, setVerdicts] = useState<Record<string, SubscriptionVerdict>>({})
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditModel, setAuditModel] = useState('')

  useEffect(() => {
    getMeta<DigestCache>('digest').then(setDigest).catch(() => {})
  }, [])

  const cycle = useMemo(() => payCycle(today, settings.payCycleStartDay), [today, settings.payCycleStartDay])

  const range: Range = useMemo(() => {
    if (rangeKey === 'last') return shiftPeriod(cycle, -1, false)
    if (rangeKey === '30') return { start: addDays(today, -29), end: today }
    if (rangeKey === '90') return { start: addDays(today, -89), end: today }
    return cycle
  }, [rangeKey, cycle, today])

  const previousRange: Range = useMemo(() => {
    if (rangeKey === 'cycle' || rangeKey === 'last') return shiftPeriod(range, -1, false)
    const length = daysBetween(range.start, range.end) + 1
    return { start: addDays(range.start, -length), end: addDays(range.start, -1) }
  }, [range, rangeKey])

  const current = useMemo(() => txnRange(transactions, range), [transactions, range])
  const previous = useMemo(() => txnRange(transactions, previousRange), [transactions, previousRange])
  const nowTotals = totals(current)
  const prevTotals = totals(previous)
  const expenseChange = changePct(nowTotals.expense, prevTotals.expense)

  const months = useMemo(() => monthlySeries(transactions, 6, today), [transactions, today])
  const weekdays = useMemo(() => weekdayPattern(current, settings.weekStart), [current, settings.weekStart])
  const merchants = useMemo(() => byMerchant(current, 6), [current])
  const last90 = useMemo(() => ({ start: addDays(today, -89), end: today }), [today])

  const context = useMemo(
    () =>
      buildSpendContext({
        txns: transactions,
        categories,
        settings,
        today,
        range,
        previousRange,
        rows,
        bills,
        schedules,
        anomalies,
        subscriptions,
        daysLeft: Math.max(1, daysBetween(today, range.end) + 1),
      }),
    [transactions, categories, settings, today, range, previousRange, rows, bills, schedules, anomalies, subscriptions],
  )

  const subs = subscriptions.slice(0, 12)
  const subsMonthly = subscriptions.reduce((s, x) => s + x.monthlyAmount, 0)

  async function runDigest() {
    if (!aiReady) {
      notify('Add an AI profile in Settings first.', 'error')
      return
    }
    setDigestBusy(true)
    try {
      const { text, result } = await generateDigest(context)
      const cache: DigestCache = {
        text,
        at: new Date().toISOString(),
        rangeStart: range.start,
        rangeEnd: range.end,
        profileName: `${result.profileName} · ${result.model}`,
      }
      await setMeta('digest', cache)
      setDigest(cache)
      notify('Digest ready', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not generate a digest', 'error')
    } finally {
      setDigestBusy(false)
    }
  }

  async function ask(text: string) {
    const q = text.trim()
    if (!q || askBusy) return
    if (!aiReady) {
      notify('Add an AI profile in Settings first.', 'error')
      return
    }
    setAskBusy(true)
    setQuestion('')
    try {
      const { text: answer, result } = await askAboutSpending(q, context)
      setAnswers((prev) => [
        { id: `${Date.now()}`, q, a: answer, model: result.profileName, at: new Date().toISOString() },
        ...prev,
      ])
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The AI could not answer', 'error')
    } finally {
      setAskBusy(false)
    }
  }

  async function runAudit() {
    if (!subs.length) return
    if (!aiReady) {
      notify('Add an AI profile in Settings first.', 'error')
      return
    }
    setAuditBusy(true)
    try {
      const { items, result } = await auditSubscriptions(subs, currency)
      const map: Record<string, SubscriptionVerdict> = {}
      for (const i of items) map[i.id] = i
      setVerdicts(map)
      setAuditModel(`${result.profileName} · ${result.model}`)
      notify(`Reviewed ${items.length} subscriptions`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Subscription audit failed', 'error')
    } finally {
      setAuditBusy(false)
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="flex justify-end gap-2">
        <ShareCharts variant="soft" label="Share charts" />
        <ReportExport variant="soft" />
      </div>
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-ink">Period</p>
          <span className="text-[10px] text-muted">
            {formatDate(range.start, 'short')} – {formatDate(range.end, 'short')}
          </span>
        </div>
        <Segmented
          value={rangeKey}
          onChange={setRangeKey}
          size="sm"
          options={[
            { value: 'cycle', label: 'This cycle' },
            { value: 'last', label: 'Last cycle' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Spent" value={formatMoney(nowTotals.expense, currency)} />
          <MiniStat label="Income" value={formatMoney(nowTotals.income, currency)} tone="good" />
          <MiniStat
            label="vs previous"
            value={expenseChange === null ? '—' : `${expenseChange > 0 ? '+' : ''}${Math.round(expenseChange)}%`}
            tone={expenseChange === null ? undefined : expenseChange > 0 ? 'bad' : 'good'}
          />
        </div>
      </Card>

      <Card className="relative overflow-hidden border-accent/25 bg-gradient-to-br from-accent/[0.09] to-surface">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <SectionTitle title="AI digest" sub={digest ? `For ${formatDate(digest.rangeStart, 'short')} – ${formatDate(digest.rangeEnd, 'short')}` : 'A short read on your money'} />
          </div>
          <Button size="sm" variant={digest ? 'ghost' : 'primary'} onClick={runDigest} loading={digestBusy}>
            {digest ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {digest ? 'Refresh' : 'Generate'}
          </Button>
        </div>

        {!aiReady ? (
          <p className="text-xs leading-relaxed text-muted">
            Connect Gemini or any other provider in{' '}
            <Link to="/settings" className="font-semibold text-accent underline underline-offset-2">
              Settings → AI profiles
            </Link>{' '}
            to get written insights and anomaly explanations.
          </p>
        ) : digestBusy ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <Spinner className="h-5 w-5" />
            <p className="text-xs text-muted">Reading your numbers…</p>
          </div>
        ) : digest ? (
          <div>
            <Markdown text={digest.text} />
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-2 text-[10px] text-muted">
              <span>{digest.profileName}</span>
              <span>{relativeTime(digest.at)}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            Generate a digest for the selected period. It uses only your logged numbers — budgets, bills, anomalies and
            category trends — then writes a short, concrete summary.
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle title="Ask about your spending" sub="Answers use the current period only" />
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void ask(question)
            }}
            placeholder="e.g. how much did I spend on food?"
          />
          <Button onClick={() => ask(question)} loading={askBusy} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {ASK_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="chip whitespace-nowrap"
              disabled={askBusy}
            >
              {s}
            </button>
          ))}
        </div>

        {askBusy ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Spinner className="h-3.5 w-3.5" /> Thinking…
          </div>
        ) : null}

        {answers.length ? (
          <div className="mt-3 space-y-2.5 border-t border-line/60 pt-3">
            {answers.map((a) => (
              <div key={a.id} className="rounded-xl border border-line/60 bg-surface2/40 p-3">
                <p className="text-[11px] font-semibold text-ink">{a.q}</p>
                <div className="mt-1.5">
                  <Markdown text={a.a} />
                </div>
                <p className="mt-2 text-[9px] text-muted">
                  {a.model} · {relativeTime(a.at)}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title="Anomalies"
            sub="Computed locally, no AI needed"
            action={<Badge tone={anomalies.length ? 'warn' : 'good'}>{anomalies.length}</Badge>}
          />
          {anomalies.length ? (
            <div className="space-y-2">
              {anomalies.map((a) => (
                <div key={a.id} className="rounded-xl border border-line/60 bg-surface2/40 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <TriangleAlert
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                        a.severity === 'high' ? 'text-bad' : a.severity === 'medium' ? 'text-warn' : 'text-muted',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-ink">{a.title}</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{a.detail}</p>
                    </div>
                    <span className="tnum shrink-0 text-[11px] font-semibold text-muted">{formatMoney(a.amount, currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<BadgeCheck className="h-6 w-6 text-good" />}
              title="Nothing unusual"
              body="No category spikes, duplicate charges or oversized purchases in the current cycle."
            />
          )}
        </Card>

        <Card>
          <SectionTitle
            title="Subscriptions"
            sub={`${formatMoney(subsMonthly, currency)} / month detected`}
            action={
              subs.length ? (
                <Button size="sm" variant="soft" onClick={runAudit} loading={auditBusy}>
                  <Wand2 className="h-3.5 w-3.5" /> Audit
                </Button>
              ) : undefined
            }
          />
          {subs.length ? (
            <div className="divide-y divide-line/60">
              {subs.map((s) => {
                const v = verdicts[s.id]
                return (
                  <div key={s.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-ink">{s.merchant}</p>
                        <p className="text-[9px] text-muted">
                          {s.occurrences} charges · every ~{s.intervalDays}d · last {formatDate(s.lastDate, 'short')}
                          {Math.abs(s.priceChangePct) >= 5 ? (
                            <span className={s.priceChangePct > 0 ? ' text-bad' : ' text-good'}>
                              {' '}
                              · {s.priceChangePct > 0 ? '↑' : '↓'}
                              {Math.abs(Math.round(s.priceChangePct))}%
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <span className="tnum shrink-0 text-[11px] font-semibold text-ink">
                        {formatMoney(s.monthlyAmount, currency)}
                      </span>
                      {v ? (
                        <Badge tone={v.verdict === 'cancel' ? 'bad' : v.verdict === 'review' ? 'warn' : 'good'}>
                          {v.verdict}
                        </Badge>
                      ) : null}
                    </div>
                    {v?.reason ? <p className="mt-0.5 pl-0 text-[10px] leading-relaxed text-muted">{v.reason}</p> : null}
                  </div>
                )
              })}
              {auditModel ? <p className="pt-2 text-[9px] text-muted">Audit by {auditModel}</p> : null}
            </div>
          ) : (
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="No recurring charges found"
              body="Once a merchant charges you 3+ times on a regular rhythm, it shows up here."
            />
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle title="Patterns" sub="Read the shape of your spending" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted">Income vs spending · 6 months</p>
            <MonthlyBars data={months} height={160} />
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted">Average day of week · this period</p>
            <WeekdayBars data={weekdays} height={160} />
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted">Spending heatmap · 90 days</p>
            <Heatmap txns={transactions} range={last90} weekStart={settings.weekStart} />
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold text-muted">Top merchants · this period</p>
            <MerchantBars data={merchants} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line/60 bg-surface2/40 px-3 py-2.5">
          <div>
            <p className="text-[11px] font-semibold text-ink">Want the full story?</p>
            <p className="text-[10px] text-muted">Generate a digest or ask a question above.</p>
          </div>
          <Button size="sm" variant="soft" onClick={runDigest} loading={digestBusy}>
            <ArrowRight className="h-3.5 w-3.5" /> Digest
          </Button>
        </div>
      </Card>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line/60 bg-surface2/40 px-2.5 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('tnum mt-0.5 truncate text-[13px] font-bold', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </p>
    </div>
  )
}
