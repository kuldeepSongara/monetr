import type { Category, Rule } from '../types'
import { addDays, parseISO, toISO } from './dates'
import { CURRENCIES } from './money'
import { ruleCategory } from './suggest'

/**
 * Offline parser for the quick-add bar ("coffee 4.50 yesterday", "uber 18 last friday",
 * "salary 4200 on 1st"). Used when no AI profile answers, so logging a spend never waits on AI.
 */
export interface LocalDraft {
  type: 'expense' | 'income'
  amount: number
  currency: string
  date: string
  merchant: string
  categoryId: string
}

const SYMBOLS: Record<string, string> = { '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY', '₩': 'KRW', '₱': 'PHP', '฿': 'THB', '₺': 'TRY', '₦': 'NGN', '₫': 'VND' }
const DOLLAR = ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'MXN']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const KEYWORDS: [RegExp, string][] = [
  [/\b(salary|payroll|paycheck|pay ?day|stipend)\b/, 'cat_salary'],
  [/\b(freelance|client|invoice|consulting)\b/, 'cat_freelance'],
  [/\b(interest|dividend)\b/, 'cat_interest'],
  [/\b(coffee|cafe|café|starbucks|tea|lunch|dinner|breakfast|brunch|restaurant|pizza|burger|sushi|swiggy|zomato|ubereats|uber eats|doordash|takeout|snack|bar|beer|drinks)\b/, 'cat_dining'],
  [/\b(grocery|groceries|supermarket|walmart|costco|bigbasket|blinkit|zepto|instamart|loblaws|no frills|trader joe|whole foods|vegetables|milk)\b/, 'cat_groceries'],
  [/\b(uber|ola|lyft|taxi|cab|metro|subway|bus|train|ttc|presto|fuel|petrol|diesel|gas station|parking|toll|auto)\b/, 'cat_transport'],
  [/\b(rent|furniture|ikea|repair|plumber)\b/, 'cat_home'],
  [/\b(electricity|hydro|internet|wifi|broadband|water bill|phone bill|mobile bill|recharge|utility)\b/, 'cat_utilities'],
  [/\b(netflix|spotify|prime|youtube premium|icloud|subscription|chatgpt|claude)\b/, 'cat_subscriptions'],
  [/\b(movie|cinema|concert|game|steam|playstation|xbox|tickets)\b/, 'cat_entertainment'],
  [/\b(pharmacy|medicine|doctor|dentist|clinic|hospital|gym|physio)\b/, 'cat_health'],
  [/\b(flight|airline|hotel|airbnb|booking|trip|visa)\b/, 'cat_travel'],
  [/\b(course|udemy|book|books|tuition|class)\b/, 'cat_education'],
  [/\b(amazon|flipkart|clothes|shirt|shoes|uniqlo|zara|electronics|gift)\b/, 'cat_shopping'],
  [/\b(fee|fees|charge|penalty|atm)\b/, 'cat_fees'],
]
const INCOME = /\b(salary|payroll|paycheck|received|got paid|income|bonus|refund from|freelance|client paid|dividend|interest)\b/
const FILLER = /\b(spent|spend|paid|pay|bought|buy|for|at|on|to|from|in|the|a|an|my|of|and|with|got|received|ago|last|today|yesterday|day|days|before)\b/g

function weekdayBefore(today: string, target: number, allowToday: boolean): string {
  const d = parseISO(today)
  let diff = (d.getDay() - target + 7) % 7
  if (diff === 0 && !allowToday) diff = 7
  return addDays(today, -diff)
}

export function parseQuickLocal(input: string, categories: Category[], rules: Rule[], base: string, today: string): LocalDraft | null {
  let text = ` ${input.toLowerCase().trim()} `
  if (!text.trim()) return null

  // currency
  let currency = base
  for (const [sym, code] of Object.entries(SYMBOLS)) if (text.includes(sym)) currency = code
  if (text.includes('$') && !DOLLAR.includes(base)) currency = 'USD'
  const code = text.match(/\b([a-z]{3})\b/g)?.map((c) => c.toUpperCase()).find((c) => CURRENCIES.some((x) => x.code === c))
  if (code) currency = code
  text = text.replace(/[€£₹¥₩₱฿₺₦₫$]/g, ' ')
  if (code) text = text.replace(new RegExp(`\\b${code.toLowerCase()}\\b`), ' ')

  // date
  let date = today
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  const ago = text.match(/\b(\d+)\s*days?\s*ago\b/)
  const slash = text.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/)
  const ordinal = text.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/)
  const monthDay = text.match(new RegExp(`\\b(\\d{1,2})\\s*(${MONTHS.join('|')})[a-z]*\\b|\\b(${MONTHS.join('|')})[a-z]*\\s*(\\d{1,2})\\b`))
  const wd = text.match(new RegExp(`\\b(last\\s+)?(${WEEKDAYS.join('|')})\\b`))
  if (iso) {
    date = iso[0]
    text = text.replace(iso[0], ' ')
  } else if (/\bday before yesterday\b/.test(text)) date = addDays(today, -2)
  else if (/\byesterday\b/.test(text)) date = addDays(today, -1)
  else if (ago) {
    date = addDays(today, -Number(ago[1]))
    text = text.replace(ago[0], ' ')
  } else if (wd) {
    date = weekdayBefore(today, WEEKDAYS.indexOf(wd[2]), !wd[1])
    text = text.replace(wd[0], ' ')
  } else if (monthDay) {
    const day = Number(monthDay[1] ?? monthDay[4])
    const mon = MONTHS.indexOf((monthDay[2] ?? monthDay[3]).slice(0, 3))
    const t = parseISO(today)
    let cand = toISO(new Date(t.getFullYear(), mon, day))
    if (cand > today) cand = toISO(new Date(t.getFullYear() - 1, mon, day))
    date = cand
    text = text.replace(monthDay[0], ' ')
  } else if (slash && !/[.,]\d{2}\b/.test(slash[0])) {
    const a = Number(slash[1])
    const b = Number(slash[2])
    // Day/month unless that's impossible; North-American currencies read month/day.
    const mdFirst = DOLLAR.includes(base) && base !== 'AUD' && base !== 'NZD'
    const [m, d] = a > 12 ? [b, a] : b > 12 ? [a, b] : mdFirst ? [a, b] : [b, a]
    const t = parseISO(today)
    const y = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : t.getFullYear()
    date = toISO(new Date(y, m - 1, d))
    text = text.replace(slash[0], ' ')
  } else if (ordinal) {
    const t = parseISO(today)
    let cand = toISO(new Date(t.getFullYear(), t.getMonth(), Number(ordinal[1])))
    if (cand > today) cand = toISO(new Date(t.getFullYear(), t.getMonth() - 1, Number(ordinal[1])))
    date = cand
    text = text.replace(ordinal[0], ' ')
  }

  // amount: prefer numbers with decimals, then the largest plain number
  const nums = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/g)].map((m) => ({
    raw: m[0],
    value: Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1),
    hasDecimal: m[1].includes('.'),
  }))
  if (!nums.length) return null
  const pick = nums.find((n) => n.hasDecimal) ?? nums.reduce((a, b) => (b.value > a.value ? b : a))
  if (!(pick.value > 0)) return null
  text = text.replace(pick.raw, ' ')

  const type: LocalDraft['type'] = INCOME.test(` ${input.toLowerCase()} `) ? 'income' : 'expense'
  const merchantWords = text.replace(FILLER, ' ').replace(/[^a-z0-9&' -]/gi, ' ').replace(/\s+/g, ' ').trim()
  const merchant = merchantWords
    ? merchantWords.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60)
    : type === 'income'
      ? 'Income'
      : 'Expense'

  const valid = new Map(categories.map((c) => [c.id, c.kind]))
  let categoryId = ruleCategory(merchant, rules)
  if (!categoryId || valid.get(categoryId) !== type) {
    const hay = ` ${input.toLowerCase()} `
    categoryId = KEYWORDS.find(([re, id]) => re.test(hay) && valid.get(id) === type)?.[1]
  }
  return {
    type,
    amount: pick.value,
    currency,
    date,
    merchant,
    categoryId: categoryId ?? (type === 'income' ? 'cat_other-income' : 'cat_other'),
  }
}
