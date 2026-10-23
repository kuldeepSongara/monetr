import type { ISODate } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function todayISO(): ISODate {
  return toISO(new Date())
}

export function nowISO(): string {
  return new Date().toISOString()
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function addMonths(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())))
  return toISO(d)
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000)
}

export function startOfWeek(iso: ISODate, weekStart: 0 | 1 = 1): ISODate {
  const d = parseISO(iso)
  const diff = (d.getDay() - weekStart + 7) % 7
  d.setDate(d.getDate() - diff)
  return toISO(d)
}

export function endOfWeek(iso: ISODate, weekStart: 0 | 1 = 1): ISODate {
  return addDays(startOfWeek(iso, weekStart), 6)
}

export interface Range {
  start: ISODate
  end: ISODate
}

/** The pay cycle containing `iso`. Cycle starts on `startDay` of each month (1-28). */
export function payCycle(iso: ISODate, startDay: number): Range {
  const day = Math.min(Math.max(Math.round(startDay) || 1, 1), 28)
  const d = parseISO(iso)
  const thisMonthStart = toISO(new Date(d.getFullYear(), d.getMonth(), day))
  const start = d.getDate() >= day ? thisMonthStart : addMonths(thisMonthStart, -1)
  return { start, end: addDays(addMonths(start, 1), -1) }
}

/** Move a pay-cycle (or week) range one step back/forward. */
export function shiftPeriod(range: Range, direction: -1 | 1, weekly: boolean): Range {
  if (weekly) {
    const start = addDays(range.start, direction * 7)
    return { start, end: addDays(start, 6) }
  }
  const start = addMonths(range.start, direction)
  return { start, end: addDays(addMonths(start, 1), -1) }
}

export function rangeDays(range: Range): number {
  return daysBetween(range.start, range.end) + 1
}

export function inRange(date: ISODate, range: Range): boolean {
  return date >= range.start && date <= range.end
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatDate(iso: ISODate, style: 'short' | 'medium' | 'long' | 'day' = 'medium'): string {
  const d = parseISO(iso)
  if (style === 'day') return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`
  if (style === 'short') return `${d.getDate()} ${MONTHS[d.getMonth()]}`
  if (style === 'long') return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function weekdayName(index: number): string {
  return WEEKDAYS[index] ?? ''
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${String(y).slice(2)}`
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7)
}

export function dueLabel(iso: ISODate, today = todayISO()): string {
  const diff = daysBetween(today, iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff <= 6) return `In ${diff} days`
  if (diff < -1 && diff >= -6) return `${Math.abs(diff)} days ago`
  return formatDate(iso, 'short')
}

export function relativeTime(isoDateTime: string): string {
  const then = new Date(isoDateTime).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(isoDateTime.slice(0, 10), 'short')
}
