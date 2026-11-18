// Customer credit: goods sold on credit. The money is owed to the shop, so it is not income until the customer pays.
import { read, write, uid, KEYS } from '../core/storage'
import { addTransaction } from '../core/data'
import type { CreditSale } from '../core/types'

export const getCredits = () => read<CreditSale[]>(KEYS.creditSales, [])
export const paidOf = (c: CreditSale) => c.payments.reduce((a, p) => a + p.amount, 0)
export const owedOf = (c: CreditSale) => Math.max(0, Math.round((c.amount - paidOf(c)) * 100) / 100)
export const isOverdue = (c: CreditSale, now = Date.now()) => !!c.due && c.due < now && owedOf(c) > 0

export function creditTotals(list = getCredits(), now = Date.now()) {
  const open = list.filter((c) => owedOf(c) > 0)
  return {
    owed: open.reduce((a, c) => a + owedOf(c), 0),
    overdue: open.filter((c) => isOverdue(c, now)).reduce((a, c) => a + owedOf(c), 0),
    count: open.length,
  }
}

export function addCredit(customer: string, amount: number, due?: number | null, note?: string | null) {
  const c: CreditSale = { id: uid(), customer: customer.trim(), amount, date: Date.now(), due: due ?? null, note: note?.trim() || null, createdAt: Date.now(), payments: [] }
  write(KEYS.creditSales, [c, ...getCredits()])
  return c
}

/** A customer pays (some of) what they owe: that is when it becomes income, in Business. Cash goes to cash in hand. */
export function receivePayment(id: string, amount: number, opts: { accountId?: string | null; cash?: boolean } = {}) {
  const list = getCredits()
  const c = list.find((x) => x.id === id)
  if (!c) return null
  const pay = Math.min(amount, owedOf(c))
  if (!(pay > 0)) return c
  const tx = addTransaction({
    paymentAmount: pay, paymentType: 'CREDIT', paymentReceiver: c.customer, paymentCategory: 'Business',
    ...(opts.cash ? { paymentSource: 'CASH' as const } : opts.accountId ? { paymentMethodId: opts.accountId } : {}),
    note: '#udhaar', manualCategory: true,
  }, { allowDuplicate: true })
  const next: CreditSale = { ...c, payments: [...c.payments, { id: uid(), amount: pay, date: Date.now(), txId: tx.id ?? null }] }
  write(KEYS.creditSales, list.map((x) => (x.id === id ? next : x)))
  return next
}

export const removeCredit = (id: string) => write(KEYS.creditSales, getCredits().filter((c) => c.id !== id))

/** Names already used, so a returning customer is one tap. */
export const knownCustomers = (list = getCredits()) => [...new Set(list.map((c) => c.customer))].slice(0, 8)
