// Loans & IOUs: money lent to or borrowed from people, with partial repayments.
// Moving the money is recorded against an account in the "Loan" category, so
// balances stay right while spending and income totals are unaffected.
import { read, write, uid, KEYS } from '../core/storage'
import { addTransaction, deleteTransaction, updateTransaction } from '../core/data'
import { LOAN } from '../accounts/accounts'
import type { Loan, LoanRepayment, Transaction } from '../core/types'

export const getLoans = () => read<Loan[]>(KEYS.loans, [])
export const repaid = (l: Loan) => l.repayments.reduce((a, r) => a + r.amount, 0)
export const outstanding = (l: Loan) => Math.max(0, Math.round((l.amount - repaid(l)) * 100) / 100)
export const isSettledLoan = (l: Loan) => outstanding(l) < 0.01

export function loanTotals(loans = getLoans()) {
  const open = loans.filter((l) => !isSettledLoan(l))
  return {
    owedToYou: open.filter((l) => l.direction === 'LENT').reduce((a, l) => a + outstanding(l), 0),
    youOwe: open.filter((l) => l.direction === 'BORROWED').reduce((a, l) => a + outstanding(l), 0),
  }
}

export function createLoan(l: Omit<Loan, 'id' | 'repayments' | 'createdAt'>) {
  const id = uid()
  let txId: string | null = null
  if (l.accountId) {
    txId = addTransaction(l.direction === 'LENT'
      ? { paymentAmount: l.amount, paymentType: 'DEBIT', paymentReceiver: `Lent to ${l.person}`, paymentCategory: LOAN, paymentMethodId: l.accountId, timestamp: l.date, note: '#loan', loanId: id, manualCategory: true }
      : { paymentAmount: l.amount, paymentType: 'CREDIT', paymentReceiver: `Borrowed from ${l.person}`, paymentCategory: LOAN, paymentMethodId: l.accountId, timestamp: l.date, note: '#loan', loanId: id, manualCategory: true },
    { allowDuplicate: true }).id ?? null
  }
  const loan: Loan = { ...l, id, txId, repayments: [], createdAt: Date.now() }
  write(KEYS.loans, [loan, ...getLoans()])
  return loan
}

/**
 * Records (part of) a loan being paid back. Amounts above what's outstanding are capped.
 * With `record`, an entry is added to the transactions even without an account.
 */
export function addRepayment(loanId: string, amount: number, accountId?: string | null, date = Date.now(), record = false) {
  const loans = getLoans()
  const loan = loans.find((x) => x.id === loanId)
  if (!loan) return null
  const amt = Math.min(amount, outstanding(loan))
  if (!(amt > 0)) return loan
  let txId: string | null = null
  if (accountId || record) {
    // the entry records all the money that moved (so the balance is right); only the part owed counts against the loan
    txId = addTransaction(loan.direction === 'LENT'
      ? { paymentAmount: amount, paymentType: 'CREDIT', paymentReceiver: `${loan.person} repaid`, paymentCategory: LOAN, paymentMethodId: accountId ?? undefined, timestamp: date, note: '#loan', loanId, manualCategory: true }
      : { paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: `Repaid ${loan.person}`, paymentCategory: LOAN, paymentMethodId: accountId ?? undefined, timestamp: date, note: '#loan', loanId, manualCategory: true },
    { allowDuplicate: true }).id ?? null
  }
  const next: Loan = { ...loan, repayments: [...loan.repayments, { id: uid(), amount: amt, date, accountId: accountId ?? null, txId }] }
  write(KEYS.loans, getLoans().map((x) => (x.id === loanId ? next : x)))
  return next
}

/** Removes a repayment (and the money-received entry it added). */
export function deleteRepayment(loanId: string, repaymentId: string) {
  const loan = getLoans().find((x) => x.id === loanId)
  const rep = loan?.repayments.find((r) => r.id === repaymentId)
  if (!loan || !rep) return
  if (rep.txId) deleteTransaction(rep.txId)
  write(KEYS.loans, getLoans().map((x) => (x.id === loanId ? { ...x, repayments: x.repayments.filter((r) => r.id !== repaymentId) } : x)))
}

/** Details of money lent, as entered on a transaction. */
export interface LendDetails { person: string; amount: number; date: number; dueDate: number | null; accountId: string | null; note?: string | null }

/** Turns an existing expense into money lent (or updates the loan it already is). Returns the loan id. */
export function lendFromTransaction(tx: Pick<Transaction, 'id' | 'loanId'>, d: LendDetails): string {
  const loans = getLoans()
  const existing = tx.loanId ? loans.find((l) => l.id === tx.loanId) : undefined
  const fields = { person: d.person, amount: d.amount, date: d.date, dueDate: d.dueDate, accountId: d.accountId, note: d.note ?? null, txId: tx.id }
  if (existing) {
    write(KEYS.loans, loans.map((l) => (l.id === existing.id ? { ...l, ...fields } : l)))
    return existing.id
  }
  const loan: Loan = { ...fields, id: uid(), direction: 'LENT', repayments: [], createdAt: Date.now() }
  write(KEYS.loans, [loan, ...loans])
  updateTransaction(tx.id, { loanId: loan.id })
  return loan.id
}

/** The expense is no longer money lent: forget the loan and the repayments recorded against it. */
export function unlendTransaction(loanId: string) {
  const loan = getLoans().find((l) => l.id === loanId)
  if (!loan) return
  for (const r of loan.repayments) if (r.txId) deleteTransaction(r.txId)
  if (loan.txId) updateTransaction(loan.txId, { loanId: undefined })
  deleteLoan(loanId)
}

/** Keeps a repayment in step when its money-received entry is edited. */
export function syncRepaymentFromTransaction(t: Pick<Transaction, 'id' | 'loanId' | 'paymentAmount' | 'timestamp' | 'paymentMethodId'>) {
  if (!t.loanId) return
  write(KEYS.loans, getLoans().map((l) => (l.id !== t.loanId ? l : {
    ...l, repayments: l.repayments.map((r): LoanRepayment => (r.txId === t.id ? { ...r, amount: t.paymentAmount, date: t.timestamp, accountId: t.paymentMethodId ?? null } : r)),
  })))
}

/** An existing income entry turns out to be (part of) a loan coming back. */
export function attachRepaymentTransaction(loanId: string, t: Pick<Transaction, 'id' | 'paymentAmount' | 'timestamp' | 'paymentMethodId'>) {
  write(KEYS.loans, getLoans().map((l) => (l.id !== loanId ? l : {
    ...l, repayments: [...l.repayments, { id: uid(), amount: Math.min(t.paymentAmount, outstanding(l)), date: t.timestamp, accountId: t.paymentMethodId ?? null, txId: t.id }],
  })))
}

/** Before a transaction is deleted: drop the loan it lent out, or the repayment it recorded. Returns the old loans for undo. */
export function detachTransactionFromLoans(t: Pick<Transaction, 'id' | 'loanId'>) {
  const before = getLoans()
  if (!t.loanId) return before
  if (before.some((l) => l.id === t.loanId && l.txId === t.id)) deleteLoan(t.loanId)
  else forgetRepaymentTransaction(t.id)
  return before
}

export const restoreLoans = (loans: Loan[]) => write(KEYS.loans, loans)

const normalizeName = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')

/** Loose "is this the same person" check: exact, or every word of the shorter name appears in the longer one. */
function samePerson(a: string, b: string) {
  const x = normalizeName(a), y = normalizeName(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const words = short.split(' ').filter((w) => w.length > 1)
  return words.length > 0 && words.every((w) => long.includes(w))
}

/**
 * A just-captured payment that matches the name and direction of money owed on an open loan
 * (you repaying what you borrowed, or them paying back what you lent) — a candidate to attach
 * as a repayment instead of leaving it as an ordinary transaction.
 */
export function findLoanMatch(t: Pick<Transaction, 'paymentReceiver' | 'paymentType'>): Loan | null {
  const open = getLoans().filter((l) => !isSettledLoan(l))
  return open.find((l) =>
    samePerson(l.person, t.paymentReceiver) && ((l.direction === 'LENT' && t.paymentType === 'CREDIT') || (l.direction === 'BORROWED' && t.paymentType === 'DEBIT')),
  ) ?? null
}

/** A repayment entry was deleted from the transactions list. */
export function forgetRepaymentTransaction(txId: string) {
  write(KEYS.loans, getLoans().map((l) => ({ ...l, repayments: l.repayments.filter((r) => r.txId !== txId) })))
}

export function deleteLoan(id: string) {
  write(KEYS.loans, getLoans().filter((l) => l.id !== id))
}

/** Does this loan belong to that person? By link, or by the exact name or a saved nickname (never a looser name guess). */
export function loanIsWith(l: Pick<Loan, 'person' | 'personId'>, p: { id: string; name: string; aliases: string[]; relation?: string | null }) {
  if (l.personId) return l.personId === p.id
  const n = normalizeName(l.person)
  if (n === normalizeName(p.name) || p.aliases.some((a) => normalizeName(a) === n)) return true
  // "Mom" typed on a loan means the contact you filed as Mom, whatever their saved name is
  const words = p.relation ? RELATION_WORDS[p.relation] : undefined
  return !!words && (n === normalizeName(p.relation!) || words.includes(n))
}

const RELATION_WORDS: Record<string, string[]> = {
  Mom: ['mom', 'mother', 'mummy', 'mommy', 'mama', 'maa', 'mum', 'amma', 'ma'],
  Dad: ['dad', 'father', 'papa', 'daddy', 'pa', 'baba', 'appa'],
  Brother: ['brother', 'bhai', 'bro'],
  Sister: ['sister', 'didi', 'sis'],
  Spouse: ['wife', 'husband', 'spouse'],
}

/** Points a loan at a saved person, so it shows on their page. */
export function linkLoanToPerson(loanId: string, personId: string | null) {
  write(KEYS.loans, getLoans().map((l) => (l.id === loanId ? { ...l, personId } : l)))
}

/** What is still open with a person: what they owe you, and what you owe them. */
export function personLoans(p: { id: string; name: string; aliases: string[]; relation?: string | null }, loans = getLoans()) {
  const open = loans.filter((l) => !isSettledLoan(l) && loanIsWith(l, p))
  return {
    open,
    owesYou: open.filter((l) => l.direction === 'LENT').reduce((a, l) => a + outstanding(l), 0),
    youOwe: open.filter((l) => l.direction === 'BORROWED').reduce((a, l) => a + outstanding(l), 0),
  }
}

/** The open loan this payment would settle: money in from someone who owes you, or money out to someone you owe. */
export function loanToSettle(t: Pick<Transaction, 'paymentType' | 'loanId'>, p: { id: string; name: string; aliases: string[]; relation?: string | null }) {
  if (t.loanId) return undefined
  return personLoans(p).open.find((l) => (l.direction === 'LENT' && t.paymentType === 'CREDIT') || (l.direction === 'BORROWED' && t.paymentType === 'DEBIT'))
}

/**
 * A new loan whose money is already in the list (the bank's message added it): that payment becomes the loan's own entry
 * instead of a second one being made. Money lent is a payment out, money borrowed a payment in.
 */
export function createLoanFromTransaction(l: Omit<Loan, 'id' | 'repayments' | 'createdAt' | 'accountId' | 'amount' | 'date'>, t: Transaction) {
  const loan: Loan = { ...l, amount: t.paymentAmount, date: t.timestamp, accountId: t.paymentMethodId ?? null, id: uid(), txId: t.id, repayments: [], createdAt: Date.now() }
  write(KEYS.loans, [loan, ...getLoans()])
  updateTransaction(t.id, { loanId: loan.id, paymentCategory: LOAN })
  return loan
}

/** Counts a payment as (part of) paying a loan back, in one tap. */
export function settleWithTransaction(t: Pick<Transaction, 'id' | 'paymentAmount' | 'timestamp' | 'paymentMethodId'>, loanId: string) {
  attachRepaymentTransaction(loanId, t)
  updateTransaction(t.id, { loanId, paymentCategory: LOAN })
}
