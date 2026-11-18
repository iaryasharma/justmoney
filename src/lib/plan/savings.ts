// "Where can I save?": concrete, rupee-sized suggestions from your own history,
// plus no-spend streaks and the weekly challenge.
import { detectRecurring, priceChanges, CADENCE_DAYS } from '../payees/recurring'
import { committedCategories, isPersonalSpend } from '../core/money'
import { formatPrice } from '../core/format'
import type { Commitment, Transaction } from '../core/types'

export interface SaveTip { key: string; icon: string; title: string; body: string; /** rough saving per year */ yearly: number }

const DELIVERY = /swiggy|zomato|zepto|blinkit|instamart|bigbasket|dunzo|eatsure|magicpin/i
const inMonth = (list: Transaction[], y: number, m: number) => {
  const a = new Date(y, m, 1).getTime(), b = new Date(y, m + 1, 1).getTime()
  return list.filter((t) => t.timestamp >= a && t.timestamp < b)
}
const money = (v: number) => formatPrice(v, { round: true })

export function saveTips(all: Transaction[], commitments: Commitment[], now = new Date()): SaveTip[] {
  const committed = committedCategories(commitments)
  const spend = all.filter((t) => isPersonalSpend(t, committed))
  const cur = inMonth(spend, now.getFullYear(), now.getMonth())
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prev = inMonth(spend, pm.getFullYear(), pm.getMonth())
  const tips: SaveTip[] = []

  const recurring = detectRecurring(all)
  for (const r of recurring.filter((x) => x.isSubscription && !x.ended)) {
    const yearly = Math.round(r.amount * (365 / CADENCE_DAYS[r.cadence]))
    if (yearly >= 600) tips.push({ key: `sub-${r.key}`, icon: 'repeat', title: `Review ${r.receiver}`, body: `${money(yearly)} a year. Cancel it if you rarely use it — or switch to a yearly plan, which is often cheaper.`, yearly })
  }
  for (const c of priceChanges(all, recurring).filter((p) => p.pct > 0)) {
    tips.push({ key: `hike-${c.receiver}`, icon: 'up', title: `${c.receiver} got pricier`, body: `Up ${money(c.to - c.from)} per charge (${c.pct}%). That is about ${money((c.to - c.from) * 12)} more a year if monthly.`, yearly: Math.round((c.to - c.from) * 12) })
  }

  const sum = (l: Transaction[], f?: (t: Transaction) => boolean) => l.filter((t) => !f || f(t)).reduce((a, t) => a + t.paymentAmount, 0)
  const delivery = sum(cur, (t) => DELIVERY.test(t.paymentReceiver))
  if (delivery >= 1500) tips.push({ key: 'delivery', icon: 'utensils', title: 'Food delivery adds up', body: `${money(delivery)} on delivery and quick-commerce this month. Cutting it by a fifth saves about ${money(delivery * 0.2)} a month.`, yearly: Math.round(delivery * 0.2 * 12) })

  const cats = new Set(cur.map((t) => t.paymentCategory))
  for (const c of cats) {
    const a = sum(cur, (t) => t.paymentCategory === c), b = sum(prev, (t) => t.paymentCategory === c)
    if (b > 0 && a >= 1000 && a >= b * 1.3 && c !== 'Investments') {
      tips.push({ key: `cat-${c}`, icon: 'trend', title: `${c} is up ${Math.round(((a - b) / b) * 100)}%`, body: `${money(a)} so far vs ${money(b)} last month. Getting back to last month's level saves ${money(a - b)}.`, yearly: Math.round(a - b) }) // one month's overshoot only: no guessing it repeats all year
    }
  }
  return tips.sort((x, y) => y.yearly - x.yearly).slice(0, 6)
}

/* ---------- streaks & the weekly challenge ---------- */

const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }

/** Consecutive no-spend days ending yesterday (today counts too while nothing is spent yet), and the best run this year. */
export function noSpendStreak(all: Transaction[], commitments: Commitment[], now = new Date()) {
  const committed = committedCategories(commitments)
  const spendDays = new Set(all.filter((t) => isPersonalSpend(t, committed)).map((t) => dayKey(t.timestamp)))
  let current = 0
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!spendDays.has(dayKey(d.getTime()))) {
    current++ // today so far
    for (d.setDate(d.getDate() - 1); ; d.setDate(d.getDate() - 1)) {
      if (spendDays.has(dayKey(d.getTime())) || current > 400) break
      current++
    }
  } // spent something today: the streak starts again tomorrow
  // the app only knows about days since the first entry
  const first = all.length ? Math.min(...all.map((t) => t.timestamp)) : now.getTime()
  const maxPossible = Math.max(0, Math.floor((now.getTime() - first) / 86400000) + 1)
  current = Math.min(current, maxPossible)
  let best = 0, run = 0
  const start = new Date(now.getFullYear(), 0, 1)
  for (const x = new Date(start); x <= now; x.setDate(x.getDate() + 1)) {
    if (x.getTime() < first - 86400000) continue
    if (spendDays.has(dayKey(x.getTime()))) run = 0
    else best = Math.max(best, ++run)
  }
  return { current, best: Math.max(best, current) }
}

export const STREAK_BADGES = [3, 7, 14, 30]
export const badgeFor = (days: number) => [...STREAK_BADGES].reverse().find((b) => days >= b) ?? 0

export interface Challenge { category: string; cap: number; weekStart: number }

/** Monday 00:00 of the week containing `d`. */
export function weekStartOf(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x.getTime()
}

export function challengeProgress(all: Transaction[], c: Challenge, now = Date.now()) {
  const spent = all.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === c.category && t.timestamp >= c.weekStart && t.timestamp < c.weekStart + 7 * 86400000).reduce((a, t) => a + t.paymentAmount, 0)
  const daysLeft = Math.max(0, Math.ceil((c.weekStart + 7 * 86400000 - now) / 86400000))
  return { spent, left: c.cap - spent, over: spent > c.cap, daysLeft, ended: now >= c.weekStart + 7 * 86400000 }
}
