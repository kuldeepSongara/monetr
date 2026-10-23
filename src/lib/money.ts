export interface CurrencyInfo {
  code: string
  name: string
  symbol: string
  decimals: number
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimals: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimals: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', decimals: 2 },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimals: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', decimals: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', decimals: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimals: 0 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', decimals: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimals: 2 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', decimals: 0 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimals: 2 },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimals: 2 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 },
]

const FALLBACK: CurrencyInfo = { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 }

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? { ...FALLBACK, code, name: code, symbol: code }
}

export function minorFactor(code: string): number {
  return Math.pow(10, currencyInfo(code).decimals)
}

export function toMinor(amount: number, code: string): number {
  return Math.round(amount * minorFactor(code))
}

export function fromMinor(minor: number, code: string): number {
  return minor / minorFactor(code)
}

/** Convert an amount (already in minor units of `currency`) into minor units of `base`. */
export function toBaseMinor(amountMinor: number, currency: string, fxRate: number, base: string): number {
  const major = fromMinor(amountMinor, currency)
  return Math.round(major * (Number.isFinite(fxRate) ? fxRate : 1) * minorFactor(base))
}

export interface FormatMoneyOptions {
  compact?: boolean
  signed?: boolean
  decimals?: number
  hideSymbol?: boolean
}

export function formatMoney(minor: number, code = 'USD', opts: FormatMoneyOptions = {}): string {
  const info = currencyInfo(code)
  const value = minor / minorFactor(code)
  const decimals = opts.decimals ?? (info.decimals === 0 ? 0 : 2)
  let out: string
  try {
    out = new Intl.NumberFormat(undefined, {
      style: opts.hideSymbol ? 'decimal' : 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      notation: opts.compact ? 'compact' : 'standard',
    }).format(Math.abs(value))
  } catch {
    out = `${opts.hideSymbol ? '' : info.symbol}${Math.abs(value).toFixed(decimals)}`
  }
  if (opts.signed) return `${value < 0 ? '−' : '+'}${out}`
  return value < 0 ? `−${out}` : out
}

/** Compact money for chart axes — $1.2k, $840. */
export function formatMoneyShort(minor: number, code = 'USD'): string {
  const value = Math.abs(minor) / minorFactor(code)
  const info = currencyInfo(code)
  if (value >= 1_000_000) return `${info.symbol}${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1000) return `${info.symbol}${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  if (value > 0 && value < 10 && info.decimals > 0) return `${info.symbol}${value.toFixed(1)}`
  return `${info.symbol}${Math.round(value)}`
}

export function fromMajorString(input: string, code: string): number | null {
  const cleaned = input.replace(/[^0-9.,-]/g, '').replace(/,/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return toMinor(n, code)
}

export function majorString(minor: number, code: string): string {
  const info = currencyInfo(code)
  return (minor / minorFactor(code)).toFixed(info.decimals).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m))
}
