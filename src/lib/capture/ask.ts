// "Ask your money": questions about your own data, in plain words.
// Common questions are answered instantly and exactly on the phone; anything else
// goes to Gemini Nano (on-device) or Gemini cloud with a compact summary of the data.
import { read, KEYS } from '../core/storage'
import { aiReady, askGemini } from './ai'
import { formatPrice, getCurrency, monthShort } from '../core/format'
import { getCategories } from '../core/data'
import { accountBalance, isTransferCategory, tracksBalance, UPI_APPS } from '../accounts/accounts'
import { FAMILY, getFamily, INCOME_CATEGORIES, isIncome, plannedIncome, spendable, committedCategories, isPersonalSpend } from '../core/money'
import { netWorth } from '../invest/invest'
import { loanTotals, outstanding, getLoans } from '../payees/loans'
import { expectedItems } from '../plan/calendar'
import { Capture, isNativeApp } from '../core/native'
import type { EmiPlan, Investment, PaymentMethod, Transaction } from '../core/types'

export interface Answer { text: string; source: 'on-device' | 'gemini-nano' | 'gemini' | 'none' }

/* ---------- periods ---------- */

interface Period { start: number; end: number; label: string }
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function parsePeriod(q: string, now = new Date()): Period | null {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const day = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd).getTime()
  const s = q.toLowerCase()
  if (/\btoday\b/.test(s)) return { start: day(y, m, d), end: day(y, m, d + 1), label: 'today' }
  if (/\byesterday\b/.test(s)) return { start: day(y, m, d - 1), end: day(y, m, d), label: 'yesterday' }
  if (/\bthis week\b/.test(s)) return { start: day(y, m, d - now.getDay()), end: day(y, m, d + 1), label: 'this week' }
  if (/\blast week\b/.test(s)) return { start: day(y, m, d - now.getDay() - 7), end: day(y, m, d - now.getDay()), label: 'last week' }
  if (/\blast month\b/.test(s)) return { start: day(y, m - 1, 1), end: day(y, m, 1), label: `in ${monthShort((m + 11) % 12)}` }
  if (/\b(this|current) month\b/.test(s)) return { start: day(y, m, 1), end: day(y, m + 1, 1), label: 'this month' }
  if (/\blast year\b/.test(s)) return { start: day(y - 1, 0, 1), end: day(y, 0, 1), label: `in ${y - 1}` }
  if (/\b(this year|so far this year|ytd)\b/.test(s)) return { start: day(y, 0, 1), end: day(y + 1, 0, 1), label: 'this year' }
  const lastN = s.match(/\b(?:last|past)\s+(\d{1,3})\s+(day|week|month)s?\b/)
  if (lastN) {
    const n = Number(lastN[1])
    const start = lastN[2] === 'day' ? day(y, m, d - n + 1) : lastN[2] === 'week' ? day(y, m, d - 7 * n + 1) : day(y, m - n + 1, 1)
    return { start, end: day(y, m, d + 1), label: `in the last ${n} ${lastN[2]}${n === 1 ? '' : 's'}` }
  }
  const mon = s.match(/\b(?:in\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/)
  if (mon) {
    const mi = MONTHS.indexOf(mon[1].slice(0, 3))
    const yy = mon[2] ? Number(mon[2]) : mi > m ? y - 1 : y
    return { start: day(yy, mi, 1), end: day(yy, mi + 1, 1), label: `in ${monthShort(mi)}${yy !== y ? ` ${yy}` : ''}` }
  }
  return null
}

/* ---------- local answers ---------- */

const fmt = (n: number) => formatPrice(n, { round: true })
const has = (s: string, w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)

/** Finds what the question is about: a family member, category, app, account, or a payee seen before. */
function findTarget(q: string, txns: Transaction[]) {
  const s = q.toLowerCase()
  const member = getFamily().find((f) => has(s, f.name) || (f.relation && has(s, f.relation)))
  if (member) return { kind: 'person' as const, name: member.name, aliases: [member.name, member.relation ?? ''].filter(Boolean) }
  const relWord = s.match(/\b(mom|mum|mummy|mother|maa|dad|papa|father|brother|bhai|sister|didi|wife|husband|parents)\b/)?.[1]
  if (relWord) return { kind: 'person' as const, name: relWord, aliases: [relWord] }
  if (/\bfamily\b/.test(s)) return { kind: 'category' as const, name: FAMILY }
  const cat = [...getCategories(), ...INCOME_CATEGORIES].find((c) => has(s, c) || has(s, c.replace(/s$/, '')))
  if (cat) return { kind: 'category' as const, name: cat }
  const app = UPI_APPS.find((a) => has(s, a) || has(s, a.replace(/\s/g, '')))
  if (app && app !== 'Other') return { kind: 'app' as const, name: app }
  const acc = read<PaymentMethod[]>(KEYS.paymentMethods, []).find((p) => has(s, p.name) || (p.bank && has(s, p.bank)))
  if (acc) return { kind: 'account' as const, name: acc.name, id: acc.id }
  const payees = [...new Set(txns.map((t) => t.paymentReceiver))].sort((a, b) => b.length - a.length)
  const payee = payees.find((p) => p.length >= 3 && has(s, p))
  if (payee) return { kind: 'payee' as const, name: payee }
  return null
}

function matchesTarget(t: Transaction, target: NonNullable<ReturnType<typeof findTarget>>) {
  switch (target.kind) {
    case 'person': return target.aliases.some((a) => t.paymentReceiver.toLowerCase().includes(a.toLowerCase()))
    case 'category': return t.paymentCategory === target.name
    case 'app': return t.paymentApp === target.name
    case 'account': return t.paymentMethodId === target.id
    case 'payee': return t.paymentReceiver === target.name
  }
}

export function answerLocally(question: string, now = new Date()): string | null {
  const q = question.trim()
  const s = q.toLowerCase()
  const txns = read<Transaction[]>(KEYS.transactions, [])
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])

  // balances
  if (/\bbalance\b|how much (money )?(do i have|is (there )?in|left in)/.test(s)) {
    const banks = methods.filter(tracksBalance)
    if (!banks.length) return 'Add your bank accounts with their balance in Planner → Accounts & cards, and I can tell you what\'s in each.'
    const one = banks.find((b) => has(s, b.name) || (b.bank && has(s, b.bank)))
    if (one) return `${one.name} has ${fmt(accountBalance(one, txns))}.`
    const lines = banks.map((b) => `${b.name}: ${fmt(accountBalance(b, txns))}`)
    return `You have ${fmt(banks.reduce((a, b) => a + accountBalance(b, txns), 0))} across your accounts — ${lines.join(', ')}.`
  }

  if (/net ?worth|how rich|total wealth/.test(s)) {
    const nw = netWorth(methods, txns, read<Investment[]>(KEYS.investments, []), read<EmiPlan[]>(KEYS.emiPlans, []))
    return `Your net worth is ${fmt(nw.total)}: ${fmt(nw.accounts)} in bank, ${fmt(nw.invest)} invested${nw.owedToYou ? `, ${fmt(nw.owedToYou)} owed to you` : ''}, minus ${fmt(nw.liabilities)} in dues.`
  }

  if (/who owes|owe(s)? me|do i owe|i owe|pending loans?/.test(s)) {
    const open = getLoans().filter((l) => outstanding(l) > 0)
    if (!open.length) return 'No open loans — nobody owes you and you owe nobody (outside bill splits).'
    const lent = open.filter((l) => l.direction === 'LENT').map((l) => `${l.person} ${fmt(outstanding(l))}`)
    const borrowed = open.filter((l) => l.direction === 'BORROWED').map((l) => `${l.person} ${fmt(outstanding(l))}`)
    const t = loanTotals()
    return [lent.length ? `Owed to you: ${fmt(t.owedToYou)} (${lent.join(', ')}).` : '', borrowed.length ? `You owe: ${fmt(t.youOwe)} (${borrowed.join(', ')}).` : ''].filter(Boolean).join(' ')
  }

  // can I afford X
  const afford = s.match(/(?:afford|can i (?:buy|spend|get|pay))[^0-9₹]*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:k|000)?)/)
  if (afford) {
    let amt = Number(afford[1].replace(/,/g, '').replace(/k$/, '000'))
    if (/\d+k\b/.test(afford[1])) amt = Number(afford[1].replace(/k/, '')) * 1000
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const committed = committedCategories()
    const spent = txns.filter((t) => t.timestamp >= start && isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)
    const budget = read<number>(KEYS.monthlyBudget, 0) || spendable()
    const upcoming = expectedItems(now.getFullYear(), now.getMonth()).filter((i) => !i.done && i.flow === 'out' && i.date >= now.getTime() && i.kind !== 'commitment').reduce((a, i) => a + i.amount, 0)
    const free = budget - spent - upcoming
    if (!budget) return 'Set your monthly income (or a budget) first, and I can check what you can afford.'
    return free >= amt
      ? `Yes — after ${fmt(spent)} spent and ${fmt(upcoming)} of bills still due, you have about ${fmt(free)} free this month, so ${fmt(amt)} fits with ${fmt(free - amt)} to spare.`
      : `Not comfortably this month — you have about ${fmt(Math.max(0, free))} free after ${fmt(spent)} spent and ${fmt(upcoming)} of bills still due. You'd be ${fmt(amt - Math.max(0, free))} short.`
  }

  const period = parsePeriod(q, now) ?? { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(), label: 'this month' }
  const inPeriod = txns.filter((t) => t.timestamp >= period.start && t.timestamp < period.end)
  const target = findTarget(q, txns)

  // income / money received
  if (/\b(earn(ed)?|income|received|got|credited|came in|made)\b/.test(s) && !/\bspen[dt]\b/.test(s)) {
    const rows = inPeriod.filter((t) => isIncome(t) && (!target || matchesTarget(t, target)))
    if (!rows.length) return `Nothing received ${target ? `from ${target.name} ` : ''}${period.label}.`
    const total = rows.reduce((a, t) => a + t.paymentAmount, 0)
    const by = new Map<string, number>()
    rows.forEach((t) => by.set(t.paymentCategory, (by.get(t.paymentCategory) ?? 0) + t.paymentAmount))
    const split = by.size > 1 ? ` — ${[...by].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${fmt(v)}`).join(', ')}` : ''
    return `You received ${fmt(total)} ${target ? `from ${target.name} ` : ''}${period.label}${split}.`
  }

  // biggest expenses
  if (/\b(biggest|largest|top|most expensive|highest)\b/.test(s)) {
    const debits = inPeriod.filter((t) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory))
    if (!debits.length) return `No spending ${period.label}.`
    if (/categor/.test(s)) {
      const by = new Map<string, number>()
      debits.forEach((t) => by.set(t.paymentCategory, (by.get(t.paymentCategory) ?? 0) + t.paymentAmount))
      return `Top categories ${period.label}: ${[...by].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `${c} ${fmt(v)}`).join(', ')}.`
    }
    return `Biggest expenses ${period.label}: ${[...debits].sort((a, b) => b.paymentAmount - a.paymentAmount).slice(0, 5).map((t) => `${t.paymentReceiver} ${fmt(t.paymentAmount)}`).join(', ')}.`
  }

  // average per day
  if (/\b(average|per day|daily|a day)\b/.test(s)) {
    const committed = committedCategories()
    const total = inPeriod.filter((t) => isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)
    const days = Math.max(1, Math.ceil((Math.min(period.end, now.getTime()) - period.start) / 86400000))
    return `You spend about ${fmt(total / days)} a day ${period.label} (${fmt(total)} over ${days} day${days === 1 ? '' : 's'}).`
  }

  // spending / sent (default intent)
  if (/\b(how much|spen[dt]|sent|send|paid|pay|cost|total)\b/.test(s)) {
    const committed = committedCategories()
    const rows = inPeriod.filter((t) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory) && (target ? matchesTarget(t, target) : isPersonalSpend(t, committed)))
    const total = rows.reduce((a, t) => a + t.paymentAmount, 0)
    if (!rows.length) return `Nothing ${target?.kind === 'person' ? `sent to ${target.name}` : `spent${target ? ` on ${target.name}` : ''}`} ${period.label}.`
    const biggest = [...rows].sort((a, b) => b.paymentAmount - a.paymentAmount)[0]
    const what = target?.kind === 'person' ? `sent ${target.name}` : target?.kind === 'app' ? `paid via ${target.name}` : target?.kind === 'account' ? `spent from ${target.name}` : target ? `spent on ${target.name}` : 'spent'
    return `You ${what} ${fmt(total)} ${period.label} across ${rows.length} transaction${rows.length === 1 ? '' : 's'}${rows.length > 1 ? ` — the biggest was ${biggest.paymentReceiver} ${fmt(biggest.paymentAmount)}` : ''}.`
  }
  return null
}

/* ---------- AI fallback ---------- */

/** A compact, numbers-only summary of the user's finances for the model. */
export function dataSummary(compact = false, now = new Date()) {
  const txns = read<Transaction[]>(KEYS.transactions, [])
  const months = compact ? 2 : 6
  const byMonth = Array.from({ length: months }, (_, i) => {
    const s = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime(), e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime()
    const rows = txns.filter((t) => t.timestamp >= s && t.timestamp < e)
    const cats: Record<string, number> = {}
    rows.filter((t) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory)).forEach((t) => { cats[t.paymentCategory] = Math.round((cats[t.paymentCategory] ?? 0) + t.paymentAmount) })
    const income: Record<string, number> = {}
    rows.filter(isIncome).forEach((t) => { income[t.paymentCategory] = Math.round((income[t.paymentCategory] ?? 0) + t.paymentAmount) })
    return { month: `${monthShort(new Date(s).getMonth())} ${new Date(s).getFullYear()}`, spendByCategory: cats, incomeBySource: income }
  })
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])
  const recent = compact ? [] : txns.slice(0, 80).map((t) => [new Date(t.timestamp).toISOString().slice(0, 10), t.paymentType === 'DEBIT' ? -t.paymentAmount : t.paymentAmount, t.paymentReceiver, t.paymentCategory, t.paymentApp ?? ''])
  return {
    currency: getCurrency(), today: now.toDateString(), monthlyIncome: plannedIncome(), spendablePerMonth: spendable(), budget: read<number>(KEYS.monthlyBudget, 0) || null,
    accounts: methods.filter(tracksBalance).map((m) => ({ name: m.name, balance: Math.round(accountBalance(m, txns)) })),
    family: getFamily().map((f) => f.relation ? `${f.name} (${f.relation})` : f.name),
    loans: getLoans().filter((l) => outstanding(l) > 0).map((l) => ({ person: l.person, direction: l.direction, outstanding: outstanding(l) })),
    upcomingThisMonth: expectedItems(now.getFullYear(), now.getMonth()).filter((i) => !i.done && i.date >= now.getTime() && i.amount > 0).map((i) => ({ date: new Date(i.date).toISOString().slice(0, 10), what: i.title, amount: i.amount, flow: i.flow })),
    months: byMonth,
    recentTransactions: recent,
  }
}

function prompt(question: string, compact: boolean) {
  return [
    'You are a friendly personal-finance assistant inside an expense tracker. Answer the user\'s question using ONLY the data below.',
    'Be concise (2-4 sentences), give exact amounts in the user\'s currency, and say plainly if the data doesn\'t contain the answer. Give practical advice when asked.',
    `DATA: ${JSON.stringify(dataSummary(compact))}`,
    `QUESTION: ${question}`,
  ].join('\n')
}

export async function ask(question: string): Promise<Answer> {
  const local = answerLocally(question)
  if (local) return { text: local, source: 'on-device' }
  if (isNativeApp()) {
    try {
      const status = (await Capture.nanoStatus()).status
      if (status === 'available') {
        const { text } = await Capture.nanoGenerate({ prompt: prompt(question, true) })
        if (text.trim()) return { text: text.trim(), source: 'gemini-nano' }
      }
    } catch { /* fall through */ }
  }
  if (aiReady()) {
    try {
      const text = await askGemini(prompt(question, false))
      if (text) return { text, source: 'gemini' }
    } catch { /* fall through */ }
  }
  return { text: 'I can answer questions like "How much did I send Mom this year?", "Food spend last month", "Can I afford ₹30,000 this month?", "Who owes me money?" or "What\'s my balance?". For open-ended questions, turn on Gemini in Settings → AI.', source: 'none' }
}
