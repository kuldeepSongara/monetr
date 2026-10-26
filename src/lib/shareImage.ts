import type { Category, ISODate, Txn } from '../types'
import { addDays, addMonths, daysBetween, type Range } from './dates'
import { formatMoney, minorFactor } from './money'
import { spendDelta } from './analytics'

/*
 * A shareable picture of overall spending for family or friends: total, category split and a
 * spending-over-time chart. Never includes merchants, notes, accounts or individual transactions.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = MONTHS.map((m) => m.slice(0, 3))

export type ShareRangeKey = 'this-month' | 'last-month' | '3m' | 'year' | 'custom'

export function shareRange(key: ShareRangeKey, today: ISODate, custom?: Range): Range {
  const monthStart = `${today.slice(0, 7)}-01`
  if (key === 'this-month') return { start: monthStart, end: today }
  if (key === 'last-month') {
    const start = addMonths(monthStart, -1)
    return { start, end: addDays(monthStart, -1) }
  }
  if (key === '3m') return { start: addMonths(monthStart, -2), end: today }
  if (key === 'year') return { start: `${today.slice(0, 4)}-01-01`, end: today }
  return custom && custom.start <= custom.end ? custom : { start: monthStart, end: today }
}

const md = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`
const monthName = (iso: ISODate) => MONTHS[Number(iso.slice(5, 7)) - 1]

export function rangeLabel(key: ShareRangeKey, r: Range): string {
  const y = r.end.slice(0, 4)
  if (key === 'this-month') return `${monthName(r.start)} ${y} · so far`
  if (key === 'last-month') return `${monthName(r.start)} ${r.start.slice(0, 4)}`
  if (key === '3m') return `${SHORT[Number(r.start.slice(5, 7)) - 1]} – ${SHORT[Number(r.end.slice(5, 7)) - 1]} ${y}`
  if (key === 'year') return `${y} so far`
  return `${md(r.start)} – ${md(r.end)} ${y}`
}

/** The period to compare against, and how to name it. */
function previous(key: ShareRangeKey, r: Range): { range: Range; label: string } {
  if (key === 'this-month' || key === 'last-month') {
    const start = addMonths(r.start, -1)
    // Same number of days into the previous month, so a half-finished month compares fairly.
    const end = key === 'this-month' ? addMonths(r.end, -1) : addDays(r.start, -1)
    return { range: { start, end }, label: key === 'this-month' ? `same days of ${monthName(start)}` : monthName(start) }
  }
  if (key === 'year') return { range: { start: addMonths(r.start, -12), end: addMonths(r.end, -12) }, label: `same time in ${Number(r.start.slice(0, 4)) - 1}` }
  if (key === '3m') return { range: { start: addMonths(r.start, -3), end: addDays(r.start, -1) }, label: 'previous 3 months' }
  const days = daysBetween(r.start, r.end) + 1
  return { range: { start: addDays(r.start, -days), end: addDays(r.start, -1) }, label: `previous ${days} days` }
}

export interface ShareData {
  total: number
  prevTotal: number
  prevLabel: string
  categories: { id: string; name: string; emoji: string; color: string; total: number; pct: number }[]
  series: { label: string; total: number }[]
  seriesUnit: 'day' | 'week' | 'month'
  hiddenCount: number
}

export function buildShareData(txns: Txn[], categories: Category[], key: ShareRangeKey, r: Range, hidden: Set<string>): ShareData {
  const spendIn = (range: Range) => txns.filter((t) => (t.type === 'expense' || t.type === 'refund') && t.date >= range.start && t.date <= range.end && !hidden.has(t.categoryId))
  const current = spendIn(r)
  const prev = previous(key, r)
  const total = Math.max(0, current.reduce((s, t) => s + spendDelta(t), 0))
  const prevTotal = Math.max(0, spendIn(prev.range).reduce((s, t) => s + spendDelta(t), 0))

  const byCat = new Map<string, number>()
  for (const t of current) byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + spendDelta(t))
  const catMap = new Map(categories.map((c) => [c.id, c]))
  let cats = [...byCat.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => {
      const c = catMap.get(id)
      return { id, name: c?.name ?? 'Other', emoji: c?.emoji ?? '•', color: c?.color ?? '#9CA3AF', total: v, pct: 0 }
    })
    .sort((a, b) => b.total - a.total)
  if (cats.length > 7) {
    const rest = cats.slice(6)
    cats = [...cats.slice(0, 6), { id: 'rest', name: `${rest.length} more`, emoji: '…', color: '#9CA3AF', total: rest.reduce((s, c) => s + c.total, 0), pct: 0 }]
  }
  const positive = cats.reduce((s, c) => s + c.total, 0) || 1
  for (const c of cats) c.pct = (c.total / positive) * 100

  const days = daysBetween(r.start, r.end) + 1
  const unit: ShareData['seriesUnit'] = days <= 31 ? 'day' : days <= 100 ? 'week' : 'month'
  const series: ShareData['series'] = []
  if (unit === 'month') {
    for (let m = `${r.start.slice(0, 7)}-01`; m <= r.end; m = addMonths(m, 1)) {
      const key2 = m.slice(0, 7)
      series.push({ label: SHORT[Number(m.slice(5, 7)) - 1], total: Math.max(0, current.filter((t) => t.date.startsWith(key2)).reduce((s, t) => s + spendDelta(t), 0)) })
    }
  } else {
    const step = unit === 'day' ? 1 : 7
    for (let d = r.start; d <= r.end; d = addDays(d, step)) {
      const end = addDays(d, step - 1)
      series.push({
        label: unit === 'day' ? String(Number(d.slice(8, 10))) : md(d),
        total: Math.max(0, current.filter((t) => t.date >= d && t.date <= end).reduce((s, t) => s + spendDelta(t), 0)),
      })
    }
  }

  return { total, prevTotal, prevLabel: prev.label, categories: cats, series, seriesUnit: unit, hiddenCount: hidden.size }
}

export interface DrawOptions {
  title: string
  subtitle: string
  currency: string
  /** 'percent' hides every amount — only shares and shapes. */
  mode: 'amount' | 'percent'
}

const W = 1080
const H = 1350
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif'
const C = { bg: '#F4F2FA', card: '#FFFFFF', ink: '#15161C', muted: '#6B7280', line: '#ECEAF3', accent: '#7C5CFF', good: '#16A34A', bad: '#DC2626' }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

/** Whole units once amounts are big enough that cents are noise ($6,450 not $6,450.40). */
function compactMoney(minor: number, currency: string): string {
  const f = minorFactor(currency)
  const whole = Math.abs(minor) >= 100 * f
  const text = formatMoney(whole ? Math.round(minor / f) * f : minor, currency)
  return whole ? text.replace(/[.,]0+(?=\D*$)/, '') : text
}

export function drawShareImage(canvas: HTMLCanvasElement, data: ShareData, opts: DrawOptions): void {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const money = (v: number) => compactMoney(Math.round(v), opts.currency)

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  roundRect(ctx, 40, 40, W - 80, H - 80, 44)
  ctx.fillStyle = C.card
  ctx.fill()

  const L = 100
  const R = W - 100
  ctx.textBaseline = 'alphabetic'

  // Header
  ctx.fillStyle = C.ink
  ctx.font = `700 52px ${FONT}`
  ctx.fillText(fit(ctx, opts.title, R - L), L, 160)
  ctx.fillStyle = C.muted
  ctx.font = `500 32px ${FONT}`
  ctx.fillText(opts.subtitle, L, 210)

  // Headline number and comparison
  let y = 330
  if (opts.mode === 'amount') {
    const total = money(data.total)
    ctx.fillStyle = C.ink
    ctx.font = `800 104px ${FONT}`
    ctx.fillText(total, L, y)
    const w = ctx.measureText(total).width
    ctx.fillStyle = C.muted
    ctx.font = `500 30px ${FONT}`
    ctx.fillText('spent', L + w + 18, y)
  } else {
    ctx.fillStyle = C.ink
    ctx.font = `800 64px ${FONT}`
    ctx.fillText('Where the money went', L, y - 20)
  }

  y += 56
  if (data.prevTotal > 0 && data.total >= 0) {
    const change = ((data.total - data.prevTotal) / data.prevTotal) * 100
    const less = change < 0
    const text = Math.abs(change) < 0.5 ? `About the same as ${data.prevLabel}` : `${Math.abs(Math.round(change))}% ${less ? 'less' : 'more'} than ${data.prevLabel}`
    ctx.font = `600 30px ${FONT}`
    const tw = ctx.measureText(text).width + 40
    roundRect(ctx, L, y - 36, tw, 52, 26)
    ctx.fillStyle = less ? '#DCFCE7' : Math.abs(change) < 0.5 ? '#F3F4F6' : '#FEE2E2'
    ctx.fill()
    ctx.fillStyle = less ? C.good : Math.abs(change) < 0.5 ? C.muted : C.bad
    ctx.fillText(text, L + 20, y)
  }

  // Donut + legend
  const top = 470
  ctx.fillStyle = C.muted
  ctx.font = `700 24px ${FONT}`
  ctx.fillText('BY CATEGORY', L, top)
  const cx = L + 170
  const cy = top + 230
  const rOut = 170
  const rIn = 105
  if (data.categories.length) {
    let a = -Math.PI / 2
    for (const c of data.categories) {
      const sweep = (c.pct / 100) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(cx, cy, rOut, a, a + sweep)
      ctx.arc(cx, cy, rIn, a + sweep, a, true)
      ctx.closePath()
      ctx.fillStyle = c.color
      ctx.fill()
      // thin separator
      ctx.strokeStyle = C.card
      ctx.lineWidth = 4
      ctx.stroke()
      a += sweep
    }
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, rOut, 0, Math.PI * 2)
    ctx.arc(cx, cy, rIn, Math.PI * 2, 0, true)
    ctx.fillStyle = C.line
    ctx.fill()
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  ctx.font = `700 34px ${FONT}`
  ctx.fillText(String(data.categories.reduce((n, c) => n + (c.id === 'rest' ? Number(c.name.split(' ')[0]) : 1), 0)), cx, cy + 4)
  ctx.fillStyle = C.muted
  ctx.font = `500 22px ${FONT}`
  ctx.fillText('categories', cx, cy + 34)
  ctx.textAlign = 'left'

  const lx = cx + rOut + 70
  const rowH = 58
  let ly = top + 230 - ((data.categories.length - 1) * rowH) / 2
  for (const c of data.categories) {
    ctx.beginPath()
    ctx.arc(lx + 9, ly - 9, 9, 0, Math.PI * 2)
    ctx.fillStyle = c.color
    ctx.fill()
    const right = opts.mode === 'amount' ? `${Math.round(c.pct)}%  ·  ${money(c.total)}` : `${Math.round(c.pct)}%`
    ctx.font = `600 28px ${FONT}`
    const rw = ctx.measureText(right).width
    ctx.fillStyle = C.ink
    ctx.textAlign = 'right'
    ctx.fillText(right, R, ly)
    ctx.textAlign = 'left'
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(fit(ctx, `${c.emoji} ${c.name}`, R - rw - 30 - (lx + 30)), lx + 30, ly)
    ly += rowH
  }
  if (!data.categories.length) {
    ctx.fillStyle = C.muted
    ctx.font = `500 28px ${FONT}`
    ctx.fillText('No spending in this period', lx, cy)
  }

  // Spending over time
  const chartTop = 970
  const chartBottom = 1185
  ctx.fillStyle = C.muted
  ctx.font = `700 24px ${FONT}`
  ctx.fillText(data.seriesUnit === 'day' ? 'EACH DAY' : data.seriesUnit === 'week' ? 'EACH WEEK' : 'EACH MONTH', L, chartTop - 34)
  const max = Math.max(1, ...data.series.map((s) => s.total))
  if (opts.mode === 'amount') {
    ctx.textAlign = 'right'
    ctx.font = `500 22px ${FONT}`
    ctx.fillText(`max ${money(max)}`, R, chartTop - 34)
    ctx.textAlign = 'left'
  }
  const n = Math.max(1, data.series.length)
  const slot = (R - L) / n
  const bw = Math.max(4, Math.min(64, slot * 0.68))
  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(L, chartBottom + 1)
  ctx.lineTo(R, chartBottom + 1)
  ctx.stroke()
  const avg = data.series.reduce((s, x) => s + x.total, 0) / n
  data.series.forEach((s, i) => {
    const h = (s.total / max) * (chartBottom - chartTop)
    const x = L + i * slot + (slot - bw) / 2
    if (s.total > 0) {
      const hh = Math.max(4, h)
      roundRect(ctx, x, chartBottom - hh, bw, hh, Math.min(8, bw / 2, hh / 2))
      ctx.fillStyle = s.total > avg * 1.8 && n > 4 ? '#F59E0B' : C.accent
      ctx.fill()
    }
  })
  // sparse x labels
  ctx.fillStyle = C.muted
  ctx.font = `500 22px ${FONT}`
  ctx.textAlign = 'center'
  const every = Math.ceil(n / (data.seriesUnit === 'day' ? 8 : 7))
  data.series.forEach((s, i) => {
    const last = i === n - 1
    if ((i % every === 0 && (last || n - 1 - i >= every / 2)) || last) ctx.fillText(s.label, L + i * slot + slot / 2, chartBottom + 36)
  })
  ctx.textAlign = 'left'

  // Footer
  ctx.fillStyle = C.muted
  ctx.font = `500 22px ${FONT}`
  const foot = `Shared from Monetr · totals only, no shops or notes${data.hiddenCount ? ' · some categories not shown' : ''}`
  ctx.textAlign = 'center'
  ctx.fillText(fit(ctx, foot, R - L), W / 2, H - 82)
  ctx.textAlign = 'left'
}
