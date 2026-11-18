// Deleting a payment that is part of something bigger: a loan (its own entry or a repayment) or a split (your share and the
// friends' share, plus the group expense). Everything that belongs together goes together, and Undo brings all of it back.
import { deleteTransaction, getAll, restoreTransaction } from './data'
import { detachTransactionFromLoans, getLoans, restoreLoans } from '../payees/loans'
import { splitSiblings } from '../split/splitLink'
import { deleteTransaction as deleteSplitExpense } from '../split/split'
import { read, write, KEYS } from './storage'
import type { Transaction } from './types'

/** Deletes a payment with whatever is tied to it. Returns an undo, and how many entries went. */
export function removeTransaction(t: Transaction): { undo: () => void; count: number } {
  const all = getAll()
  const loan = t.loanId ? getLoans().find((l) => l.id === t.loanId && l.txId === t.id) : undefined
  // the loan's own entry: its repayments would otherwise point at a loan that no longer exists
  const repayments = loan ? all.filter((x) => x.id !== t.id && x.loanId === loan.id) : []
  const siblings = splitSiblings(t, all)
  const splitBefore = t.splitTxnId ? { txns: read<unknown[]>(KEYS.splitTransactions, []), rows: read<unknown[]>(KEYS.splits, []) } : null
  const loansBefore = detachTransactionFromLoans(t)
  const gone = [t, ...repayments, ...siblings]
  for (const x of gone) deleteTransaction(x.id)
  if (t.splitTxnId) deleteSplitExpense(t.splitTxnId)
  return {
    count: gone.length,
    undo: () => {
      for (const x of gone) restoreTransaction(x)
      restoreLoans(loansBefore)
      if (splitBefore) { write(KEYS.splitTransactions, splitBefore.txns); write(KEYS.splits, splitBefore.rows) }
    },
  }
}
