// A bank payment shared in a SplitMoney group: only your share stays your spending. The others' share is a second
// entry in the "Split" category (a transfer, like a loan), so it never counts as yours, and the group knows who owes you.
import { SPLIT } from '../accounts/accounts'
import { addTransaction, deleteTransaction, getAll, updateTransaction } from '../core/data'
import { addPeople, createProject, createTransaction, deleteLinked, ensureCurrentUserInProject, splitAmountEvenly, splitWithoutGroup, type SplitPerson, type SplitTxn } from './split'
import { read, KEYS } from '../core/storage'
import type { Transaction } from '../core/types'

const r2 = (n: number) => Math.round(n * 100) / 100

/** A new group for a split made from a payment: you plus the friends named. Returns its id. */
export function newSplitGroup(name: string, selfName: string, friends: string[]) {
  const p = createProject(name.trim(), selfName)
  if (friends.length) addPeople(p.id, friends)
  return p.id
}

/**
 * Shares a payment equally among `personIds` (group members, you included or not) in a SplitMoney group, with you as the payer.
 * Your share stays on this entry; the rest moves to a Split entry beside it. Returns your share, or null if nothing was split.
 */
export function splitPayment(t: Transaction, projectId: string, personIds: string[]): number | null {
  if (t.paymentType !== 'DEBIT' || t.splitTxnId || personIds.length === 0) return null
  ensureCurrentUserInProject(projectId)
  const people = read<SplitPerson[]>(KEYS.splitPeople, []).filter((p) => p.projectId === projectId)
  const self = people.find((p) => p.isCurrentUser)!
  const ids = personIds.filter((id) => people.some((p) => p.id === id))
  if (!ids.some((id) => id !== self.id)) return null
  const amounts = splitAmountEvenly(t.paymentAmount, ids.length)
  const expense = createTransaction(t.paymentAmount, t.paymentReceiver, t.timestamp, projectId, self.id,
    ids.map((personId, i) => ({ personId, amount: amounts[i] })), 'DEBIT', { splitMode: 'EQUAL' })
  const mine = ids.includes(self.id) ? amounts[ids.indexOf(self.id)] : 0
  return keepMyShare(t, mine, expense.id)
}

/**
 * Shares a payment between you and friends named, outside any group: each friend's part goes into your ledger with them.
 * Equal unless `shares` (by name, 'me' for you) says otherwise. Your share stays on this entry.
 * Returns your share, or null if nothing was split (already split, not a payment you made, or bad shares).
 */
export function splitPaymentWithoutGroup(t: Transaction, friends: string[], selfName = 'You', shares?: Record<string, number>): number | null {
  if (t.paymentType !== 'DEBIT' || t.splitTxnId) return null
  const r = splitWithoutGroup({ amount: t.paymentAmount, description: t.paymentReceiver, date: t.timestamp, friends, paidBy: 'me', selfName, shares })
  if ('error' in r) return null
  return keepMyShare(t, r.myShare, r.key)
}

/** Your share stays on the payment; the friends' share moves to a Split entry beside it, both tagged with the split's key. */
function keepMyShare(t: Transaction, mine: number, key: string) {
  const others = r2(t.paymentAmount - mine)
  if (mine < 0.01) {
    // paid entirely for the others: the whole payment is theirs; its own category is kept aside for the undo
    updateTransaction(t.id, { paymentCategory: SPLIT, splitTxnId: key, splitCategory: t.paymentCategory === SPLIT ? undefined : t.paymentCategory })
    return 0
  }
  const id = addTransaction({
    paymentAmount: others, paymentType: 'DEBIT', paymentReceiver: t.paymentReceiver, paymentCategory: SPLIT, timestamp: t.timestamp,
    paymentSource: t.paymentSource, paymentMethodId: t.paymentMethodId ?? undefined, paymentApp: t.paymentApp, timeUnknown: t.timeUnknown, manualCategory: true,
  }, { allowDuplicate: true }).id
  if (id) updateTransaction(id, { splitTxnId: key })
  updateTransaction(t.id, { paymentAmount: mine, splitTxnId: key, originalAmount: undefined, originalCurrency: undefined })
  return mine
}

/** The others' share of a split payment (the Split entries beside it). */
export const splitSiblings = (t: Pick<Transaction, 'id' | 'splitTxnId'>, all: Transaction[] = getAll()) =>
  t.splitTxnId ? all.filter((x) => x.splitTxnId === t.splitTxnId && x.id !== t.id) : []

/** The group expense is being deleted in SplitMoney: the bank payment it came from gets its full amount back. Returns whether there was one. */
export function unsplitLinked(splitExpenseId: string) {
  // a bill split with several friends outside a group is one key across their ledgers
  const key = read<SplitTxn[]>(KEYS.splitTransactions, []).find((x) => x.id === splitExpenseId)?.linkKey ?? splitExpenseId
  const linked = getAll().filter((x) => x.splitTxnId === key)
  const main = linked.find((x) => x.paymentCategory !== SPLIT) ?? linked[0]
  if (main) unsplitPayment(main)
  return !!main
}

/** Undoes a split: the full amount comes back to this entry, and the group expense (or every friend's part of it) is removed. */
export function unsplitPayment(t: Transaction) {
  if (!t.splitTxnId) return
  const siblings = splitSiblings(t)
  const total = r2(t.paymentAmount + siblings.reduce((a, x) => a + x.paymentAmount, 0))
  for (const x of siblings) deleteTransaction(x.id)
  deleteLinked(t.splitTxnId)
  const back = t.paymentCategory === SPLIT ? { paymentCategory: t.splitCategory ?? 'Others' } : {}
  updateTransaction(t.id, { paymentAmount: total, splitTxnId: undefined, splitCategory: undefined, ...back })
}
