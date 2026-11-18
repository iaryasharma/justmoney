// Plain-language readings of your own spending: why a month changed, your habits, your best months, price creep.
// Everything compares you with yourself; nothing here uses anyone else's data.
import { isTransferCategory } from '../accounts/accounts'
import { formatPrice } from '../core/format'
import { getCategories } from '../core/data'
import { isPersonalSpend } from '../core/money'
import { payeeKey, payeeLabel } from '../payees/payee'
import type { Transaction } from '../core/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const inMonth = (t: Transaction, y: number, m: number) => { const d = new Date(t.timestamp); return d.getFullYear() === y && d.getMonth() === m }
const sum = (xs: Transaction[]) => xs.reduce((a, t) => a + t.paymentAmount, 0)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const money = (n: number) => formatPrice(n, { round: true })
/** A category as the rest of the app shows it: unknown ones count as Others. */
const catName = (t: Transaction, cats = getCategories()) => (cats.includes(t.paymentCategory) ? t.paymentCategory : 'Others')

export interface Reading { title: string; body: string; tone?: 'up' | 'down' | 'neutral' }

/** Why this month's spending is higher or lower than last month's. */
export function explainChange(all: Transaction[], committed: Set<string>, year: number, month: number): { now: number; before: number; diff: number; reasons: string[] } {
  const prevD = new Date(year, month - 1, 1)
  const spend = (y: number, m: number) => all.filter((t) => inMonth(t, y, m) && isPersonalSpend(t, committed))
  const cur = spend(year, month), prev = spend(prevD.getFullYear(), prevD.getMonth())
  const now = sum(cur), before = sum(prev), diff = now - before
  const reasons: string[] = []
  if (!cur.length || !prev.length) return { now, before, diff, reasons }

  const byCat = (xs: Transaction[]) => xs.reduce<Record<string, number>>((m, t) => ({ ...m, [catName(t)]: (m[catName(t)] ?? 0) + t.paymentAmount }), {})
  const a = byCat(cur), b = byCat(prev)
  const moves = [...new Set([...Object.keys(a), ...Object.keys(b)])].map((c) => ({ c, d: (a[c] ?? 0) - (b[c] ?? 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
  for (const m of moves.slice(0, 2)) if (Math.abs(m.d) >= Math.max(300, Math.abs(diff) * 0.15)) reasons.push(`${m.c} ${m.d > 0 ? 'went up' : 'came down'} by ${money(Math.abs(m.d))}.`)

  const seen = new Set(all.filter((t) => t.timestamp < new Date(year, month, 1).getTime() && isPersonalSpend(t, committed)).map((t) => payeeKey(t.paymentReceiver, t.paymentCategory)))
  const fresh = new Map<string, { label: string; total: number }>()
  for (const t of cur) {
    const k = payeeKey(t.paymentReceiver, t.paymentCategory)
    if (seen.has(k)) continue
    const e = fresh.get(k) ?? { label: payeeLabel(t.paymentReceiver, t.paymentCategory), total: 0 }
    e.total += t.paymentAmount; fresh.set(k, e)
  }
  const newTotal = [...fresh.values()].reduce((x, e) => x + e.total, 0)
  if (fresh.size && newTotal >= 500) reasons.push(`${fresh.size} new payee${fresh.size === 1 ? '' : 's'} took ${money(newTotal)} (${[...fresh.values()].sort((x, y) => y.total - x.total).slice(0, 2).map((e) => e.label).join(', ')}).`)

  const typical = median(prev.map((t) => t.paymentAmount))
  const big = [...cur].sort((x, y) => y.paymentAmount - x.paymentAmount)[0]
  if (big && big.paymentAmount > Math.max(2000, typical * 8) && big.paymentAmount >= Math.abs(diff) * 0.3) reasons.push(`One payment of ${money(big.paymentAmount)} to ${payeeLabel(big.paymentReceiver, big.paymentCategory)} stands out.`)

  const dd = cur.length - prev.length
  if (Math.abs(dd) >= 8) reasons.push(`You made ${Math.abs(dd)} ${dd > 0 ? 'more' : 'fewer'} payments than last month.`)
  return { now, before, diff, reasons }
}

/** How you tend to spend: weekends, nights, the days after payday. Covers the chosen year, up to today when it is this year. */
export function habits(all: Transaction[], committed: Set<string>, year: number, today = Date.now()): Reading[] {
  const from = new Date(year, 0, 1).getTime()
  const now = Math.min(today, new Date(year + 1, 0, 1).getTime() - 1)
  const xs = all.filter((t) => t.timestamp >= from && t.timestamp <= now && isPersonalSpend(t, committed) && !t.timeUnknown)
  if (xs.length < 15) return []
  const out: Reading[] = []
  const days = (pred: (d: Date) => boolean) => { let n = 0; for (let t = from; t <= now; t += 86400000) if (pred(new Date(t))) n++; return Math.max(1, n) }
  const wkend = (d: Date) => d.getDay() === 0 || d.getDay() === 6
  const endAvg = sum(xs.filter((t) => wkend(new Date(t.timestamp)))) / days(wkend)
  const dayAvg = sum(xs.filter((t) => !wkend(new Date(t.timestamp)))) / days((d) => !wkend(d))
  if (dayAvg > 0 && Math.abs(endAvg / dayAvg - 1) >= 0.2) out.push({ title: endAvg > dayAvg ? 'Weekends cost more' : 'Weekdays cost more', body: `You spend about ${money(endAvg)} a day on weekends and ${money(dayAvg)} on weekdays.`, tone: endAvg > dayAvg ? 'up' : 'neutral' })

  const night = xs.filter((t) => { const h = new Date(t.timestamp).getHours(); return h >= 23 || h < 4 })
  if (night.length >= 5 && sum(night) / sum(xs) >= 0.08) out.push({ title: 'Late-night spending', body: `${night.length} payments after 11 pm added up to ${money(sum(night))} (${Math.round((sum(night) / sum(xs)) * 100)}% of your spending).`, tone: 'up' })

  const early = xs.filter((t) => new Date(t.timestamp).getDate() <= 5)
  const share = sum(early) / sum(xs)
  if (share >= 0.38) out.push({ title: 'Payday splurge', body: `${Math.round(share * 100)}% of your spending lands in the first 5 days of the month.`, tone: 'up' })

  const dow = Array.from({ length: 7 }, () => 0)
  xs.forEach((t) => { dow[new Date(t.timestamp).getDay()] += t.paymentAmount })
  const top = dow.indexOf(Math.max(...dow))
  out.push({ title: `${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][top]} are your biggest day`, body: `${Math.round((dow[top] / sum(xs)) * 100)}% of your spending happens then.`, tone: 'neutral' })
  return out
}

/** For your biggest categories: your lowest month so far this year against the month you are looking at. */
export function bestMonths(all: Transaction[], committed: Set<string>, year: number, month: number): Reading[] {
  const xs = all.filter((t) => isPersonalSpend(t, committed) && !isTransferCategory(t.paymentCategory))
  const totals = new Map<string, Map<string, number>>()
  for (const t of xs) {
    const d = new Date(t.timestamp)
    if (d.getFullYear() !== year) continue
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const c = catName(t)
    const cat = totals.get(c) ?? totals.set(c, new Map()).get(c)!
    cat.set(key, (cat.get(key) ?? 0) + t.paymentAmount)
  }
  const out: Reading[] = []
  const ranked = [...totals.entries()].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0)).slice(0, 4)
  for (const [cat, months] of ranked) {
    if (months.size < 2) continue
    const now = months.get(`${year}-${month}`) ?? 0
    const [bestKey, best] = [...months.entries()].filter(([k]) => k !== `${year}-${month}`).sort((a, b) => a[1] - b[1])[0] ?? []
    if (!bestKey || best === undefined) continue
    const bm = Number(bestKey.split('-')[1])
    if (now > 0 && now < best) { out.push({ title: `${cat}: this is your lowest month`, body: `${money(now)} this month, next lowest was ${money(best)} in ${MONTHS[bm]}.`, tone: 'down' }); continue }
    out.push({ title: `${cat}: best month was ${MONTHS[bm]}`, body: `${money(best)} then, ${money(now)} this month${best > 0 ? ` (${now > best ? '+' : ''}${Math.round(((now - best) / best) * 100)}%)` : ''}.`, tone: now > best ? 'up' : 'down' })
  }
  return out
}

/** Things you buy again and again that now cost more (or less) per payment than when you started. */
export function priceCreep(all: Transaction[]): Reading[] {
  const groups = new Map<string, { label: string; xs: Transaction[] }>()
  for (const t of all) {
    if (t.paymentType !== 'DEBIT' || isTransferCategory(t.paymentCategory) || t.paymentCategory === 'Family') continue
    const k = payeeKey(t.paymentReceiver, t.paymentCategory)
    if (!k) continue
    const g = groups.get(k) ?? { label: payeeLabel(t.paymentReceiver, t.paymentCategory), xs: [] }
    g.xs.push(t); groups.set(k, g)
  }
  const out: (Reading & { size: number })[] = []
  for (const g of groups.values()) {
    const xs = [...g.xs].sort((a, b) => a.timestamp - b.timestamp)
    if (xs.length < 6 || xs[xs.length - 1].timestamp - xs[0].timestamp < 90 * 86400000) continue
    const third = Math.floor(xs.length / 3)
    const first = median(xs.slice(0, third).map((t) => t.paymentAmount)), last = median(xs.slice(-third).map((t) => t.paymentAmount))
    if (!first) continue
    const pct = ((last - first) / first) * 100
    if (Math.abs(pct) < 8) continue
    const since = new Date(xs[0].timestamp)
    out.push({ title: `${g.label}: ${pct > 0 ? '+' : ''}${Math.round(pct)}% per payment`, body: `A typical payment was ${money(first)} in ${MONTHS[since.getMonth()]} ${since.getFullYear()}, now ${money(last)}.`, tone: pct > 0 ? 'up' : 'down', size: xs.length })
  }
  return out.sort((a, b) => b.size - a.size).slice(0, 5)
}

export const NET_MILESTONES = [100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000]
/** The biggest milestone reached and the next one to aim for. */
export function milestones(netWorth: number) {
  const reached = NET_MILESTONES.filter((m) => netWorth >= m)
  const next = NET_MILESTONES.find((m) => netWorth < m) ?? null
  return { last: reached[reached.length - 1] ?? null, next, toNext: next ? next - netWorth : 0, progress: next ? Math.max(0, Math.min(1, netWorth / next)) : 1 }
}
