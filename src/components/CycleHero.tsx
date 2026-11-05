import { useMemo } from 'react'
import { CircleDollarSign, Plus } from 'lucide-react'
import { useApp } from '../store'
import { cycleDays, cycleInsights, fixedTxnIds, type CycleDay } from '../lib/cycleDays'
import { daysBetween, formatDate, shiftPeriod, type Range } from '../lib/dates'
import { CycleStrip } from './CycleStrip'
import { formatMoney } from '../lib/money'
import { cn } from './ui'

/**
 * The home screen's one bold object: today's safe-to-spend figure on a dark slip, with the whole
 * pay cycle drawn underneath (see CycleStrip) and one line that says something useful about it.
 */

/** Large figure with the cents set smaller, so the whole amount reads first. */
export function MoneyFigure({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
  const text = formatMoney(minor, currency)
  const m = text.match(/^(.*?)([.,]\d{1,3})(\D*)$/)
  return (
    <span className={cn('figure', className)}>
      {m ? (
        <>
          {m[1]}
          <span className="text-[0.5em] tracking-[-0.02em] opacity-60">{m[2]}</span>
          {m[3]}
        </>
      ) : (
        text
      )}
    </span>
  )
}

/** A finished pay cycle: what was spent against what was budgeted. */
export interface PastCycle {
  range: Range
  label: string
  spent: number
  limit: number
}

export function CycleHero({ onAdd, past }: { onAdd: (type?: 'income') => void; past?: PastCycle }) {
  const { safe, transactions, categories, bills, payments, schedules, subscriptions, settings, today: realToday, potList } = useApp()
  const currency = settings.currency
  const range = past?.range ?? safe.range
  // For a finished cycle every day is in the past; nothing is "today" and no bill is upcoming.
  const today = past ? range.end : realToday

  const { days, billDays, insights } = useMemo(() => {
    const potIds = new Set(potList.map((p) => p.pot.id))
    const txns = transactions.filter((t) => !(t.potId && potIds.has(t.potId)))
    const fixed = fixedTxnIds(txns, bills, payments, subscriptions)
    const billDays = new Set<number>()
    for (const b of past ? [] : bills) {
      const due = schedules.get(b.id)?.nextDue
      if (b.active && !b.archived && due && due >= range.start && due <= range.end) billDays.add(daysBetween(range.start, due))
    }
    const insights = cycleInsights({ txns, categories, range, prevRange: shiftPeriod(range, -1, false), today: realToday, fixed, currency, finished: Boolean(past) })
    return { days: cycleDays(txns, categories, range, fixed), billDays, insights }
  }, [transactions, categories, bills, payments, subscriptions, schedules, range, realToday, potList, past, currency])
  const todayIdx = Math.min(days.length - 1, daysBetween(range.start, today))

  if (past) return <PastHero past={past} days={days} insights={insights} onAdd={onAdd} currency={currency} />

  const used = safe.limit ? Math.min(100, (safe.spent / safe.limit) * 100) : 0
  const none = safe.basis === 'none'

  return (
    <section
      aria-label="Safe to spend today"
      className="relative w-full overflow-hidden rounded-[24px] p-5 text-[#ECEDEF] sm:p-6"
      style={{
        background: 'radial-gradient(120% 90% at 100% 0%, #2A2F36 0%, #181B1F 45%, #111316 100%)',
        boxShadow: '0 1px 0 0 rgb(255 255 255 / 0.07) inset, 0 20px 40px -24px rgb(0 0 0 / 0.55)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-white/60">Safe to spend today</p>
        <p className="text-right text-[12px] text-white/45">
          {formatDate(range.start, 'short')} – {formatDate(range.end, 'short')}
        </p>
      </div>

      {none ? (
        <div className="mt-3">
          <p className="text-[32px] font-light leading-tight tracking-[-0.03em]">Set a budget</p>
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-white/55">
            Add budgets or a monthly allowance and this becomes the amount you can spend each day after bills.
          </p>
        </div>
      ) : (
        <>
          <MoneyFigure minor={safe.perDay} currency={currency} className="mt-3 block text-[56px] sm:text-[68px]" />
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/60">
            {safe.remainingBudget < 0
              ? `This cycle is ${formatMoney(-safe.remainingBudget, currency)} over budget, with ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'} to go.`
              : safe.discretionary <= 0
                ? `What's left is set aside for ${formatMoney(safe.billsReserved, currency)} of bills${safe.potsReserved ? ` and ${formatMoney(safe.potsReserved, currency)} for savings pots` : ''} due before the cycle ends.`
                : `${formatMoney(safe.discretionary, currency)} left for the ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'} ahead, after ${formatMoney(safe.billsReserved, currency)} for bills${safe.potsReserved ? ` and ${formatMoney(safe.potsReserved, currency)} for savings pots` : ''}.`}
          </p>
        </>
      )}
      <Insights lines={insights.slice(0, 1)} />

      <CycleStrip days={days} todayIdx={todayIdx} billDays={billDays} currency={currency} showToday />

      {!none ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-white/60">Spent this cycle</span>
            <span className="tnum">
              <span className="font-medium text-white">{formatMoney(safe.spent, currency)}</span>
              <span className="text-white/45"> of {formatMoney(safe.limit, currency)}</span>
            </span>
          </div>
          <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-white/10">
            <div
              className={cn('h-full rounded-full transition-[width] duration-700', safe.overBudget ? 'bg-[#F06A5E]' : 'bg-white')}
              style={{ width: `${used}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onAdd()} className="btn btn-sm bg-white text-[#14161A] hover:bg-white/90">
          <Plus className="h-3.5 w-3.5" /> Add expense
        </button>
        <button type="button" onClick={() => onAdd('income')} className="btn btn-sm border border-white/15 bg-white/[0.06] text-white hover:bg-white/10">
          <CircleDollarSign className="h-3.5 w-3.5" /> Add income
        </button>
      </div>
    </section>
  )
}

function Insights({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div className="mt-3 space-y-1">
      {lines.map((l) => (
        <p key={l} className="max-w-xl text-[13px] leading-relaxed text-white/80">
          {l}
        </p>
      ))}
    </div>
  )
}

const SLIP = {
  background: 'radial-gradient(120% 90% at 100% 0%, #2A2F36 0%, #181B1F 45%, #111316 100%)',
  boxShadow: '0 1px 0 0 rgb(255 255 255 / 0.07) inset, 0 20px 40px -24px rgb(0 0 0 / 0.55)',
}

function PastHero({ past, days, insights, onAdd, currency }: { past: PastCycle; days: CycleDay[]; insights: string[]; onAdd: (type?: 'income') => void; currency: string }) {
  const over = past.limit > 0 && past.spent > past.limit
  const used = past.limit ? Math.min(100, (past.spent / past.limit) * 100) : 0
  return (
    <section aria-label={`How ${past.label} went`} className="relative w-full overflow-hidden rounded-[24px] p-5 text-[#ECEDEF] sm:p-6" style={SLIP}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-white/60">How {past.label} went</p>
        <p className="text-right text-[12px] text-white/45">
          {formatDate(past.range.start, 'short')} – {formatDate(past.range.end, 'short')}
        </p>
      </div>
      <MoneyFigure minor={past.spent} currency={currency} className="mt-3 block text-[56px] sm:text-[68px]" />
      <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/60">
        {past.limit
          ? over
            ? `That's ${formatMoney(past.spent - past.limit, currency)} over the ${formatMoney(past.limit, currency)} budget.`
            : `That's ${formatMoney(past.limit - past.spent, currency)} under the ${formatMoney(past.limit, currency)} budget.`
          : 'No budget was set for this cycle.'}
      </p>
      <Insights lines={insights} />

      <CycleStrip days={days} todayIdx={days.length - 1} billDays={new Set()} currency={currency} showToday={false} />

      {past.limit ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="h-[5px] overflow-hidden rounded-full bg-white/10">
            <div className={cn('h-full rounded-full', over ? 'bg-[#F06A5E]' : 'bg-white')} style={{ width: `${used}%` }} />
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onAdd()} className="btn btn-sm bg-white text-[#14161A] hover:bg-white/90">
          <Plus className="h-3.5 w-3.5" /> Add expense to {past.label}
        </button>
        <button type="button" onClick={() => onAdd('income')} className="btn btn-sm border border-white/15 bg-white/[0.06] text-white hover:bg-white/10">
          <CircleDollarSign className="h-3.5 w-3.5" /> Add income
        </button>
      </div>
    </section>
  )
}
