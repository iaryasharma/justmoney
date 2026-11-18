// Money handled for someone else: family gives you ₹10k to order their things, or a friend pays on their card
// and you pay them back. It sits in the "On behalf" category (a transfer category), so it is never your
// spending or your income, and each person keeps a running balance of whose money is where.
import { isTransferCategory, LOAN, ON_BEHALF } from './accounts'
import { addTransaction, getAll, updateTransaction } from '../core/data'
import { getPeople, normName } from '../payees/peopleMatch'
import type { Transaction } from '../core/types'

const DAY = 86400000
/** How far back a payment from someone can have funded a purchase for them. */
const FUNDED_WITHIN = 21 * DAY

export const isOnBehalf = (t: Pick<Transaction, 'paymentCategory'>) => t.paymentCategory === ON_BEHALF

/**
 * Marks a payment as money handled for a person. With `theirs` below the full amount, the payment is split:
 * their part becomes On behalf, the rest stays yours in the old category. Returns the id of your part, if any.
 */
export function markOnBehalf(t: Transaction, personId: string, theirs = t.paymentAmount): string | null {
  const part = Math.round(Math.min(theirs, t.paymentAmount) * 100) / 100
  if (!(part > 0)) return null
  // a payment moved out of a loan has no real category to go back to (your own money moving stays a Self transfer)
  const was = isOnBehalf(t) ? t.behalfFrom : t.paymentCategory
  const from = was && was !== LOAN && was !== ON_BEHALF ? was : t.paymentType === 'CREDIT' ? 'Other income' : 'Others'
  const mine = Math.round((t.paymentAmount - part) * 100) / 100
  let mineId: string | null = null
  if (mine >= 0.01) {
    mineId = addTransaction({
      paymentAmount: mine, paymentType: t.paymentType, paymentReceiver: t.paymentReceiver, paymentCategory: from, timestamp: t.timestamp,
      paymentSource: t.paymentSource, paymentMethodId: t.paymentMethodId ?? undefined, paymentApp: t.paymentApp, note: t.note, timeUnknown: t.timeUnknown, manualCategory: true,
    }, { allowDuplicate: true }).id ?? null
  }
  updateTransaction(t.id, { paymentAmount: part, paymentCategory: ON_BEHALF, behalfFrom: from, contactId: personId, loanId: undefined, ...(mine >= 0.01 ? { originalAmount: undefined, originalCurrency: undefined } : {}) })
  return mineId
}

/** Back to an ordinary payment of yours, in the category it had before. */
export function unmarkOnBehalf(t: Transaction) {
  updateTransaction(t.id, { paymentCategory: t.behalfFrom ?? (t.paymentType === 'CREDIT' ? 'Other income' : 'Others'), behalfFrom: undefined })
}

/** Their money you are still holding (above 0), or what they still owe you for things you paid for (below 0). */
export function behalfBalance(personId: string, txns: Transaction[] = getAll()) {
  let b = 0
  for (const t of txns) if (t.contactId === personId && isOnBehalf(t)) b += t.paymentType === 'CREDIT' ? t.paymentAmount : -t.paymentAmount
  return Math.round(b * 100) / 100
}

/** Everyone with money on behalf, balance first, and the entries behind it (newest first). */
export function behalfPeople(txns: Transaction[] = getAll()) {
  const by = new Map<string, Transaction[]>()
  for (const t of txns) if (t.contactId && isOnBehalf(t)) by.set(t.contactId, [...(by.get(t.contactId) ?? []), t])
  return [...by.entries()].map(([personId, list]) => ({
    personId, balance: behalfBalance(personId, list), list: list.sort((a, b) => b.timestamp - a.timestamp),
  }))
}

/**
 * Money coming in from someone you bought things for, who still owes you for them: a payback to count
 * against what they owe. The sender is the linked contact, or a saved person whose name or nickname it is.
 */
export function paybackFrom(t: Transaction, txns: Transaction[] = getAll()): { personId: string; owed: number } | null {
  if (t.paymentType !== 'CREDIT' || isOnBehalf(t) || t.loanId) return null
  const n = normName(t.paymentReceiver)
  const ids = t.contactId ? [t.contactId] : getPeople().filter((p) => normName(p.name) === n || p.aliases.some((a) => normName(a) === n)).map((p) => p.id)
  for (const personId of ids) {
    const b = behalfBalance(personId, txns)
    if (b <= -1) return { personId, owed: -b }
  }
  return null
}

/**
 * They paid first and you only marked the purchase: money that came in from them in the three weeks before it,
 * still filed as your income. Offered so their advance is counted too and the balance comes out right.
 */
export function unmarkedAdvance(t: Transaction, txns: Transaction[] = getAll()): Transaction | null {
  if (t.paymentType !== 'DEBIT' || !isOnBehalf(t) || !t.contactId || behalfBalance(t.contactId, txns) > -1) return null
  const p = getPeople().find((x) => x.id === t.contactId)
  const names = p ? [p.name, ...p.aliases].map(normName) : []
  return txns
    .filter((x) => x.paymentType === 'CREDIT' && !isTransferCategory(x.paymentCategory) && x.timestamp <= t.timestamp && t.timestamp - x.timestamp <= FUNDED_WITHIN
      && (x.contactId === t.contactId || (!x.contactId && names.includes(normName(x.paymentReceiver)))))
    .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null
}

/**
 * A purchase that may have been paid with money someone gave you to spend for them: they sent you money
 * marked On behalf in the three weeks before it, and enough of it is still unspent. Returns that person, if one.
 */
export function fundedBy(t: Transaction, txns: Transaction[] = getAll()): string | null {
  if (t.paymentType !== 'DEBIT' || isOnBehalf(t)) return null
  for (const p of behalfPeople(txns)) {
    if (p.balance < t.paymentAmount * 0.5) continue
    if (p.list.some((x) => x.paymentType === 'CREDIT' && x.timestamp <= t.timestamp && t.timestamp - x.timestamp <= FUNDED_WITHIN)) return p.personId
  }
  return null
}
