import { read, KEYS } from './storage'
import type { User } from './types'

export const getCurrency = () => read<User | null>(KEYS.user, null)?.currency || 'INR'
const localeFor = (c: string) => (c === 'INR' ? 'en-IN' : 'en-US')

export function formatPrice(amount: number, opts: { round?: boolean; currency?: string } = {}) {
  const currency = opts.currency ?? getCurrency()
  const v = opts.round ? Math.round(amount) : amount
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return `${currency} ${v.toLocaleString('en-US')}`
  }
}

export function currencySymbol(currency = getCurrency()) {
  try {
    return new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency })
      .formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

const trim = (n: number) => String(Math.round(n * 100) / 100)

export function formatPriceCompact(amount: number, currency = getCurrency()) {
  const s = currencySymbol(currency)
  const a = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (currency === 'INR') {
    if (a >= 1e7) return `${sign}${s}${trim(a / 1e7)}Cr`
    if (a >= 1e5) return `${sign}${s}${trim(a / 1e5)}L`
  } else {
    if (a >= 1e9) return `${sign}${s}${trim(a / 1e9)}B`
    if (a >= 1e6) return `${sign}${s}${trim(a / 1e6)}M`
    if (a >= 1e3) return `${sign}${s}${trim(a / 1e3)}K`
  }
  return formatPrice(amount, { round: true, currency })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthShort = (m: number) => MONTHS[m]

/** "Oct 05, 2:30 PM" — or just "Oct 05" when only the date is known (e.g. statement rows). */
export function formatDateTime(ts: number, dateOnly = false) {
  const d = new Date(ts)
  if (dateOnly) return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`
  const h = d.getHours() % 12 || 12
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

export function formatTime12(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export const monthRange = (year: number, month: number) => ({
  start: new Date(year, month, 1).getTime(),
  end: new Date(year, month + 1, 1).getTime(),
})

export const monthKey = (year: number, month: number) => `${String(month + 1).padStart(2, '0')}-${year}`

/** yyyy-mm-ddThh:mm for <input type="datetime-local"> */
export function toLocalInput(ts: number) {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}

export const CURRENCIES: [string, string][] = [
  ['INR', 'Indian Rupee'], ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'],
  ['AED', 'UAE Dirham'], ['AUD', 'Australian Dollar'], ['CAD', 'Canadian Dollar'], ['SGD', 'Singapore Dollar'],
  ['JPY', 'Japanese Yen'], ['CNY', 'Chinese Yuan'], ['CHF', 'Swiss Franc'], ['SAR', 'Saudi Riyal'],
  ['NZD', 'New Zealand Dollar'], ['HKD', 'Hong Kong Dollar'], ['SEK', 'Swedish Krona'], ['NOK', 'Norwegian Krone'],
  ['DKK', 'Danish Krone'], ['ZAR', 'South African Rand'], ['BRL', 'Brazilian Real'], ['MXN', 'Mexican Peso'],
  ['KRW', 'South Korean Won'], ['IDR', 'Indonesian Rupiah'], ['MYR', 'Malaysian Ringgit'], ['THB', 'Thai Baht'],
  ['PHP', 'Philippine Peso'], ['VND', 'Vietnamese Dong'], ['BDT', 'Bangladeshi Taka'], ['PKR', 'Pakistani Rupee'],
  ['LKR', 'Sri Lankan Rupee'], ['NPR', 'Nepalese Rupee'], ['QAR', 'Qatari Riyal'], ['KWD', 'Kuwaiti Dinar'],
  ['OMR', 'Omani Rial'], ['BHD', 'Bahraini Dinar'], ['TRY', 'Turkish Lira'], ['RUB', 'Russian Ruble'],
  ['PLN', 'Polish Zloty'], ['ILS', 'Israeli Shekel'], ['EGP', 'Egyptian Pound'], ['NGN', 'Nigerian Naira'],
  ['KES', 'Kenyan Shilling'],
]
