// Search written like a sentence: "swiggy last month", "over ₹500 on travel", "income this year".
// It works on the device, with no AI: dates, amounts, a category and expense/income are picked out of the words,
// and whatever is left is searched as plain text.

export interface SearchIntent {
  /** What is left to search for as text. */
  text: string
  from?: string
  to?: string
  min?: number
  max?: number
  categories: string[]
  type?: 'DEBIT' | 'CREDIT'
  /** Short phrases for what was understood, shown under the search box. */
  labels: string[]
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const rupee = (n: number) => `₹${n.toLocaleString('en-IN')}`
const FILLER = new Set(['on', 'for', 'at', 'from', 'in', 'my', 'the', 'a', 'an', 'of', 'to', 'show', 'me', 'all', 'spent', 'spend', 'paid', 'pay', 'payments', 'payment', 'transactions', 'transaction', 'than', 'with', 'during', 'by'])
const CATEGORY_WORDS: Record<string, string[]> = {
  Food: ['food', 'eating', 'dining', 'restaurant', 'restaurants', 'meals', 'lunch', 'dinner', 'breakfast'],
  Travel: ['travel', 'trip', 'trips', 'transport', 'commute', 'cab', 'cabs', 'fuel', 'petrol'],
  Shopping: ['shopping', 'clothes', 'clothing'],
  Groceries: ['groceries', 'grocery', 'vegetables'],
  Entertainment: ['entertainment', 'movies', 'movie', 'ott'],
  Bills: ['bills', 'bill', 'utilities'],
  Health: ['health', 'medical', 'medicine', 'medicines', 'doctor'],
  Fitness: ['fitness', 'gym'],
  Rent: ['rent'],
}

const amountOf = (s: string): number => {
  const m = s.replace(/[,₹]|rs\.?|inr/gi, '').trim().match(/^(\d+(?:\.\d+)?)\s*(k|l|lakh|lakhs|cr)?$/i)
  if (!m) return NaN
  const mult = !m[2] ? 1 : /^k$/i.test(m[2]) ? 1000 : /^cr$/i.test(m[2]) ? 10000000 : 100000
  return Number(m[1]) * mult
}
const AMT = String.raw`(?:₹|rs\.?\s*|inr\s*)?\d[\d,]*(?:\.\d+)?\s*(?:k|lakhs?|l|cr)?`

export function parseSearch(query: string, categories: string[] = [], now: Date = new Date()): SearchIntent {
  let q = ` ${query.toLowerCase().replace(/\s+/g, ' ').trim()} `
  const out: SearchIntent = { text: '', categories: [], labels: [] }
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => { const m = q.match(re); if (m) { f(m); q = q.replace(re, ' ') } }
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const range = (a: Date, b: Date, label: string) => { out.from = iso(a); out.to = iso(b); out.labels.push(label) }

  // amounts
  take(new RegExp(String.raw` between (${AMT}) (?:and|to|-) (${AMT}) `), (m) => { const a = amountOf(m[1]), b = amountOf(m[2]); if (a >= 0 && b >= 0) { out.min = Math.min(a, b); out.max = Math.max(a, b); out.labels.push(`${rupee(out.min)} – ${rupee(out.max)}`) } })
  take(new RegExp(String.raw` (?:over|above|more than|greater than|bigger than|at least|>=?|exceeding|min(?:imum)?) (${AMT}) `), (m) => { const a = amountOf(m[1]); if (a >= 0) { out.min = a; out.labels.push(`Over ${rupee(a)}`) } })
  take(new RegExp(String.raw` (?:under|below|less than|lower than|cheaper than|at most|<=?|max(?:imum)?|within) (${AMT}) `), (m) => { const a = amountOf(m[1]); if (a >= 0) { out.max = a; out.labels.push(`Under ${rupee(a)}`) } })

  // dates
  const y = now.getFullYear(), mo = now.getMonth()
  take(/ last (\d+) days? /, (m) => range(day(-Number(m[1])), day(0), `Last ${m[1]} days`))
  take(/ (?:past|last) week /, () => range(day(-7), day(0), 'Last 7 days'))
  take(/ (?:past|last) month /, () => range(new Date(y, mo - 1, 1), new Date(y, mo, 0), 'Last month'))
  take(/ last year /, () => range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31), `${y - 1}`))
  take(/ this week /, () => { const d = now.getDay() || 7; range(day(1 - d), day(0), 'This week') })
  take(/ this month /, () => range(new Date(y, mo, 1), new Date(y, mo + 1, 0), 'This month'))
  take(/ this year /, () => range(new Date(y, 0, 1), day(0), `${y}`))
  take(/ yesterday /, () => range(day(-1), day(-1), 'Yesterday'))
  take(/ today /, () => range(day(0), day(0), 'Today'))
  take(new RegExp(String.raw` (?:in |during |of )?(${MONTHS.join('|')})[a-z]*(?:\s+(20\d\d))? `), (m) => {
    const mi = MONTHS.indexOf(m[1]); const yr = m[2] ? Number(m[2]) : mi > mo ? y - 1 : y
    range(new Date(yr, mi, 1), new Date(yr, mi + 1, 0), `${m[1][0].toUpperCase()}${m[1].slice(1)} ${yr}`)
  })

  // income or expenses
  take(/ (?:income|earnings?|salary|received|credited|credits?|refunds?) /, () => { out.type = 'CREDIT'; out.labels.push('Income') })
  if (!out.type) take(/ (?:expenses?|spending|debited|debits?) /, () => { out.type = 'DEBIT'; out.labels.push('Expenses') })

  // a category, by its own name or a word that means it
  const words = q.trim().split(' ').filter(Boolean)
  const rest: string[] = []
  for (const w of words) {
    const direct = categories.find((c) => c.toLowerCase() === w)
    const alias = Object.entries(CATEGORY_WORDS).find(([, ws]) => ws.includes(w))?.[0]
    const cat = direct ?? (alias ? categories.find((c) => c.toLowerCase() === alias.toLowerCase()) : undefined)
    if (cat && !out.categories.includes(cat)) { out.categories.push(cat); out.labels.push(cat) } else if (!FILLER.has(w)) rest.push(w)
  }
  out.text = rest.join(' ')
  return out
}

/** True when the words did more than name a payee, so the search should say what it understood. */
export const understood = (i: SearchIntent) => i.labels.length > 0
