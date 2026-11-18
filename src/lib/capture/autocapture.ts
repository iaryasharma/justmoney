// Turns payment notifications captured by PaymentNotificationListener.java into
// transactions. One payment often produces two notifications (the UPI app's and the
// bank's SMS); those are merged into one transaction carrying both app and account.
import { parseScreenshot } from './screenshot'
import { activeHoldIds, parseHold, recordHold } from '../accounts/holds'
import { endsMandate, isAutopaySetup, recordAutoPay } from '../plan/autopay'
import { read, write, KEYS } from '../core/storage'
import { addTransaction, isBlockEvent, isPromoOrFuture, updateTransaction } from '../core/data'
import { localParseTransaction } from './ai'
import { looksLikeBankSms, parseBankSms, refOf } from './sms'
import { detectUpiApp, enrichFromText } from '../accounts/accounts'
import { guessIncomeCategory } from '../core/money'
import { BUSINESS, isMerchantApp, isMerchantReceipt, merchantAppOfPackage, reconcileSettlements } from '../payees/merchant'
import { Capture, isNativeApp } from '../core/native'
import { GENERIC_PAYEE, isUnnamed } from '../payees/payeeGuess'
import { normName } from '../payees/peopleMatch'
import { clearNudges, settlePart, splitPaybackFrom } from '../split/splitPlus'
import { SPLIT } from '../accounts/accounts'
import type { SplitPerson, SplitProject, SplitRow, SplitTxn } from '../split/split'
import { alertOn } from '../notify/alerts'
import { notifyNow } from '../notify/nativeNotify'
import { formatPrice } from '../core/format'
import type { CapturedNotification, Hold, NewTransaction, Transaction } from '../core/types'

/** Package → app label for the apps people pay with. Unknown packages still work (bank SMS etc.). */
export const PKG_APPS: Record<string, string> = {
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.phonepe.app': 'PhonePe',
  'net.one97.paytm': 'Paytm',
  'com.phonepe.app.business': 'PhonePe Business',
  'com.paytm.business': 'Paytm Business',
  'in.org.npci.upiapp': 'BHIM',
  'in.amazon.mShop.android.shopping': 'Amazon Pay',
  'com.dreamplug.androidapp': 'CRED',
  'com.mobikwik_new': 'MobiKwik',
  'com.whatsapp': 'WhatsApp Pay',
  'com.naviapp': 'Navi',
  'com.freecharge.android': 'Freecharge',
  'money.super.payments': 'super.money',
}
/** Banking apps: the notification names the account, not a UPI app. */
const BANK_APP = /(kotak|kbank|sbi|yono|hdfc|icici|imobile|axis|uco|pnb|bob|baroda|canara|union|idfc|yesbank|indusind|federal|rbl|bandhan|aubank)/i

const CUR = String.raw`(?:₹|rs\.?|inr)\s?`
const AMT = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`
const NAME = String.raw`([A-Za-z0-9][A-Za-z0-9 &.'@_-]{1,40}?)`
const END = String.raw`(?=\s+(?:using|via|from|on|is|was|has|successfully|with|through|ref|upi)\b|[.,!\n|]|$)`

const PATTERNS: { re: RegExp; type: 'DEBIT' | 'CREDIT'; amt: number; who: number }[] = [
  { re: new RegExp(String.raw`(?:you\s+)?(?:paid|sent|payment of)\s+${CUR}${AMT}\s+(?:successfully\s+)?(?:to|at)\s+${NAME}${END}`, 'i'), type: 'DEBIT', amt: 1, who: 2 },
  { re: new RegExp(String.raw`${CUR}${AMT}\s+(?:paid|sent)\s+(?:successfully\s+)?to\s+${NAME}${END}`, 'i'), type: 'DEBIT', amt: 1, who: 2 },
  { re: new RegExp(String.raw`(?:you\s+)?(?:received|got)\s+${CUR}${AMT}\s+from\s+${NAME}${END}`, 'i'), type: 'CREDIT', amt: 1, who: 2 },
  { re: new RegExp(String.raw`${CUR}${AMT}\s+(?:received|credited)\s+from\s+${NAME}${END}`, 'i'), type: 'CREDIT', amt: 1, who: 2 },
  { re: new RegExp(String.raw`${NAME}\s+(?:sent|paid)\s+you\s+${CUR}${AMT}`, 'i'), type: 'CREDIT', amt: 2, who: 1 },
]

/** Sales as the business apps word them; the customer's name is optional. */
const SALE_PATTERNS: { re: RegExp; amt: number; who: number }[] = [
  { re: new RegExp(String.raw`(?:payment|money|amount)\s+(?:of\s+)?${CUR}${AMT}\s+(?:is\s+)?(?:received|credited)(?:\s+(?:from|by)\s+${NAME}${END})?`, 'i'), amt: 1, who: 2 },
  { re: new RegExp(String.raw`(?:received|got)\s+(?:a\s+)?(?:payment\s+)?(?:of\s+)?${CUR}${AMT}(?:\s+from\s+${NAME}${END})?`, 'i'), amt: 1, who: 2 },
  { re: new RegExp(String.raw`${CUR}${AMT}\s+(?:received|credited)(?:\s+from\s+${NAME}${END})?`, 'i'), amt: 1, who: 2 },
]
/** A business app telling you it paid its balance out to the bank: the bank's own credit is the record of that. */
const PAYOUT_NOTICE = /settle|payout|(?:credited|transferred|sent)\s+to\s+(?:your\s+)?(?:bank|a\/c|account)/i

const title = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s)

/**
 * A payment-success screen read by the screen service (PaymentScreenService): the lines of text on the screen, top to bottom.
 * The service has already kept only screens that read as a successful payment; this takes out who was paid, how much and the bank reference.
 */
export function parsePaymentScreen(n: Pick<CapturedNotification, 'pkg' | 'text' | 'ts'>): NewTransaction | null {
  const rows = n.text.split('\n').map((s) => s.trim()).filter(Boolean)
  // an amount on a line of its own is the big number on the screen
  const lines = rows.map((text, i) => ({ text, top: i * 40, left: 0, height: /^(?:₹|rs\.?|inr)?\s?[\d,]+(?:\.\d{1,2})?$/i.test(text) ? 64 : 22 }))
  const p = parseScreenshot({ text: rows.join('\n'), lines })
  if (!p.tx || p.failed) return null
  const app = PKG_APPS[n.pkg.replace(/^screen:/, '')]
  // without a name for who was paid, the bank's own message will say more: do not add a nameless duplicate
  if (p.confidence !== 'high' && /^(Payment|Money received)$/.test(p.tx.paymentReceiver)) return null
  return { ...p.tx, paymentApp: app ?? p.tx.paymentApp, ref: refOf(n.text), timestamp: n.ts, timeUnknown: undefined, autoCaptured: true, note: undefined }
}

export function parsePaymentNotification(n: Pick<CapturedNotification, 'pkg' | 'title' | 'text' | 'ts'>): NewTransaction | null {
  if (n.pkg.startsWith('screen:')) return parsePaymentScreen(n)
  const all = `${n.title ?? ''}\n${n.text}`.trim()
  // TRAI marks every sender with what it sends: "-P" is promotional ("VM-PILGRM-P"), never a transaction
  if (/^sms:.*-P$/i.test(n.pkg) || /^[A-Z0-9]{2}-[A-Z0-9&]{3,9}-P$/i.test((n.title ?? '').trim())) return null
  if (isBlockEvent(all)) return null // IPO / mandate block or unblock
  // a payment that failed, is still pending, is only a reminder to pay, or is a request someone sent you: no money has moved
  // (money given back for a failed payment did move: "credited ... towards reversal of failed UPI transaction" is kept)
  if (/\b(?:failed|failure|declined|unsuccessful|not\s+completed|could\s+not\s+be\s+completed)\b/i.test(all)
    && !/\b(?:credited|reversal|reversed|refund(?:ed)?)\b/i.test(all)) return null
  if (/\b(?:pending|processing|in\s+progress|requested|collect\s+request|approve|is\s+due|due\s+(?:on|by|today)|pay\s+now|reminder)\b/i.test(all)
    && !/\b(?:debited|credited|successful(?:ly)?)\b/i.test(all)) return null
  // an offer, store credit, or money that has not arrived yet: never added on its own. (Amazon's shopping app is a shop, not a payment app.)
  if (isPromoOrFuture(all, !!PKG_APPS[n.pkg], !!PKG_APPS[n.pkg] && n.pkg !== 'in.amazon.mShop.android.shopping')) return null
  // a mandate / AutoPay being set up, changed or cancelled moves no money; the charge itself arrives later as an ordinary debit
  if (/\b(?:mandate|auto\s?-?pay)\b/i.test(all) && !/\b(?:debited|credited|paid|sent|spent|received|deducted)\b/i.test(all)) return null
  const detected = PKG_APPS[n.pkg] ?? (BANK_APP.test(n.pkg) ? 'Bank app' : detectUpiApp(all))
  const biz = merchantAppOfPackage(n.pkg) ?? (isMerchantApp(detected) ? detected : null)
  const app = biz ?? detected
  if (biz && PAYOUT_NOTICE.test(all)) return null
  let tx: NewTransaction | null = null
  if (biz) {
    for (const p of SALE_PATTERNS) {
      const m = all.match(p.re)
      if (!m) continue
      const amount = Number(m[p.amt].replace(/,/g, ''))
      if (!(amount > 0)) continue
      tx = { paymentAmount: amount, paymentType: 'CREDIT', paymentReceiver: m[p.who] ? title(m[p.who].trim().replace(/\s+/g, ' ')) : 'Customer payment', paymentCategory: BUSINESS }
      break
    }
  }
  for (const p of PATTERNS) {
    const m = all.match(p.re)
    if (!m) continue
    const amount = Number(m[p.amt].replace(/,/g, ''))
    const who = title(m[p.who].trim().replace(/\s+/g, ' '))
    if (!(amount > 0) || !who) continue
    tx = {
      paymentAmount: amount, paymentType: p.type, paymentReceiver: who,
      paymentCategory: p.type === 'CREDIT' ? guessIncomeCategory(`${who} ${all}`) : 'Others',
    }
    break
  }
  if (!tx && looksLikeBankSms(all)) tx = parseBankSms(all)
  // the loose reader only for a payment or bank app's own notification: an SMS (or the messaging app showing one) must read as a
  // real bank alert, or it is an advert that happens to say "credited" and quote a price
  if (!tx && (PKG_APPS[n.pkg] || BANK_APP.test(n.pkg) || biz)) tx = localParseTransaction(all)
  if (!tx) return null
  if (biz) {
    // a sale taken by a shop: income now, in no bank account yet (the payout reaches the bank later)
    return { ...tx, paymentCategory: tx.paymentType === 'CREDIT' ? BUSINESS : tx.paymentCategory, paymentMethodId: undefined, paymentApp: biz, timestamp: n.ts, autoCaptured: true, note: undefined }
  }
  // a message that only gives the date (Kotak: "on 24-10-26") and arrives on a later day keeps its own date, not the day it was read
  const msgDay = tx.timestamp !== undefined && !sameDay(tx.timestamp, n.ts)
  return { ...enrichFromText(tx, all), paymentApp: tx.paymentApp ?? app ?? undefined, ref: tx.ref ?? refOf(all), timestamp: msgDay ? tx.timestamp : n.ts, ...(msgDay ? { timeUnknown: true } : {}), autoCaptured: true, note: undefined }
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
const WINDOW = 15 * 60000

/** Same amount and direction within 15 minutes = the same payment seen twice. */
function findSamePayment(list: Transaction[], t: NewTransaction & { timestamp: number }, window = WINDOW) {
  // the bank's reference number settles it: the same number is the same payment, a different one is not
  if (t.ref) { const byRef = list.find((x) => x.ref === t.ref); if (byRef) return byRef }
  const sale = isMerchantApp(t.paymentApp) && t.paymentType === 'CREDIT'
  const named = (s?: string) => !!s && !GENERIC_PAYEE.test(s.trim())
  const kind = (x: { seenIn?: ('screen' | 'bank')[] }) => x.seenIn?.[0]
  return list.find((x) => !(x.ref && t.ref) && x.paymentAmount === t.paymentAmount && x.paymentType === t.paymentType
    // a message that only gives the date (UCO, read the next morning) is the same payment any time that day
    && (x.timeUnknown || t.timeUnknown ? sameDay(x.timestamp, t.timestamp) : Math.abs(x.timestamp - t.timestamp) <= window)
    // two sales of the same amount a few minutes apart are two customers, not one payment seen twice
    && !(sale && isMerchantReceipt(x))
    // different accounts are different payments (₹40 from UCO and ₹40 from Kotak), and so are two named, different payees
    && !(x.paymentMethodId && t.paymentMethodId && x.paymentMethodId !== t.paymentMethodId)
    && !(named(x.rawReceiver ?? x.paymentReceiver) && named(t.paymentReceiver) && normName(x.rawReceiver ?? x.paymentReceiver) !== normName(t.paymentReceiver) && normName(x.paymentReceiver) !== normName(t.paymentReceiver))
    // the same source reporting the same amount twice (two UCO messages) is two payments: one source never repeats itself
    && !(kind(x) && kind(t) === kind(x) && x.paymentMethodId === t.paymentMethodId && (x.paymentApp ?? '') === (t.paymentApp ?? '')))
}

/** The last notifications seen: which app sent them and whether they were read. Shown in Diagnostics, to check a new app is recognised. No message text is kept. */
export interface CaptureLogEntry {
  at: number; pkg: string; app: string | null; ok: boolean
  /** What was made of it, in words ("₹86 paid to Zepto"): never the message text itself. */
  what?: string
  outcome?: 'added' | 'matched' | 'ignored' | 'hold'
}

export function processCaptured(items: CapturedNotification[]) {
  const added: Transaction[] = []
  let merged = 0
  const log = read<CaptureLogEntry[]>(KEYS.captureLog, [])
  // the success screen goes first: it knows the app and the payee, and the bank message that follows is checked against it
  const ordered = [...items].sort((a, b) => Number(b.pkg.startsWith('screen:')) - Number(a.pkg.startsWith('screen:')))
  for (const item of ordered) {
    // a UPI AutoPay / recurring mandate set up or cancelled: kept under Planner -> AutoPay, never an expense and never frozen money
    {
      const whole = `${item.title ?? ''} ${item.text}`
      const heldNow = endsMandate(whole) ? activeHoldIds(read<Hold[]>(KEYS.holds, [])) : null
      const releasesIpo = !!heldNow && read<Hold[]>(KEYS.holds, []).some((h) => heldNow.has(h.id) && Math.abs(h.amount - (parseHold(whole)?.amount ?? -1)) < 0.5)
      if (releasesIpo) {
        // an IPO mandate cancelled while its money is held is the release of that money
        recordHold(whole, item.ts, { fromNotification: true, kind: 'UNBLOCKED' })
        log.unshift({ at: item.ts, pkg: item.pkg, app: PKG_APPS[item.pkg] ?? null, ok: true, what: 'IPO / mandate block or unblock', outcome: 'hold' })
        continue
      }
      if (isAutopaySetup(whole) || endsMandate(whole)) {
        const changed = recordAutoPay(whole, item.ts)
        log.unshift({ at: item.ts, pkg: item.pkg, app: PKG_APPS[item.pkg] ?? null, ok: true, what: 'AutoPay mandate', outcome: changed ? 'added' : 'matched' })
        continue
      }
    }
    // an IPO / mandate block or unblock: kept as a hold, not a payment
    if (isBlockEvent(`${item.title ?? ''}
${item.text}`)) { recordHold(`${item.title ?? ''}
${item.text}`, item.ts, { fromNotification: true }); log.unshift({ at: item.ts, pkg: item.pkg, app: PKG_APPS[item.pkg] ?? null, ok: true, what: 'IPO / mandate block or unblock', outcome: 'hold' }); continue }
    const tx = parsePaymentNotification(item)
    const entry: CaptureLogEntry = { at: item.ts, pkg: item.pkg, app: tx?.paymentApp ?? PKG_APPS[item.pkg] ?? merchantAppOfPackage(item.pkg), ok: !!tx, outcome: 'ignored', what: 'Not a payment, nothing saved' }
    log.unshift(entry)
    if (!tx?.timestamp) continue
    entry.what = `${formatPrice(tx.paymentAmount)} ${tx.paymentType === 'CREDIT' ? 'received' : 'paid'}${isUnnamed(tx) ? '' : (tx.paymentType === 'CREDIT' ? ' from ' : ' to ') + tx.paymentReceiver}`
    const kind: 'screen' | 'bank' = item.pkg.startsWith('screen:') ? 'screen' : 'bank'
    tx.seenIn = [kind]
    const existing = mergeIntoExisting(tx as NewTransaction & { timestamp: number }, kind)
    if (existing) { merged++; entry.outcome = 'matched'; continue }
    const r = addTransaction(tx)
    entry.outcome = r.added ? 'added' : 'matched'
    if (r.added) {
      added.push(read<Transaction[]>(KEYS.transactions, [])[0])
      // a friend paying back exactly what they owe in a split: their share is settled and the money filed as Split, not income
      if (tx.paymentType === 'CREDIT' && r.id && autoSettleSplit(r.id)) entry.what += ', settled in SplitMoney'
    }
  }
  write(KEYS.captureLog, log.slice(0, 25))
  reconcileSettlements()
  return { added, merged }
}

/** Settles a split share from an incoming payment when the payer and the exact amount match one friend's debt. */
export function autoSettleSplit(txId: string): boolean {
  const t = read<Transaction[]>(KEYS.transactions, []).find((x) => x.id === txId)
  if (!t || t.paymentType !== 'CREDIT' || isUnnamed(t)) return false
  const projects = read<SplitProject[]>(KEYS.splitProjects, []), people = read<SplitPerson[]>(KEYS.splitPeople, [])
  const hit = splitPaybackFrom(t.paymentReceiver, t.paymentAmount, projects, people, read<SplitTxn[]>(KEYS.splitTransactions, []), read<SplitRow[]>(KEYS.splits, []))
  if (!hit || Math.abs(hit.owed - t.paymentAmount) >= 0.5) return false
  const self = people.find((p) => p.projectId === hit.project.id && p.isCurrentUser)
  if (!self) return false
  settlePart(hit.project.id, hit.person.id, self.id, t.paymentAmount, hit.owed)
  clearNudges(hit.project.id, hit.person.id)
  updateTransaction(t.id, { paymentCategory: SPLIT })
  return true
}

/**
 * The same payment seen from another side (the bank's message, then the receipt screenshot with the payee's name): finds the entry already
 * saved and fills in what it was missing, instead of adding a second one. Returns that entry, or null when this is a new payment.
 */
export function mergeIntoExisting(tx: NewTransaction & { timestamp: number }, kind: 'screen' | 'bank', window = WINDOW): Transaction | null {
  const existing = findSamePayment(read<Transaction[]>(KEYS.transactions, []), tx, window)
  if (!existing) return null
  {
    {
      // Fill in what the other notification knew (app from the UPI app, account from the bank).
      const patch: Partial<Transaction> = {}
      // the bank's message came first and only knows the bank: the app you paid with (Paytm, PhonePe...) replaces a blank or generic label
      if ((!existing.paymentApp || existing.paymentApp === 'Bank app' || existing.paymentApp === 'Other') && tx.paymentApp && tx.paymentApp !== 'Bank app') patch.paymentApp = tx.paymentApp
      // the shop app and the bank both reported it: the sale was paid straight into the bank
      if (isMerchantApp(tx.paymentApp) && tx.paymentType === 'CREDIT') { patch.paymentApp = tx.paymentApp; patch.paymentCategory = BUSINESS }
      if (!existing.paymentMethodId && tx.paymentMethodId) patch.paymentMethodId = tx.paymentMethodId
      if (!existing.ref && tx.ref) patch.ref = tx.ref
      // the other source saw the same payment: the screen and the bank agree
      if (!(existing.seenIn ?? []).includes(kind)) patch.seenIn = [...(existing.seenIn ?? []), kind]
      // the payee's real name (from Paytm, PhonePe...) replaces a nameless bank label, or a name the app only guessed for one
      const nameless = GENERIC_PAYEE.test(existing.paymentReceiver) || (!!existing.rawReceiver && GENERIC_PAYEE.test(existing.rawReceiver))
      if (nameless && tx.paymentReceiver && !GENERIC_PAYEE.test(tx.paymentReceiver)) { patch.paymentReceiver = tx.paymentReceiver; patch.rawReceiver = undefined }
      if (Object.keys(patch).length) updateTransaction(existing.id, patch)
    }
  }
  return existing
}

/**
 * After the update that lets IPO block / unblock notices through (they were being dropped before they were stored), the last 30 days of
 * messages are read once, so a release that already arrived, like "unblock Rs. 15000 ... due to non-allotment", is picked up.
 */
export async function rescanSmsOnce() {
  if (!isNativeApp() || read<boolean>(KEYS.smsRescanHolds, false)) return
  try {
    const s = await Capture.smsStatus()
    if (!s.granted) return
    await Capture.scanSms({ days: 30, holdsOnly: true })   // only the block / unblock notices: payments you deleted are not brought back
    write(KEYS.smsRescanHolds, true)
  } catch { /* try again the next time the app opens */ }
}

/** Pulls whatever the listener captured since last time and records it. */
export async function syncCapturedPayments() {
  if (!isNativeApp() || !read<boolean>(KEYS.autoCapture, true)) return { added: [] as Transaction[], merged: 0 }
  const { items } = await Capture.takeCapturedPayments().catch(() => ({ items: [] as CapturedNotification[] }))
  if (!items.length) return { added: [] as Transaction[], merged: 0 }
  const res = processCaptured(items)
  // money that went out with no name on it: ask who it was to, right away, while you still remember
  for (const t of res.added) {
    if (alertOn('nameIt') && t.paymentType === 'DEBIT' && isUnnamed(t)) void notifyNow(`name-${t.id}`, `${formatPrice(t.paymentAmount)} paid. Who to?`, 'Tap to name it. Your earlier payments help suggest the name.', 'review')
  }
  return res
}
