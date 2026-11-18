// Turns on-device OCR of a payment screenshot or receipt into a transaction.
// Works on GPay / PhonePe / Paytm / BHIM / bank-app success screens, "received
// money" screens, food-delivery and shopping order summaries, and printed bills.
import { guessCategory } from './ai'
import { buildVendorCategoryMap, isBlockEvent } from '../core/data'
import { guessIncomeCategory } from '../core/money'
import { detectAccount, detectUpiApp } from '../accounts/accounts'
import { refOf } from './sms'
import type { NewTransaction, PaymentSource } from '../core/types'

export interface OcrLine { text: string; top: number; left: number; height: number }
export interface OcrResult { text: string; lines: OcrLine[] }

export interface ScreenshotParse {
  tx: NewTransaction | null
  /** high: amount, payee and a success/total marker were all found; low: a guess worth reviewing. */
  confidence: 'high' | 'low' | 'none'
  /** The screenshot shows a failed / pending payment, which shouldn't be recorded. */
  failed?: boolean
  kind: 'payment' | 'receipt' | 'unknown'
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const CUR = String.raw`(?:₹|rs\.?|inr)`
const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`

const SUCCESS = /\b(paid|completed|successful(?:ly)?|success|sent|debited|payment done|transaction successful|money sent|received|credited)\b/i
const FAILED = /\b(failed|declined|unsuccessful|payment pending|is pending|transaction pending|cancelled|reversed)\b/i
const CREDIT = /\b(received from|money received|you received|received ₹|credited to your|refund(?:ed)? to|cashback received)\b/i
const RECEIPT_KEYS: RegExp[] = [
  /\bgrand\s*total\b/i, /\bto\s*pay\b/i, /\bbill\s*total\b/i, /\btotal\s*(?:amount|payable|paid)\b/i, /\bamount\s*paid\b/i,
  /\border\s*total\b/i, /\bnet\s*(?:amount|payable|total)\b/i, /\bpaid\s*via\b/i, /\btotal\b/i,
]
const NOISE = /^(completed|successful|success|paid|done|share|split|view details|transaction (?:id|details)|upi transaction id|google transaction id|utr|ref(?:erence)?(?: no\.?)?|banking name|from|to|paid to|sent to|received from|debited from|credited to|powered by.*|.*\bupi\b.*id.*)$/i

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
const money = (s: string) => Number(s.replace(/,/g, ''))

/** Amounts on a line; `marked` ones carry a currency sign. Skips ids, phone numbers, years and times. */
function amountsIn(line: string) {
  const out: { value: number; marked: boolean }[] = []
  const re = new RegExp(String.raw`(${CUR})?\s*${NUM}`, 'gi')
  for (const m of line.matchAll(re)) {
    const raw = m[2]
    const after = line.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3)
    const before = line.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0)
    if (/^\s?:\d/.test(after) || /^:\d/.test(after) || /:$/.test(before)) continue // time like 10:22
    if (!m[1] && /^\d{9,}$/.test(raw)) continue // transaction ids, phone numbers
    if (!m[1] && /^(19|20)\d{2}$/.test(raw)) continue // years
    const value = money(raw)
    if (!(value > 0) || value > 1e8) continue
    out.push({ value, marked: !!m[1] })
  }
  return out
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, crore: 10000000, crores: 10000000 }

/** "Three Hundred Twenty Nine" → 329 (Indian scales: lakh, crore). NaN when a word is not a number word. */
export function wordsToNumber(s: string) {
  let total = 0, part = 0
  for (const w of s.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((x) => x && x !== 'and')) {
    if (w in UNITS) part += UNITS[w]
    else if (w === 'hundred') part = (part || 1) * 100
    else if (w in SCALES) { total += (part || 1) * SCALES[w]; part = 0 }
    else return NaN
  }
  return total + part
}

/**
 * The amount written out ("Rupees Three Hundred Twenty Nine Only", Paytm). The phone's text reader has no "₹", and in Paytm's font
 * reads it as a 7 ("₹329" → "7329"), so the words, which it reads cleanly, are the amount whenever they are there.
 */
export function amountInWords(text: string) {
  const m = text.replace(/\s+/g, ' ').match(/\b(?:rupees|rs\.?|inr)\s+([a-z -]+?)(?:\s+and\s+([a-z -]+?)\s+paise)?\s+only\b/i)
  if (!m) return 0
  const rupees = wordsToNumber(m[1]), paise = m[2] ? wordsToNumber(m[2]) : 0
  return rupees > 0 && paise >= 0 && paise < 100 ? rupees + paise / 100 : 0
}

function cleanName(s: string) {
  let n = s.replace(/\(.*?\)/g, ' ').replace(/[|•·]/g, ' ').replace(/\s+/g, ' ').trim()
  if (n.includes('@')) n = n.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim() // UPI id → name part
  n = n.replace(/^(mr|ms|mrs|m\/s)\.?\s+/i, '').replace(/[:\-–]+$/, '').trim()
  if (!/[a-z]{2}/i.test(n) || NOISE.test(n) || amountsIn(n).some((a) => a.marked)) return ''
  if (n.length > 40) n = n.slice(0, 40).trim()
  return n === n.toUpperCase() || n === n.toLowerCase() ? titleCase(n) : n
}

function payeeOf(lines: string[], credit: boolean): string {
  const lead = credit
    ? /^(?:received from|money received from|from)\b\s*:?\s*(.*)$/i
    : /^(?:paid (?:successfully )?to|sent to|payment to|paying|transferred to|to)\b\s*:?\s*(.*)$/i
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(lead)
    if (!m) continue
    const same = cleanName(m[1] ?? '')
    if (same) {
      // a long name wraps onto the next line ("To: Samarth Kailash" / "Magar") when what follows is the UPI id or account line
      const cont = (lines[i + 1] ?? '').trim()
      if (/^[A-Za-z][A-Za-z.'-]{1,20}(?: [A-Za-z][A-Za-z.'-]{1,20})?$/.test(cont) && !/^(?:upi|from|to|message|ref|date|bank|paid|sent|completed|successful|powered|transaction|debited|credited)\b/i.test(cont)
        && /^(?:upi id|vpa|a\/c|account|[*•x]{2,}\S*@)/i.test((lines[i + 2] ?? '').trim())) return `${same} ${cleanName(cont) || cont}`.trim()
      return same
    }
    for (const next of lines.slice(i + 1, i + 3)) {
      const n = cleanName(next)
      if (n) return n
    }
  }
  return ''
}

const KNOWN = /\b(swiggy|zomato|uber|ola|rapido|blinkit|zepto|bigbasket|instamart|dmart|amazon|flipkart|myntra|ajio|meesho|netflix|spotify|hotstar|starbucks|domino'?s|kfc|mcdonald'?s|irctc|indigo|airtel|jio|apollo|pharmeasy|nykaa|bookmyshow|makemytrip|dunzo|reliance|tata ?cliq|croma|bigbazaar)\b/i

function merchantForReceipt(lines: string[], text: string) {
  const known = text.match(KNOWN)?.[0]
  if (known) return titleCase(known)
  for (const l of lines.slice(0, 5)) {
    if (/\b(order|invoice|bill|receipt|tax|gst|date|time|table|summary|details)\b/i.test(l)) continue
    const n = cleanName(l)
    if (n && n.length >= 3) return n
  }
  return ''
}

/** When the payment happened; `hasTime` is false when the screenshot shows only the date. */
function parseDate(text: string): { ts: number; hasTime: boolean } | undefined {
  const t = text.replace(/\s+/g, ' ')
  const mon = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase())
  const withTime = (y: number, m: number, d: number, hh?: string, mm?: string, ap?: string) => {
    let h = hh ? Number(hh) : 12
    if (ap) { const pm = /p/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
    const dt = new Date(y, m, d, h, mm ? Number(mm) : 0)
    return Number.isNaN(dt.getTime()) ? undefined : { ts: dt.getTime(), hasTime: !!hh }
  }
  const now = new Date()
  const guessYear = (m: number, d: number) => (new Date(now.getFullYear(), m, d) > now ? now.getFullYear() - 1 : now.getFullYear())
  let m: RegExpMatchArray | null
  // "10:22 am on 27 Oct 2026" (PhonePe)
  if ((m = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?\s*(?:on|,)?\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?/i)) && mon(m[5]) >= 0) {
    const mo = mon(m[5])
    return withTime(m[6] ? Number(m[6]) : guessYear(mo, Number(m[4])), mo, Number(m[4]), m[1], m[2], m[3])
  }
  // "27 Oct 2026, 10:22 am" / "27 October 2026 at 10:22 PM" / "27 Oct, 10:22 AM"
  if ((m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?(?:,?\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*(am|pm)?)?/i)) && mon(m[2]) >= 0) {
    const mo = mon(m[2])
    return withTime(m[3] ? Number(m[3]) : guessYear(mo, Number(m[1])), mo, Number(m[1]), m[4], m[5], m[6])
  }
  // "Oct 27, 2026 10:22 PM"
  if ((m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})(?:,?\s*(?:at\s*)?(\d{1,2}):(\d{2})\s*(am|pm)?)?/i)) && mon(m[1]) >= 0) {
    return withTime(Number(m[3]), mon(m[1]), Number(m[2]), m[4], m[5], m[6])
  }
  // "27/10/2026 10:22" or "27-10-26"
  if ((m = t.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:,?\s*(\d{1,2}):(\d{2})\s*(am|pm)?)?/i)) && Number(m[2]) <= 12) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
    return withTime(y, Number(m[2]) - 1, Number(m[1]), m[4], m[5], m[6])
  }
  return undefined
}

function sourceOf(text: string): PaymentSource | undefined {
  if (/credit card|card ending|\bcc\b|credit a\/c/i.test(text)) return 'CREDIT_CARD'
  if (/debit card/i.test(text)) return 'DEBIT_CARD'
  if (/\bcash\b/i.test(text)) return 'CASH'
  if (/\bupi\b|\butr\b|debited from|@ok|@ybl|@paytm|@ibl|@axl|bank|a\/c|neft|imps/i.test(text)) return 'BANK'
  return undefined
}

export function parseScreenshot(ocr: OcrResult): ScreenshotParse {
  const lines = [...ocr.lines].sort((a, b) => a.top - b.top || a.left - b.left)
  const texts = lines.map((l) => l.text.trim()).filter(Boolean)
  const text = ocr.text || texts.join('\n')
  if (!texts.length) return { tx: null, confidence: 'none', kind: 'unknown' }

  if (isBlockEvent(text)) return { tx: null, confidence: 'none', kind: 'unknown' } // IPO / mandate block or unblock
  if (FAILED.test(text) && !/\bsuccess/i.test(text)) return { tx: null, confidence: 'none', failed: true, kind: 'payment' }

  const credit = CREDIT.test(text)
  const isPayment = /\b(paid to|sent to|paid successfully|received from|transaction successful|upi transaction id|utr|debited from|payment successful|money sent)\b/i.test(text)
  const receiptKey = !isPayment && RECEIPT_KEYS.some((r) => r.test(text))

  // ---- amount ----
  let amount = 0
  if (receiptKey) {
    outer: for (const key of RECEIPT_KEYS) {
      for (let i = 0; i < texts.length; i++) {
        if (!key.test(texts[i]) || /\b(item|sub)\s*total\b/i.test(texts[i])) continue
        const here = amountsIn(texts[i].replace(key, ' '))
        const pick = here.length ? here : amountsIn(texts[i + 1] ?? '')
        if (pick.length) { amount = pick[pick.length - 1].value; break outer }
      }
    }
  }
  if (!amount) {
    // Payment apps print the amount in the biggest type on screen.
    const scored = lines.flatMap((l) => amountsIn(l.text).map((a) => ({ ...a, height: l.height, line: l.text.trim() })))
    const marked = scored.filter((a) => a.marked)
    const bareBig = scored.filter((a) => !a.marked && /^[^\w]?\s*[\d,]+(\.\d{1,2})?$/.test(a.line))
    const pool = marked.length ? marked : bareBig
    if (pool.length) {
      const best = pool.reduce((a, b) => (b.height > a.height ? b : a))
      amount = best.value
      // "₹" is sometimes read as a leading "2" or "7" (₹330 → 7330): prefer the same number written elsewhere.
      if (!best.marked && /^[27]\d/.test(String(best.value))) {
        const alt = Number(String(best.value).slice(1))
        if (marked.some((m) => m.value === alt) || scored.some((s) => s.value === alt && s !== best)) amount = alt
      }
    }
  }

  const spelled = amountInWords(texts.join(' '))
  if (spelled) amount = spelled

  // ---- payee / merchant ----
  let receiver = payeeOf(texts, credit)
  if (!receiver) {
    const vpa = text.match(/\b([a-z0-9._-]{3,})@[a-z]{2,}\b/i)?.[0]
    receiver = (vpa && cleanName(vpa)) || merchantForReceipt(texts, text)
  }

  if (!(amount > 0)) return { tx: null, confidence: 'none', kind: receiptKey ? 'receipt' : isPayment ? 'payment' : 'unknown' }

  const vendorMap = buildVendorCategoryMap()
  const name = receiver || (credit ? 'Money received' : 'Payment')
  const when = parseDate(text)
  const tx: NewTransaction = {
    paymentAmount: amount,
    paymentType: credit ? 'CREDIT' : 'DEBIT',
    paymentReceiver: name,
    paymentCategory: credit ? guessIncomeCategory(`${name} ${text}`) : vendorMap[name] ?? guessCategory(`${name} ${text}`),
    paymentSource: sourceOf(text),
    paymentMethodId: detectAccount(text) ?? undefined,
    paymentApp: detectUpiApp(text, name) ?? undefined,
    timestamp: when?.ts,
    ref: refOf(text),
    ...(when && !when.hasTime ? { timeUnknown: true } : {}),
  }
  const marker = receiptKey || SUCCESS.test(text)
  return { tx, confidence: receiver && marker ? 'high' : 'low', kind: receiptKey ? 'receipt' : isPayment ? 'payment' : 'unknown' }
}
