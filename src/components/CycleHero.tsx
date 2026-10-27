import { useMemo } from 'react'
import { CircleDollarSign, Plus } from 'lucide-react'
import { useApp } from '../store'
import { spendDelta } from '../lib/analytics'
import { addDays, daysBetween, formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { cn } from './ui'

/**
 * The home screen's one bold object: today's safe-to-spend figure on a dark slip, with the whole
 * pay cycle drawn underneath — one bar per day, its height the money spent that day, today ringed,
 * days still to come as dots, and a mark on the days a bill is due.
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

export function CycleHero({ onAdd }: { onAdd: (type?: 'income') => void }) {
  const { safe, transactions, bills, schedules, settings, today, potList } = useApp()
  const currency = settings.currency
  const range = safe.range

  const days = useMemo(() => {
    const len = daysBetween(range.start, range.end) + 1
    const potIds = new Set(potList.map((p) => p.pot.id))
    const spent = new Array<number>(len).fill(0)
    for (const t of transactions) {
      if (t.date < range.start || t.date > range.end || (t.potId && potIds.has(t.potId))) continue
      const i = daysBetween(range.start, t.date)
      spent[i] += spendDelta(t)
    }
    const dueDays = new Set<number>()
    for (const b of bills) {
      const due = schedules.get(b.id)?.nextDue
      if (b.active && !b.archived && due && due >= range.start && due <= range.end) dueDays.add(daysBetween(range.start, due))
    }
    const todayIdx = daysBetween(range.start, today)
    const max = Math.max(1, ...spent.slice(0, todayIdx + 1))
    // Square root keeps one big day (rent) from flattening every other day.
    return spent.map((v, i) => ({ i, date: addDays(range.start, i), spent: Math.max(0, v), h: Math.sqrt(Math.max(0, v) / max), past: i <= todayIdx, today: i === todayIdx, bill: dueDays.has(i) }))
  }, [transactions, bills, schedules, range, today, potList])

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

      {/* The pay cycle, one mark per day */}
      <div className="mt-6" aria-hidden>
        <div className="flex h-14 items-end gap-[3px]">
          {days.map((d) => (
            <div key={d.i} className="relative flex h-full flex-1 flex-col items-center justify-end">
              {d.bill ? <span className="absolute -top-0.5 h-1 w-1 rounded-full bg-[#E4AA48]" /> : null}
              {d.past ? (
                <span
                  className={cn('w-full max-w-[10px] origin-bottom animate-tick rounded-[3px]', d.today ? 'bg-white' : d.spent ? 'bg-white/45' : 'bg-white/12')}
                  style={{ height: `${Math.max(8, d.h * 100)}%`, animationDelay: `${Math.min(d.i, 40) * 14}ms` }}
                  title={`${formatDate(d.date, 'short')}: ${formatMoney(d.spent, currency)}`}
                />
              ) : (
                <span className="mb-0.5 h-1 w-1 rounded-full bg-white/25" />
              )}
              {d.today ? <span className="absolute -bottom-2.5 h-[3px] w-[3px] rounded-full bg-white" /> : null}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between text-[11px] text-white/45">
          <span>{formatDate(range.start, 'short')}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E4AA48]" /> bill due
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-white" /> today
            </span>
          </span>
          <span>{formatDate(range.end, 'short')}</span>
        </div>
      </div>

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
