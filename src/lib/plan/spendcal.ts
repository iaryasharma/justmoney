// The numbers behind the spending calendar: what was spent each day, how heavy each day was, the month's top days, and the week's rhythm.
import { isTransferCategory } from '../accounts/accounts'
import { formatPrice } from '../core/format'
import type { Transaction } from '../core/types'

const DAY = 86400000
export const isSpendTx = (t: Transaction) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory)

export interface DayInfo { day: number; date: number; total: number; count: number; tx: Transaction[]; byCat: Map<string, number> }

/** One entry per day of the month. With `cat`, only that category counts. */
export function monthDays(all: Transaction[], year: number, month: number, cat: string | null = null): DayInfo[] {
  const n = new Date(year, month + 1, 0).getDate()
  const days: DayInfo[] = Array.from({ length: n }, (_, i) => ({ day: i + 1, date: new Date(year, month, i + 1).getTime(), total: 0, count: 0, tx: [], byCat: new Map() }))
  for (const t of all) {
    const d = new Date(t.timestamp)
    if (d.getFullYear() !== year || d.getMonth() !== month || !isSpendTx(t) || (cat && t.paymentCategory !== cat)) continue
    const x = days[d.getDate() - 1]
    x.total += t.paymentAmount; x.count++; x.tx.push(t)
    x.byCat.set(t.paymentCategory, (x.byCat.get(t.paymentCategory) ?? 0) + t.paymentAmount)
  }
  days.forEach((d) => d.tx.sort((a, b) => a.timestamp - b.timestamp))
  return days
}

/** The upper edge of heat levels 1 to 3, from the days that had spending (so a quiet month still shows its shape). */
export function thresholdsOf(days: DayInfo[]): number[] {
  const v = days.filter((d) => d.total > 0).map((d) => d.total).sort((a, b) => a - b)
  if (!v.length) return [Infinity, Infinity, Infinity]
  const q = (p: number) => v[Math.floor(p * (v.length - 1))]
  return [q(0.25), q(0.5), q(0.75)]
}

/** 0 for no spending, then 1 (light) to 4 (heaviest). */
export function levelOf(total: number, th: number[]): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0
  return total <= th[0] ? 1 : total <= th[1] ? 2 : total <= th[2] ? 3 : 4
}

export interface MonthStats { total: number; avg: number; daysCounted: number; noSpend: number; top: DayInfo[]; prevTotal: number; change: number | null; count: number }

export function monthStats(all: Transaction[], year: number, month: number, now = new Date(), cat: string | null = null): MonthStats {
  const days = monthDays(all, year, month, cat)
  const isNow = year === now.getFullYear() && month === now.getMonth()
  const past = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth())
  const counted = isNow ? now.getDate() : past ? days.length : 0
  const live = days.slice(0, Math.max(counted, 0))
  const total = days.reduce((a, d) => a + d.total, 0)
  const prevDays = monthDays(all, month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1, cat)
  // compare like with like: this month so far against the same days of last month
  const prevTotal = prevDays.slice(0, isNow ? counted : prevDays.length).reduce((a, d) => a + d.total, 0)
  return {
    total, daysCounted: counted, avg: counted ? total / counted : 0,
    noSpend: live.filter((d) => d.total === 0).length,
    top: [...days].filter((d) => d.total > 0).sort((a, b) => b.total - a.total).slice(0, 3),
    prevTotal, change: prevTotal > 0 && total > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
    count: days.reduce((a, d) => a + d.count, 0),
  }
}

export interface CatRow { cat: string; total: number; pct: number; prev: number }
export function categoriesOf(all: Transaction[], year: number, month: number): CatRow[] {
  const sum = (y: number, m: number) => {
    const out = new Map<string, number>()
    for (const d of monthDays(all, y, m)) d.byCat.forEach((v, c) => out.set(c, (out.get(c) ?? 0) + v))
    return out
  }
  const cur = sum(year, month), prev = sum(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)
  const total = [...cur.values()].reduce((a, b) => a + b, 0)
  return [...cur.entries()].sort((a, b) => b[1] - a[1]).map(([cat, v]) => ({ cat, total: v, pct: total ? Math.round((v / total) * 100) : 0, prev: prev.get(cat) ?? 0 }))
}

/** A day set against the month's daily average, in a sentence. */
export function dayInsight(day: DayInfo, avgPerDay: number): string | null {
  if (day.total <= 0) return 'Nothing was spent this day.'
  const top = [...day.byCat.entries()].sort((a, b) => b[1] - a[1])[0]
  if (avgPerDay > 0) {
    const pct = Math.round(((day.total - avgPerDay) / avgPerDay) * 100)
    if (pct >= 25) return `${top[0]} led the day. You spent ${pct}% more than your daily average.`
    if (pct <= -25) return `A light day: ${Math.abs(pct)}% under your daily average.`
  }
  return `${top[0]} was the biggest spend, ${formatPrice(top[1], { round: true })} of the day.`
}

export interface Pattern { key: string; icon: string; title: string; body: string; tone: 'warn' | 'good' | 'info' }
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

/** The week's rhythm over the last 12 weeks up to the month on screen: which days cost more, and which are steady. */
export function patterns(all: Transaction[], year: number, month: number, now = new Date()): Pattern[] {
  const monthEnd = new Date(year, month + 1, 0).getTime()
  const end = Math.min(monthEnd, new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime())
  const start = end - 83 * DAY
  const per = new Map<number, number>()
  for (const t of all) { if (t.timestamp >= start && t.timestamp < end + DAY && isSpendTx(t)) { const k = new Date(t.timestamp).setHours(0, 0, 0, 0); per.set(k, (per.get(k) ?? 0) + t.paymentAmount) } }
  const byDow: number[][] = Array.from({ length: 7 }, () => [])
  for (let i = 0; i < 84; i++) { const d = new Date(start + i * DAY); byDow[d.getDay()].push(per.get(new Date(d).setHours(0, 0, 0, 0)) ?? 0) }
  const data = per.size
  if (data < 8) return []
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
  const avgs = byDow.map(mean)
  const out: Pattern[] = []
  const weekend = mean([...byDow[0], ...byDow[6]]), weekday = mean([1, 2, 3, 4, 5].flatMap((i) => byDow[i]))
  if (weekday > 0 && weekend > 0) {
    const pct = Math.round(((weekend - weekday) / weekday) * 100)
    if (Math.abs(pct) >= 10) out.push({ key: 'weekend', icon: 'users', title: pct > 0 ? 'Weekends cost more' : 'Weekdays cost more', body: pct > 0 ? `You spend ${pct}% more on a weekend day than on a weekday.` : `You spend ${Math.abs(pct)}% more on a weekday than on a weekend day.`, tone: pct > 0 ? 'warn' : 'info' })
  }
  const hi = avgs.reduce((b, v, i) => (v > avgs[b] ? i : b), 0), lo = avgs.reduce((b, v, i) => (v < avgs[b] ? i : b), 0)
  if (avgs[hi] > 0) out.push({ key: 'highest', icon: 'trend', title: 'Highest spending day', body: `${WEEKDAYS[hi]} (about ${formatPrice(avgs[hi], { round: true })} a day).`, tone: 'warn' })
  const cv = avgs.map((m, i) => { const v = byDow[i]; const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2))); return m > 0 ? { i, c: sd / m } : null }).filter((x): x is { i: number; c: number } => !!x)
  const steady = cv.length ? cv.reduce((b, x) => (x.c < b.c ? x : b)) : null
  if (steady) out.push({ key: 'steady', icon: 'calendar', title: 'Most consistent', body: `${WEEKDAYS[steady.i]} (about ${formatPrice(avgs[steady.i], { round: true })} a day, with little change).`, tone: 'info' })
  if (lo !== hi) out.push({ key: 'lowest', icon: 'down', title: 'Lowest spending day', body: `${WEEKDAYS[lo]} (about ${formatPrice(avgs[lo], { round: true })} a day).`, tone: 'good' })
  const s = monthStats(all, year, month, now)
  if (s.change !== null) out.push({ key: 'trend', icon: 'trend', title: 'Spending trend', body: s.change >= 0 ? `Your spending is up ${s.change}% compared with the same days last month.` : `Your spending is down ${Math.abs(s.change)}% compared with the same days last month.`, tone: s.change > 0 ? 'warn' : 'good' })
  return out
}
