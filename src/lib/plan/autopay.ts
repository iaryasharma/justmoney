// UPI AutoPay / recurring mandates: when the bank says one was set up, changed or cancelled, it is kept here (Planner -> AutoPay).
// Setting a mandate up moves no money, so it is never an expense and never frozen money. Each charge arrives later as an ordinary debit.
import { read, write, uid, KEYS } from '../core/storage'
import type { AutoPay } from '../core/types'

/** Wording that marks a subscription-style mandate (as opposed to the one-off mandate that blocks money for an IPO). */
export const AUTOPAY_WORDS = /\b(?:auto\s?-?pay|recurring|subscription|frequency|monthly|yearly|annually|weekly|quarterly|every\s+(?:month|week|year)|as\s+presented|next\s+(?:debit|charge))\b/i
/** Wording that marks an IPO / ASBA mandate or block: those are held money, handled by holds.ts. */
export const IPO_WORDS = /\b(?:ipo|asba|sbmd|application|public issue|lien|blocked)\b/i
const MONEY_MOVED = /\b(?:debited|credited|paid|sent|spent|received|deducted)\b/i
const ENDED = /\b(?:revoked|cancell?ed|deleted|expired|terminated|stopped)\b/i
const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A message about setting up or running a subscription mandate (not an IPO one, and not a charge that already happened). */
export const isAutopaySetup = (text: string) => /\b(?:mandate|auto\s?-?pay|standing instruction)\b/i.test(text) && AUTOPAY_WORDS.test(text) && !IPO_WORDS.test(text) && !MONEY_MOVED.test(text)
/** A message saying a mandate was cancelled (could be an AutoPay or an IPO one: the caller checks for held money). */
export const endsMandate = (text: string) => /\bmandate\b/i.test(text) && ENDED.test(text) && !IPO_WORDS.test(text)

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
const clean = (s: string) => {
  const m = s.replace(/\b(?:upi|autopay|auto pay|mandate|the|your|a|an|is|has|been|was)\b/gi, ' ').replace(/[^A-Za-z0-9&.' -]/g, ' ').replace(/\s+/g, ' ').trim()
  return m === m.toUpperCase() || m === m.toLowerCase() ? titleCase(m) : m
}

function nameOf(text: string): string {
  const pats = [
    /towards\s+(.{2,50}?)\s+(?:for|of|with|,|\.|\()/i,
    /mandate\s+(?:of\s+(?:rs\.?|inr|₹)\s*[\d,.]+\s+)?(?:to|for|with)\s+([A-Za-z][A-Za-z0-9&.' -]{1,40}?)(?=\s+(?:has|was|is|created|set|approved|registered|revoked|cancell?ed|for|of|on|frequency|monthly|yearly|weekly)|\s*[,.(])/i,
    /(?:merchant|payee|beneficiary)\s*:?\s*([A-Za-z][A-Za-z0-9&.' -]{1,40}?)(?=\s*[,.(]|\s+(?:for|of|on|has|was)\b|$)/i,
    /\bto\s+([A-Z][A-Za-z0-9&.' -]{1,30}?)(?=\s+(?:created|set|approved|registered|revoked|cancell?ed|for|of|on|frequency)\b)/,
  ]
  for (const re of pats) { const m = text.match(re)?.[1]; const c = m ? clean(m) : ''; if (c.length >= 2) return c }
  return 'AutoPay'
}

function dateIn(s: string): number | undefined {
  const m = s.match(/(\d{1,2})[-/ ]([A-Za-z]{3,9}|\d{1,2})[-/ ,]*(\d{2,4})/)
  if (!m) return undefined
  const mon = /\d/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
  if (mon < 0 || mon > 11) return undefined
  let y = Number(m[3]); if (y < 100) y += 2000
  const t = new Date(y, mon, Number(m[1]), 9, 0).getTime()
  return Number.isNaN(t) ? undefined : t
}

export function parseAutoPay(text: string): { name: string; amount: number; frequency?: string; nextAt?: number; status: AutoPay['status'] } {
  const amount = Number((text.match(AMOUNT)?.[1] ?? '0').replace(/,/g, ''))
  const fq = text.match(/\b(monthly|yearly|annually|weekly|quarterly|daily|half[- ]yearly|as presented|one[- ]time)\b/i)?.[1]?.toLowerCase() ?? (/every\s+month/i.test(text) ? 'monthly' : /every\s+week/i.test(text) ? 'weekly' : /every\s+year/i.test(text) ? 'yearly' : undefined)
  const next = text.match(/next\s+(?:debit|charge)[^0-9]{0,24}([\s\S]{0,24})/i)?.[1]
  const status: AutoPay['status'] = ENDED.test(text) ? 'cancelled' : /\b(?:paused|suspended)\b/i.test(text) ? 'paused' : 'active'
  return { name: nameOf(text), amount, frequency: fq === 'annually' ? 'yearly' : fq, nextAt: next ? dateIn(next) : undefined, status }
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
const sameName = (a: string, b: string) => {
  if (a === 'AutoPay' || b === 'AutoPay') return false
  const wa = words(a), wb = words(b)
  return wa.length > 0 && wb.length > 0 && wa.some((w) => wb.includes(w))
}

export const getAutoPays = () => read<AutoPay[]>(KEYS.autopays, [])

/** Saves what a mandate message says. A repeat of the same message changes nothing. Returns true if something changed. */
export function recordAutoPay(text: string, ts: number): boolean {
  const p = parseAutoPay(text)
  const list = getAutoPays()
  const mine = list.find((a) => sameName(a.name, p.name))
  if (p.status === 'cancelled') {
    // cancelling something never seen adds nothing: there is nothing to track
    if (!mine || mine.status === 'cancelled') return false
    write(KEYS.autopays, list.map((a) => (a.id === mine.id ? { ...a, status: 'cancelled' as const, updatedAt: ts } : a)))
    return true
  }
  if (!(p.amount > 0) && !mine) return false
  if (mine) {
    const unchanged = mine.status === p.status && (!p.amount || Math.abs(mine.amount - p.amount) < 0.5) && (!p.nextAt || mine.nextAt === p.nextAt) && (!p.frequency || mine.frequency === p.frequency)
    if (unchanged) return false
    write(KEYS.autopays, list.map((a) => (a.id === mine.id ? { ...a, status: p.status, amount: p.amount || a.amount, frequency: p.frequency ?? a.frequency, nextAt: p.nextAt ?? a.nextAt, updatedAt: ts } : a)))
    return true
  }
  write(KEYS.autopays, [{ id: uid(), name: p.name, amount: p.amount, frequency: p.frequency, nextAt: p.nextAt, status: p.status, createdAt: ts, updatedAt: ts }, ...list].slice(0, 200))
  return true
}

export const removeAutoPay = (id: string) => write(KEYS.autopays, getAutoPays().filter((a) => a.id !== id))

/** What the active mandates add up to in a month (weekly x 4.33, quarterly / 3, yearly / 12). */
export function monthlyTotal(list: AutoPay[] = getAutoPays()): number {
  return list.filter((a) => a.status === 'active').reduce((s, a) => s + a.amount * (a.frequency === 'weekly' ? 4.33 : a.frequency === 'yearly' ? 1 / 12 : a.frequency === 'quarterly' ? 1 / 3 : /half/.test(a.frequency ?? '') ? 1 / 6 : /one/.test(a.frequency ?? '') ? 0 : a.frequency === 'daily' ? 30 : 1), 0)
}
