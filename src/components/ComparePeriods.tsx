import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, GitCompareArrows } from 'lucide-react'
import { useApp } from '../store'
import { comparePeriods, lastYear, sameLength } from '../lib/compare'
import { addDays, daysBetween, formatDate, type Range } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { ComparisonChart } from './charts'
import { Card, Input, SectionTitle, cn } from './ui'

type Against = 'previous' | 'year' | 'custom'

const span = (r: Range) => `${formatDate(r.start, 'short')} – ${formatDate(r.end, 'short')}`

/** Side-by-side view of the selected period against an earlier one. All computed on this device. */
export function ComparePeriods({ range, previousRange, label }: { range: Range; previousRange: Range; label: string }) {
  const { transactions, categories, settings, today } = useApp()
  const currency = settings.currency
  const [against, setAgainst] = useState<Against>('previous')
  const [customStart, setCustomStart] = useState(() => addDays(previousRange.start, -daysBetween(previousRange.start, previousRange.end) - 1))
  const [showAll, setShowAll] = useState(false)

  const b: Range = against === 'year' ? lastYear(range) : against === 'custom' ? sameLength(range, customStart) : previousRange
  const cmp = useMemo(() => comparePeriods(transactions, categories, range, b, today), [transactions, categories, range, b.start, b.end, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const fair = cmp.bSameDays ?? cmp.b.spent
  const diff = cmp.a.spent - fair
  const pct = fair ? (diff / fair) * 100 : null
  const up = diff > 0
  const cats = showAll ? cmp.categories : cmp.categories.slice(0, 6)
  const maxCat = Math.max(1, ...cmp.categories.map((c) => Math.max(c.a, c.b)))
  const labelB = against === 'year' ? 'Last year' : against === 'custom' ? 'Compared' : 'Before'
  const empty = !cmp.a.spent && !cmp.b.spent

  return (
    <Card className="space-y-3">
      <SectionTitle title="Compare" sub={`${label} vs ${span(b)}`} />
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['previous', 'Previous period'],
            ['year', 'Same time last year'],
            ['custom', 'Pick dates'],
          ] as [Against, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAgainst(k)} className={cn('chip', against === k && 'chip-active')}>
            {l}
          </button>
        ))}
      </div>
      {against === 'custom' ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Starting</span>
          <Input type="date" value={customStart} max={today} onChange={(e) => e.target.value && setCustomStart(e.target.value)} className="max-w-[11rem]" />
          <span className="text-[11px] text-muted">for {daysBetween(range.start, range.end) + 1} days</span>
        </div>
      ) : null}

      {empty ? (
        <p className="py-4 text-center text-[11px] text-muted">No spending in either period yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-2.5">
              <p className="text-[11px] font-medium text-muted">{label}</p>
              <p className="tnum text-lg font-bold text-ink">{formatMoney(cmp.a.spent, currency)}</p>
              <p className="text-[10px] text-muted">{cmp.bSameDays !== null ? `${cmp.daysElapsed} days so far · ` : ''}{cmp.a.count} spends</p>
            </div>
            <div className="rounded-xl border border-line/70 p-2.5">
              <p className="text-[11px] font-medium text-muted">{span(b)}</p>
              <p className="tnum text-lg font-bold text-ink/80">{formatMoney(fair, currency)}</p>
              <p className="text-[10px] text-muted">
                {cmp.bSameDays !== null ? `first ${cmp.daysElapsed} days · ${formatMoney(cmp.b.spent, currency)} in full` : `${cmp.b.count} spends`}
              </p>
            </div>
          </div>

          <p className={cn('flex items-center gap-1 text-[12px] font-semibold', pct === null ? 'text-muted' : up ? 'text-bad' : 'text-good')}>
            <GitCompareArrows className="h-3.5 w-3.5" />
            {pct === null
              ? 'Nothing to compare against in that period.'
              : `${formatMoney(Math.abs(diff), currency)} ${up ? 'more' : 'less'} (${Math.abs(Math.round(pct))}%)${cmp.bSameDays !== null ? ` than the first ${cmp.daysElapsed} days of that period` : ''}`}
          </p>

          <ComparisonChart data={cmp.cumulative} labelA={label} labelB={labelB} />
          <div className="flex gap-4 text-[10px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full bg-accent" /> {label} (running total)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t-2 border-dashed border-muted" /> {span(b)}
            </span>
          </div>

          <div>
            <p className="label mb-1.5">By category{cmp.bSameDays !== null ? ` · same ${cmp.daysElapsed} days` : ''}</p>
            <div className="space-y-2">
              {cats.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink">
                      {c.emoji} {c.name}
                    </span>
                    <span className="tnum flex shrink-0 items-center gap-1.5">
                      <span className="text-muted">{formatMoney(c.b, currency)} →</span>
                      <span className="font-semibold text-ink">{formatMoney(c.a, currency)}</span>
                      {c.delta ? (
                        <span className={cn('flex items-center text-[10px] font-semibold', c.delta > 0 ? 'text-bad' : 'text-good')}>
                          {c.delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {formatMoney(Math.abs(c.delta), currency)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <div className="h-1.5 rounded-full" style={{ width: `${(c.a / maxCat) * 100}%`, background: c.color, minWidth: c.a ? 3 : 0 }} />
                    <div className="h-1 rounded-full opacity-40" style={{ width: `${(c.b / maxCat) * 100}%`, background: c.color, minWidth: c.b ? 3 : 0 }} />
                  </div>
                </div>
              ))}
            </div>
            {cmp.categories.length > 6 ? (
              <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-[11px] font-medium text-muted underline underline-offset-2 hover:text-ink">
                {showAll ? 'Show fewer' : `Show all ${cmp.categories.length} categories`}
              </button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  )
}
