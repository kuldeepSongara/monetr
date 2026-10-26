import type { Rule } from '../types'
import { ruleCategory } from './suggest'
import { toISO } from './dates'

/**
 * Read a bank / card CSV export without AI. Handles a single signed amount column or separate
 * debit/credit columns, and the common date formats. Returns null when the layout isn't
 * recognised (then the AI import is used instead).
 */
export interface CsvLine {
  date: string
  merchant: string
  amount: number
  currency: string
  type: 'expense' | 'income' | 'transfer' | 'refund'
  categoryId: string
  confidence: number
  note?: string
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim())
      if (row.some((c) => c)) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c)) rows.push(row)
  return rows
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function parseDateLoose(s: string, preferMonthFirst: boolean): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return toISO(new Date(+m[1], +m[2] - 1, +m[3]))
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    const [mon, day] = a > 12 ? [b, a] : b > 12 ? [a, b] : preferMonthFirst ? [a, b] : [b, a]
    return toISO(new Date(y, mon - 1, day))
  }
  m = t.match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]*(\d{2,4})/i)
  if (m) return toISO(new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]))
  m = t.match(/^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i)
  if (m) return toISO(new Date(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2]))
  return null
}

function num(s: string | undefined): number {
  if (!s) return NaN
  const neg = /^\(.*\)$/.test(s.trim()) || /-/.test(s) || /\bdr\b/i.test(s)
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && s.match(/\d/) ? (neg ? -n : n) : NaN
}

export function parseStatementCsv(text: string, base: string, rules: Rule[], today: string): CsvLine[] | null {
  const rows = parseCsvRows(text)
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdraw|deposit|paid out|paid in/i.test(c)))
  if (headerIdx < 0) return null
  const header = rows[headerIdx].map((h) => h.toLowerCase())
  const col = (re: RegExp) => header.findIndex((h) => re.test(h))
  const iDate = col(/^(transaction |posted |posting |value )?date|date$/)
  const iDesc = col(/desc|detail|narration|merchant|payee|particular|memo|name|transaction$/)
  const iAmount = col(/^amount|amount$|amount \(/)
  const iDebit = col(/debit|withdraw|paid out|money out/)
  const iCredit = col(/credit|deposit|paid in|money in/)
  const iCur = col(/currency/)
  if (iDate < 0 || (iAmount < 0 && iDebit < 0)) return null

  const body = rows.slice(headerIdx + 1).filter((r) => r[iDate])
  const mdFirst = ['USD', 'CAD'].includes(base)
  const singleSigned = iAmount >= 0 && iDebit < 0
  const negatives = singleSigned ? body.filter((r) => num(r[iAmount]) < 0).length : 0
  // Bank accounts export spending as negative numbers; card statements as positive charges.
  const negativeIsSpend = negatives >= body.length / 2

  const out: CsvLine[] = []
  for (const r of body) {
    const date = parseDateLoose(r[iDate], mdFirst)
    if (!date || date > today) continue
    let amount: number
    let type: CsvLine['type']
    if (singleSigned) {
      const v = num(r[iAmount])
      if (!Number.isFinite(v) || v === 0) continue
      const spend = negativeIsSpend ? v < 0 : v > 0
      amount = Math.abs(v)
      // On a card statement (charges positive) a negative line is a refund, not income.
      type = spend ? 'expense' : negativeIsSpend ? 'income' : 'refund'
    } else {
      const d = num(r[iDebit])
      const c = iCredit >= 0 ? num(r[iCredit]) : NaN
      if (Number.isFinite(d) && d !== 0) {
        amount = Math.abs(d)
        type = 'expense'
      } else if (Number.isFinite(c) && c !== 0) {
        amount = Math.abs(c)
        type = 'income'
      } else continue
    }
    const raw = (iDesc >= 0 ? r[iDesc] : '') || 'Unknown'
    if (/payment.*(thank|received)|autopay payment|card payment|transfer (to|from)/i.test(raw)) type = 'transfer'
    else if (type === 'income' && /\b(refund|return|reversal|reversed|cashback)\b/i.test(raw)) type = 'refund'
    const merchant = raw.replace(/\s{2,}/g, ' ').replace(/\b(pos|purchase|debit card|visa|mastercard|interac|e-?transfer)\b/gi, '').trim().slice(0, 60) || raw.slice(0, 60)
    const currency = iCur >= 0 && /^[A-Z]{3}$/.test(r[iCur]) ? r[iCur] : base
    const ruled = type !== 'transfer' ? ruleCategory(merchant, rules) : undefined
    out.push({
      date,
      merchant,
      amount,
      currency,
      type,
      categoryId: ruled ?? (type === 'income' ? 'cat_other-income' : type === 'transfer' ? 'cat_transfer' : 'cat_other'),
      confidence: 0.85,
    })
  }
  return out.length ? out : null
}
