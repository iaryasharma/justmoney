// Spots a charge that doesn't look like you: far above what you usually pay that payee,
// or the same payment twice within minutes.
import { isTransferCategory } from '../accounts/accounts'
import { payeeKey } from './payee'
import { formatPrice } from '../core/format'
import type { Transaction } from '../core/types'

export interface Anomaly { txId: string; kind: 'spike' | 'duplicate'; title: string; body: string }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

export const SPIKE_FACTOR = 3
export const SPIKE_MIN_EXTRA = 500
export const DUPLICATE_MINUTES = 10

/** Checks `check` (usually the newest entries) against everything in `all`. */
export function detectAnomalies(all: Transaction[], check: Transaction[]): Anomaly[] {
  const out: Anomaly[] = []
  for (const t of check) {
    if (t.paymentType !== 'DEBIT' || t.loanId || isTransferCategory(t.paymentCategory)) continue
    const key = payeeKey(t.paymentReceiver, t.paymentCategory)
    if (!key || /^(expense|payment|moneyreceived)$/.test(key)) continue
    const same = all.filter((x) => x.id !== t.id && x.paymentType === 'DEBIT' && payeeKey(x.paymentReceiver, x.paymentCategory) === key)

    const dup = same.find((x) => Math.abs(x.paymentAmount - t.paymentAmount) < 0.01 && Math.abs(x.timestamp - t.timestamp) <= DUPLICATE_MINUTES * 60000 && x.createdAt <= t.createdAt)
    if (dup) {
      out.push({ txId: t.id, kind: 'duplicate', title: 'Possible duplicate payment', body: `${t.paymentReceiver} ${formatPrice(t.paymentAmount, { round: true })} shows up twice within ${DUPLICATE_MINUTES} minutes.` })
      continue
    }

    const before = same.filter((x) => x.timestamp < t.timestamp)
    if (before.length < 3) continue
    const usual = median(before.map((x) => x.paymentAmount))
    if (usual > 0 && t.paymentAmount >= usual * SPIKE_FACTOR && t.paymentAmount - usual >= SPIKE_MIN_EXTRA) {
      out.push({ txId: t.id, kind: 'spike', title: 'Unusually high payment', body: `${t.paymentReceiver} ${formatPrice(t.paymentAmount, { round: true })} is ${Math.round(t.paymentAmount / usual)}× your usual ${formatPrice(usual, { round: true })}.` })
    }
  }
  return out
}
