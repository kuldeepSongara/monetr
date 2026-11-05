import { useEffect, useRef, useState } from 'react'
import type { CycleDay } from '../lib/cycleDays'
import { formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { cn } from './ui'

/**
 * The pay cycle as one bar per day. Each bar shows everyday spending on top of fixed costs (bills,
 * rent, subscriptions). Hover a bar (or tap it on a phone, or tab to it) to see the date, the total
 * and what it was spent on.
 */
export function CycleStrip({
  days,
  todayIdx,
  billDays,
  currency,
  showToday,
}: {
  days: CycleDay[]
  /** Last day with data: today, or the last day of a finished cycle. */
  todayIdx: number
  billDays: Set<number>
  currency: string
  showToday: boolean
}) {
  const [open, setOpen] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  // A tap focuses the bar (which opens it) and then clicks it; only a second tap on an open bar closes it.
  const tapClose = useRef(false)
  const max = Math.max(1, ...days.slice(0, todayIdx + 1).map((d) => d.total))

  // Tap anywhere else (or press Escape) to close.
  useEffect(() => {
    if (open === null) return
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const sel = open !== null ? days[open] : null
  const pos = open !== null ? ((open + 0.5) / days.length) * 100 : 0
  // Keep the card inside the slip near the edges.
  const shift = pos < 18 ? '-12%' : pos > 82 ? '-88%' : '-50%'

  return (
    <div ref={wrap} className="relative mt-6">
      {sel ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-[calc(100%+10px)] z-10 w-[min(260px,85vw)] rounded-2xl border border-white/10 bg-[#0F1114]/95 p-3 text-left shadow-[0_16px_40px_-12px_rgb(0_0_0/0.7)] backdrop-blur"
          style={{ left: `${pos}%`, transform: `translateX(${shift})` }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-semibold text-white">
              {formatDate(sel.date, 'day')} {formatDate(sel.date, 'short').split(' ')[1]}
            </p>
            <p className="tnum text-[13px] font-semibold text-white">{formatMoney(sel.total, currency)}</p>
          </div>
          {sel.total > 0 ? (
            <>
              {sel.fixed > 0 ? (
                <p className="mt-0.5 text-[11px] text-white/50">
                  {sel.everyday > 0
                    ? `${formatMoney(sel.everyday, currency)} everyday · ${formatMoney(sel.fixed, currency)} bills & subscriptions`
                    : 'All bills & subscriptions'}
                </p>
              ) : null}
              <div className="mt-2 space-y-1">
                {sel.categories.slice(0, 6).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-[12px]">
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: c.color }} />
                    <span className="truncate text-white/80">
                      {c.emoji} {c.name}
                    </span>
                    <span className="tnum ml-auto shrink-0 text-white">{formatMoney(c.amount, currency)}</span>
                  </div>
                ))}
                {sel.categories.length > 6 ? <p className="text-[11px] text-white/45">+ {sel.categories.length - 6} more categories</p> : null}
              </div>
              <p className="mt-2 text-[11px] text-white/40">
                {sel.count} entr{sel.count === 1 ? 'y' : 'ies'}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-white/50">Nothing spent.</p>
          )}
        </div>
      ) : null}

      <div className="flex h-14 items-end gap-[3px]" onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(null)}>
        {days.map((d) => {
          const past = d.i <= todayIdx
          const isToday = showToday && d.i === todayIdx
          const h = Math.sqrt(d.total / max) * 100
          const fixedShare = d.total ? d.fixed / d.total : 0
          return (
            <div key={d.i} className="relative flex h-full flex-1 flex-col items-center justify-end">
              {billDays.has(d.i) ? <span className="absolute -top-0.5 h-1 w-1 rounded-full bg-[#E4AA48]" /> : null}
              {past ? (
                <button
                  type="button"
                  aria-label={`${formatDate(d.date, 'medium')}: ${formatMoney(d.total, currency)}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(d.i)}
                  onFocus={() => setOpen(d.i)}
                  onBlur={() => setOpen((o) => (o === d.i ? null : o))}
                  onPointerDown={(e) => (tapClose.current = e.pointerType !== 'mouse' && open === d.i)}
                  onClick={() => {
                    setOpen(tapClose.current ? null : d.i)
                    tapClose.current = false
                  }}
                  className="group flex h-full w-full max-w-[14px] items-end justify-center outline-none"
                >
                  <span
                    className={cn(
                      'flex w-full max-w-[10px] origin-bottom animate-tick flex-col overflow-hidden rounded-[3px] transition-opacity',
                      open !== null && open !== d.i && 'opacity-40',
                      'group-focus-visible:ring-2 group-focus-visible:ring-white/70',
                    )}
                    style={{ height: `${Math.max(8, h)}%`, animationDelay: `${Math.min(d.i, 40) * 14}ms` }}
                  >
                    {d.total ? (
                      <>
                        <span className={cn('w-full flex-1', isToday ? 'bg-white' : 'bg-white/55')} style={{ flexGrow: 1 - fixedShare }} />
                        <span className="w-full bg-[#E4AA48]/75" style={{ flexGrow: fixedShare }} />
                      </>
                    ) : (
                      <span className={cn('h-full w-full', isToday ? 'bg-white/60' : 'bg-white/12')} />
                    )}
                  </span>
                </button>
              ) : (
                <span className="mb-0.5 h-1 w-1 rounded-full bg-white/25" />
              )}
              {isToday ? <span className="absolute -bottom-2.5 h-[3px] w-[3px] rounded-full bg-white" /> : null}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-white/45">
        <span>{formatDate(days[0]?.date ?? '', 'short')}</span>
        <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-[2px] bg-white/70" /> everyday
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-[2px] bg-[#E4AA48]" /> bills
          </span>
          {showToday ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[#E4AA48]" /> bill due
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white" /> today
              </span>
            </>
          ) : null}
        </span>
        <span>{formatDate(days[days.length - 1]?.date ?? '', 'short')}</span>
      </div>
    </div>
  )
}
