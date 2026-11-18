// Cash in hand. Money taken out of an ATM becomes cash; spending marked as paid in cash comes out of it.
// An ATM withdrawal is moving your own money, so once it is marked as a transfer it stops counting as spending
// (what you then spend in cash is what counts).
import { addTransaction, updateTransaction } from '../core/data'
import { isTransferCategory, SELF_TRANSFER } from './accounts'
import type { Transaction } from '../core/types'

const ATM = /\b(atm|cash\s*withdrawal|cash\s*wdl|nfs|cash\s*at\s*pos)\b/i

/** A bank or card debit that is taking cash out. */
export const isWithdrawal = (t: Transaction) => t.paymentType === 'DEBIT' && t.paymentSource !== 'CASH' && ATM.test(`${t.paymentReceiver} ${t.note ?? ''}`)

export function cashInHand(txns: Transaction[]) {
  const withdrawn = txns.filter(isWithdrawal).reduce((a, t) => a + t.paymentAmount, 0)
  const received = txns.filter((t) => t.paymentType === 'CREDIT' && t.paymentSource === 'CASH').reduce((a, t) => a + t.paymentAmount, 0)
  const spent = txns.filter((t) => t.paymentType === 'DEBIT' && t.paymentSource === 'CASH').reduce((a, t) => a + t.paymentAmount, 0)
  // cash deposited at a branch or machine (CDM) left your hand for the bank
  const deposited = txns.filter((t) => t.paymentType === 'CREDIT' && t.paymentSource !== 'CASH' && /\bcash\s*dep(?:osit)?|\bcdm\b|\bby\s+cash\b/i.test(`${t.paymentReceiver} ${t.rawReceiver ?? ''} ${t.note ?? ''}`)).reduce((a, t) => a + t.paymentAmount, 0)
  return { withdrawn, received, spent, balance: withdrawn + received - spent - deposited, has: withdrawn > 0 || spent > 0 || received > 0 }
}

/** Withdrawals still counted as spending: they double count with the cash you then spend. */
export const withdrawalsAsSpending = (txns: Transaction[]) => txns.filter((t) => isWithdrawal(t) && !isTransferCategory(t.paymentCategory))

/** Stops a withdrawal counting as spending. The cash balance still includes it. */
export const markWithdrawal = (t: Pick<Transaction, 'id'>) => updateTransaction(t.id, { paymentCategory: SELF_TRANSFER })

/** "I withdrew ₹2,000" from an account. */
export function withdrawCash(amount: number, fromId: string | null, timestamp = Date.now()) {
  addTransaction({ paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: 'Cash withdrawal', paymentCategory: SELF_TRANSFER, paymentMethodId: fromId ?? undefined, timestamp, manualCategory: true }, { allowDuplicate: true })
}

/** "I spent ₹150 cash" on something. */
export function spendCash(amount: number, payee: string, category: string, timestamp = Date.now()) {
  return addTransaction({ paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: payee.trim() || 'Cash spend', paymentCategory: category, paymentSource: 'CASH', timestamp, manualCategory: true }, { allowDuplicate: true })
}

/** Makes the cash balance read `target`, by recording the difference as cash received or spent. */
export function setCashBalance(target: number, txns: Transaction[]) {
  const diff = Math.round((target - cashInHand(txns).balance) * 100) / 100
  if (!diff) return
  addTransaction({ paymentAmount: Math.abs(diff), paymentType: diff > 0 ? 'CREDIT' : 'DEBIT', paymentReceiver: 'Cash adjustment', paymentCategory: SELF_TRANSFER, paymentSource: 'CASH', manualCategory: true }, { allowDuplicate: true })
}

/** Safe to spend per day: what is in your accounts, less everything still due this month, spread over the days left (today included). */
export function safeToSpend(balance: number, dueOut: number, now = new Date()) {
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1
  const free = balance - dueOut
  return { free, daysLeft, perDay: free > 0 ? free / daysLeft : 0, over: free < 0 ? -free : 0 }
}
