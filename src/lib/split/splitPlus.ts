// SplitMoney, the parts that make a split easy to collect: splitting a bill item by item (tax and service shared in proportion),
// messages that carry each person's own UPI pay link, reminders that get firmer the longer money waits, settling part of a debt or
// "calling it even", repeating group expenses (rent on the 5th), and settling a friend's share when their UPI payment arrives.
import { read, write, uid, KEYS } from '../core/storage'
import { createTransaction, friendBalances, splitAmountEvenly, splitByWeights, type SplitPerson, type SplitProject, type SplitRow, type SplitTxn } from './split'
import { formatPrice } from '../core/format'
import { normName } from '../payees/peopleMatch'

const r2 = (n: number) => Math.round(n * 100) / 100

/* ---------- item by item ---------- */

export interface SplitItem { name: string; price: number; qty?: number; who: string[] }

/**
 * What each person owes for a bill split item by item. An item is shared equally by the people ticked on it (by everyone when none
 * are). Tax, service charge and discounts (`extras`, negative for a discount) are shared in proportion to what each person had.
 * Amounts are worked out in paise, so they always add up to the bill.
 */
export function computeItemSplits(items: SplitItem[], extras: number, everyone: string[]): { personId: string; amount: number }[] {
  const subtotal = new Map<string, number>(everyone.map((id) => [id, 0]))
  for (const it of items) {
    const who = it.who.length ? it.who : everyone
    splitAmountEvenly(it.price, who.length).forEach((share, i) => subtotal.set(who[i], r2((subtotal.get(who[i]) ?? 0) + share)))
  }
  const ids = [...subtotal.keys()].filter((id) => (subtotal.get(id) ?? 0) > 0)
  if (!ids.length) return []
  const base = ids.map((id) => subtotal.get(id)!)
  const extra = Math.abs(extras) > 0.004 ? splitByWeights(Math.abs(extras), base) : base.map(() => 0)
  return ids.map((personId, i) => ({ personId, amount: r2(base[i] + Math.sign(extras) * extra[i]) }))
}

/** Lines on a bill that are not items: totals, taxes, charges, discounts. */
const TAXLIKE = /\b(c\s?gst|s\s?gst|i\s?gst|gst|vat|tax|cess|service\s*(?:charge|tax)?|packing|packaging|delivery|platform\s*fee|convenience|round(?:ing)?\s*off|tip)\b/i
const DISCOUNT = /\b(discount|disc\.?|offer|coupon|promo|savings?)\b/i
const NOT_ITEM = /\b(sub\s*-?\s*total|grand\s*total|net\s*(?:amount|total|payable)|total|amount\s*(?:due|paid|payable)|to\s*pay|cash|change|card|upi|paid|balance|bill\s*(?:no|number)|invoice|date|time|table|cover|gstin|fssai|phone|ph\.?|tel|thank|visit|order\s*(?:no|id))\b/i
const PRICE_AT_END = /(?:₹|rs\.?|inr)?\s*(-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)\s*$/i

/**
 * The items, taxes and total read off a bill (the lines the phone's text reader returned, top to bottom). An item is a line with words
 * then a price at the end ("Paneer Tikka 2 x 180 360", "आटा 5 किलो ₹245"); tax, charges and discounts are collected apart. Returns
 * what it is sure of: a line it cannot read is left out rather than guessed.
 */
export function billItems(lines: string[]): { items: { name: string; price: number; qty?: number }[]; extras: number; total?: number } {
  const items: { name: string; price: number; qty?: number }[] = []
  let extras = 0
  let total: number | undefined
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    const m = line.match(PRICE_AT_END)
    if (!m || m.index === undefined) continue
    const price = Number(m[1].replace(/,/g, ''))
    const name = line.slice(0, m.index).replace(/[:\-–|.]+\s*$/, '').trim()
    // letters with their vowel signs: Hindi words ("कुल") alternate letters and marks
    if (!(Math.abs(price) > 0) || !/[\p{L}\p{M}]{2}/u.test(name)) continue
    // \b does not see Hindi word edges in JavaScript, so "कुल" (total) and "योग" are matched by spaces
    if ((/\b(?:grand\s*total|net\s*(?:amount|payable)|total\s*(?:amount|payable)?|to\s*pay)\b/i.test(name) || /(?:^|\s)(?:कुल|योग)(?:\s|$)/u.test(name)) && !/sub\s*-?\s*total/i.test(name)) { total = Math.abs(price); continue }
    if (DISCOUNT.test(name)) { extras -= Math.abs(price); continue }
    if (TAXLIKE.test(name)) { extras += price; continue }
    if (NOT_ITEM.test(name)) continue
    // "2 x 180" or "Qty 2" before the price: keep the quantity, the price stays the line total
    const q = name.match(/(\d+)\s*(?:x|×|nos?|pcs?|qty)\b|\bqty\s*(\d+)/i)
    const qty = q ? Number(q[1] ?? q[2]) : undefined
    const clean = name.replace(/\s*\d+\s*(?:x|×)\s*[\d.,]+\s*$/i, '').replace(/\s+\d+(?:\.\d+)?\s*$/, '').trim()
    items.push({ name: clean || name, price, ...(qty && qty > 1 ? { qty } : {}) })
  }
  // a total printed on the bill settles what the extras are when the bill does not list them line by line
  const sum = r2(items.reduce((a, i) => a + i.price, 0) + extras)
  if (total !== undefined && items.length && Math.abs(total - sum) > 0.5 && Math.abs(extras) < 0.005 && total > sum) extras = r2(total - sum)
  return { items, extras: r2(extras), total }
}

/* ---------- messages friends act on without the app ---------- */

export interface ShareLine { name: string; amount: number; upiUrl?: string }

/** One message for the group: what the bill was and each person's share, each with their own UPI link (amount already filled in). */
export function splitShareMessage(opts: { title: string; total: number; payer: string; lines: ShareLine[]; hinglish?: boolean }) {
  const head = opts.hinglish
    ? `*${opts.title}*: total ${formatPrice(opts.total)}, ${opts.payer} ne pay kiya.`
    : `*${opts.title}*: ${formatPrice(opts.total)}, paid by ${opts.payer}.`
  const body = opts.lines.map((l) => `• ${l.name}: ${formatPrice(l.amount)}${l.upiUrl ? `\n  Pay: ${l.upiUrl}` : ''}`).join('\n')
  const foot = opts.hinglish ? 'Link pe tap karo, UPI app mein amount pehle se bhara hoga.' : 'Tap your link: your UPI app opens with the amount filled in.'
  return `${head}\n\n${body}\n\n${foot}`
}

/** JustMoney's pay page (the /pay route of the website). Built in on purpose: it is not a setting, so nobody can point links elsewhere. */
export const PAY_PAGE = 'https://justmoney.aryasharma.in/pay'

/**
 * A person's own pay link: your UPI id, their amount, the bill as the note. WhatsApp does not make upi:// links tappable, so the
 * link is an https one to the pay page; everything after "#" stays on the friend's phone and never reaches the site.
 */
export function payLink(upi: string | undefined, myName: string, amount: number, note: string) {
  if (!upi) return undefined
  return `${PAY_PAGE}#${new URLSearchParams({ pa: upi, pn: myName, am: r2(amount).toFixed(2), tn: note.slice(0, 40) }).toString().replace(/\+/g, '%20')}`
}

/** The name a person goes by in a message: the contact label without a nickname ("Samarth (Neo)" → "Samarth"). */
export const realNameOf = (contact: string) => contact.replace(/\s*[([].*?[)\]]/g, ' ').replace(/\s+/g, ' ').trim() || contact.trim()

/* ---------- reminders that get firmer ---------- */

interface NudgeState { n: number; last: number }
const nudgeKey = (projectId: string, personId: string) => `${projectId}:${personId}`
export const nudgeCount = (projectId: string, personId: string) => read<Record<string, NudgeState>>(KEYS.splitNudges, {})[nudgeKey(projectId, personId)]

/** Records a reminder sent, so the next one is firmer. */
export function recordNudge(projectId: string, personId: string, now = Date.now()) {
  const all = read<Record<string, NudgeState>>(KEYS.splitNudges, {})
  const k = nudgeKey(projectId, personId)
  write(KEYS.splitNudges, { ...all, [k]: { n: (all[k]?.n ?? 0) + 1, last: now } })
}

/** Starting over once they have paid. */
export function clearNudges(projectId: string, personId: string) {
  const all = read<Record<string, NudgeState>>(KEYS.splitNudges, {})
  const k = nudgeKey(projectId, personId)
  if (all[k]) { const { [k]: _, ...rest } = all; write(KEYS.splitNudges, rest) }
}

/**
 * The reminder to send: gentle first, then plain, then firm, then a joke that still gets the point across. `days` is how long the
 * money has waited; English or Hinglish. The pay link goes at the end so it is one tap.
 */
export function nudgeMessage(opts: { name: string; amount: number; title: string; nth: number; days: number; upiUrl?: string; hinglish?: boolean }) {
  const a = formatPrice(opts.amount)
  const first = opts.name.split(' ')[0]
  const en = [
    `Hi ${first}, a gentle reminder that your share of *${opts.title}* is ${a}. Pay whenever you get a moment.`,
    `Hi ${first}, your ${a} for *${opts.title}* is still pending. Please clear it today.`,
    `${first}, this is reminder number ${opts.nth}: ${a} for *${opts.title}*${opts.days > 1 ? `, ${opts.days} days now` : ''}. Please send it today.`,
    `${first}, your ${a} for *${opts.title}* has waited so long it is now asking for rent.`,
  ]
  const hi = [
    `Hi ${first}, bas ek chhota sa reminder: *${opts.title}* mein tumhara share ${a} hai. Jab time mile bhej dena.`,
    `Hi ${first}, *${opts.title}* ke ${a} abhi bhi pending hain. Aaj hi clear kar do please.`,
    `${first}, yeh reminder number ${opts.nth} hai: *${opts.title}* ke ${a}${opts.days > 1 ? `, ${opts.days} din ho gaye` : ''}. Aaj bhej do please.`,
    `${first}, *${opts.title}* ke ${a} itne purane ho gaye hain ki ab inka birthday aane wala hai.`,
  ]
  const text = (opts.hinglish ? hi : en)[Math.min(Math.max(opts.nth, 1), 4) - 1]
  return opts.upiUrl ? `${text}\n\n${opts.hinglish ? 'Pay karo' : 'Pay'}: ${opts.upiUrl}` : text
}

/**
 * Money that has stopped being a split and started being a loan: owed for a month or more, or three or more expenses unpaid.
 * Those friends get a "time to settle" nudge on the SplitMoney screen.
 */
export function overdueFriends(projects: SplitProject[], people: SplitPerson[], txns: SplitTxn[], rows: SplitRow[], now = Date.now()) {
  return friendBalances(projects, people, txns, rows).filter((b) => b.direction === 'owes-you').map((b) => {
    const theirs = txns.filter((t) => t.projectId === b.project.id && t.transactionType === 'DEBIT' && rows.some((r) => r.transactionId === t.id && r.personId === b.person.id))
    const oldest = theirs.reduce((a, t) => Math.min(a, t.date), now)
    return { ...b, days: Math.floor((now - oldest) / 86400000), count: theirs.length }
  }).filter((x) => x.days >= 30 || x.count >= 3)
}

/* ---------- part payments and "call it even" ---------- */

/** "Call it even": what they owe rounded to a friendly amount (₹498 → ₹500, ₹1,240 → ₹1,250, ₹12.40 → ₹12). */
export function roundedEven(amount: number) {
  const step = amount >= 1000 ? 50 : amount >= 100 ? 10 : 1
  return Math.max(step, Math.round(amount / step) * step)
}

/**
 * Records money paid on a debt: a part payment leaves the rest owed; `callEven` closes the whole debt when they paid a rounded amount
 * (the difference is written off as "Rounded off", so the group's totals still add up).
 */
export function settlePart(projectId: string, debtorId: string, creditorId: string, paid: number, owed: number, callEven = false) {
  const p = r2(Math.max(0, paid))
  if (p > 0) createTransaction(p, 'Settlement', Date.now(), projectId, debtorId, [{ personId: creditorId, amount: p }], 'SETTLEMENT')
  const rest = r2(owed - p)
  if (callEven && Math.abs(rest) >= 0.01) {
    // they owe less (or more) than they paid: the gap is closed by a settlement the other way round when they overpaid
    if (rest > 0) createTransaction(rest, 'Rounded off', Date.now(), projectId, debtorId, [{ personId: creditorId, amount: rest }], 'SETTLEMENT')
    else createTransaction(-rest, 'Rounded off', Date.now(), projectId, creditorId, [{ personId: debtorId, amount: -rest }], 'SETTLEMENT')
  }
  return callEven ? 0 : Math.max(0, rest)
}

/* ---------- repeating group expenses ---------- */

export interface SplitRepeat {
  id: string; projectId: string; description: string; amount: number; payerId: string
  splits: { personId: string; amount: number }[]
  /** Day of the month it is added on (rent on the 5th); a shorter month uses its last day. */
  day: number; nextAt: number; createdAt: number
}

const onDay = (y: number, m: number, day: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 10).getTime()

/** The next time a monthly repeat on `day` is due, after `from`. */
export function nextRepeat(day: number, from = Date.now()) {
  const d = new Date(from)
  const thisMonth = onDay(d.getFullYear(), d.getMonth(), day)
  return thisMonth > from ? thisMonth : onDay(d.getFullYear(), d.getMonth() + 1, day)
}

export const getRepeats = () => read<SplitRepeat[]>(KEYS.splitRepeats, [])

export function addRepeat(r: Omit<SplitRepeat, 'id' | 'nextAt' | 'createdAt'>, from = Date.now()) {
  const rep: SplitRepeat = { ...r, id: uid(), nextAt: nextRepeat(r.day, from), createdAt: Date.now() }
  write(KEYS.splitRepeats, [...getRepeats(), rep])
  return rep
}

export const removeRepeat = (id: string) => write(KEYS.splitRepeats, getRepeats().filter((r) => r.id !== id))

/** Adds every repeating expense that came due (each month it was missed, at most 12) and moves it to its next date. */
export function processSplitRepeats(now = Date.now()) {
  const list = getRepeats()
  const groups = new Set(read<SplitProject[]>(KEYS.splitProjects, []).map((p) => p.id))
  let added = 0
  const next = list.filter((r) => groups.has(r.projectId)).map((r) => {
    let at = r.nextAt
    for (let i = 0; at <= now && i < 12; i++) {
      createTransaction(r.amount, r.description, at, r.projectId, r.payerId, r.splits, 'DEBIT', { splitMode: 'EXACT', splitValues: Object.fromEntries(r.splits.map((s) => [s.personId, s.amount])) })
      added++
      const d = new Date(at)
      at = onDay(d.getFullYear(), d.getMonth() + 1, r.day)
    }
    return { ...r, nextAt: at }
  })
  if (added || next.length !== list.length) write(KEYS.splitRepeats, next)
  return added
}

/* ---------- their UPI payment settles their share ---------- */

/**
 * Money that came in from a friend who owes you in a split: that friend (matched by the name the bank or UPI app wrote), the group
 * and how much they owe. Null when no one matches, or when two friends of the same name both owe you (then you choose).
 */
export function splitPaybackFrom(payer: string, amount: number, projects: SplitProject[], people: SplitPerson[], txns: SplitTxn[], rows: SplitRow[]) {
  const n = normName(payer)
  if (n.length < 3) return null
  const first = (s: string) => normName(s.split(' ')[0])
  const owing = friendBalances(projects, people, txns, rows).filter((b) => b.direction === 'owes-you')
  // the full name first ("Rohan Mehta"), then a first name that only one friend has
  const exact = owing.filter((b) => normName(b.person.name) === n)
  const byFirst = exact.length ? exact : owing.filter((b) => first(b.person.name).length >= 3 && first(b.person.name) === first(payer))
  if (new Set(byFirst.map((b) => normName(b.person.name))).size !== 1) return null
  // the debt this payment fits best: the one it clears exactly, else the largest it does not exceed, else the largest
  const pick = byFirst.find((b) => Math.abs(b.amount - amount) < 0.5) ?? byFirst.filter((b) => b.amount >= amount).sort((a, b) => b.amount - a.amount)[0] ?? byFirst.sort((a, b) => b.amount - a.amount)[0]
  return pick ? { person: pick.person, project: pick.project, owed: pick.amount } : null
}
