import { recordHold } from '../accounts/holds'
// Parses Indian bank / card / UPI alert SMS into transactions, entirely on-device.
import { guessCategory } from './ai'
import { buildVendorCategoryMap, isBlockEvent, isPromoOrFuture } from '../core/data'
import { guessIncomeCategory } from '../core/money'
import { detectAccount } from '../accounts/accounts'
import type { NewTransaction, PaymentSource } from '../core/types'

// "Rs.250", "INR 250", "₹250", and the way SBI writes it with no currency sign at all: "debited by 340.0"
const AMOUNT = /(?:(?:rs\.?:?|inr|₹)\s*|(?<=(?:debited|credited)\s+(?:by|with|for)\s+))([\d,]+(?:\.\d{1,2})?)/i
const DEBIT = /\b(debited|spent|sent|paid|withdrawn|purchase|debit)\b|\bdr\./i
const CREDIT = /\b(credited|received|deposited|refund(?:ed)?|credit of)\b|\bcr\./i
const BANKISH = /\b(a\/c|acct|account|card|upi|vpa|avl\.? ?(?:bal|lmt)|neft|imps|ref(?:\.| no)?|txn)\b/i
const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec'

/**
 * What every real bank or card alert carries and an advert never does: your account or card written masked ("A/c XX6469",
 * "Card XX2434", "UCO Bank - 6469", "ending 1234"), a UPI / UTR reference, or the balance left. "CREDITED: Buy 1 Get 1 FREE in your
 * account! … orders above Rs. 699" has an amount and the word "credited", but none of these, so it is not money.
 */
const MASKED_ACCOUNT = /\b(?:a\/c|acc?t?|account|card|cc|dc)\b[^.\n]{0,30}?[x*•]+\s?-?\d{2,}|[x*•]{2,}\s?\d{3,}\b|\bending\s+(?:with\s+|in\s+)?\d{4}\b|\bbank\s*[-–]\s*\d{4}\b|\ba\/c\s*(?:no\.?\s*)?\d{4,}/i
const BALANCE = /\bavl\.?\s*(?:bal|lmt|limit)|\bavailable\s+(?:bal(?:ance)?|limit)|\b(?:a\/c|account)\s+bal(?:ance)?\b/i
export const hasTxnEvidence = (msg: string) => MASKED_ACCOUNT.test(msg) || BALANCE.test(msg) || !!refOf(msg)

/** True when the text reads like one or more bank alerts rather than a typed note. */
export function looksLikeBankSms(text: string) {
  return AMOUNT.test(text) && BANKISH.test(text) && (DEBIT.test(text) || CREDIT.test(text)) && hasTxnEvidence(text)
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

function cleanMerchant(raw: string) {
  let m = raw.trim()
  // a UPI id made of a mobile number (9876543210@ybl) is kept whole: the number is what finds the person in your contacts
  if (/^\+?\d{10,13}@[a-z0-9]+$/i.test(m)) return m.toLowerCase()
  if (m.includes('@')) m = m.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ')
  m = m.replace(/\b(vpa|upi|a\/c|acct|ac|your|the|mr|ms|m\/s)\b\.?/gi, ' ').replace(/[*x]{2,}\d*/gi, ' ').replace(/\s+/g, ' ').trim()
  // "-ACME TECHNOLOGIES" (NEFT-ACME…) loses its dash; "Rs500" is the amount, not who paid
  m = m.replace(/^[-/:.\s]+/, '')
  if (!/[a-z]{2}/i.test(m) || /^(bank|card|account)$/i.test(m) || /^(?:rs|inr|₹)\.?\s?\d/i.test(m)) return ''
  return m === m.toUpperCase() || m === m.toLowerCase() ? titleCase(m) : m
}

/** How the money moved (some banks write only this, e.g. "by UCO-UPI"). */
const CHANNEL = /^(?:[A-Za-z]{2,10}[-\s])?(?:upi|neft|imps|rtgs|atm|pos|ecs|nach|chq|cheque|clearing|cdm|branch)$/i

function merchantOf(msg: string, credit: boolean): string {
  const patterns = credit
    ? [
        /\b(?:from|by)\s+(?:neft|imps|upi|rtgs)?\s*(?:from\s+)?([A-Za-z0-9.@_ &'-]{2,40}?)(?=\s+on\b|\s+in\s+your\b|\s+in\s+a\/c\b|\s*[.,;(]|\s+ref|\s+avl|\s*$)/i,
        /;\s*([A-Za-z0-9 &.'-]{2,40}?)\s+debited/i,
      ]
    : [
        /;\s*([A-Za-z0-9 &.'-]{2,40}?)\s+credited/i,
        /\bat\s+([A-Za-z0-9 &.'*-]{2,40}?)(?=\s+on\b|\s*[.,;(]|\s+ref|\s+avl|\s*$)/i,
        /\bto\s+(?:vpa\s+)?([A-Za-z0-9.@_ &'-]{2,40}?)(?=\s+on\b|\s*[.,;(]|\s+ref|\s+avl|\s*$)/i,
        /\binfo:?\s*([^.]{2,40})/i,
      ]
  // a UPI id as the other side: "Cr. to 98xxxxx@kotakbank" / "Dr. from name@okaxis", dots and all
  const vpa = msg.match(credit ? /\b(?:dr\.?\s+from|from|by)\s+(?:vpa\s+)?([A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,})/i : /\b(?:cr\.?\s+to|to)\s+(?:vpa\s+)?([A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,})/i)?.[1]
  if (vpa) { const c = cleanMerchant(vpa); if (c) return c }
  for (const re of patterns) {
    const hit = msg.match(re)?.[1]
    // "by UCO-UPI", "by NEFT": the channel the money moved by, not who it was from or to
    if (hit && CHANNEL.test(hit.trim())) continue
    if (hit) {
      const parts = hit.split('/').map(cleanMerchant).filter((p) => p && !/^(upi|neft|imps|p2a|p2m|pos)$/i.test(p))
      if (parts[0]) return parts[0]
    }
  }
  if (/\batm\b/i.test(msg)) return 'ATM Withdrawal'
  return credit ? 'Bank credit' : 'Bank debit'
}

function dateOf(msg: string): number | undefined {
  // "(2026:08:14 04:10:37)" (Bank of Baroda): the date and the exact time
  const full = msg.match(/\b(20\d{2})[:/.-](\d{2})[:/.-](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (full && +full[2] <= 12) return new Date(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] ?? 0)).getTime()
  let m = msg.match(/\b(\d{4})[:-](\d{2})[:-](\d{2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime()
  m = msg.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ,]*(\d{2,4})\b/)
  if (m && MONTHS.includes(m[2].toLowerCase())) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    return new Date(y, MONTHS.indexOf(m[2].toLowerCase()) / 3, +m[1], 12).getTime()
  }
  m = msg.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    const d = new Date(y, +m[2] - 1, +m[1], 12)
    if (!Number.isNaN(d.getTime()) && +m[2] <= 12) return d.getTime()
  }
  return undefined
}

function sourceOf(msg: string): PaymentSource | undefined {
  if (/credit card|\bcc\b|avl\.? ?lmt|available limit/i.test(msg)) return 'CREDIT_CARD'
  if (/debit card|\bdc\b/i.test(msg)) return 'DEBIT_CARD'
  if (/\batm\b/i.test(msg)) return 'CASH'
  if (/\b(upi|vpa|a\/c|acct|account|neft|imps|rtgs)\b/i.test(msg)) return 'BANK'
  return undefined
}

/** One message → transaction, or null for OTPs, mandates, and non-transactions. */
export function parseBankSms(msg: string): NewTransaction | null {
  if (isBlockEvent(msg)) return null // IPO / mandate block or unblock
  if (isPromoOrFuture(msg)) return null // an offer, or money that has not arrived yet: not a transaction
  if (/\b(otp|one time password|will be debited|is due|due on|mandate|request(?:ed)? money|collect request)\b/i.test(msg)) return null
  if (!hasTxnEvidence(msg)) return null // an advert that says "credited" and quotes a price is not a bank alert
  const amt = msg.match(AMOUNT)
  const amount = amt ? Number(amt[1].replace(/,/g, '')) : 0
  if (!(amount > 0)) return null
  const d = msg.search(DEBIT)
  const c = msg.search(CREDIT)
  if (d < 0 && c < 0) return null
  const credit = c >= 0 && (d < 0 || c < d)
  const receiver = merchantOf(msg, credit)
  const vendorMap = buildVendorCategoryMap()
  return {
    paymentAmount: amount,
    paymentType: credit ? 'CREDIT' : 'DEBIT',
    paymentReceiver: receiver,
    paymentCategory: credit ? guessIncomeCategory(`${receiver} ${msg}`) : vendorMap[receiver] ?? (receiver === 'ATM Withdrawal' ? 'Others' : guessCategory(`${receiver} ${msg}`)),
    paymentSource: sourceOf(msg),
    paymentMethodId: detectAccount(msg) ?? undefined,
    timestamp: dateOf(msg),
    ref: refOf(msg),
    payeeId: payeeIdOf(msg),
  }
}

/** The UPI / UTR reference number in a bank message ("UPI Ref 173951909602", "UPI ref no. 666915186642", "UTR: 4412..."). */
export const refOf = (msg: string): string | undefined => msg.match(/\b(?:upi\s*)?(?:ref(?:erence)?(?:\s*(?:no|number|id)\.?)?|utr(?:\s*(?:no|number)\.?)?|rrn|(?:upi\s*)?(?:transaction|txn)\s*id)\s*[:#.-]?\s*(\d{9,16})\b/i)?.[1]
  // ICICI and HDFC print it as "UPI:630077665544" or "(UPI 630099887766)": exactly twelve digits right after the word UPI
  ?? msg.match(/\bupi\s*[:#/-]?\s*(\d{12})\b/i)?.[1]

/** The other side's full UPI id (name@bank) or a mobile number, when the message prints it unmasked. A masked one (xx9501@bank) says too little to remember. */
export const payeeIdOf = (msg: string): string | undefined => {
  const vpa = msg.match(/(?<![A-Za-z0-9._*•-])([A-Za-z0-9][A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,})\b/)?.[1]
  if (vpa) return vpa.toLowerCase()
  return undefined
}

const smsBlocks = (text: string) => text.split(/\n\s*\n/).flatMap((b) => {
  const lines = b.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 1 && lines.every((l) => AMOUNT.test(l)) ? lines : [lines.join(' ')]
})

/** IPO / mandate blocks and unblocks in pasted messages are kept as holds. Returns how many were new. */
export function recordSmsHolds(text: string): number {
  return smsBlocks(text).filter((b) => isBlockEvent(b) && recordHold(b, dateOf(b) ?? Date.now())).length
}

/** Splits pasted text into messages (blank lines, or lines that each start a new alert). */
export function parseBankSmsBatch(text: string): NewTransaction[] {
  return smsBlocks(text).map(parseBankSms).filter((t): t is NewTransaction => !!t)
}
