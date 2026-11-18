import { payeeKey } from './payee'
import type { Transaction } from '../core/types'

export type Cadence = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
export const CADENCE_DAYS: Record<Cadence, number> = { WEEKLY: 7, MONTHLY: 30, QUARTERLY: 91, YEARLY: 365 }

/** The same day in the next month, quarter or year (rent on Feb 1 is due Mar 1, not Mar 3), on the last day when that month is shorter. */
function nextDue(ts: number, cadence: Cadence) {
  if (cadence === 'WEEKLY') return ts + 7 * 86400000
  const d = new Date(ts)
  const y = d.getFullYear(), m = d.getMonth() + (cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : 12)
  return new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate()), d.getHours(), d.getMinutes()).getTime()
}
const DAY = 86400000

export const SUBSCRIPTION_BRANDS = [
  'netflix', 'prime video', 'jiohotstar', 'hotstar', 'crunchyroll', 'spotify', 'youtube premium', 'apple',
  'google one', 'disney+', 'zee5', 'sonyliv', 'audible', 'adobe',
]

// The radar only follows streaming and app subscriptions, and rent. Everything else that merely repeats (groceries, food, shopping) is left alone.
const OTT = /netflix|prime\s?video|amazon\s?prime|\bprime\b|hotstar|crunchy\s?roll|jio\s?cinema|spotify|you\s?tube\s?(?:premium|music)|apple\s?(?:music|tv|one|services)|icloud|google\s?(?:one|play)|disney|zee\s?5|sony\s?liv|sun\s?nxt|\baha\b|hoichoi|audible|adobe|\bmubi\b|lionsgate|discovery\s?\+|subscription/i
const RENT = /\brent\b|landlord|\bpg\b|house\s?owner/i
const NOT_A_BILL = /blinkit|zepto|instamart|big\s?basket|swiggy|zomato|dunzo|bb\s?now|jio\s?mart|minutes|dmart|grocer|supermarket|amazon\s?(?:fresh|now)|licious|country\s?delight/i
export type RadarKind = 'subscription' | 'rent'
export function radarKind(receiver: string, category = ''): RadarKind | null {
  if (NOT_A_BILL.test(receiver)) return null
  if (OTT.test(receiver) || category === 'Subscriptions') return 'subscription'
  if (category === 'Rent' || RENT.test(receiver)) return 'rent'
  return null
}

export interface RecurringDebit {
  key: string; receiver: string; category: string; amount: number; cadence: Cadence
  occurrences: number; lastChargedAt: number; nextDueAt: number; confidence: number; isSubscription: boolean
  kind: RadarKind
  /** The charge is well overdue: it was probably cancelled, so it is not forecast any more. */
  ended: boolean
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function cadenceFor(meanGapDays: number): Cadence | null {
  if (meanGapDays >= 5 && meanGapDays <= 9) return 'WEEKLY'
  if (meanGapDays >= 24 && meanGapDays <= 38) return 'MONTHLY'
  if (meanGapDays >= 80 && meanGapDays <= 100) return 'QUARTERLY'
  if (meanGapDays >= 330 && meanGapDays <= 400) return 'YEARLY'
  return null
}

/** Detects recurring debits by grouping on normalised receiver and checking charge intervals. */
export function detectRecurring(txns: Transaction[]): RecurringDebit[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of txns) {
    if (t.paymentType !== 'DEBIT' || !radarKind(t.paymentReceiver, t.paymentCategory)) continue
    const k = payeeKey(t.paymentReceiver, t.paymentCategory)
    if (!k) continue
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  const out: RecurringDebit[] = []
  groups.forEach((list, key) => {
    if (list.length < 2) return
    list.sort((a, b) => a.timestamp - b.timestamp)
    const gaps = list.slice(1).map((t, i) => (t.timestamp - list[i].timestamp) / DAY)
    const cadence = cadenceFor(gaps.reduce((a, b) => a + b, 0) / gaps.length)
    if (!cadence) return
    const amounts = list.map((t) => t.paymentAmount)
    const amount = median(amounts)
    const maxDev = Math.max(...amounts.map((a) => Math.abs(a - amount)))
    const confidence = 0.6 * Math.min(list.length / 4, 1) + 0.4 * (1 - Math.min(maxDev / amount / 0.35, 1))
    const last = list[list.length - 1]
    const receiver = last.paymentReceiver
    out.push({
      key, receiver, category: last.paymentCategory, amount, cadence, occurrences: list.length,
      lastChargedAt: last.timestamp, nextDueAt: nextDue(last.timestamp, cadence), confidence,
      isSubscription: radarKind(receiver, last.paymentCategory) === 'subscription',
      kind: radarKind(receiver, last.paymentCategory)!,
      ended: Date.now() - (last.timestamp + CADENCE_DAYS[cadence] * DAY) > Math.max(12, CADENCE_DAYS[cadence] * 0.4) * DAY,
    })
  })
  return out.sort((a, b) => a.nextDueAt - b.nextDueAt)
}


export interface PriceChange { receiver: string; from: number; to: number; pct: number; at: number }

/** Recurring payees whose latest charge is noticeably different from the one before (a price hike or a drop). */
export function priceChanges(txns: Transaction[], recurring: RecurringDebit[]): PriceChange[] {
  const out: PriceChange[] = []
  for (const r of recurring) {
    const list = txns.filter((t) => t.paymentType === 'DEBIT' && payeeKey(t.paymentReceiver, t.paymentCategory) === r.key).sort((a, b) => a.timestamp - b.timestamp)
    if (list.length < 2) continue
    const last = list[list.length - 1]
    const before = median(list.slice(0, -1).slice(-3).map((t) => t.paymentAmount))
    const pct = Math.round(((last.paymentAmount - before) / before) * 100)
    if (Math.abs(pct) >= 5 && Math.abs(last.paymentAmount - before) >= 1) out.push({ receiver: r.receiver, from: before, to: last.paymentAmount, pct, at: last.timestamp })
  }
  return out.sort((a, b) => b.at - a.at)
}
