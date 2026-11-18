// Reads a payment written or spoken in the user's own words: "paid 450 to swiggy from my kotak", "two hundred fifty for tea cash",
// "gym 1500 phonepe". There is no fixed phrase to learn. What it knows comes from the app's own data:
//   amount    the number in the sentence (digits, "4k", "1.5 lakh" or number words), chosen by how it is used
//   source    your accounts and cards by name, bank or last digits, the UPI apps, "cash"
//   merchant  names you have paid before, then the known-brand list
//   category  what that merchant was filed under before; else what your own history says about the other words; else the built-in keywords
import { read, KEYS } from '../core/storage'
import { APP_MARKERS, BANKS, getAccounts } from '../accounts/accounts'
import { merchantBrand } from '../payees/brands'
import { getCategories } from '../core/data'
import type { PaymentMethod, PaymentSource, Transaction } from '../core/types'

/* ---------- amount ---------- */

const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALE: Record<string, number> = { thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, crore: 10000000, crores: 10000000 }
const MULT: Record<string, number> = { k: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, cr: 10000000, crore: 10000000, crores: 10000000 }

export interface AmountHit { value: number; start: number; end: number; marked: boolean }

const CUR = String.raw`(?:₹|rs\.?|inr|\$|€|£)`
const CUR_WORD = /^(?:rupees?|rs\.?|inr|bucks|rupaye|rupaiye|₹)$/i

/** Every number in the text, written as digits or as words, with where it sits. */
export function numbersIn(text: string): AmountHit[] {
  const out: AmountHit[] = []
  const re = new RegExp(String.raw`(?<![\w.])(${CUR})?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(k|lakhs?|lacs?|crores?|cr)\b)?`, 'gi')
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const after = text.slice(end, end + 12).toLowerCase()
    const before = text.slice(Math.max(0, start - 12), start).toLowerCase()
    // not an amount: a time, a date, a unit, a percentage, a phone number
    if (/^\s*(?:am|pm|%|st\b|nd\b|rd\b|th\b|kg|gm?s?\b|ml|litres?|km|kms|mins?\b|hrs?\b|hours?|days?|years?|months?|weeks?|x\b)/.test(after)) continue
    // a date ("30 oct", "march 5"): a whole month name, so "Vishal Mega Mart 2100" is not read as March
    const MON = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`
    if (new RegExp(String.raw`^\s*${MON}\b`).test(after) || new RegExp(String.raw`\b${MON}\s*$`).test(before)) continue
    if (/^:\d/.test(after) || /\d:$/.test(before) || /\d[/-]$/.test(before) || /^[/-]\d/.test(after)) continue
    if (m[2].replace(/,/g, '').length >= 10) continue
    const base = Number(`${m[2].replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`)
    const value = base * (m[4] ? MULT[m[4].toLowerCase()] ?? 1 : 1)
    const next = text.slice(end).trimStart().split(/\s+/)[0] ?? ''
    out.push({ value, start, end, marked: !!m[1] || CUR_WORD.test(next) })
  }
  // number words: "two hundred fifty", "five thousand"
  const words = [...text.matchAll(/[A-Za-z']+/g)]
  for (let i = 0; i < words.length; i++) {
    const w = words[i][0].toLowerCase()
    if (!(w in UNITS) && !(w in TENS) && w !== 'hundred' && !(w in SCALE)) continue
    if (w === 'one' && !(words[i + 1] && /^(?:hundred|thousand|lakhs?|lacs?|crores?)$/i.test(words[i + 1][0]))) continue // "one" alone is rarely an amount
    let j = i, total = 0, cur = 0, any = false
    for (; j < words.length; j++) {
      const t = words[j][0].toLowerCase()
      if (t in UNITS) { cur += UNITS[t]; any = true }
      else if (t in TENS) { cur += TENS[t]; any = true }
      else if (t === 'hundred') { cur = (cur || 1) * 100; any = true }
      else if (t in SCALE) { total += (cur || 1) * SCALE[t]; cur = 0; any = true }
      else if (t === 'and' && j + 1 < words.length && (words[j + 1][0].toLowerCase() in UNITS || words[j + 1][0].toLowerCase() in TENS)) continue
      else break
      if (j + 1 < words.length && text.slice((words[j].index ?? 0) + words[j][0].length, words[j + 1].index).trim() !== '') { j++; break }
    }
    if (any) {
      const last = words[j - 1]
      const end = (last.index ?? 0) + last[0].length
      const next = text.slice(end).trimStart().split(/\s+/)[0] ?? ''
      out.push({ value: total + cur, start: words[i].index ?? 0, end, marked: CUR_WORD.test(next) })
    }
    i = Math.max(i, j - 1)
  }
  return out.filter((a) => a.value > 0).sort((a, b) => a.start - b.start)
}

/** The amount the sentence is about: one with a currency sign or word, else the one used like a price, else the biggest. */
export function pickAmount(text: string): AmountHit | null {
  const all = numbersIn(text)
  if (!all.length) return null
  const max = Math.max(...all.map((a) => a.value))
  const score = (a: AmountHit) => {
    const before = text.slice(Math.max(0, a.start - 14), a.start).toLowerCase()
    let s = 0
    if (a.marked) s += 4
    if (/(?:paid|pay|spent|spend|for|of|cost|costs|total|bill|worth|got|received|sent|gave|was|is|at|=|:)\s*$/.test(before)) s += 2
    if (a.value === max) s += 1
    // "2 tea 40": a small number beside a bigger one is a count, not the price
    if (a.value <= 12 && all.some((o) => o !== a && o.value >= a.value * 8)) s -= 3
    if (a.start === Math.min(...all.map((o) => o.start)) && all.length > 1) s -= 0.5
    return s
  }
  return all.reduce((best, a) => (score(a) > score(best) ? a : best))
}

/* ---------- payment source ---------- */

export interface SourceHit {
  start: number
  end: number
  paymentSource?: PaymentSource
  paymentMethodId?: string
  app?: string
  label: string
}

const GENERIC_NAME = new Set(['account', 'accounts', 'savings', 'saving', 'current', 'card', 'cards', 'bank', 'credit', 'debit', 'wallet', 'cash', 'main', 'my', 'the', 'and', 'for'])
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nameWords = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_NAME.has(w))

/** Where the money came from: one of the user's accounts or cards, a UPI app, or cash. */
export function findSource(text: string, methods: PaymentMethod[] = getAccounts()): SourceHit | null {
  const low = text.toLowerCase()
  const span = (re: RegExp) => { const m = re.exec(text); return m ? { start: m.index, end: m.index + m[0].length } : null }
  // a leading "from my", "via", "using", "paid by" belongs with the source
  const lead = (s: { start: number; end: number }) => {
    const m = /(?:\b(?:paid\s+)?(?:from|via|using|with|by|through|on|in|thru)\s+(?:my\s+|the\s+)?)$/i.exec(text.slice(0, s.start))
    return m ? { start: s.start - m[0].length, end: s.end } : s
  }
  const wantsCredit = /\bcredit\b|\bcc\b/.test(low)
  const wantsDebit = /\bdebit\b/.test(low)
  const wantsCard = wantsCredit || wantsDebit || /\bcard\b/.test(low)
  const wantsCash = /\bcash\b/.test(low)

  // the user's own accounts: a word of its name, its bank, or its last digits
  const bankHit = BANKS.map((b) => ({ b, m: new RegExp(b.re.source, 'i').exec(text) })).find((x) => x.m)
  const digits = [...text.matchAll(/(?:ending|xx+|x+|\*+|card|a\/c|acct?)\s*(?:no\.?)?\s*[x*]*(\d{4})\b/gi)].map((m) => m[1])
  const cands = methods.map((m) => {
    let score = 0
    const hit = nameWords(m.name).find((w) => new RegExp(String.raw`\b${esc(w)}\b`, 'i').test(text))
    if (hit) score += 2
    if (bankHit && (m.bank === bankHit.b.short || nameWords(m.name).some((w) => bankHit.b.re.test(w)))) score += 2
    if (m.last4 && digits.includes(m.last4)) score += 4
    if (score && wantsCredit && m.type === 'CREDIT_CARD') score += 1
    if (score && wantsDebit && m.type === 'DEBIT_CARD') score += 1
    if (score && wantsCard && !wantsCredit && !wantsDebit && (m.type === 'CREDIT_CARD' || m.type === 'DEBIT_CARD')) score += 0.5
    if (score && wantsCash && m.type === 'CASH') score += 2
    return { m, score, hit }
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score)
  if (cands.length) {
    const top = cands[0]
    const tie = cands.filter((c) => c.score === top.score).length > 1
    const where = top.hit ? span(new RegExp(String.raw`\b${esc(top.hit)}\b`, 'i')) : bankHit?.m ? { start: bankHit.m.index, end: bankHit.m.index + bankHit.m[0].length } : { start: 0, end: 0 }
    const base = lead(where ?? { start: 0, end: 0 })
    if (!tie) return { ...base, paymentMethodId: top.m.id, paymentSource: top.m.type, label: top.m.name }
    // several fit (two Kotak accounts): name the bank and the kind, but do not guess which
    if (bankHit?.m) return { ...base, label: bankHit.b.short, paymentSource: wantsCredit ? 'CREDIT_CARD' : wantsDebit ? 'DEBIT_CARD' : 'BANK' }
  }
  if (bankHit?.m) {
    const s = lead({ start: bankHit.m.index, end: bankHit.m.index + bankHit.m[0].length })
    return { ...s, label: bankHit.b.short, paymentSource: wantsCredit ? 'CREDIT_CARD' : wantsDebit ? 'DEBIT_CARD' : 'BANK' }
  }
  for (const [app, re] of APP_MARKERS) {
    const s = span(new RegExp(re.source, 'i'))
    if (s) return { ...lead(s), app, label: app, paymentSource: 'BANK' }
  }
  if (wantsCash) {
    const cash = methods.find((m) => m.type === 'CASH')
    const s = span(/\bcash\b/i) ?? { start: 0, end: 0 }
    return { ...lead(s), paymentSource: 'CASH', paymentMethodId: cash?.id, label: cash?.name ?? 'Cash' }
  }
  if (wantsCard) {
    const cards = methods.filter((m) => wantsCredit ? m.type === 'CREDIT_CARD' : wantsDebit ? m.type === 'DEBIT_CARD' : m.type === 'CREDIT_CARD' || m.type === 'DEBIT_CARD')
    const s = span(/\b(?:credit\s+card|debit\s+card|card|cc)\b/i)
    if (s) return { ...lead(s), paymentSource: wantsCredit ? 'CREDIT_CARD' : wantsDebit ? 'DEBIT_CARD' : cards[0]?.type, paymentMethodId: cards.length === 1 ? cards[0].id : undefined, label: cards.length === 1 ? cards[0].name : wantsCredit ? 'Credit card' : wantsDebit ? 'Debit card' : 'Card' }
  }
  const wallet = span(/\bwallet\b/i)
  if (wallet) return { ...lead(wallet), label: 'Wallet' }
  return null
}

/* ---------- merchant and category ---------- */

const FILLER = new Set(['paid', 'pay', 'paying', 'spent', 'spend', 'spending', 'to', 'for', 'at', 'on', 'from', 'via', 'using', 'with', 'by', 'through', 'my', 'the', 'a', 'an', 'of', 'in', 'and', 'it', 'was', 'is', 'i', 'me', 'just', 'today', 'yesterday', 'now', 'rs', 'rupees', 'rupee', 'inr', 'bucks', 'rupaye', 'got', 'bought', 'buy', 'purchase', 'purchased', 'ordered', 'order', 'took', 'cost', 'costs', 'amount', 'bill', 'payment', 'transaction'])
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

interface History { receivers: Map<string, { name: string; cats: Map<string, number> }>; words: Map<string, Map<string, number>>; total: Map<string, number> }
let cache: { n: number; first: string; h: History } | null = null

/** What this person's own transactions say: the names they have paid, and which words go with which category. */
function learn(txns: Transaction[]): History {
  if (cache && cache.n === txns.length && cache.first === txns[0]?.id) return cache.h
  const h: History = { receivers: new Map(), words: new Map(), total: new Map() }
  for (const t of txns.slice(0, 1500)) {
    if (t.paymentType !== 'DEBIT' || !t.paymentCategory || t.paymentCategory === 'Others') continue
    const k = key(t.paymentReceiver)
    if (k) {
      const r = h.receivers.get(k) ?? { name: t.paymentReceiver, cats: new Map() }
      r.cats.set(t.paymentCategory, (r.cats.get(t.paymentCategory) ?? 0) + 1)
      h.receivers.set(k, r)
    }
    const toks = new Set(key(`${t.paymentReceiver} ${(t.note ?? '').replace(/#\S+/g, '')}`).split(' ').filter((w) => w.length >= 3 && !FILLER.has(w)))
    for (const w of toks) {
      const m = h.words.get(w) ?? new Map<string, number>()
      m.set(t.paymentCategory, (m.get(t.paymentCategory) ?? 0) + 1)
      h.words.set(w, m)
      h.total.set(t.paymentCategory, (h.total.get(t.paymentCategory) ?? 0) + 1)
    }
  }
  cache = { n: txns.length, first: txns[0]?.id ?? '', h }
  return h
}

const topOf = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]

/** A category for words alone ("tea", "gym"), when the user's own history agrees on one. */
function categoryFromHistory(words: string[], h: History): string | null {
  const cats = new Map<string, number>()
  let hits = 0
  for (const w of words) {
    const m = h.words.get(w)
    if (!m) continue
    const sum = [...m.values()].reduce((a, b) => a + b, 0)
    hits += sum
    for (const [c, n] of m) cats.set(c, (cats.get(c) ?? 0) + n / sum)
  }
  if (!cats.size || hits < 2) return null
  const total = [...cats.values()].reduce((a, b) => a + b, 0)
  const [best, v] = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]
  return v / total >= 0.65 ? best : null
}

/** True when a typed receiver is really what was bought ("tea", "lunch", "petrol"), not a name: one word, not a brand, and it means a category. */
export function isDescription(text: string, guess: (s: string) => string): boolean {
  const w = text.trim()
  return !!w && !/\s/.test(w) && w.length >= 3 && !merchantBrand(w) && guess(w) !== 'Others'
}

export interface Understood {
  amount: number
  source: SourceHit | null
  merchant: string | null
  /** The merchant is one you have paid before, or a known brand (not just a leftover word). */
  merchantKnown: boolean
  /** Where the merchant came from: a name you paid before, a brand, a name after "to/at/from", or only the words that were left (which may be a description, not a name). */
  merchantFrom: 'history' | 'brand' | 'named' | 'leftover' | null
  category: string
  categoryFrom: 'merchant' | 'history' | 'keywords' | 'none'
  /** Words left after the amount, the source and the merchant: what the payment was for. */
  context: string
}

/** Reads one sentence. `guess` is the built-in keyword table, used last. */
export function understand(text: string, guess: (s: string) => string, txns: Transaction[] = read<Transaction[]>(KEYS.transactions, [])): Understood | null {
  const a = pickAmount(text)
  if (!a) return null
  const methods = getAccounts()
  const cats = getCategories()
  const source = findSource(text, methods)
  // what is left once the amount and the source are taken out
  const cut = [{ start: a.start, end: a.end }, ...(source ? [source] : [])].sort((x, y) => y.start - x.start)
  let rest = text
  for (const c of cut) rest = `${rest.slice(0, c.start)} ${rest.slice(c.end)}`
  const tokens = rest.split(/[^A-Za-z0-9&'’.\-]+/).filter(Boolean)
  const h = learn(txns)

  // merchant: a name you have paid before, else a known brand, longest phrase first
  let merchant: string | null = null
  let known = false
  let from: Understood['merchantFrom'] = null
  for (let n = Math.min(4, tokens.length); n >= 1 && !merchant; n--) {
    for (let i = 0; i + n <= tokens.length && !merchant; i++) {
      const phrase = tokens.slice(i, i + n).join(' ')
      if (n === 1 && (FILLER.has(phrase.toLowerCase()) || phrase.length < 3)) continue
      const own = h.receivers.get(key(phrase))
      // a one-word "receiver" that is really what was bought ("Tea", "Lunch") is a description, even if an earlier entry used it as a name
      const describes = !!own && n === 1 && !merchantBrand(phrase) && guess(phrase) !== 'Others'
      if (own && !describes) { merchant = own.name; known = true; from = 'history'; continue }
      const brand = merchantBrand(phrase)
      if (brand && brand.label.length > 2) { merchant = brand.label; known = true; from = 'brand' }
    }
  }
  const used = new Set(merchant ? key(merchant).split(' ') : [])
  let ctxWords = tokens.map((t) => key(t)).filter((t) => t && !FILLER.has(t) && !used.has(t))
  if (!merchant) {
    // "to Ramesh", "at the corner shop": a name after a preposition; else a short leftover phrase
    const m = rest.match(/\b(?:to|at|from)\s+([A-Za-z][A-Za-z0-9&'.\- ]{1,30})/i)?.[1]?.split(/\s+(?:for|at|on|via|using|by|with|today|yesterday)\b/i)[0]?.trim()
    const named = m && key(m).split(' ').filter((w) => !FILLER.has(w)).join(' ')
    if (named) { merchant = title(named); from = 'named' }
    else if (ctxWords.length && ctxWords.length <= 3) { merchant = title(ctxWords.join(' ')); from = 'leftover' }
  }

  // category: what this merchant was filed under; else what the other words mean to this user; else the built-in keywords
  let category = 'Others'
  let catFrom: Understood['categoryFrom'] = 'none'
  const m = merchant ? h.receivers.get(key(merchant)) : undefined
  if (m) { category = topOf(m.cats)[0]; catFrom = 'merchant' }
  if (catFrom === 'none' && known && merchant) { const g = guess(merchant); if (g !== 'Others') { category = g; catFrom = 'merchant' } }
  if (catFrom === 'none') { const c = categoryFromHistory(ctxWords, h); if (c) { category = c; catFrom = 'history' } }
  if (catFrom === 'none') { const g = guess(`${ctxWords.join(' ')} ${merchant ?? ''}`); if (g !== 'Others') { category = g; catFrom = 'keywords' } }
  if (!cats.includes(category)) { category = 'Others'; catFrom = 'none' }
  ctxWords = ctxWords.filter((w) => !used.has(w))
  return { amount: a.value, source, merchant, merchantKnown: known, merchantFrom: from, category, categoryFrom: catFrom, context: ctxWords.join(' ') }
}
