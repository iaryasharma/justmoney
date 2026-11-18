// Bank statement reader (on-device). Works out money in vs out from, in order:
//  1. column positions — amounts under "Deposit/Credit" vs "Withdrawal/Debit" headings
//  2. the running balance — balance up = money received, down = money paid
//  3. "Cr"/"Dr" markers and words like salary/refund (last resort)
import { guessCategory } from './ai'
import { bankFromIfsc, detectBank, detectUpiApp, getAccounts, last4From, mostMentionedBank } from '../accounts/accounts'
import { isBlockEvent } from '../core/data'
import type { NewTransaction } from '../core/types'

export interface PdfItem { x: number; w: number; s: string }
export interface PdfLine { items: PdfItem[] }

interface Row {
  ts: number
  /** The statement gave a time of day (otherwise only the date is known). */
  hasTime: boolean
  desc: string
  amount: number
  balance: number | null
  type: 'DEBIT' | 'CREDIT' | null
  /** How the type was decided — anything but 'guess' is reliable. */
  how: 'column' | 'balance' | 'marker' | 'guess'
  /** An IPO / mandate block or unblock: left out of the import. */
  held?: boolean
  /** Text under the statement's account / bank column(s), e.g. "UCO Bank - 69". */
  acct: string[]
  /** The row's text without the account and notes columns: where the payee's name is. */
  narr: string
}

const MON = 'janfebmaraprmayjunjulaugsepoctnovdec'
// "01/10/2026", "01-Oct-26", "27 SEP'26", "5 October 2026"
const DATE = /\b(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3}[a-z]*)[/\-. ,']*(\d{2,4})\b(?!:)/
const DATE_G = new RegExp(DATE.source, 'g')
const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i
const STATUS_BAD = /^(failed|failure|declined|pending|expired|cancell?ed)$/i
// statement columns that aren't the payee: which account was used, and notes / tags
const ACCOUNT_COL = /^(your account|account|account (number|no\.?)|bank|bank (name|account))$/i
const NOTES_COL = /^(notes?( & tags)?|remarks?|tags?)$/i
// "Money sent to X", "Received from X", "Automatic payment of ₹399 setup for X"
const PAYEE_PHRASE = /\b(?:money sent to|sent to|paid to|received from|money received from|payment (?:to|from)|setup for|transferred to)\s+(.+?)(?=\s+(?:tag:|note:|upi\b|#|ref\b)|\s*$)/i
// UPI id with the holder's name: "zepto@payuaxis(ZEPTO)"
const VPA_NAME = /([\w.*-]+@[\w.-]+)\(([^)]*)\)/g
// Amounts: "1,234.50", "450.00", or a currency-marked whole number ("₹500", "Rs. 500").
// UPI-app statements sign them: "- ₹450" paid, "+ Rs.1,000" received.
// Groups: 1 sign, 2 currency, 3 sign, 4 grouped/decimal number, 5 whole number after a currency, 6 Cr/Dr.
const AMT_IN_TEXT = /(?<![\d/:A-Za-z])(?:([+-])\s?)?(₹|rs\.?|inr)?\s?(?:([+-])\s?)?(?:(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2})|(?<=(?:₹|rs\.?|inr)\s?)(\d+))(?![\d,])(?:\s*(Cr|Dr|CR|DR|cr|dr)\b)?/gi
const AMT_ITEM = /^(?:([+-])\s?)?(₹|rs\.?|inr)?\s?(?:([+-])\s?)?(?:(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{2})|(?<=(?:₹|rs\.?|inr)\s?)(\d+))\s*(cr|dr)?\.?$/i
/** Value, Cr/Dr marker and +/- sign of an amount match (AMT_IN_TEXT or AMT_ITEM groups). */
const amountOf = (m: RegExpMatchArray) => ({
  value: money(m[4] ?? m[5]),
  marker: (m[6] ?? '').toLowerCase(),
  sign: m[1] ?? m[3] ?? '',
})
// "Paid to" / "Received from" and DEBIT/CREDIT type columns in UPI-app statements
const OUT_WORDS = /\b(paid to|sent to|money sent|transferred to|paid for|debit(?!\s*card)|debited)\b/i
const IN_WORDS = /\b(received from|money received|credit(?!\s*card)|credited|refund(?:ed)?|cashback)\b/i
const OPENING = /\b(opening balance|balance b\/?f|brought forward|balance forward)\b/i
const CREDIT_WORDS = /\b(salary|refund|cashback|interest (paid|credit)|int\.? ?pd|neft cr|imps cr|upi cr|by transfer|received|credited|deposit)\b/i
const NOISE = /^(upi|neft|imps|rtgs|pos|ach|nach|ecs|atm|mmt|inb|ib|txn|ref|dr|cr|p2a|p2m|by|to|transfer)$/i

function money(s: string) { return Number(s.replace(/,/g, '')) }

const TIME = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i

// "Oct 01, 2026" (PhonePe) and "26 Oct" with the year only in the header (Paytm)
const DATE_MDY = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/
const DATE_DM = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\b(?![\s,'’-]*\d{2,4}\b(?!:))/
const monthIndex = (s: string) => (/^\d+$/.test(s) ? Number(s) - 1 : MON.indexOf(s.slice(0, 3).toLowerCase()) / 3)

/** Date (and time when the row has one) of a statement row. Date-only rows get noon. */
function parseDateTime(text: string, year = new Date().getFullYear()): { ts: number; hasTime: boolean } | null {
  let day: number, m: number, y: number, at: number, len: number
  // the first date-shaped match that is a real date ("00 5 Payments" isn't)
  const dmy = [...text.matchAll(DATE_G)].find((d) => { const mi = monthIndex(d[2]); return Number.isInteger(mi) && mi >= 0 && mi <= 11 }) ?? null
  const mdy = dmy ? null : text.match(DATE_MDY)
  const dm = dmy || mdy ? null : text.match(DATE_DM)
  if (dmy) { day = Number(dmy[1]); m = monthIndex(dmy[2]); y = Number(dmy[3]); at = dmy.index ?? 0; len = dmy[0].length }
  else if (mdy) { day = Number(mdy[2]); m = monthIndex(mdy[1]); y = Number(mdy[3]); at = mdy.index ?? 0; len = mdy[0].length }
  else if (dm) { day = Number(dm[1]); m = monthIndex(dm[2]); y = year; at = 0; len = dm[0].length }
  else return null
  if (y < 100) y += 2000
  if (!Number.isInteger(m) || m < 0 || m > 11 || day < 1 || day > 31) return null
  // a time right after the date, e.g. "01/10/2026 14:05:33" or "01 Oct 2026, 10:22 AM"
  const after = text.slice(at + len, at + len + 16)
  const t = after.match(TIME)
  let h = 12, mi = 0, s = 0
  if (t) {
    h = Number(t[1]); mi = Number(t[2]); s = Number(t[3] ?? 0)
    if (t[4]) { const pm = /p/i.test(t[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
    if (h > 23 || mi > 59) { h = 12; mi = 0; s = 0 }
  }
  const ts = new Date(y, m, day, h, mi, s).getTime()
  return Number.isNaN(ts) ? null : { ts, hasTime: !!t && h <= 23 }
}

const centre = (i: PdfItem) => i.x + i.w / 2

/** Finds the Debit / Credit / Balance column centres from the table heading, if there is one. */
function findColumns(lines: PdfLine[]) {
  for (const l of lines) {
    const find = (re: RegExp) => l.items.find((i) => re.test(i.s.trim()))
    const debit = find(/^(withdrawals?( amt\.?| amount)?|debits?( amount)?|dr\.?( amount)?|paid out|money out)(\s*\(.*\))?$/i)
    const credit = find(/^(deposits?( amt\.?| amount)?|credits?( amount)?|cr\.?( amount)?|paid in|money in)(\s*\(.*\))?$/i)
    if (debit && credit) {
      const balance = find(/^(closing\s+)?balance(\s*\(.*\))?$/i)
      return { debit: centre(debit), credit: centre(credit), balance: balance ? centre(balance) : null }
    }
  }
  return null
}

function cleanDesc(s: string) {
  const d = s.replace(DATE, ' ').replace(TIME, ' ').replace(AMT_IN_TEXT, ' ').replace(/\b(Cr|Dr|CR|DR|success(?:ful)?|completed)\b/gi, ' ').replace(/\s+/g, ' ').trim()
  const parts = d.split(/[/|]|\s-\s|-/).map((p) => p.replace(/^[\d\s.:,-]+/, '').trim()) // drop ref numbers in front of names
    .filter((p) => /[A-Za-z]{3}/.test(p) && !NOISE.test(p))
  const name = (parts[0] ?? d).replace(/\s+/g, ' ').slice(0, 40).trim()
  if (!name) return 'Statement entry'
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name
}

export interface StatementRow { tx: NewTransaction; sure: boolean; /** The row's full text (to spot the account in UPI-app statements). */ raw: string }

/** What the statement says about itself: which account, and the balance at its end. */
export interface StatementInfo {
  accountId: string | null
  bank: string | null
  last4: string | null
  closing: { balance: number; ts: number } | null
  /** A UPI app's statement (Paytm, PhonePe...) rather than a bank's, when it says so. */
  app: string | null
  /** IPO / mandate block and unblock rows left out of the transactions (they are saved as holds). */
  held: number
  holds: { ts: number; amount: number; type: 'DEBIT' | 'CREDIT' | null; text: string }[]
}
let lastInfo: StatementInfo = { accountId: null, bank: null, last4: null, closing: null, app: null, held: 0, holds: [] }

/** Rows plus the statement's bank / account / closing balance. */
export function analyseStatement(lines: PdfLine[], fileName?: string): { rows: StatementRow[]; info: StatementInfo } {
  const rows = readStatement(lines, fileName)
  return { rows, info: lastInfo }
}

/** Reads statement lines (with x positions when available) into transactions. */
export function parseStatementLines(lines: PdfLine[]): NewTransaction[] {
  return readStatement(lines).map((r) => r.tx)
}

/** Centres of the heading cells matching `re` (account / notes columns), from the first heading row that has them. */
function columnCentres(lines: PdfLine[], re: RegExp) {
  for (const l of lines) {
    const hits = l.items.filter((i) => re.test(i.s.trim()))
    if (hits.length) return hits.map(centre)
  }
  return []
}

/** A "27 SEP'26 - 26 OCT'26" / "01/10/2026 to 27/10/2026" period line, not a transaction. */
function isPeriod(text: string) {
  const d = text.match(DATE)
  if (!d) return false
  const rest = text.slice((d.index ?? 0) + d[0].length)
  return /^\s*(?:-|–|to)\s*/i.test(rest) && DATE.test(rest)
}

/** The payee: "Money sent to X" style phrases, else the other side's UPI name, else the cleaned text. */
function payeeOf(narr: string, ownVpa: string | null): { name: string; vpa?: string } {
  const phrase = narr.replace(AMT_IN_TEXT, ' ').replace(DATE_G, ' ').replace(TIME, ' ').replace(/\s+/g, ' ').match(PAYEE_PHRASE)?.[1]?.replace(/[\s-]+$/, '').trim()
  if (phrase && /[A-Za-z]{2}/.test(phrase)) return { name: titleCase(phrase.slice(0, 40)) }
  const others = [...narr.matchAll(VPA_NAME)].filter((m) => m[1].toLowerCase() !== ownVpa)
  if (others.length) {
    const [, vpa, holder] = others[0]
    // masked names ("xxxxxxxxITED") say nothing; keep the UPI id for reference
    return /^[x*]{3,}/i.test(holder.trim()) || !/[A-Za-z]{2}/.test(holder) ? { name: 'UPI payment', vpa } : { name: titleCase(holder.trim().slice(0, 40)), vpa }
  }
  return { name: cleanDesc(narr) }
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s)

/** Same as parseStatementLines, also saying whether each row's direction is certain (columns / balance / markers). */
export function readStatement(lines: PdfLine[], fileName?: string): StatementRow[] {
  const cols = findColumns(lines)
  const acctCols = columnCentres(lines, ACCOUNT_COL)
  const notesCols = columnCentres(lines, NOTES_COL)
  const near = (i: PdfItem, cs: number[]) => cs.some((c) => Math.abs(centre(i) - c) < 50)
  const narrOf = (items: PdfItem[]) => items.filter((i) => !near(i, acctCols) && !near(i, notesCols)).map((i) => i.s).join(' ')
  const acctOf = (items: PdfItem[]) => items.filter((i) => near(i, acctCols) && !ACCOUNT_COL.test(i.s.trim())).map((i) => i.s)
  const rows: Row[] = []
  const header: string[] = [] // lines above the first transaction
  const meta: string[] = [] // every line that isn't a transaction or its narration
  let opening: number | null = null
  // the statement period's year, for UPI-app rows dated just "26 Oct"
  const firstLines = lines.slice(0, 12).map((l) => l.items.map((i) => i.s).join(' ')).join(' ')
  const yearHit = firstLines.match(/\b(20\d{2})\b/) ?? firstLines.match(/[A-Za-z]{3}\s?['’](\d{2})\b/)
  const year = yearHit ? (yearHit[1].length === 2 ? 2000 + Number(yearHit[1]) : Number(yearHit[1])) : new Date().getFullYear()

  for (const l of lines) {
    const lineText = l.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()
    if (!lineText) continue
    if (OPENING.test(lineText)) {
      const a = [...lineText.matchAll(AMT_IN_TEXT)]
      if (a.length) { const o = amountOf(a[a.length - 1]); opening = o.value * (o.marker === 'dr' || o.sign === '-' ? -1 : 1) }
      continue
    }
    const when = isPeriod(lineText) ? null : parseDateTime(lineText.slice(0, 120), year)
    const last = rows[rows.length - 1]
    if (when == null) {
      if (!last) { header.push(lineText); meta.push(lineText); continue }
      // the rest of the last entry: its narration, account, or its time on a line of its own
      const t = lineText.match(TIME_ONLY)
      if (t && !last.hasTime) {
        let h = Number(t[1])
        if (t[4]) { const pm = /p/i.test(t[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
        const d = new Date(last.ts); d.setHours(h, Number(t[2]), Number(t[3] ?? 0), 0)
        if (h <= 23 && Number(t[2]) <= 59) { last.ts = d.getTime(); last.hasTime = true }
      } else if (/[A-Za-z]/.test(lineText) && last.desc.length < 400) {
        last.desc += ` ${lineText}`
        last.narr += ` ${narrOf(l.items)}`
        last.acct.push(...acctOf(l.items))
      } else meta.push(lineText)
      continue
    }
    if (l.items.some((i) => STATUS_BAD.test(i.s.trim()))) continue // failed / pending payment: no money moved

    // amounts with positions (separate PDF items) or, failing that, from the text
    const posAmounts = l.items.filter((i) => AMT_ITEM.test(i.s.trim())).map((i) => ({ ...amountOf(i.s.trim().match(AMT_ITEM)!), cx: centre(i), hasPos: true }))
    const amounts = posAmounts.length ? posAmounts : [...lineText.matchAll(AMT_IN_TEXT)].map((m) => ({ ...amountOf(m), cx: 0, hasPos: false }))
    if (!amounts.length) continue
    // a DR / CR column of its own (BHIM)
    const drcr = l.items.find((i) => /^(dr|cr)\.?$/i.test(i.s.trim()))?.s.trim().slice(0, 2).toLowerCase()
    if (drcr && !amounts[0].marker) amounts[0] = { ...amounts[0], marker: drcr }
    const desc = lineText
    const extra = { acct: acctOf(l.items), narr: narrOf(l.items) }
    const { ts, hasTime } = when

    // 1. columns
    if (cols && amounts.every((a) => a.hasPos)) {
      let debit = 0, credit = 0, balance: number | null = null
      for (const a of amounts) {
        const dists = [['debit', Math.abs(a.cx - cols.debit)], ['credit', Math.abs(a.cx - cols.credit)], ['balance', cols.balance != null ? Math.abs(a.cx - cols.balance) : Infinity]] as const
        const col = [...dists].sort((x, y) => x[1] - y[1])[0][0]
        if (col === 'debit') debit = a.value
        else if (col === 'credit') credit = a.value
        else balance = a.value
      }
      if (credit > 0 || debit > 0) {
        rows.push({ ts, hasTime, desc, amount: credit > 0 ? credit : debit, balance, type: credit > 0 ? 'CREDIT' : 'DEBIT', how: 'column', ...extra })
        continue
      }
    }

    // 2./3. no usable columns: first amount is the transaction, a later one the running balance
    const first = amounts[0]
    const balance = amounts.length >= 2 ? amounts[amounts.length - 1].value * (amounts[amounts.length - 1].marker === 'dr' ? -1 : 1) : null
    const marker = first.marker === 'cr' || first.sign === '+' ? 'CREDIT' : first.marker === 'dr' || first.sign === '-' ? 'DEBIT' : null
    rows.push({ ts, hasTime, desc, amount: first.value, balance, type: marker, how: marker ? 'marker' : 'guess', ...extra })
  }

  // 2. running balance (statements may list newest first — walk them oldest first)
  const chrono = rows.length > 1 && rows[0].ts > rows[rows.length - 1].ts ? [...rows].reverse() : rows
  let prev = opening
  for (const r of chrono) {
    if (r.balance != null && prev != null && r.how !== 'column') {
      const delta = Math.round((r.balance - prev) * 100) / 100
      if (delta !== 0) {
        r.type = delta > 0 ? 'CREDIT' : 'DEBIT'
        r.how = 'balance'
        // if the "first amount" wasn't the transaction (e.g. a cheque no.), the change in balance is
        if (Math.abs(Math.abs(delta) - r.amount) > 0.5) r.amount = Math.abs(delta)
      }
    }
    if (r.balance != null) prev = r.balance
  }
  // IPO / mandate blocks and unblocks: money held, not spent. Judged on the whole entry,
  // since UPI apps put "Money blocked for … IPO" on the line under the amount.
  for (const r of rows) r.held = isBlockEvent(r.narr) || isBlockEvent(r.desc)

  // the statement owner's own UPI id: the one on nearly every row
  const vpaCount = new Map<string, number>()
  for (const r of rows) for (const m of r.desc.matchAll(VPA_NAME)) vpaCount.set(m[1].toLowerCase(), (vpaCount.get(m[1].toLowerCase()) ?? 0) + 1)
  const ownVpa = [...vpaCount.entries()].sort((a, b) => b[1] - a[1]).find(([, n]) => n >= Math.max(2, rows.length * 0.6))?.[0] ?? null

  const { bank, last4, accountId: account } = statementIdentity(header.join('\n'), meta.join('\n'), fileName)
  const last = [...chrono].reverse().find((r) => r.balance != null)
  const appHint = `${fileName ?? ''} ${header.join(' ')}`.replace(/[_.-]+/g, ' ')
  lastInfo = {
    accountId: account, bank, last4, held: rows.filter((r) => r.held).length,
    holds: rows.filter((r) => r.held).map((r) => ({ ts: r.ts, amount: r.amount, type: r.type, text: `${r.narr} ${r.desc}` })),
    app: detectUpiApp(appHint) ?? (/\bpay\s*\/\s*collect\b/i.test(header.join(' ')) ? 'BHIM' : /^sm[_ -]receipt/i.test(fileName ?? '') ? 'super.money' : null),
    closing: last && last.balance != null ? { balance: last.balance, ts: last.ts } : null,
  }
  return rows.filter((r) => !r.held).map((r) => {
    const words = OUT_WORDS.test(r.narr) ? 'DEBIT' : IN_WORDS.test(r.narr) ? 'CREDIT' : null
    const type = r.type ?? words ?? (CREDIT_WORDS.test(r.desc) ? 'CREDIT' : 'DEBIT')
    const { name, vpa } = payeeOf(r.narr, ownVpa)
    const tx: NewTransaction = {
      paymentAmount: r.amount, paymentType: type, paymentReceiver: name,
      paymentCategory: type === 'CREDIT' ? 'Others' : guessCategory(`${name} ${r.desc}`), // income source is picked when saved
      timestamp: r.ts,
      ...(r.hasTime ? {} : { timeUnknown: true }),
      ...(account ? { paymentMethodId: account } : {}),
      ...(vpa ? { note: vpa } : {}),
    }
    return { tx, sure: r.how !== 'guess', raw: r.acct.length ? r.acct.join(' ') : r.desc }
  })
}

/**
 * Whose statement is this? Only the header and footer count. Narrations name the other
 * side's bank ("UPI/.../HDFC"), which is how a Kotak statement could pass for HDFC.
 */
export function statementIdentity(header: string, meta: string, fileName?: string) {
  const bank = bankFromIfsc(header) ?? bankFromIfsc(meta) ?? (fileName ? detectBank(fileName.replace(/[_.-]+/g, ' ')) : null)
    ?? mostMentionedBank(header) ?? mostMentionedBank(meta)
  const last4 = last4From(header) ?? last4From(meta)
  const accounts = getAccounts().filter((m) => m.type !== 'CREDIT_CARD')
  const sameLast4 = (m: { last4?: string | null }) => !!(m.last4 && last4 && (m.last4.endsWith(last4) || last4.endsWith(m.last4)))
  const ofBank = bank ? accounts.filter((m) => (m.bank ?? detectBank(m.name)) === bank) : accounts
  const accountId = (ofBank.find(sameLast4) ?? (bank && ofBank.length === 1 ? ofBank[0] : undefined))?.id ?? null
  return { bank, last4, accountId }
}

/** Plain-text version (no positions): relies on the running balance and markers. */
export function parseStatementText(text: string): NewTransaction[] {
  return parseStatementLines(text.split(/\n/).map((s) => ({ items: [{ x: 0, w: 0, s }] })))
}

/**
 * Gemini reads narrations well but can confuse money in and out; the bank's own
 * balance maths can't. Where the on-device reading was sure (columns or balance),
 * its direction wins for the matching row.
 */
export function reconcileDirections(ai: NewTransaction[], local: StatementRow[]): NewTransaction[] {
  const day = (ts?: number) => (ts ? new Date(ts).toDateString() : '')
  const pool = local.filter((r) => r.sure).map((r) => r.tx)
  const all = local.map((r) => r.tx)
  // Gemini puts date-only rows at noon; the on-device reading knows whether the row had a time
  const noon = (ts?: number) => !!ts && new Date(ts).getHours() === 12 && new Date(ts).getMinutes() === 0
  return ai.map((t) => {
    const i = pool.findIndex((l) => Math.abs(l.paymentAmount - t.paymentAmount) < 0.01 && day(l.timestamp) === day(t.timestamp))
    if (i < 0) {
      const same = all.find((l) => Math.abs(l.paymentAmount - t.paymentAmount) < 0.01 && day(l.timestamp) === day(t.timestamp))
      const timing = same ? { timestamp: same.timestamp, timeUnknown: same.timeUnknown } : noon(t.timestamp) ? { timeUnknown: true } : {}
      return { ...t, ...timing, paymentMethodId: t.paymentMethodId ?? same?.paymentMethodId }
    }
    const [l] = pool.splice(i, 1)
    return { ...t, paymentType: l.paymentType, timestamp: l.timestamp, timeUnknown: l.timeUnknown, paymentMethodId: t.paymentMethodId ?? l.paymentMethodId }
  })
}
