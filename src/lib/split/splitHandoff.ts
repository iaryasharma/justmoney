// "Split this" on a transaction: parks what to prefill, and SplitMoney picks it up when it opens.
export interface SplitPrefill { description: string; amount: number; txnId?: string }

let pending: SplitPrefill | null = null

export const setPendingSplit = (p: SplitPrefill) => { pending = p }

/** "Split this" on a payment opens its edit sheet with the split turned on: which payment asked for that. */
let splitIntent: string | null = null
export const setSplitIntent = (txId: string) => { splitIntent = txId }
/** True once for the payment that asked to be split. */
export function takeSplitIntent(txId: string) {
  if (splitIntent !== txId) return false
  splitIntent = null
  return true
}

/** Home's "Split a bill" opens the split sheet straight away: a one-time request for it. */
let quickSplit = false
export const requestQuickSplit = () => { quickSplit = true }
export function takeQuickSplit() {
  const q = quickSplit
  quickSplit = false
  return q
}

/** Returns the parked prefill once, then forgets it. */
export function takePendingSplit(): SplitPrefill | null {
  const p = pending
  pending = null
  return p
}
