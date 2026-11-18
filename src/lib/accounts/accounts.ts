// Bank accounts & cards: which account a payment came from or went to, running
// balances from an opening balance, transfers between your own accounts, salary
// payday, and which UPI app was used.
import { frozenFor } from './holds'
import { read, write, KEYS } from '../core/storage'
import type { NewTransaction, PaymentMethod, RecurringRule, SalarySettings, Transaction, User } from '../core/types'

/** Money moved between your own accounts (or into/out of investments): never spending, never income. */
export const SELF_TRANSFER = 'Self transfer'
/** Money lent to / borrowed from someone (and paid back): owed, not spent or earned. */
export const LOAN = 'Loan'
/** Money someone gave you to spend for them, or that you spent for someone and got back: theirs, not yours. */
export const ON_BEHALF = 'On behalf'
/** Friends' share of a bill you paid and split in SplitMoney (or their settle-up coming back): theirs, not yours. */
export const SPLIT = 'Split'
/** Categories that move money without being spending or income. */
export const isTransferCategory = (c: string) => c === SELF_TRANSFER || c === LOAN || c === ON_BEHALF || c === SPLIT

/* ---------- banks ---------- */

/** Checked in order: "State Bank of India" must win over "Bank of India", etc. */
export const BANKS: { short: string; full: string; re: RegExp }[] = [
  { short: 'Kotak', full: 'Kotak Mahindra Bank', re: /\bkotak\b|\bkmbl\b|\bkkbk0/i },
  { short: 'UCO', full: 'UCO Bank', re: /\buco\b/i },
  { short: 'SBI', full: 'State Bank of India', re: /\bsbi\b|state bank/i },
  { short: 'HDFC', full: 'HDFC Bank', re: /\bhdfc\b/i },
  { short: 'ICICI', full: 'ICICI Bank', re: /\bicici\b/i },
  { short: 'Axis', full: 'Axis Bank', re: /\baxis bank\b|\baxis\b(?!\s*(?:ltd )?upi)/i },
  { short: 'PNB', full: 'Punjab National Bank', re: /\bpnb\b|punjab national/i },
  { short: 'BoB', full: 'Bank of Baroda', re: /bank of baroda|\bbob\b/i },
  { short: 'Canara', full: 'Canara Bank', re: /\bcanara\b/i },
  { short: 'Union', full: 'Union Bank of India', re: /union bank/i },
  { short: 'IDFC First', full: 'IDFC First Bank', re: /\bidfc\b/i },
  { short: 'Yes', full: 'Yes Bank', re: /\byes bank\b/i },
  { short: 'IndusInd', full: 'IndusInd Bank', re: /\bindusind\b/i },
  { short: 'Federal', full: 'Federal Bank', re: /\bfederal bank\b/i },
  { short: 'IDBI', full: 'IDBI Bank', re: /\bidbi\b/i },
  { short: 'Indian Overseas', full: 'Indian Overseas Bank', re: /indian overseas|\biob\b/i },
  { short: 'Central', full: 'Central Bank of India', re: /central bank/i },
  { short: 'Indian Bank', full: 'Indian Bank', re: /\bindian bank\b/i },
  { short: 'BOI', full: 'Bank of India', re: /bank of india|\bboi\b/i },
  { short: 'AU', full: 'AU Small Finance Bank', re: /\bau small|\bau bank\b/i },
  { short: 'RBL', full: 'RBL Bank', re: /\brbl\b/i },
  { short: 'Bandhan', full: 'Bandhan Bank', re: /\bbandhan\b/i },
  { short: 'Paytm Payments', full: 'Paytm Payments Bank', re: /paytm payments bank/i },
  { short: 'Airtel Payments', full: 'Airtel Payments Bank', re: /airtel payments bank/i },
  { short: 'Jio Payments', full: 'Jio Payments Bank', re: /jio payments bank/i },
  { short: 'Fino', full: 'Fino Payments Bank', re: /\bfino\b/i },
]

export function detectBank(text: string): string | null {
  return BANKS.find((b) => b.re.test(text))?.short ?? null
}

/** IFSC prefixes (first 4 letters) → bank. An IFSC names the account's own branch, so it beats any name in the text. */
const IFSC: Record<string, string> = {
  KKBK: 'Kotak', UCBA: 'UCO', SBIN: 'SBI', HDFC: 'HDFC', ICIC: 'ICICI', UTIB: 'Axis', PUNB: 'PNB', BARB: 'BoB', CNRB: 'Canara',
  UBIN: 'Union', IDFB: 'IDFC First', YESB: 'Yes', INDB: 'IndusInd', FDRL: 'Federal', IBKL: 'IDBI', IOBA: 'Indian Overseas',
  CBIN: 'Central', IDIB: 'Indian Bank', BKID: 'BOI', AUBL: 'AU', RATN: 'RBL', BDBL: 'Bandhan', PYTM: 'Paytm Payments',
  AIRP: 'Airtel Payments', JIOP: 'Jio Payments', FINO: 'Fino',
}

export function bankFromIfsc(text: string): string | null {
  for (const m of text.matchAll(/\b([A-Z]{4})0[A-Z0-9]{6}\b/g)) if (IFSC[m[1]]) return IFSC[m[1]]
  return null
}

/** The bank named most often in `text` (ties go to the first mention). */
export function mostMentionedBank(text: string): string | null {
  let best: { bank: string; n: number; at: number } | null = null
  for (const b of BANKS) {
    const re = new RegExp(b.re.source, 'gi')
    const hits = [...text.matchAll(re)]
    if (!hits.length) continue
    const cand = { bank: b.short, n: hits.length, at: hits[0].index ?? 0 }
    if (!best || cand.n > best.n || (cand.n === best.n && cand.at < best.at)) best = cand
  }
  return best?.bank ?? null
}

/** Last digits of an account / card number in an SMS or screenshot ("A/c XX1234", "card ending 1234", "**1234"). */
export function last4From(text: string): string | null {
  const pats = [
    /\b(?:a\/c|acct|account)\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d{8,18})\b/i, // full account number on statements
    /\b(?:a\/c|acct|account|ac|a\/c no\.?)\s*(?:no\.?)?\s*[:\-]?\s*[x*•.\s]*?(\d{3,6})\b/i,
    /\b(?:card|cc|debit card|credit card)\b[^0-9]{0,24}?[x*•.]{2,}\s?(\d{4})\b/i,
    /\bending(?:\s+with|\s+in)?\s*[x*•.]*\s*(\d{4})\b/i,
    /[x*•]{2,}\s?(\d{3,4})\b/i,
  ]
  for (const re of pats) {
    const m = text.match(re)
    if (m) return m[1].slice(-4)
  }
  return null
}

export const getAccounts = () => read<PaymentMethod[]>(KEYS.paymentMethods, [])

/** The saved account/card a message or screenshot refers to: by last digits first, then by bank. */
export function detectAccount(text: string, methods = getAccounts()): string | null {
  if (!methods.length || !text) return null
  const digits = last4From(text)
  if (digits) {
    const hits = methods.filter((m) => m.last4 && (m.last4.endsWith(digits) || digits.endsWith(m.last4)))
    const named = hits.length > 1 ? detectBank(text) : null
    const hit = (named && hits.find((m) => (m.bank ?? detectBank(m.name)) === named)) || hits[0]
    if (hit) return hit.id
  }
  const bank = detectBank(text)
  if (bank) {
    const ofBank = methods.filter((m) => (m.bank ?? detectBank(m.name)) === bank)
    if (ofBank.length === 1) return ofBank[0].id
    // A bank SMS for a card vs the account: pick by type when that settles it.
    const card = /credit card|\bcc\b|card ending|avl\.? ?lmt/i.test(text)
    const narrowed = ofBank.filter((m) => (card ? m.type === 'CREDIT_CARD' : m.type !== 'CREDIT_CARD'))
    if (narrowed.length === 1) return narrowed[0].id
  }
  return null
}

/* ---------- UPI apps ---------- */

export const UPI_APPS = ['PhonePe', 'PhonePe Business', 'Google Pay', 'Paytm', 'Paytm Business', 'BHIM', 'super.money', 'Amazon Pay', 'CRED', 'MobiKwik', 'WhatsApp Pay', 'Navi', 'Slice', 'Pop', 'Freecharge', 'Bank app', 'Other']

export const APP_MARKERS: [string, RegExp][] = [
  ['PhonePe Business', /\bphone\s?pe\s*(?:for\s*)?(?:business|merchant)\b/i],
  ['Paytm Business', /\bpaytm\s*(?:for\s*)?(?:business|merchant)\b|paytm\s*soundbox/i],
  ['PhonePe',/\bphone\s?pe\b/i],
  ['Google Pay', /google pay|\bg\s?pay\b|google transaction id/i],
  ['super.money', /super\.?\s?money/i],
  ['Amazon Pay', /amazon\s?pay/i],
  ['Paytm', /\bpaytm\b(?!\s*payments bank)/i],
  ['BHIM', /\bbhim\b/i],
  ['CRED', /\bcred\b(?!it)/i],
  ['MobiKwik', /mobikwik/i],
  ['WhatsApp Pay', /whatsapp\s?pay|payments on whatsapp/i],
  ['Navi', /\bnavi\b/i],
  ['Freecharge', /freecharge/i],
]

/**
 * The app a payment was made with, from screenshot or typed text. The payee name is
 * removed first so "Paid to Amazon Pay" isn't read as paying *with* Amazon Pay.
 */
export function detectUpiApp(text: string, payee?: string): string | null {
  let t = text
  if (payee) t = t.split(payee).join(' ')
  return APP_MARKERS.find(([, re]) => re.test(t))?.[0] ?? null
}

/** Fills in account and app from the original text when a parser didn't. */
export function enrichFromText<T extends NewTransaction>(tx: T, rawText: string): T {
  return {
    ...tx,
    paymentMethodId: tx.paymentMethodId ?? detectAccount(rawText) ?? undefined,
    paymentApp: tx.paymentApp ?? detectUpiApp(rawText, tx.paymentReceiver) ?? undefined,
  }
}

/* ---------- balances ---------- */

/**
 * The bank account a debit card draws from: the one it was linked to, or else the only
 * account of the same bank. A debit card is just a way to pay; it has no money of its own.
 */
export function cardAccount(card: PaymentMethod, methods: PaymentMethod[] = getAccounts()): PaymentMethod | null {
  if (card.type !== 'DEBIT_CARD') return null
  const linked = card.linkedAccountId ? methods.find((m) => m.id === card.linkedAccountId && m.type === 'BANK') : undefined
  if (linked) return linked
  const bank = card.bank ?? detectBank(card.name)
  const same = bank ? methods.filter((m) => m.type === 'BANK' && (m.bank ?? detectBank(m.name)) === bank) : []
  return same.length === 1 ? same[0] : null
}

export const tracksBalance = (m: PaymentMethod) =>
  m.openingBalance != null && m.type !== 'CREDIT_CARD' && !(m.type === 'DEBIT_CARD' && cardAccount(m))

/**
 * Now, rounded down to the minute: new transactions are timestamped from a datetime-local
 * input, which has no seconds, so an opening date stamped with full second/ms precision
 * could end up a few seconds *after* a transaction entered "now" in the same minute —
 * wrongly excluding it from the balance. Rounding both to the same minute fixes that.
 */
export const openingNow = () => Math.floor(Date.now() / 60000) * 60000

/** Opening balance + credits − debits since the opening date, for this account and the debit cards drawing on it. */
export function accountBalance(m: PaymentMethod, txns: Transaction[], methods: PaymentMethod[] = getAccounts()) {
  const from = m.openingDate ?? 0
  const ids = new Set([m.id, ...methods.filter((c) => cardAccount(c, methods)?.id === m.id).map((c) => c.id)])
  // money held for an IPO or mandate is not available until it is unblocked
  return txns.reduce((bal, t) => {
    if (!t.paymentMethodId || !ids.has(t.paymentMethodId) || t.timestamp < from) return bal
    return bal + (t.paymentType === 'CREDIT' ? t.paymentAmount : -t.paymentAmount)
  }, m.openingBalance ?? 0) - frozenFor(ids)
}

/** Credit card: what's been spent on it this billing month (approximate outstanding). */
export function cardSpentThisMonth(m: PaymentMethod, txns: Transaction[]) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return txns.filter((t) => t.paymentMethodId === m.id && t.timestamp >= start)
    .reduce((a, t) => a + (t.paymentType === 'DEBIT' ? t.paymentAmount : -t.paymentAmount), 0)
}

/* ---------- salary payday ---------- */

const SALARY_RULE = 'salary'

/** Next payday at 10:00 (today counts if it's payday and before 10:00). Short months use their last day. */
export function nextPayday(day: number, from = new Date()) {
  const at = (y: number, m: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 10).getTime()
  const thisMonth = at(from.getFullYear(), from.getMonth())
  return thisMonth > from.getTime() ? thisMonth : at(from.getFullYear(), from.getMonth() + 1)
}

/** Keeps the automatic salary entry in step with the salary settings and profile income. */
export function applySalarySettings(s: SalarySettings) {
  write(KEYS.salary, s)
  const all = read<RecurringRule[]>(KEYS.recurringRules, [])
  const old = all.find((r) => r.id === SALARY_RULE)
  const rules = all.filter((r) => r.id !== SALARY_RULE)
  const income = read<User | null>(KEYS.user, null)?.monthly_income ?? 0
  if (s.autoAdd && s.accountId && income > 0) {
    rules.push({
      id: SALARY_RULE,
      template: { paymentAmount: income, paymentType: 'CREDIT', paymentReceiver: 'Salary', paymentCategory: 'Salary', paymentMethodId: s.accountId },
      // a payday that already passed while the app was closed is still due: keep it, so this month's salary is added
      cadence: 'MONTHLY', nextAt: old?.enabled && old.anchorDay === s.day ? old.nextAt : nextPayday(s.day), anchorDay: s.day, enabled: true, createdAt: old?.createdAt ?? Date.now(),
    })
  }
  write(KEYS.recurringRules, rules)
}
