// Links an imported bank statement to the right account (creating it if needed)
// and brings that account's balance up to date from the statement.
import { read, write, uid, KEYS } from '../core/storage'
import { METHOD_COLORS } from '../core/data'
import { BANKS } from '../accounts/accounts'
import type { StatementInfo } from './statement'
import type { Loan, PaymentMethod, SalarySettings, Transaction } from '../core/types'

/**
 * Moves everything from one account into another and removes the first, e.g. when a
 * statement was filed under the wrong bank. The newer of the two set balances is kept.
 */
export function mergeAccount(fromId: string, toId: string) {
  if (fromId === toId) return
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])
  const from = methods.find((m) => m.id === fromId)
  const to = methods.find((m) => m.id === toId)
  if (!from || !to) return
  write(KEYS.transactions, read<Transaction[]>(KEYS.transactions, []).map((t) => (t.paymentMethodId === fromId ? { ...t, paymentMethodId: toId, updatedAt: Date.now() } : t)))
  write(KEYS.loans, read<Loan[]>(KEYS.loans, []).map((l) => ({
    ...l, accountId: l.accountId === fromId ? toId : l.accountId,
    repayments: l.repayments.map((r) => (r.accountId === fromId ? { ...r, accountId: toId } : r)),
  })))
  const salary = read<SalarySettings | null>(KEYS.salary, null)
  if (salary?.accountId === fromId) write(KEYS.salary, { ...salary, accountId: toId })
  const newer = from.openingDate != null && (to.openingDate == null || from.openingDate > to.openingDate)
  write(KEYS.paymentMethods, methods.filter((m) => m.id !== fromId).map((m) => (m.id !== toId ? m : {
    ...m, last4: m.last4 ?? from.last4,
    ...(newer ? { openingBalance: from.openingBalance, openingDate: from.openingDate } : {}),
  })))
}

/** Re-files just these transactions under another account. */
export function moveTransactions(ids: string[], toId: string) {
  const set = new Set(ids)
  write(KEYS.transactions, read<Transaction[]>(KEYS.transactions, []).map((t) => (set.has(t.id) ? { ...t, paymentMethodId: toId, updatedAt: Date.now() } : t)))
}

export interface LinkedAccount { account: PaymentMethod; created: boolean }

/** The saved account the statement belongs to, or a new one for its bank. Null if the bank is unknown. */
export function linkStatementAccount(info: StatementInfo): LinkedAccount | null {
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])
  if (info.accountId) {
    const account = methods.find((m) => m.id === info.accountId)
    if (account) return { account, created: false }
  }
  if (!info.bank) return null
  // an account of this bank may have been added since the statement was read
  const same = methods.filter((m) => m.type !== 'CREDIT_CARD' && m.bank === info.bank && (!info.last4 || !m.last4 || m.last4 === info.last4))
  if (same.length === 1) return { account: same[0], created: false }
  const full = BANKS.find((b) => b.short === info.bank)?.full ?? info.bank
  const account: PaymentMethod = {
    id: uid(), name: full, type: 'BANK', bank: info.bank, last4: info.last4 ?? undefined,
    color: METHOD_COLORS.find((c) => !methods.some((m) => m.color === c)) ?? METHOD_COLORS[0], createdAt: Date.now(),
  }
  write(KEYS.paymentMethods, [...methods, account])
  return { account, created: true }
}

/**
 * Sets the account balance to the statement's closing balance, effective from the end of
 * the statement's last day — unless the user already set a balance more recent than that.
 */
export function applyClosingBalance(accountId: string, closing: StatementInfo['closing']): number | null {
  if (!closing) return null
  const d = new Date(closing.ts)
  // a statement that only gives dates (read as noon) and ends today already counts today's payments so far: the balance holds from now,
  // so a payment later today still comes off it. A row with its own time holds from just after it; an older day from its midnight.
  const dateOnly = d.getHours() === 12 && d.getMinutes() === 0
  const effective = !dateOnly ? closing.ts + 1
    : new Date().toDateString() === d.toDateString() ? Date.now()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])
  const m = methods.find((x) => x.id === accountId)
  if (!m || m.type === 'CREDIT_CARD') return null
  if (m.openingDate != null && m.openingDate > effective) return null
  write(KEYS.paymentMethods, methods.map((x) => (x.id === accountId ? { ...x, openingBalance: closing.balance, openingDate: effective } : x)))
  return closing.balance
}
