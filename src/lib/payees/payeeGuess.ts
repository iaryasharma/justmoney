// Some banks (UCO, many others) say only "Credited with Rs.13,650 by UCO-UPI": no name. These entries get a plain label, and this suggests who it
// probably was, from your own history: the same amount paid or received before, and for money in, a similar amount around the same day of the month.
import type { Transaction } from '../core/types'

export const GENERIC_PAYEE = /^(?:payment|bank debit|bank credit|expense|money received|atm withdrawal|transfer)$/i
export const isUnnamed = (t: Pick<Transaction, 'paymentReceiver'>) => GENERIC_PAYEE.test(t.paymentReceiver.trim())

export function payeeSuggestions(t: Transaction, all: Transaction[], max = 3): string[] {
  const seen = new Map<string, { n: number; last: number }>()
  const dom = new Date(t.timestamp).getDate()
  for (const x of all) {
    if (x.id === t.id || isUnnamed(x) || x.paymentType !== t.paymentType) continue
    const same = Math.abs(x.paymentAmount - t.paymentAmount) < 0.5
    const alike = t.paymentType === 'CREDIT' && Math.abs(x.paymentAmount - t.paymentAmount) <= t.paymentAmount * 0.02 && Math.abs(new Date(x.timestamp).getDate() - dom) <= 3
    if (!same && !alike) continue
    const e = seen.get(x.paymentReceiver) ?? { n: 0, last: 0 }
    seen.set(x.paymentReceiver, { n: e.n + (same ? 2 : 1), last: Math.max(e.last, x.timestamp) })
  }
  return [...seen.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).slice(0, max).map(([name]) => name)
}
