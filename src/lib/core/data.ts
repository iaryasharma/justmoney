import { GENERIC_PAYEE } from '../payees/payeeGuess'
import { settleHoldsWith } from '../accounts/holds'
import { read, write, uid, KEYS } from './storage'
import { isTransferCategory } from '../accounts/accounts'
import { matchRule, noteRuleHit } from '../capture/rules'
import { logActivity, moveToTrash, takeFromTrash } from './trash'
import { findPerson } from '../payees/peopleMatch'
import { normName as payeeNorm, payeeLabel } from '../payees/payee'
import { merchantBrand } from '../payees/brands'
import { applySavingsRules } from '../plan/savingsRules'
import { FAMILY, guessIncomeCategory, INCOME_CATEGORIES, looksLikeFamilyTransfer } from './money'
import type { NewTransaction, PaymentMethod, PaymentSource, RecurringCadence, RecurringRule, Transaction } from './types'

export const DEFAULT_CATEGORIES = ['Food', 'Snacks', 'Shopping', 'Travel', 'Fuel', 'Grocery', 'Rent', 'Investments', 'Health', 'Fitness', 'EMI/Bill', 'Subscriptions', 'Entertainment', 'Games', 'Fund', 'Family', 'Others']

const PIE_COLORS: Record<string, string> = {
  Food: '#FF3B30', Shopping: '#007AFF', Travel: '#5AC8FA', Grocery: '#34C759', Rent: '#FF9500',
  Investments: '#FFD60A', Health: '#BF5AF2', 'EMI/Bill': '#FF6B6B', Subscriptions: '#5856D6', Family: '#F4A261', Others: '#8E8E93', Fuel: '#E8590C', Games: '#2DD4BF', Snacks: '#F59E0B', Fund: '#22C55E', Entertainment: '#EC4899', Fitness: '#84CC16',
  // income sources
  Salary: '#34C759', 'Stocks & IPO': '#0A84FF', Dividends: '#64D2FF', Interest: '#30B0C7', Freelance: '#BF5AF2', Business: '#FF9F0A',
  'Rental income': '#A2845E', Gift: '#FF375F', Refund: '#8E8E93', Cashback: '#FFD60A', 'Other income': '#AEAEB2',
}
const CUSTOM_COLORS = ['#00C7BE', '#FF2D55', '#A2845E', '#64D2FF', '#FFB340', '#C644FC', '#7D7AFF', '#B0C948', '#FF6482', '#40C8E0']

/** Expense categories; Family is always available because commitments and transfers rely on it. */
export const getCategories = () => withFamily(read<string[] | null>(KEYS.categories, null))

const STREAMING = new Set(['netflix', 'primevideo', 'youtube', 'youtubemusic', 'hotstar', 'crunchyroll', 'applemusic'])

/** What counts as fitness: the gym, protein and the like. Spelling mistakes ("protien") are common, so they count too. */
export const FITNESS_WORDS = /\bgym\b|gyms?\b|fitness|workout|crossfit|zumba|pilates|\byoga\b|prot(?:ei|ie)n|\bwhey\b|creatine|bcaa|pre-?workout|mass\s?gainer|muscleblaze|myprotein|healthkart|optimum\s?nutrition|cult\.?\s?fit|anytime\s?fitness|gold'?s\s?gym|decathlon\s?(?:gym|fitness)|dumbbell|treadmill|supplements?\b/i

/** One-time: gym, protein and the like that were filed as Others or Health move to Fitness. */
export function migrateFitness() {
  if (read<boolean>(KEYS.fitnessMoved, false)) return
  write(KEYS.fitnessMoved, true)
  const list = getAll()
  let changed = false
  const next = list.map((t) => {
    if (t.paymentType !== 'DEBIT' || !['Others', 'Health'].includes(t.paymentCategory)) return t
    if (!FITNESS_WORDS.test(`${t.paymentReceiver} ${t.rawReceiver ?? ''} ${t.note ?? ''}`)) return t
    changed = true
    return { ...t, paymentCategory: 'Fitness' }
  })
  if (changed) write(KEYS.transactions, next)
}

/** One-time: Netflix, Prime, YouTube, YouTube Music, Hotstar and Apple Music are entertainment, not subscriptions. */
export function migrateStreaming() {
  if (read<boolean>(KEYS.streamingMoved, false)) return
  write(KEYS.streamingMoved, true)
  const list = getAll()
  let changed = false
  const next = list.map((t) => {
    if (t.paymentType !== 'DEBIT' || t.paymentCategory !== 'Subscriptions') return t
    const b = merchantBrand(t.rawReceiver ?? t.paymentReceiver)
    if (!b || !STREAMING.has(b.key)) return t
    changed = true
    return { ...t, paymentCategory: 'Entertainment' }
  })
  if (changed) write(KEYS.transactions, next)
}

/** One-time: earlier entries written as "Zepto Marketplace Pr" take their brand's name too. The written name is kept. */
export function migrateNames() {
  if (read<boolean>(KEYS.namesMigrated, false)) return
  write(KEYS.namesMigrated, true)
  const list = getAll()
  let changed = false
  const next = list.map((t) => {
    if (t.paymentType !== 'DEBIT' || t.rawReceiver) return t
    const label = payeeLabel(t.paymentReceiver, t.paymentCategory)
    if (label === t.paymentReceiver) return t
    changed = true
    return { ...t, paymentReceiver: label, rawReceiver: t.paymentReceiver }
  })
  if (changed) write(KEYS.transactions, next)
}

/**
 * Remembers a name you gave a payee, so "SRI SAI ENTP" becomes "Chai stall" on every later payment too,
 * and renames the earlier ones that were written the same way.
 */
export function learnPayeeName(written: string, name: string) {
  const key = payeeNorm(written)
  const clean = name.trim()
  // "Bank debit", "Payment", "Transfer" are what the bank wrote when it gave no name: they stand for anyone, so naming one
  // payment must never rename every other nameless one (a UCO debit to Zudio became "Amazon" this way)
  if (!key || !clean || payeeNorm(clean) === key || GENERIC_PAYEE.test(written.trim())) return 0
  write(KEYS.payeeNames, { ...read<Record<string, string>>(KEYS.payeeNames, {}), [key]: clean })
  let n = 0
  write(KEYS.transactions, getAll().map((t) => {
    if (payeeNorm(t.rawReceiver ?? t.paymentReceiver) !== key && payeeNorm(t.paymentReceiver) !== key) return t
    if (t.paymentReceiver === clean) return t
    n++
    return { ...t, paymentReceiver: clean, rawReceiver: t.rawReceiver ?? t.paymentReceiver }
  }))
  return n
}

/** Categories added after launch, and where each goes in a list saved before it existed. */
const ADDED: { name: string; after?: string; before?: string }[] = [
  { name: 'Snacks', after: 'Food' }, { name: 'Fund', before: 'Family' }, { name: 'Entertainment', before: 'Games' }, { name: 'Fitness', after: 'Health' },
]

/** One-time per category: puts newly added categories into a list saved before they existed. */
export function migrateCategories() {
  const flag = read<boolean | string[]>(KEYS.snacksAdded, false)
  const done = flag === true ? ['Snacks', 'Fund'] : Array.isArray(flag) ? flag : []
  const todo = ADDED.filter((c) => !done.includes(c.name))
  if (!todo.length) return
  write(KEYS.snacksAdded, ADDED.map((c) => c.name))
  const saved = read<string[] | null>(KEYS.categories, null)
  if (!saved) return
  let list = [...saved]
  for (const c of todo) {
    if (list.includes(c.name)) continue
    const at = c.after ? list.indexOf(c.after) + 1 || 0 : list.indexOf(c.before ?? '')
    list = at > 0 ? [...list.slice(0, at), c.name, ...list.slice(at)] : [...list.slice(0, -1), c.name, ...list.slice(-1)]
  }
  write(KEYS.categories, list)
}

export function withFamily(stored: string[] | null) {
  const c = stored ?? DEFAULT_CATEGORIES
  return c.includes(FAMILY) ? c : [...c.slice(0, -1), FAMILY, ...c.slice(-1)]
}

export function categoryColor(name: string, categories = getCategories()) {
  if (PIE_COLORS[name]) return PIE_COLORS[name]
  const custom = categories.filter((c) => !PIE_COLORS[c])
  return CUSTOM_COLORS[custom.indexOf(name)] ?? '#8E8E93'
}

const CATEGORY_ICONS: Record<string, string> = {
  Food: 'utensils', Shopping: 'bag', Travel: 'plane', Grocery: 'cart', Rent: 'home', Investments: 'bars',
  Health: 'heart', 'EMI/Bill': 'receipt', Subscriptions: 'play', Family: 'users', Others: 'dots', Fuel: 'fuel', Games: 'gamepad', Fitness: 'dumbbell', Snacks: 'cookie', Fund: 'bars', Entertainment: 'ticket',
  'On behalf': 'users', 'Self transfer': 'repeat', Split: 'split',
}

/** Icon name (see components/ui) for a category; custom categories get a tag. */
export const categoryIcon = (name: string) => CATEGORY_ICONS[name] ?? 'tag'

export const METHOD_COLORS = ['#0088FF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#FF2D55', '#5AC8FA', '#FFCC00', '#30B0C7', '#64D2FF']
export const SOURCE_LABELS: Record<PaymentSource, string> = {
  CREDIT_CARD: 'Credit Card', DEBIT_CARD: 'Debit Card', CASH: 'Cash', BANK: 'Bank / UPI',
}
export const MAX_METHODS = 20

const SOURCES: PaymentSource[] = ['BANK', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD']
export const normalizeSource = (s: unknown): PaymentSource | undefined =>
  SOURCES.includes(s as PaymentSource) ? (s as PaymentSource) : undefined

export function autoSelectPaymentMethod(source?: string | null): string | null {
  if (!source) return null
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])
  if (methods.some((m) => m.id === source)) return source
  const ofType = methods.filter((m) => m.type === source)
  return ofType.length === 1 ? ofType[0].id : null
}

/** A transaction's effective source: its linked method's type wins over the parsed source. */
export function effectiveSource(t: Transaction, methods: PaymentMethod[]): PaymentSource | undefined {
  const m = t.paymentMethodId ? methods.find((x) => x.id === t.paymentMethodId) : undefined
  return m?.type ?? t.paymentSource
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()

const THREE_DAYS = 3 * 86400000

export function findDuplicate(list: Transaction[], t: NewTransaction & { timestamp: number }, dayLevel = false) {
  return list.find(
    (x) =>
      // the same bank reference is the same payment; two different references are two payments, whatever the amount
      (x.ref && t.ref ? x.ref === t.ref : (x.paymentAmount === t.paymentAmount &&
        x.paymentReceiver === t.paymentReceiver &&
        x.paymentType === t.paymentType &&
        (dayLevel ? sameDay(x.timestamp, t.timestamp) : x.timestamp === t.timestamp)) ||
      // An automatic entry (e.g. salary on payday) and the bank's SMS / screenshot for the same
      // money: same amount, direction and category within 3 days is one transaction.
      (!!x.recurringId !== !!t.recurringId &&
        x.paymentAmount === t.paymentAmount &&
        x.paymentType === t.paymentType &&
        // the bank files the salary as "Other income": money in of the same amount near payday is the same money
        (x.paymentCategory === t.paymentCategory || t.paymentType === 'CREDIT') &&
        Math.abs(x.timestamp - t.timestamp) <= THREE_DAYS)),
  )
}

export const getAll = () => read<Transaction[]>(KEYS.transactions, [])

/** Income gets an income source; money sent to a known family member is a Family transfer. */
export function normalizeCategory(t: Pick<NewTransaction, 'paymentType' | 'paymentCategory' | 'paymentReceiver' | 'note'>) {
  if (isTransferCategory(t.paymentCategory)) return t.paymentCategory
  if (t.paymentType === 'CREDIT') {
    return INCOME_CATEGORIES.includes(t.paymentCategory) ? t.paymentCategory : guessIncomeCategory(`${t.paymentReceiver} ${t.note ?? ''}`)
  }
  if ((!t.paymentCategory || t.paymentCategory === 'Others') && looksLikeFamilyTransfer(t.paymentReceiver)) return FAMILY
  return t.paymentCategory || 'Others'
}

/** User rules first (unless the user chose the category), then the built-in normalisation. */
function categoryFor(t: NewTransaction) {
  if (!t.manualCategory && !isTransferCategory(t.paymentCategory)) {
    const rule = matchRule(t)
    if (rule) { noteRuleHit(rule.id); return rule.category }
  }
  return normalizeCategory(t)
}

function build(t: NewTransaction): Transaction {
  const now = Date.now()
  const person = findPerson(t)
  const category = categoryFor(t)
  // official merchants carry their brand's name ("Zepto Marketplace Pr" is Zepto); people and refunds keep what was written
  const written = t.paymentReceiver.trim() || 'Expense'
  // a nameless label is never looked up: a name learned for it before this was fixed would land on unrelated payments
  const taught = GENERIC_PAYEE.test(written) ? undefined : read<Record<string, string>>(KEYS.payeeNames, {})[payeeNorm(written)]
  // a name the user gave this UPI id or number before: the bank gave none this time, so use it
  const known = t.payeeId && GENERIC_PAYEE.test(written) ? read<Record<string, string>>(KEYS.numberNames, {})[t.payeeId.toLowerCase()] : undefined
  // a payee written as a mobile number or its UPI id (9876543210@ybl) shows as the contact it belongs to
  const numberOnly = /^\s*(?:\+?91[\s-]?)?[6-9]\d{9}(?:@\S+)?\s*$/.test(written)
  const shownName = known ?? taught ?? (person && numberOnly ? person.name : t.paymentType === 'DEBIT' ? payeeLabel(written, category) : written)
  return {
    id: uid(),
    timestamp: t.timestamp ?? now,
    paymentAmount: Math.abs(t.paymentAmount),
    paymentType: t.paymentType,
    paymentReceiver: shownName,
    ...(shownName !== (t.paymentReceiver.trim() || 'Expense') ? { rawReceiver: t.paymentReceiver.trim() } : {}),
    paymentCategory: person?.familyId && !t.manualCategory && !isTransferCategory(category) ? FAMILY : category,
    paymentSource: normalizeSource(t.paymentSource),
    paymentMethodId: t.paymentMethodId ?? autoSelectPaymentMethod(t.paymentSource),
    ...(t.note?.trim() ? { note: t.note.trim() } : {}),
    ...(t.originalCurrency && t.originalAmount ? { originalAmount: t.originalAmount, originalCurrency: t.originalCurrency } : {}),
    ...(t.recurringId ? { recurringId: t.recurringId } : {}),
    ...(t.paymentApp ? { paymentApp: t.paymentApp } : {}),
    ...(t.autoCaptured ? { autoCaptured: true } : {}),
    ...(t.ref ? { ref: t.ref } : {}),
    ...(t.seenIn?.length ? { seenIn: t.seenIn } : {}),
    ...(t.payeeId ? { payeeId: t.payeeId } : {}),
    ...(t.timeUnknown ? { timeUnknown: true } : {}),
    ...(t.loanId ? { loanId: t.loanId } : {}),
    ...(person ? { contactId: person.id } : {}),
    // a payee the user said is a shop cost (stock, rent) stays one
    ...(t.paymentType === 'DEBIT' && read<string[]>(KEYS.businessPayees, []).includes(payeeNorm(written)) ? { business: true } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

/** Lowercased #hashtags found in a note. */
export const tagsOf = (note?: string) => [...new Set((note?.match(/#[\p{L}\p{N}_-]+/gu) ?? []).map((t) => t.toLowerCase()))]

/** Puts a deleted transaction back exactly as it was (for undo). */
export function restoreTransaction(t: Transaction) {
  const list = getAll()
  if (list.some((x) => x.id === t.id)) return
  takeFromTrash(t.id)
  logActivity('restored', t)
  write(KEYS.transactions, [t, ...list].sort((a, b) => b.timestamp - a.timestamp))
}

/* ---------- recurring rules ---------- */

export function advance(ts: number, cadence: RecurringCadence, anchorDay?: number) {
  const d = new Date(ts)
  if (cadence === 'WEEKLY') d.setDate(d.getDate() + 7)
  else if (cadence === 'MONTHLY') {
    const day = anchorDay ?? d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  } else {
    // yearly: same month next year, back on the anchor day where the month allows it (Feb 29 → Feb 28 → … → Feb 29)
    const month = d.getMonth(), day = anchorDay ?? d.getDate()
    d.setDate(1)
    d.setFullYear(d.getFullYear() + 1, month)
    d.setDate(Math.min(day, new Date(d.getFullYear(), month + 1, 0).getDate()))
  }
  return d.getTime()
}

/** Creates every entry whose time has come and moves each rule's nextAt forward. Returns how many were added. */
export function processRecurring(now = Date.now()) {
  const rules = read<RecurringRule[]>(KEYS.recurringRules, [])
  let added = 0
  let changed = false
  const next = rules.map((r) => {
    if (!r.enabled || r.nextAt > now) return r
    let at = r.nextAt
    const rows: NewTransaction[] = []
    while (at <= now && rows.length < 60) {
      rows.push({ ...r.template, timestamp: at, recurringId: r.id })
      at = advance(at, r.cadence, r.anchorDay)
    }
    added += addTransactionsBulk(rows).added
    changed = true
    return { ...r, nextAt: at }
  })
  if (changed) write(KEYS.recurringRules, next)
  return added
}

export function createRecurringRule(template: RecurringRule['template'], cadence: RecurringCadence, firstAt: number, anchorDay = new Date(firstAt).getDate()) {
  const rule: RecurringRule = { id: uid(), template, cadence, nextAt: firstAt, anchorDay, enabled: true, createdAt: Date.now() }
  write(KEYS.recurringRules, [...read<RecurringRule[]>(KEYS.recurringRules, []), rule])
  return rule
}

export function addTransaction(t: NewTransaction, opts: { allowDuplicate?: boolean } = {}): { added: boolean; duplicate?: boolean; id?: string } {
  const list = getAll()
  const full = build(t)
  if (!opts.allowDuplicate && findDuplicate(list, full)) return { added: false, duplicate: true }
  write(KEYS.transactions, [full, ...list])
  logActivity('added', full)
  applySavingsRules(full)
  settleHoldsWith(full)
  return { added: true, id: full.id }
}

/**
 * IPO / ASBA / UPI-mandate blocks and unblocks: money held and released, never spent
 * or received, so they are not transactions.
 */
export const BLOCK_EVENT =
  /\b(?:un-?)?block(?:ed|ing)?\b[\s\S]{0,100}\b(?:ipo|mandate|asba|upi|application|bid|funds?|amount)\b|\b(?:ipo|mandate|asba|application|bid|funds?|amount)\b[\s\S]{0,100}\b(?:un-?)?block(?:ed|ing)?\b|\basba\b|\bsbmd\b|\bmandate\s+(?:created|revoked|modified|paused|cancelled)\b|\bamount\s+(?:has\s+been\s+)?(?:reserved|released)\b|\bmandate\b[^.]{0,60}\brevoked\b|\blien\b[\s\S]{0,80}\b(?:marked|created|placed|set|released|removed|vacated|lifted|revoked|ipo|asba|mandate|upi|funds?|amount)\b|\b(?:marked|created|placed|released|removed|vacated|lifted)\b[\s\S]{0,30}\blien\b|\b(?:block|hold)\s+(?:released|removed|reversed)\b/i

export const isBlockEvent = (text?: string | null) => !!text && BLOCK_EVENT.test(text)

/**
 * A message that talks about money that has not arrived, or tries to sell something: "cashback will be credited within 7 days",
 * "earn up to ₹500", "7.5% interest on FD, apply now". These must never become income. A real credit says it happened.
 */
const FUTURE = new RegExp([
  String.raw`\b(?:under|subject\s+to|pending)\s+(?:cheque\s+)?clearing\b`,
  String.raw`\b(?:will|shall|to|may|could|can)\s+(?:be\s+)?(?:get\s+)?(?:credited|added|received|refunded|reversed|settled|processed|paid)\b`,
  String.raw`\b(?:expected|expect(?:ing)?)\b.{0,30}\b(?:credit|refund|cashback|interest)\b`,
  String.raw`\bwithin\s+\d+\s*(?:-\s*\d+\s*)?(?:working\s+|business\s+)?(?:days?|hours?|hrs?)\b`,
  String.raw`\b(?:in|after)\s+\d+\s*-\s*\d+\s*(?:working\s+|business\s+)?days?\b`,
].join('|'), 'i')
const PROMO = new RegExp([
  String.raw`\b(?:earn|get|win|avail|claim|unlock|grab|save|enjoy)\b[^.
]{0,45}\b(?:up\s?to|upto|flat|extra|assured|guaranteed|\d+\s?%|₹|rs\.?)`,
  String.raw`\b(?:offer|offers|t\s?&\s?c|terms\s+(?:and|&)\s+conditions|apply\s+now|click\s+(?:here|on|the)|tap\s+(?:here|to)|download|install|limited\s+period|hurry|coupon|promo(?:code)?|scratch\s*card|lucky|reward\s+points?|redeem|eligible|pre-?approved)\b`,
  String.raw`\b(?:interest\s+rate|rate\s+of\s+interest|p\.?\s?a\.?|per\s+annum)\b`,
  String.raw`\binterest\b[^.
]{0,40}\d+(?:\.\d+)?\s?%`,
  String.raw`\d+(?:\.\d+)?\s?%[^.
]{0,40}\b(?:interest|cashback|returns?)\b`,
].join('|'), 'i')
/** A real bank notice names a masked account and gives a reference or the balance, even when a sales line is tacked on the end. */
const LOOKS_REAL = /(?:a\/c|acct?|account)\s*(?:no\.?)?\s*[x*]*\d{3,}/i
const HAS_REF = /\b(?:utr|ref(?:erence)?\s*(?:no|id)?|upi\s*ref)\b.{0,20}\d{6,}|\bbal(?:ance)?\b|\bavl\.?\s*bal\b/i
export const PROMO_OR_FUTURE = FUTURE

/**
 * Cashback, rewards, scratch cards and vouchers. A UPI app's title can say "₹100 cashback received" while the text underneath says what you
 * can get, by doing something, before a date. So the whole message is read: it only counts as money received when nothing in it is conditional
 * AND it says the money reached an account or wallet (or carries a masked account with a reference or balance, like a real bank alert).
 * Anything else is an offer, or at least unconfirmed: the bank's own credit message adds the real entry when the money actually arrives.
 */
const CASHBACKISH = /\b(?:cash\s?-?back|rewards?|scratch\s*card|gift\s*(?:card|voucher)|voucher|coupon|bonus)\b/i
const CONDITIONAL = new RegExp([
  String.raw`\byou\s+(?:can|could|may|will|'ll)\b`,
  String.raw`\b(?:can|could|may)\s+(?:get|earn|win|claim|use|avail|redeem|unlock)\b`,
  String.raw`\b(?:to|and)\s+(?:get|claim|win|earn|unlock|redeem|avail)\b`,
  String.raw`\b(?:if|when|once|after)\s+you\b`,
  String.raw`\bon\s+(?:your\s+)?(?:next|first|every|each)\b`,
  String.raw`\bby\s+(?:sending|paying|inviting|referring|completing|making|adding|using|spending)\b`,
  String.raw`\b(?:valid|expires?|expiry|offer\s+ends|ends\s+(?:on|today|soon)|before\s+\d)\b`,
  String.raw`\b(?:minimum|min\.?)\s+(?:order|spend|transaction|payment|purchase|amount)\b`,
  String.raw`\b(?:refer|referral|invite|friends?|complete|task|spin|lucky|unlock|claim|redeem|apply|scratch|collect|check\s+(?:your\s+)?(?:offers?|scratch))\b`,
].join('|'), 'i')
const CREDIT_CONFIRMED = /\b(?:credited|added|deposited|transferred)\b[^.\n]{0,60}\b(?:account|a\/c|acct|wallet|balance|bank|upi\s*lite|passbook)\b|\b(?:account|a\/c|acct|wallet|bank)\b[^.\n]{0,40}\b(?:credited|added|deposited)\b/i
/** Past-tense wording of money that came to you (what a UPI app says about a cashback it just gave). */
const RECEIVED_WORDS = /\b(?:received|credited|added|earned|deposited|rewarded)\b/i
/**
 * From a UPI app itself (GPay, PhonePe, Paytm, CRED…) the cashback often has no bank SMS and no bank credit at all, so the app's own
 * notification is the only record. There, "received / credited / earned" with nothing conditional in the whole text is enough.
 * From anywhere else (a bank SMS, pasted text) the message must also say where the money went.
 */
export const isUnconfirmedCashback = (text?: string | null, fromApp = false) => {
  if (!text || !CASHBACKISH.test(text)) return false
  if (CONDITIONAL.test(text)) return true
  if (fromApp && RECEIVED_WORDS.test(text)) return false
  return !(CREDIT_CONFIRMED.test(text) || (LOOKS_REAL.test(text) && HAS_REF.test(text)))
}

/**
 * "₹100 credited in your Zepto Cash / JioMart wallet", "₹50 added to your Bewakoof wallet": a shop putting store credit in its own wallet to
 * make you order again. It is not money you received, and it can only be spent in that shop, so it is never income. (A top-up of a payment
 * wallet from your bank shows up as the bank debit; a refund to a wallet is not new income either.) Only a clean cashback notice from a
 * payment app is let through (see isUnconfirmedCashback); wording about using, redeeming or ordering makes it a promotion even there.
 */
const WALLET_CREDIT = /\b(?:credited|added|received|loaded|reloaded|topped\s*up)\b[^.\n]{0,60}\b(?:wallet|credits?|points?|coins?|balance)\b|\b(?:wallet|credits?|coins?)\b[^.\n]{0,40}\b(?:credited|added)\b/i
const BANK_EVIDENCE = /\b(?:a\/c|acct?|account|bank|utr|ref(?:erence)?\s*(?:no|id)?|upi\s*ref)\b/i
const USAGE_WORDS = /\b(?:use|usable|redeem|applicable|next\s+order|your\s+order|orders?\s+(?:above|over|worth)|valid|expires?|bonus|promo(?:tional)?|offer|shopping|only\s+on|to\s+spend|spend\s+it|on\s+(?:your\s+)?(?:next|first))\b/i
/** Money that only exists inside an app: coins, points, gift cards, wallets, "Swiggy Money", "Amazon Pay balance". */
const STORE_MONEY = /\b(?:super\s?coins?|coins?|reward\s+points|points|gift\s?card|wallet|(?:swiggy|zomato|ola|uber|airtel)\s+money|(?:amazon\s+pay|paytm|phonepe|mobikwik|freecharge)\s+(?:balance|cash))\b/i
const MONEY_IN = /\b(?:credited|added|received|loaded|reloaded|topped\s*up|earned|won|refund(?:ed)?|cashback)\b/i
/** A real bank account named in the message ("a/c XX1045", "UCO Bank - 6469"): then the money did reach the bank. */
const REAL_ACCOUNT = /\ba\/c\b|\bacc(?:oun)?t\s*(?:no\.?\s*)?[x*•]+\s?\d{3,}|\bxx\d{3,}|\bbank\s*[-–]\s*\d{3,}|\butr\b|\bupi\s*ref/i

export const isStoreWalletCredit = (text?: string | null, fromPayApp = false) =>
  !!text && !REAL_ACCOUNT.test(text) && (
    // cashback, refunds and rewards into a wallet, coins or points are store credit, not money in the bank, from any app
    (STORE_MONEY.test(text) && MONEY_IN.test(text))
    || (WALLET_CREDIT.test(text) && !BANK_EVIDENCE.test(text) && (!fromPayApp || CONDITIONAL.test(text) || USAGE_WORDS.test(text))))

export const isPromoOrFuture = (text?: string | null, fromApp = false, fromPayApp = fromApp) => !!text && (FUTURE.test(text) || isUnconfirmedCashback(text, fromApp) || isStoreWalletCredit(text, fromPayApp) || (PROMO.test(text) && !(LOOKS_REAL.test(text) && HAS_REF.test(text))))

const SAME_TIME = 15 * 60000

/**
 * The same money already recorded from another source (a Paytm receipt vs the bank
 * statement vs an SMS): same amount and direction at the same time, within 15
 * minutes, or the same day when either side only knows the date. Never across two
 * different accounts. `used` stops one saved entry from matching two incoming ones.
 */
export function findSameMoney(list: Transaction[], t: Pick<Transaction, 'paymentAmount' | 'paymentType' | 'timestamp'> & Partial<Pick<Transaction, 'paymentMethodId' | 'timeUnknown'>>, used?: Set<string>) {
  return list.find((x) => {
    if (used?.has(x.id)) return false
    const tr = (t as { ref?: string }).ref
    if (x.ref && tr) return x.ref === tr
    if (Math.abs(x.paymentAmount - t.paymentAmount) > 0.005 || x.paymentType !== t.paymentType) return false
    if (x.paymentMethodId && t.paymentMethodId && x.paymentMethodId !== t.paymentMethodId) return false
    return x.timeUnknown || t.timeUnknown ? sameDay(x.timestamp, t.timestamp) : Math.abs(x.timestamp - t.timestamp) <= SAME_TIME
  })
}

/**
 * Imports many rows (statements, screenshots). Rows already in the app are skipped,
 * and the saved entry picks up what the import knew that it didn't (account, UPI app).
 */
export function addTransactionsBulk(rows: NewTransaction[]) {
  const list = getAll()
  let added = 0
  let skipped = 0
  let blocked = 0
  const fresh: Transaction[] = []
  const used = new Set<string>()
  const patches = new Map<string, Partial<Transaction>>()
  /** What happened to each row, in order. */
  const outcome: ('added' | 'skipped' | 'held')[] = []
  for (const r of rows) {
    if (isBlockEvent(`${r.paymentReceiver} ${r.note ?? ''}`)) { blocked++; outcome.push('held'); continue }
    const full = build(r)
    // within one import, two date-only rows of the same amount can be two real payments (two chais)
    const same = (full.timeUnknown ? undefined : findDuplicate(fresh, full)) ?? findDuplicate(list, full) ?? findSameMoney(list, full, used)
    if (same) {
      skipped++
      used.add(same.id)
      const patch: Partial<Transaction> = { ...patches.get(same.id) }
      if (!same.paymentMethodId && full.paymentMethodId) patch.paymentMethodId = full.paymentMethodId
      if (!same.paymentApp && full.paymentApp) patch.paymentApp = full.paymentApp
      if (same.timeUnknown && !full.timeUnknown) { patch.timestamp = full.timestamp; patch.timeUnknown = undefined }
      if (Object.keys(patch).length) patches.set(same.id, patch)
      outcome.push('skipped')
      continue
    }
    fresh.push(full); added++; outcome.push('added')
  }
  if (fresh.length || patches.size) {
    const now = Date.now()
    write(KEYS.transactions, [...fresh, ...list.map((t) => (patches.has(t.id) ? { ...t, ...patches.get(t.id), updatedAt: now } : t))])
    fresh.forEach(applySavingsRules)
    fresh.forEach(settleHoldsWith)
  }
  return { added, skipped, blocked, rows: fresh, outcome }
}

export function updateTransaction(id: string, patch: Partial<Transaction>) {
  const before = getAll().find((t) => t.id === id)
  write(KEYS.transactions, getAll().map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)))
  // marking something reviewed is bookkeeping, not an edit worth listing
  if (before && Object.keys(patch).some((k) => k !== 'reviewed')) logActivity('edited', { ...before, ...patch }, before)
}

/** Marks a payment as a shop cost (or not). The same payee's other payments follow, and so will new ones. Returns how many changed. */
export function setBusinessExpense(id: string, on: boolean) {
  const all = getAll()
  const tx = all.find((t) => t.id === id)
  if (!tx) return 0
  const key = payeeNorm(tx.rawReceiver ?? tx.paymentReceiver)
  const same = (t: Transaction) => t.paymentType === 'DEBIT' && payeeNorm(t.rawReceiver ?? t.paymentReceiver) === key
  const list = read<string[]>(KEYS.businessPayees, [])
  write(KEYS.businessPayees, on ? [...new Set([...list, key])] : list.filter((k) => k !== key))
  let n = 0
  write(KEYS.transactions, all.map((t) => {
    if (!same(t) || !!t.business === on) return t
    n++
    return { ...t, business: on ? true : undefined, updatedAt: Date.now() }
  }))
  return n
}

export function deleteTransaction(id: string) {
  const tx = getAll().find((t) => t.id === id)
  if (tx) { moveToTrash(tx); logActivity('deleted', tx) }
  write(KEYS.transactions, getAll().filter((t) => t.id !== id))
}

/** receiver → category from the 20 most recently updated transactions; helps the AI reuse past choices. */
export function buildVendorCategoryMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const t of [...getAll()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (Object.keys(map).length >= 20) break
    if (!(t.paymentReceiver in map)) map[t.paymentReceiver] = t.paymentCategory
  }
  return map
}
