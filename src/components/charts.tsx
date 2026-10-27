import { useMemo } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CategoryTotal, DayPoint, MerchantTotal, MonthPoint, WeekdayPoint } from '../lib/analytics'
import type { Txn } from '../types'
import { formatMoney, formatMoneyShort } from '../lib/money'
import { useApp } from '../store'
import { addDays, daysBetween, formatDate, startOfWeek, type Range } from '../lib/dates'
import { cn } from './ui'

const AXIS = { fontSize: 10, fill: 'rgb(var(--muted))' }
const GRID = 'rgb(var(--line) / 0.45)'

function TooltipCard({
  label,
  rows,
}: {
  label: string
  rows: { name: string; value: number; color: string }[]
}) {
  const currency = useApp().settings.currency
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="tnum flex items-center gap-2 text-xs text-ink">
          <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
          <span className="text-muted">{r.name}</span>
          <span className="ml-auto font-semibold">{formatMoney(r.value, currency)}</span>
        </p>
      ))}
    </div>
  )
}

type TooltipPayload = { name?: string; value?: number; color?: string; dataKey?: string }[]

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload; label?: string | number }) {
  if (!active || !payload?.length) return null
  const heading = typeof label === 'number' ? `Day ${label}` : label && /^\d{4}-\d{2}-\d{2}$/.test(label) ? formatDate(label, 'medium') : label ?? ''
  return (
    <TooltipCard
      label={heading}
      rows={payload.map((p) => ({
        name: p.name ?? p.dataKey ?? '',
        value: Number(p.value) || 0,
        color: p.color ?? 'rgb(var(--accent))',
      }))}
    />
  )
}

/* ---------------------------------- trend ---------------------------------- */

export function SpendTrendChart({ data, height = 190 }: { data: DayPoint[]; height?: number }) {
  const series = useMemo(() => {
    const window = 7
    return data.map((p, i) => {
      const slice = data.slice(Math.max(0, i - window + 1), i + 1)
      const avg = slice.reduce((sum, s) => sum + s.expense, 0) / Math.max(1, slice.length)
      return { ...p, avg: Math.round(avg) }
    })
  }, [data])

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
            tickFormatter={(value: string) => String(Number(value.slice(8, 10)))}
          />
          <YAxis hide />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--line))' }} />
          <Area
            type="monotone"
            dataKey="expense"
            name="Daily spend"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            fill="url(#trend-fill)"
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="avg"
            name="7-day avg"
            stroke="rgb(var(--warn))"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CumulativeChart({ data, height = 180 }: { data: DayPoint[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="cum-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            minTickGap={20}
            tickFormatter={(value: string) => String(Number(value.slice(8, 10)))}
          />
          <YAxis hide />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--line))' }} />
          <Area
            type="monotone"
            dataKey="cumulative"
            name="Spent so far"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            fill="url(#cum-fill)"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------------------------------- donut ---------------------------------- */

export function CategoryDonut({
  data,
  total,
  height = 190,
}: {
  data: CategoryTotal[]
  total: number
  height?: number
}) {
  const top = data.slice(0, 7)
  const currency = useApp().settings.currency
  return (
    <div className="grid grid-cols-[minmax(0,150px)_1fr] items-center gap-2 sm:grid-cols-[minmax(0,190px)_1fr]">
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={top}
              dataKey="total"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {top.map((entry) => (
                <Cell key={entry.categoryId} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as CategoryTotal
                return (
                  <TooltipCard label={p.name} rows={[{ name: `${Math.round(p.share)}% of spend`, value: p.total, color: p.color }]} />
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">Spent</span>
          <span className="tnum text-sm font-bold text-ink">{formatMoney(total, currency, { compact: true })}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {top.map((c) => (
          <div key={c.categoryId} className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="truncate text-muted">
              {c.emoji} {c.name}
            </span>
            <span className="tnum ml-auto shrink-0 font-semibold text-ink">{Math.round(c.share)}%</span>
          </div>
        ))}
        {!top.length ? <p className="text-xs text-muted">No spending in this period.</p> : null}
      </div>
    </div>
  )
}

/* --------------------------------- monthly --------------------------------- */

export function MonthlyBars({ data, height = 180 }: { data: MonthPoint[]; height?: number }) {
  const currency = useApp().settings.currency
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={38}
            tickFormatter={(v: number) => formatMoneyShort(v, currency)}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
          <Bar dataKey="income" name="Income" fill="rgb(var(--good))" radius={[4, 4, 0, 0]} maxBarSize={18} />
          <Bar dataKey="expense" name="Spending" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* -------------------------------- weekdays --------------------------------- */

export function WeekdayBars({ data, height = 150 }: { data: WeekdayPoint[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
          <Bar dataKey="avg" name="Avg / day" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 5 || i === 6 ? 'rgb(var(--warn))' : 'rgb(var(--accent))'} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* --------------------------------- heatmap --------------------------------- */

export function Heatmap({
  txns,
  range,
  weekStart = 1,
}: {
  txns: Txn[]
  range: Range
  weekStart?: 0 | 1
}) {
  const currency = useApp().settings.currency
  const { columns, max, monthMarks } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const t of txns) {
      if (t.type !== 'expense' || t.date < range.start || t.date > range.end) continue
      totals.set(t.date, (totals.get(t.date) ?? 0) + t.baseAmount)
    }
    const gridStart = startOfWeek(range.start, weekStart)
    const totalDays = daysBetween(gridStart, range.end)
    const weeks = Math.ceil((totalDays + 1) / 7)
    const cols: { date: string; amount: number; inRange: boolean }[][] = []
    const marks: { index: number; label: string }[] = []
    let lastMonth = ''
    for (let w = 0; w < weeks; w++) {
      const col: { date: string; amount: number; inRange: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const date = addDays(gridStart, w * 7 + d)
        const inRange = date >= range.start && date <= range.end
        col.push({ date, amount: inRange ? totals.get(date) ?? 0 : 0, inRange })
        if (d === 0 && inRange) {
          const m = date.slice(0, 7)
          if (m !== lastMonth) {
            marks.push({ index: w, label: formatDate(date, 'short').split(' ')[1] })
            lastMonth = m
          }
        }
      }
      cols.push(col)
    }
    return { columns: cols, max: Math.max(1, ...totals.values()), monthMarks: marks }
  }, [txns, range, weekStart])

  const dayLabels = weekStart === 1 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div>
      <div className="flex gap-1.5">
        <div className="flex flex-col justify-between pb-4 pt-0.5">
          {dayLabels.map((d, i) => (
            <span key={i} className="h-[13px] text-[8px] leading-[13px] text-muted/70">
              {d}
            </span>
          ))}
        </div>
        <div className="no-scrollbar flex flex-1 gap-[3px] overflow-x-auto">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell, di) => {
                const ratio = cell.amount / max
                const alpha = cell.amount === 0 ? 0 : 0.18 + ratio * 0.82
                return (
                  <div
                    key={di}
                    title={cell.inRange ? `${formatDate(cell.date, 'medium')} · ${formatMoney(cell.amount, currency)}` : ''}
                    className={cn('h-[13px] w-[13px] rounded-[3px]', !cell.inRange && 'opacity-0')}
                    style={{
                      background:
                        cell.amount === 0 ? 'rgb(var(--surface-2))' : `rgb(var(--accent) / ${alpha.toFixed(2)})`,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-5 mt-2 flex justify-between text-[9px] text-muted/70">
        {monthMarks.slice(0, 6).map((m) => (
          <span key={m.index}>{m.label}</span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-muted/70">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((a) => (
          <span
            key={a}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ background: a === 0 ? 'rgb(var(--surface-2))' : `rgb(var(--accent) / ${0.2 + a * 0.8})` }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

/* --------------------------------- merchants ------------------------------- */

export function MerchantBars({ data }: { data: MerchantTotal[] }) {
  const currency = useApp().settings.currency
  const max = Math.max(1, ...data.map((d) => d.total))
  if (!data.length) return <p className="text-xs text-muted">No spending yet this period.</p>
  return (
    <div className="space-y-2.5">
      {data.map((m, i) => (
        <div key={m.merchant}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate font-medium text-ink/90">{m.merchant}</span>
            <span className="tnum shrink-0 font-semibold text-muted">{formatMoney(m.total, currency)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(4, (m.total / max) * 100)}%`,
                background: `rgb(var(--accent) / ${(0.9 - i * 0.09).toFixed(2)})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------- sparkline -------------------------------- */

export function Sparkline({ values, height = 34 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values)
  const width = 100
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * width
      const y = height - (v / max) * (height - 4) - 2
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-9 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/* -------------------------------- comparison ------------------------------- */

export function ComparisonChart({ data, labelA, labelB, height = 190 }: { data: { day: number; a?: number; b?: number }[]; labelA: string; labelB: string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} tickFormatter={(d: number) => `Day ${d}`} />
          <YAxis hide />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--line))' }} />
          <Line type="monotone" dataKey="b" name={labelB} stroke="rgb(var(--muted))" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          <Line type="monotone" dataKey="a" name={labelA} stroke="rgb(var(--accent))" strokeWidth={2.2} dot={false} activeDot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
