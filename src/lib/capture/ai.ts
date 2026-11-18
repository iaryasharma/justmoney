// Replaces AboutMoney's private backend (extract-info, extract-info-from-image,
// extract-info-from-doc, spending-insights) with direct Gemini calls using the
// user's own API key, plus on-device fallbacks.
import { read, KEYS } from '../core/storage'
import { buildVendorCategoryMap, getCategories, normalizeSource } from '../core/data'
import { parseStatementText } from './statement'
import { FAMILY, getFamily, guessIncomeCategory, INCOME_CATEGORIES, matchFamily } from '../core/money'
import { getCurrency } from '../core/format'
import { understand } from './nlparse'
import type { Insight, NewTransaction, PaymentType, Transaction } from '../core/types'

const MODEL = 'gemini-2.5-flash'

export class NoTransactionInfoError extends Error { code = 'NO_TRANSACTION_INFO' }
export class AIUnavailableError extends Error {}

export const hasAIConsent = () => read<boolean>(KEYS.aiConsent, false) === true
export const getApiKey = () => read<string>(KEYS.geminiKey, '').trim()
export const aiReady = () => hasAIConsent() && !!getApiKey()

type Part = { text: string } | { inline_data: { mime_type: string; data: string } }

async function gemini<T>(parts: Part[], timeoutMs = 60000): Promise<T> {
  if (!hasAIConsent()) throw new AIUnavailableError('AI processing is off. Enable it from Settings.')
  const key = getApiKey()
  if (!key) throw new AIUnavailableError('Add a Gemini API key in Settings to use AI.')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Gemini request failed (${res.status})`)
    const body = await res.json()
    const text: string = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}

function context() {
  const now = new Date()
  return [
    `Today is ${now.toDateString()} (local time, epoch ms ${now.getTime()}).`,
    `User currency: ${getCurrency()}.`,
    `Expense categories (for DEBIT): ${JSON.stringify(getCategories())}. Pick the closest one; use "Others" if nothing fits. Money sent to a family member is "Family".`,
    `Income categories (for CREDIT, i.e. money received): ${JSON.stringify(INCOME_CATEGORIES)}. e.g. money from parents/siblings → "Family", IPO/share/trading profit → "Stocks & IPO".`,
    `The user's family members: ${JSON.stringify(getFamily().map((m) => ({ name: m.name, relation: m.relation })))}. For money from/to family, paymentReceiver is the person's name or relation (e.g. "Dad").`,
    `The user's past category choices per receiver (prefer these): ${JSON.stringify(buildVendorCategoryMap())}.`,
    'paymentType is "DEBIT" for money going out and "CREDIT" for money coming in (salary, refunds, cashback, received).',
    'paymentSource is one of "BANK" (UPI/netbanking), "CASH", "CREDIT_CARD", "DEBIT_CARD", or null if unknown.',
    'timestamp is epoch milliseconds; use null if no date or time is stated.',
    'paymentReceiver is a short, Title Case merchant/payee/payer name.',
  ].join('\n')
}

const TXN_SHAPE = '{"paymentAmount": number, "paymentType": "DEBIT"|"CREDIT", "paymentReceiver": string, "paymentCategory": string, "paymentSource": string|null, "timestamp": number|null}'

interface RawTxn {
  paymentAmount?: unknown; paymentType?: unknown; paymentReceiver?: unknown
  paymentCategory?: unknown; paymentSource?: unknown; timestamp?: unknown
}

export function sanitizeExtractedTransactions(rows: RawTxn[] | undefined): NewTransaction[] {
  const cats = getCategories()
  return (rows ?? []).flatMap((r): NewTransaction[] => {
    const amount = Number(String(r.paymentAmount ?? '').replace(/[^0-9.]/g, ''))
    const type = r.paymentType === 'DEBIT' || r.paymentType === 'CREDIT' ? (r.paymentType as PaymentType) : null
    const receiver = String(r.paymentReceiver ?? '').trim()
    if (!(amount > 0) || !type || !receiver) return []
    const cat = String(r.paymentCategory ?? '')
    if (type === 'CREDIT') {
      return [{
        paymentAmount: amount, paymentType: type, paymentReceiver: receiver,
        paymentCategory: INCOME_CATEGORIES.includes(cat) ? cat : guessIncomeCategory(receiver),
        paymentSource: normalizeSource(r.paymentSource), timestamp: Number(r.timestamp) > 0 ? Number(r.timestamp) : undefined,
      }]
    }
    const ts = Number(r.timestamp)
    return [{
      paymentAmount: amount, paymentType: type, paymentReceiver: receiver,
      paymentCategory: cats.includes(cat) ? cat : 'Others',
      paymentSource: normalizeSource(r.paymentSource),
      timestamp: ts > 0 ? ts : undefined,
    }]
  })
}

/** A free-text answer from Gemini (used by "Ask your money"). */
export async function askGemini(prompt: string): Promise<string> {
  const r = await gemini<{ answer?: string }>([{ text: `${prompt}

Respond with JSON {"answer": "<your answer>"}.` }], 45000)
  return (r.answer ?? '').trim()
}

/** Free text or voice transcript → one transaction. */
export async function extractInfo(text: string): Promise<NewTransaction> {
  const r = await gemini<RawTxn>([{
    text: `${context()}\n\nExtract a single transaction from the user's message. Respond with JSON ${TXN_SHAPE}. If the message contains no amount, respond with {"paymentAmount": null, "paymentType": null}.\n\nMessage: ${JSON.stringify(text)}`,
  }], 30000)
  if (r.paymentAmount == null || r.paymentType == null) throw new NoTransactionInfoError('No transaction info found')
  const [t] = sanitizeExtractedTransactions([r])
  if (!t) throw new NoTransactionInfoError('No transaction info found')
  return t
}

/** Receipt, invoice or payment-app screenshot → transactions. */
export async function extractInfoFromImage(file: File): Promise<NewTransaction[]> {
  const data = await fileToBase64(file)
  const r = await gemini<{ transactions?: RawTxn[] }>([
    { text: `${context()}\n\nThis image is a receipt, bill, or payment-app/bank screenshot. Extract every completed transaction visible. For a receipt, return one transaction for the total. Respond with JSON {"transactions": [${TXN_SHAPE}]}.` },
    { inline_data: { mime_type: file.type || 'image/jpeg', data } },
  ], 60000)
  return sanitizeExtractedTransactions(r.transactions)
}

/** Text extracted from a bank/card statement → transactions. */
export async function extractInfoFromStatementText(text: string): Promise<NewTransaction[]> {
  const r = await gemini<{ transactions?: RawTxn[] }>([{
    text: `${context()}\n\nBelow is the text of a bank, card, or wallet statement. Extract every transaction row (skip opening/closing balances and totals). Use each row's date for timestamp (noon local time if no time). Amounts in a Deposit/Credit column are CREDIT (money received) and in a Withdrawal/Debit column are DEBIT. If unsure, use the running Balance column: balance going up means CREDIT, going down means DEBIT. Respond with JSON {"transactions": [${TXN_SHAPE}]}.\n\n--- STATEMENT ---\n${text.slice(0, 200000)}`,
  }], 90000)
  return sanitizeExtractedTransactions(r.transactions)
}

export async function generateInsights(txns: Transaction[], monthLabel: string, salary: number): Promise<Insight[]> {
  const rows = txns.filter((t) => t.paymentType === 'DEBIT')
    .map((t) => ({ title: t.paymentReceiver, category: t.paymentCategory, amount: t.paymentAmount, date: new Date(t.timestamp).toISOString().slice(0, 10) }))
  const r = await gemini<{ suggestions?: Insight[] }>([{
    text: `You are a friendly personal-finance coach. Currency: ${getCurrency()}. Monthly income: ${salary || 'unknown'}. Month: ${monthLabel}.\nHere are this month's expenses: ${JSON.stringify(rows)}\n\nGive 4-6 specific, actionable spending insights grounded in these numbers (mention merchants, categories, and amounts). Respond with JSON {"suggestions": [{"suggestion": "short headline", "tip": "one or two sentences"}]}.`,
  }], 60000)
  return (r.suggestions ?? []).filter((s) => s?.suggestion && s?.tip)
}

/** Personal suggestions about the plan, from numbers only (no names): what to do next with the money. */
export async function generateAdvice(summary: string, area: string): Promise<Insight[]> {
  const r = await gemini<{ suggestions?: Insight[] }>([{
    text: `You are a warm, practical personal-finance coach for someone in India. Currency: ${getCurrency()}. Focus: ${area}.
Here are their numbers (no names):
${summary}

Give 3-4 specific, actionable suggestions that help them save more and spend carefully, using these numbers. Be concrete (say amounts and days), kind, and never shaming. Respond with JSON {"suggestions": [{"suggestion": "short headline", "tip": "one or two sentences"}]}.`,
  }], 60000)
  return (r.suggestions ?? []).filter((s) => s?.suggestion && s?.tip).slice(0, 4)
}

const FALLBACK_INSIGHTS: Insight[] = [
  { suggestion: 'Track your spending', tip: 'Regular expense tracking helps you identify where your money goes and find savings opportunities.' },
  { suggestion: 'Emergency fund', tip: 'Aim to save 3-6 months of expenses as an emergency fund for financial security.' },
  { suggestion: 'Health budget', tip: 'Set aside a monthly budget for health checkups and wellness to avoid large unexpected medical expenses.' },
]

export function ensureMinSuggestions(list: Insight[], min = 3) {
  const out = [...list]
  for (const f of FALLBACK_INSIGHTS) {
    if (out.length >= min) break
    if (!out.some((s) => s.suggestion === f.suggestion)) out.push(f)
  }
  return out
}

/** On-device insights used when AI is off: simple, number-grounded observations. */
export function localInsights(txns: Transaction[], prev: Transaction[], salary: number, fmt: (n: number) => string): Insight[] {
  const debits = txns.filter((t) => t.paymentType === 'DEBIT')
  const total = debits.reduce((a, t) => a + t.paymentAmount, 0)
  const out: Insight[] = []
  if (!debits.length) return out
  const byCat = new Map<string, number>()
  debits.forEach((t) => byCat.set(t.paymentCategory, (byCat.get(t.paymentCategory) ?? 0) + t.paymentAmount))
  const [topCat, topAmt] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0]
  out.push({ suggestion: `${topCat} is your biggest spend`, tip: `${fmt(topAmt)} went to ${topCat} — ${Math.round((topAmt / total) * 100)}% of this month's spending. Trimming it by 10% saves ${fmt(topAmt * 0.1)}.` })
  const byRecv = new Map<string, { n: number; amt: number }>()
  debits.forEach((t) => {
    const v = byRecv.get(t.paymentReceiver) ?? { n: 0, amt: 0 }
    byRecv.set(t.paymentReceiver, { n: v.n + 1, amt: v.amt + t.paymentAmount })
  })
  const [frequent, f] = [...byRecv.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  if (f.n >= 3) out.push({ suggestion: `Frequent spends at ${frequent}`, tip: `${f.n} payments to ${frequent} adding up to ${fmt(f.amt)}. Small repeat purchases add up fast.` })
  const prevTotal = prev.filter((t) => t.paymentType === 'DEBIT').reduce((a, t) => a + t.paymentAmount, 0)
  if (prevTotal > 0) {
    const pct = Math.round(((total - prevTotal) / prevTotal) * 100)
    out.push(pct > 0
      ? { suggestion: pct > 1000 ? `Spending is up ${fmt(total - prevTotal)}` : `Spending is up ${pct}%`, tip:`You've spent ${fmt(total - prevTotal)} more than last month so far. Review recent non-essentials.` }
      : { suggestion: `Spending is down ${Math.abs(pct)}%`, tip: `Nice — ${fmt(prevTotal - total)} less than last month. Consider moving the difference to savings.` })
  }
  if (salary > 0) {
    const rate = Math.round(((salary - total) / salary) * 100)
    out.push({ suggestion: rate >= 20 ? `You're saving ~${rate}% of income` : `Savings rate is ${rate}%`, tip: rate >= 20 ? 'Keep it up — automate a SIP or RD so the savings happen first.' : 'Aim for at least 20%. Set a monthly budget on Home to keep spending in check.' })
  }
  const weekend = debits.filter((t) => [0, 6].includes(new Date(t.timestamp).getDay())).reduce((a, t) => a + t.paymentAmount, 0)
  if (weekend / total > 0.4) out.push({ suggestion: 'Weekends cost you the most', tip: `${Math.round((weekend / total) * 100)}% of spending happens on weekends. Plan weekend outings ahead with a cap.` })
  return out
}

/**
 * Offline parser for what someone types or says, in any order: "₹500 to Swiggy", "paid two hundred fifty for tea cash", "gym 1500 phonepe".
 * The amount, where it was paid from, the merchant and the category are worked out by nlparse.ts from the user's own accounts and history.
 */
export function localParseTransaction(text: string): NewTransaction | null {
  const u = understand(text, guessCategory)
  if (!u || !(u.amount > 0)) return null
  const amount = u.amount
  // Money in: "received", "got", "papa sent 5000", "IPO profit 12000", "dividend 800"…
  const familyWho = matchFamily(text)?.name ?? text.match(FAMILY_WHO)?.[1]
  const credit = /\b(received|credit(?!\s*card)|credited|salary|refund|income|cashback|got|gave me|sent me|profit|dividend|interest|bonus|stipend|won|earned|reimbursed|reimbursement)\b/i.test(text)
    || (!!familyWho && new RegExp(String.raw`\b${familyWho}\s+(sent|gave|transferred|paid)\b`, 'i').test(text))
  // "tea 20": tea is what was paid for, not who was paid. With no real merchant, the words become the note (unless the user turned that off).
  const asNote = !credit && !familyWho && u.merchantFrom === 'leftover' && read<boolean>(KEYS.descriptionAsNote, true)
  let receiver = (credit && familyWho) || (asNote ? 'Expense' : u.merchant) || 'Expense'
  const from = {
    ...(u.source?.paymentMethodId ? { paymentMethodId: u.source.paymentMethodId } : {}),
    ...(u.source?.paymentSource ? { paymentSource: u.source.paymentSource } : {}),
    ...(u.source?.app ? { paymentApp: u.source.app } : {}),
  }
  if (credit) {
    const category = guessIncomeCategory(text)
    // "IPO profit 12000" has no payer: name it after the source instead of a stray word
    if (!familyWho && !/\bfrom\b/i.test(text) && !u.merchantKnown) receiver = category === 'Other income' ? 'Money received' : category
    return { paymentAmount: amount, paymentType: 'CREDIT', paymentReceiver: receiver, paymentCategory: category, ...from }
  }
  return { paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: receiver, paymentCategory: familyWho ? FAMILY : u.category, ...(asNote && u.merchant ? { note: u.merchant } : {}), ...from }
}

const FAMILY_WHO = /\b(mom|mum|mummy|mother|maa|amma|dad|daddy|papa|father|appa|brother|bhai|bhaiya|sister|didi|wife|husband|uncle|aunty|aunt|chacha|mama|nana|nani|dada|dadi|grandpa|grandma|parents)\b/i


const KEYWORDS: [string, RegExp][] = [
  ['Entertainment', /netflix|prime\s?video|amazon\s?prime|\bprime\b|hotstar|crunchy\s?roll|you\s?tube|apple\s?music|bookmyshow|book\s?my\s?show|\bpvr\b|\binox\b|cinepolis|cinema|movie|theatre|theater|concert|\bshow\s?tickets?\b|comedy\s?show|district\.in|insider\.in|amusement|wonderla|imagica|bowling|arcade/i],
  ['Fitness', /\bgym\b|gyms?\b|fitness|workout|crossfit|zumba|pilates|\byoga\b|prot(?:ei|ie)n|\bwhey\b|creatine|bcaa|pre-?workout|mass\s?gainer|muscleblaze|myprotein|healthkart|optimum\s?nutrition|cult\.?\s?fit|anytime\s?fitness|gold'?s\s?gym|dumbbell|treadmill|supplements?\b/i],
  ['Snacks', /snack|chips|namkeen|biscuit|cookie|samosa|vada\s?pav|pani\s?puri|golgappa|bhel|maggi|haldiram|bikaner|lays|kurkure|bingo|ice\s?cream|chocolate|cadbury|candy|popcorn|chaat|bakery|\bchai\b|\btea\b|tea\s?stall|juice|kulfi|waffle|wafer/i],
  ['Food', /\btoing\b|chaayos|cafe\s?coffee\s?day|\bccd\b|wendy|bikaner\s?wala|burger\s?singh|burger\s?king|swiggy|zomato|savana|brown\s?sugar|dosaka|restaurant|cafe|coffee|starbucks|pizza|burger|lunch|dinner|breakfast|food|domino|kfc|mcdonald/i],
  ['Grocery', /grocery|blinkit|zepto|bigbasket|instamart|amazon\s?(?:now|fresh)|flipkart\s?minutes|d-?\s?mart|vegetable|milk|supermarket|general store|kirana|provision|reliance fresh|more retail|big bazaar|smart\s?baza{1,2}r|spencer/i],
  ['Fuel', /petrol|diesel|\bfuel\b|\bcng\b|indian\s?oil|\biocl\b|\bhpcl?\b|bharat\s?petroleum|\bbpcl\b|reliance\s?bp|jio-?bp|nayara|\bshell\b|petrol\s?pump/i],
  ['Games', /steam|roblox|playstation|\bpsn\b|xbox|nintendo|epic\s?games|riot|valorant|bgmi|krafton|free\s?fire|garena|dream11|\bmpl\b|gaming|\bgames?\b|pubg|supercell|clash|codm/i],
  ['Travel', /uber|ola|rapido|abhi\s?bus|red\s?bus|\bauto(?!\s?(debit|pay))\b|rickshaw|metro|namma\s?yatri|bmrc|dmrc|jmrc|pmrda|irctc|train|flight|indigo|petrol|fuel|cab|taxi|bus|travel/i],
  ['Shopping', /amazon|flipkart|myntra|ajio|meesho|westside|zudio|(?:reliance\s*)?trends|red\s?tape|limeroad|lime\s?road|max\s?(?:fashion|shopping)|vishal\s?mega\s?mart|\bv\s?-?\s?mart\b|bonkers\s?corner|glitchez|\bzara\b|h\s?&\s?m\b|levi'?s|decathlon|shopping|clothes|shoes/i],
  ['Rent', /rent|landlord|pg\b/i],
  ['Health', /pharmacy|medicine|doctor|hospital|apollo|1mg|pharmeasy|health/i],
  ['Subscriptions', /spotify|subscription|icloud|google one/i],
  ['EMI/Bill', /emi|bill|electricity|recharge|broadband|wifi|airtel|\bbsnl\b|jio|insurance/i],
  ['Investments', /sip|mutual fund|zerodha|groww|stocks|investment|ppf|fd\b/i],
]
export function guessCategory(text: string) {
  const cats = getCategories()
  return KEYWORDS.find(([c, re]) => cats.includes(c) && re.test(text))?.[0] ?? 'Others'
}


/** Best-effort statement-row parser for when AI is unavailable (see statement.ts). */
export function localParseStatement(text: string): NewTransaction[] {
  return parseStatementText(text)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
