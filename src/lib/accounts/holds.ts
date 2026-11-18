// IPO / ASBA / UPI-mandate blocks and unblocks. The money is held at the bank, not spent: it shows in the list as a block or an unblock,
// leaves the account's balance while it is held, and is not counted in spending or income.
import { read, write, uid, KEYS } from '../core/storage'
import { detectBank, getAccounts } from './accounts'
import { createInvestmentFromTx, linkInvestmentBuy } from '../invest/invest'
import type { Hold, Investment, PaymentMethod, Transaction } from '../core/types'

export const GENERIC_NAME = 'IPO / UPI mandate'
const AMOUNT = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i
// banks word it differently: "unblocked", "revoked", "released", "lien removed / vacated / lifted"
const UNBLOCK = /\bun-?block(?:ed|ing)?\b|\brevoked\b|\blien\b[\s\S]{0,50}\b(?:released|removed|vacated|lifted|revoked|reversed|cancell?ed)\b|\b(?:released|removed|vacated|lifted|reversed)\b[\s\S]{0,30}\blien\b|\b(?:block|hold)\s+(?:released|removed|reversed)\b|\b(?:released|release of|reversed|revoked|refund(?:ed)?)\b[\s\S]{0,60}\b(?:ipo|mandate|asba|bid|funds?|amount|block)\b/i

/** What a block / unblock message says: which way, how much, and for which IPO if it names one. */
export function parseHold(text: string): { kind: Hold['kind']; amount: number; name: string; appNo?: string } | null {
  const m = text.match(AMOUNT)
  const amount = m ? Number(m[1].replace(/,/g, '')) : 0
  if (!(amount > 0)) return null
  const kind: Hold['kind'] = UNBLOCK.test(text) ? 'UNBLOCKED' : 'BLOCKED'
  // "UPI-Mandate is successfully created towards TATA CAPITAL LTD for Rs. 15,000"
  const towards = text.match(/towards\s+(.{2,60}?)\s+for\s+(?:rs\.?|inr|₹)/i)?.[1]?.trim()
  const named = text.match(/(?:for|towards|in|of)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9&.' -]{1,38}?)\s+(?:IPO|public issue|NFO|SME)\b/i)?.[1]?.trim()
  // "appl no. A12581921401252", "application number 1234567890", "ASBA ref ...", "UMRN ..." (letters and digits, at least 8, and at least one digit)
  const appNo = text.match(/(?:appl(?:ication)?\.?\s*(?:no\.?|number|id|ref)?|asba\s*(?:no|ref|id)\.?|umrn|mandate\s*(?:ref|no|id)\.?|bid\s*(?:no|id))\s*[:#.-]?\s*([A-Z0-9]{8,24})\b/i)?.[1]
  return { kind, amount, name: towards ?? (named ? `${named} IPO` : GENERIC_NAME), ...(appNo && /\d/.test(appNo) ? { appNo: appNo.toUpperCase() } : {}) }
}

const FILLER_WORDS = new Set(['ltd', 'limited', 'private', 'pvt', 'technologies', 'technology', 'india', 'industries', 'services', 'company', 'corp', 'the', 'and', 'ipo', 'public', 'issue', 'application'])
const sig = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER_WORDS.has(w))

/**
 * Do two messages describe the same IPO application? The application number decides when both quote one. Otherwise the names do: a message
 * that names no IPO fits any, and two names that share a word ("TATA CAPITAL LTD" / "Tata Capital IPO") are one. Two clearly different names are not.
 */
export function sameApplication(a: { name: string; appNo?: string }, b: { name: string; appNo?: string }): boolean {
  if (a.appNo && b.appNo) return a.appNo === b.appNo
  if (a.name === GENERIC_NAME || b.name === GENERIC_NAME) return true
  const wa = sig(a.name), wb = sig(b.name)
  if (!wa.length || !wb.length) return true
  return wa.some((w) => wb.some((x) => x === w || (w.length >= 5 && x.length >= 5 && (w.startsWith(x) || x.startsWith(w)))))
}

/** True when the message says which application it is about (a number or a name), so it can be told apart from another of the same amount. */
const identifies = (h: { name: string; appNo?: string }) => !!h.appNo || h.name !== GENERIC_NAME

/** The bank account the message is about: by the last digits it shows, else the bank it names, else the only bank account there is. */
export function accountForHold(text: string, methods: PaymentMethod[] = getAccounts()): string | null {
  const banks = methods.filter((m) => m.type === 'BANK')
  const byDigits = banks.filter((m) => m.last4 && new RegExp(String.raw`(?:x|\*|ending|a/c|acct?\.?)\s*(?:no\.?)?\s*[x*]*${m.last4}\b`, 'i').test(text))
  if (byDigits.length === 1) return byDigits[0].id
  const bank = detectBank(text)
  const byBank = bank ? banks.filter((m) => (m.bank ?? detectBank(m.name)) === bank) : []
  if (byBank.length === 1) return byBank[0].id
  return banks.length === 1 ? banks[0].id : null
}

/** Saves a block / unblock. The same message seen twice (SMS and the bank app, say) is kept once. */
/**
 * Money can only be blocked while the market is open: Monday to Friday, applications close at 5 PM and the bank's message can trail by up to half an hour.
 * A "blocked" message at 2 AM or on a Sunday is the bank reminding you the money is still held, never a new block.
 */
export function inBlockWindow(ts: number): boolean {
  const d = new Date(ts)
  const day = d.getDay()
  const mins = d.getHours() * 60 + d.getMinutes()
  return day >= 1 && day <= 5 && mins >= 8 * 60 && mins <= 17 * 60 + 30
}

export function recordHold(text: string, ts: number, opts: { fromNotification?: boolean; windowMs?: number; paymentMethodId?: string | null; kind?: Hold['kind']; amount?: number; name?: string } = {}): boolean {
  const p = parseHold(text)
  const amount = opts.amount ?? p?.amount ?? 0
  if (!(amount > 0)) return false
  const kind = opts.kind ?? p?.kind ?? 'BLOCKED'
  // Setting up a subscription (a UPI AutoPay / recurring mandate for Netflix, Spotify, an SIP…) holds nothing: the money moves only when each
  // charge is taken, and that charge arrives as an ordinary debit. Without IPO / ASBA / application / lien wording it is not a block.
  if (kind === 'BLOCKED' && !opts.kind && /\b(?:auto\s?-?pay|recurring|subscription|frequency|monthly|yearly|weekly|quarterly|every\s+(?:month|week|year))\b/i.test(text) && !/\b(?:ipo|asba|sbmd|application|public issue|lien|blocked)\b/i.test(text)) return false
  // a message that arrives live, outside the hours blocking is possible, is only a reminder of a block that is already there
  const reminder = opts.fromNotification && kind === 'BLOCKED' && !inBlockWindow(ts)
  const holds = read<Hold[]>(KEYS.holds, [])
  let methodId = opts.paymentMethodId ?? accountForHold(text)
  const name = opts.name ?? p?.name ?? GENERIC_NAME
  const appNo = p?.appNo
  const me = { name, appNo }
  const sameAmount = (h: Hold) => Math.abs(h.amount - amount) < 0.5
  const sameAccount = (h: Hold) => !h.paymentMethodId || !methodId || h.paymentMethodId === methodId
  // the bank, the registrar and the depository can each send their own message about the one application: they are one event when they
  // agree on the application (its number, or its name) and on the amount
  const sameEvent = (h: Hold) => sameAmount(h) && sameAccount(h) && sameApplication(h, me)
  if (kind === 'UNBLOCKED') {
    // the same release told twice, by different senders in different words: recorded once
    const told = holds.find((h) => h.kind === 'UNBLOCKED' && sameEvent(h) && identifies(h) && identifies(me) && Math.abs(h.timestamp - ts) <= 3 * 86400000)
    if (told) {
      const patch: Partial<Hold> = {}
      if (!told.appNo && appNo) patch.appNo = appNo
      if (told.name === GENERIC_NAME && name !== GENERIC_NAME) patch.name = name
      if (Object.keys(patch).length) write(KEYS.holds, holds.map((h) => (h.id === told.id ? { ...h, ...patch } : h)))
      return false
    }
    // an unblock pairs with the block it releases (the one for the same application if it says which), and takes its account
    const stillHeld = activeHoldIds(holds)
    const open = holds.filter((h) => stillHeld.has(h.id) && Math.abs(h.amount - amount) < 0.5)
    const ofApp = identifies(me) ? open.filter((h) => sameApplication(h, me)) : []
    const pool = ofApp.length ? ofApp : open
    const match = pool.find((h) => (h.paymentMethodId ?? null) === (methodId ?? null)) ?? pool[0]
    // a UPI autopay mandate being cancelled is not a release of blocked money: with no block to match, it is left alone
    if (!match && /\b(?:revoked|cancell?ed|deleted|expired)\b/i.test(text) && !/\b(?:ipo|asba|block|lien)/i.test(text)) return false
    if (match) {
      methodId = match.paymentMethodId ?? methodId
      if (!match.appNo && appNo) write(KEYS.holds, holds.map((h) => (h.id === match.id ? { ...h, appNo } : h)))
    }
    // the bank can repeat an unblock notice: one for this amount and account in the last week, for the same application, is the same release
    else if (holds.some((h) => h.kind === 'UNBLOCKED' && sameAmount(h) && Math.abs(h.timestamp - ts) <= 7 * 86400000 && sameAccount(h) && (!identifies(h) || !identifies(me) || sameApplication(h, me)))) return false
  }
  const win = opts.windowMs ?? 30 * 60000
  // Banks often send two messages for one event (the UPI mandate, then a "lien marked" notice). The same kind and amount in the same account
  // (or an account one of them could not tell), for the same application, within the window is one event: keep one, and let the message that
  // names the IPO give it its name. The bank also repeats the notice every day until the money is released (even at night): a block that is
  // still held, for the same amount, account and application, is that reminder and not a second block. Two applications for the same
  // amount (the lot size is often 15,000) stay two blocks when their numbers or names differ.
  const held = kind === 'BLOCKED' ? activeHoldIds(holds) : new Set<string>()
  const dup = holds.find((h) => h.kind === kind && sameEvent(h) && (Math.abs(h.timestamp - ts) <= win || held.has(h.id)))
  // a reminder for a block that was never seen (the app was not running that day) says nothing about when it was made: leave it out
  if (!dup && reminder) return false
  if (dup) {
    const patch: Partial<Hold> = {}
    if (dup.name === GENERIC_NAME && name !== GENERIC_NAME) patch.name = name
    if (!dup.paymentMethodId && methodId) patch.paymentMethodId = methodId
    if (!dup.appNo && appNo) patch.appNo = appNo
    if (Object.keys(patch).length) write(KEYS.holds, holds.map((h) => (h.id === dup.id ? { ...h, ...patch } : h)))
    return false
  }
  write(KEYS.holds, [{ id: uid(), timestamp: ts, amount, kind, name, paymentMethodId: methodId, ...(appNo ? { appNo } : {}) }, ...holds].sort((a, b) => b.timestamp - a.timestamp).slice(0, 500))
  return true
}

/** Blocks that have not been unblocked yet: each unblock releases the earliest block of the same amount in the same account. */
export function activeHoldIds(holds: Hold[]): Set<string> {
  const open: Hold[] = []
  for (const h of [...holds].sort((a, b) => a.timestamp - b.timestamp)) {
    if (h.kind === 'BLOCKED') { if (!h.settledBy) open.push(h); continue }
    const i = open.findIndex((b) => Math.abs(b.amount - h.amount) < 0.5 && (b.paymentMethodId ?? null) === (h.paymentMethodId ?? null))
    if (i >= 0) open.splice(i, 1)
  }
  return new Set(open.map((h) => h.id))
}

/** Money held right now in these accounts (the account and the debit cards that spend from it). */
export function frozenFor(ids: Set<string>, holds: Hold[] = read<Hold[]>(KEYS.holds, [])): number {
  if (!holds.length) return 0
  const active = activeHoldIds(holds)
  return holds.filter((h) => active.has(h.id) && h.paymentMethodId && ids.has(h.paymentMethodId)).reduce((a, h) => a + h.amount, 0)
}

const GENERIC = /^(payment|bank debit|expense|upi payment|debit)$/i
const FILLER = new Set(['ltd', 'limited', 'private', 'pvt', 'technologies', 'technology', 'india', 'industries', 'services', 'company', 'corp', 'the', 'and', 'ipo'])
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !FILLER.has(w))

/**
 * When the bank really takes the blocked money (an IPO allotment), the payment is an investment, not spending:
 * the block is settled by it, and it goes into that IPO in Investments. Returns true if it was matched.
 */
export function settleHoldsWith(tx: Transaction): boolean {
  if (tx.paymentType !== 'DEBIT' || tx.investmentId) return false
  const holds = read<Hold[]>(KEYS.holds, [])
  if (!holds.length) return false
  const live = activeHoldIds(holds)
  const text = `${tx.paymentReceiver} ${tx.note ?? ''}`.toLowerCase()
  const keyword = /\b(ipo|asba|allot\w*|mandate|public issue)\b/.test(text)
  const cand = holds.filter((h) => h.kind === 'BLOCKED' && live.has(h.id) && tx.timestamp >= h.timestamp - 60000 && tx.paymentAmount <= h.amount + 0.5
    && (!tx.paymentMethodId || !h.paymentMethodId || tx.paymentMethodId === h.paymentMethodId))
  const named = (h: Hold) => words(h.name).some((w) => text.includes(w))
  const exact = (h: Hold) => Math.abs(h.amount - tx.paymentAmount) < 0.5
  const match = cand.find(named) ?? cand.find((h) => exact(h) && (keyword || GENERIC.test(tx.paymentReceiver.trim()))) ?? (keyword ? cand[0] : undefined)
  if (!match) return false
  const label = match.name.replace(/\s*IPO$/i, '').trim() || 'IPO'
  const invs = read<Investment[]>(KEYS.investments, [])
  const key = label.toLowerCase()
  const existing = invs.find((i) => i.type === 'IPO' && !i.closedAt && i.name.toLowerCase() === key)
  let invId: string
  if (existing) { linkInvestmentBuy(tx, existing.id); invId = existing.id } else invId = createInvestmentFromTx(tx, { name: label, type: 'IPO' })
  write(KEYS.investments, read<Investment[]>(KEYS.investments, []).map((i) => (i.id === invId ? { ...i, ipoStatus: 'ALLOTTED' as const } : i)))
  write(KEYS.holds, read<Hold[]>(KEYS.holds, []).map((h) => (h.id === match.id ? { ...h, settledBy: tx.id, investmentId: invId } : h)))
  return true
}
