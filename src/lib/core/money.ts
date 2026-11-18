// Money flow beyond everyday spending:
//  - commitments: fixed monthly outflows planned from income (e.g. ₹15,000 to family)
//  - spendable: income minus commitments, which is what the budget bar tracks
//  - income sources: where money came from (salary, family, stocks/IPO, …) and from whom
import { read, KEYS } from './storage'
import { isTransferCategory } from '../accounts/accounts'
import type { Commitment, FamilyMember, IncomeSource, Transaction, User } from './types'

/** Categories for money coming in (CREDIT). */
export const INCOME_CATEGORIES = [
  'Salary', 'Family', 'Stocks & IPO', 'Dividends', 'Interest', 'Freelance', 'Business',
  'Rental income', 'Gift', 'Refund', 'Cashback', 'Other income',
]
/** The outflow category for money sent to family (and its default commitment). */
export const FAMILY = 'Family'

export const RELATIONS = ['Mom', 'Dad', 'Brother', 'Sister', 'Spouse', 'Grandparent', 'Uncle', 'Aunt', 'Cousin', 'Child', 'Other']

export const getFamily = () => read<FamilyMember[]>(KEYS.familyMembers, [])
export const getCommitments = () => read<Commitment[]>(KEYS.commitments, [])

/**
 * Outflow categories that are planned commitments rather than personal spending.
 * Money sent to family always counts as a commitment, as does any category with a
 * commitment set (e.g. Rent paid to parents). These are shown separately and
 * excluded from "spent", so the spendable budget isn't counted twice.
 */
export function committedCategories(commitments = getCommitments()) {
  return new Set([FAMILY, ...commitments.map((c) => c.category)])
}

export const isPersonalSpend = (t: Transaction, committed: Set<string>) =>
  t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory) && !committed.has(t.paymentCategory) && !t.business
/** Money spent on the shop (stock, rent, wages), kept apart from what the person spends. */
export const isBusinessExpense = (t: Transaction) => t.paymentType === 'DEBIT' && !!t.business && !isTransferCategory(t.paymentCategory)
export const isCommittedOutflow = (t: Transaction, committed: Set<string>) => t.paymentType === 'DEBIT' && committed.has(t.paymentCategory)
/** Money received that is real income (moving money between your own accounts isn't). */
export const isIncome = (t: Transaction) => t.paymentType === 'CREDIT' && !isTransferCategory(t.paymentCategory)

/** Planned monthly income: profile salary + recurring income sources. */
export function plannedIncome(user = read<User | null>(KEYS.user, null), sources = read<IncomeSource[]>(KEYS.incomeSources, [])) {
  return (user?.monthly_income ?? 0) + sources.reduce((a, s) => a + s.amount, 0)
}

export function spendable(income = plannedIncome(), commitments = getCommitments()) {
  return income - commitments.reduce((a, c) => a + c.amount, 0)
}

/** How much of a commitment was actually paid in the given transactions (usually one month's). */
export function commitmentPaid(c: Commitment, txns: Transaction[], members = getFamily()) {
  const member = c.memberId ? members.find((m) => m.id === c.memberId) : undefined
  return txns
    .filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === c.category)
    .filter((t) => !member || sameName(t.paymentReceiver, member.name) || !t.paymentReceiver || t.paymentReceiver === c.name)
    .reduce((a, t) => a + t.paymentAmount, 0)
}

// letters of any script, so a member saved as "माँ" is not an empty name that every payee "contains"
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
export const sameName = (a: string, b: string) => !!a && !!b && norm(a) === norm(b)

/** The family member a payee/payer name refers to, by name or relation ("Mom", "papa"…). */
export function matchFamily(name: string, members = getFamily()): FamilyMember | undefined {
  const n = norm(name)
  if (!n) return undefined
  return members.find((m) => {
    const mn = norm(m.name)
    return (!!mn && mn === n) || (!!m.relation && norm(m.relation) === n) || (mn.length >= 3 && n.includes(mn))
  })
}

const FAMILY_WORDS = /\b(mom|mum|mummy|mother|maa|ma|amma|mamma|dad|daddy|papa|father|pitaji|appa|bro|brother|bhai|bhaiya|sis|sister|didi|behen|wife|husband|spouse|family|uncle|aunt|aunty|chacha|chachi|mama|mami|nana|nani|dada|dadi|grandpa|grandma|son|daughter|parents?)\b/i

/** Picks an income category for money received, from the payer name and message text. */
export function guessIncomeCategory(text: string, members = getFamily()): string {
  const t = text.toLowerCase()
  if (members.some((m) => m.name && t.includes(m.name.toLowerCase())) || FAMILY_WORDS.test(t)) return FAMILY
  if (/\b(salary|payroll|sal cr|wages|stipend)\b/.test(t)) return 'Salary'
  if (/\b(dividend|div\b)/.test(t)) return 'Dividends'
  if (/\b(ipo|stocks?|shares?|equity|demat|zerodha|groww|upstox|angel ?one|5paisa|kite|nse|bse|trading|profit|f&o|mutual fund redemption|redemption)\b/.test(t)) return 'Stocks & IPO'
  if (/\b(interest|int\.? cr|int pd|fd maturity|rd maturity)\b/.test(t)) return 'Interest'
  if (/\b(refund|reversal|reversed)\b/.test(t)) return 'Refund'
  if (/\b(cashback|cash back|reward)\b/.test(t)) return 'Cashback'
  if (/\b(rent received|rental|tenant)\b/.test(t)) return 'Rental income'
  if (/\b(freelance|upwork|fiverr|invoice|client|consulting)\b/.test(t)) return 'Freelance'
  if (/\b(gift|birthday|shagun|wedding)\b/.test(t)) return 'Gift'
  if (/\b(business|sales|shop|store income)\b/.test(t)) return 'Business'
  return 'Other income'
}

/** Expense side: money sent to a known family member (or "to mom") is a Family transfer. */
/** A payee that is only a relation ("Mummy", "to Papa"): "BHAI BHAI KIRANA" or "MAMA EARTH" is a shop, not family. */
const FAMILY_ONLY = new RegExp(`^\\s*(?:to\\s+|my\\s+)?(?:${FAMILY_WORDS.source.replace(/^\\b\(|\)\\b$/g, '')})\\s*(?:ji)?\\s*$`, 'i')

export function looksLikeFamilyTransfer(text: string, members = getFamily()) {
  return !!matchFamily(text, members) || FAMILY_ONLY.test(text)
}
