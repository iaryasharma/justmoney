// "Your year in money": what came in, what was spent, what was saved and how the emergency fund grew, as one card to look at and share.
import { read, KEYS } from '../core/storage'
import { categoryColor } from '../core/data'
import { committedCategories, isIncome, isPersonalSpend } from '../core/money'
import { formatPrice } from '../core/format'
import { getRecords, getPlanSettings, shopSummary } from '../plan/plan'
import { monthlyEssentials } from '../plan/pots'
import { brandLogo, merchantBrand } from '../payees/brands'
import { CARD_H, CARD_W, FONT, GREEN, LIGHT, MINT, VIOLET, dataUri, esc, icon, svgToUrl } from './recap'
import { categoryIcon } from '../core/data'
import type { Commitment, SavingsGoal, Transaction } from '../core/types'
import { retheme } from '../core/accent'

/** Every time money went into (or out of) a goal, so the emergency fund's growth can be told. Kept by the plan. */
export interface SavingsLogEntry { at: number; name: string; amount: number; emergency: boolean }
export const getSavingsLog = () => read<SavingsLogEntry[]>(KEYS.savingsLog, [])

export interface Story {
  year: number
  income: number
  spent: number
  family: number
  saved: number
  emergencyAdded: number
  emergencyNow: number
  monthsCovered: number | null
  top: { label: string; value: number; pct: number; color: string; prev: number }[]
  cheapest: { m: number; spent: number } | null
  bestSaving: { m: number; amount: number } | null
  onPlan: { good: number; total: number }
  goals: { name: string; saved: number; target: number }[]
  shop: { sales: number; costs: number; profit: number } | null
  count: number
  /** each month of the year: what was spent on you and what came in */
  byMonth: { m: number; spent: number; income: number }[]
  biggest: Transaction | null
  longestStreak: number
  noSpendDays: number
  streakFrom: number | null
  streakTo: number | null
  /** days of the year counted so far (the whole year once it is over) */
  daysCounted: number
  /** the same stretch of the year before, for "vs last year" */
  spentPrev: number
  incomePrev: number
  /** months of the year so far (the whole year once it is over) */
  monthsCounted: number
}

const sum = (xs: Transaction[]) => xs.reduce((a, t) => a + t.paymentAmount, 0)

export function buildStory(year: number, shop = false, now = Date.now()): Story {
  const all = read<Transaction[]>(KEYS.transactions, [])
  const committed = committedCategories(read<Commitment[]>(KEYS.commitments, []))
  const inYear = all.filter((t) => new Date(t.timestamp).getFullYear() === year)
  const spend = inYear.filter((t) => isPersonalSpend(t, committed))
  // the same stretch of last year: Jan 1 up to this day (the whole year if it is over)
  const nowD = new Date(now)
  const cutoff = year < nowD.getFullYear() ? new Date(year, 11, 31, 23, 59, 59, 999) : nowD
  const prevEnd = new Date(year - 1, cutoff.getMonth(), cutoff.getDate(), 23, 59, 59, 999).getTime()
  const prevYear = all.filter((t) => { const d = new Date(t.timestamp); return d.getFullYear() === year - 1 && t.timestamp <= prevEnd })
  const prevSpend = prevYear.filter((t) => isPersonalSpend(t, committed))
  const catPrev = new Map<string, number>()
  prevSpend.forEach((t) => catPrev.set(t.paymentCategory, (catPrev.get(t.paymentCategory) ?? 0) + t.paymentAmount))
  const byCat = new Map<string, number>()
  spend.forEach((t) => byCat.set(t.paymentCategory, (byCat.get(t.paymentCategory) ?? 0) + t.paymentAmount))
  const spent = sum(spend)
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, value]) => ({ label, value: Math.round(value), prev: Math.round(catPrev.get(label) ?? 0), pct: spent ? Math.round((value / spent) * 100) : 0, color: categoryColor(label) }))

  const perMonth = Array.from({ length: 12 }, (_, m) => ({ m, spent: sum(spend.filter((t) => new Date(t.timestamp).getMonth() === m)), n: inYear.filter((t) => new Date(t.timestamp).getMonth() === m).length }))
  const live = perMonth.filter((x) => x.n >= 3 && x.spent > 0 && (year < new Date(now).getFullYear() || x.m < new Date(now).getMonth()))
  const cheapest = live.length > 1 ? live.reduce((a, b) => (b.spent < a.spent ? b : a)) : null

  const planSaved = read<Record<string, number>>(KEYS.planSaved, {})
  const savedBy = Object.entries(planSaved).filter(([k]) => k.startsWith(`${year}-`)).map(([k, v]) => ({ m: Number(k.slice(5)) - 1, amount: v }))
  const saved = savedBy.reduce((a, x) => a + x.amount, 0)
  const bestSaving = savedBy.length ? savedBy.reduce((a, b) => (b.amount > a.amount ? b : a)) : null

  const log = getSavingsLog().filter((e) => new Date(e.at).getFullYear() === year && e.emergency)
  const goals = read<SavingsGoal[]>(KEYS.savingsGoals, [])
  const fund = goals.find((g) => g.emergency)
  const essentials = monthlyEssentials(all, now)
  const recs = Object.values(getRecords()).filter((r) => r.y === year && !r.history)

  return {
    year, income: Math.round(sum(inYear.filter(isIncome))), spent: Math.round(spent), family: Math.round(sum(inYear.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === 'Family'))),
    saved: Math.round(saved), emergencyAdded: Math.round(log.reduce((a, e) => a + e.amount, 0)), emergencyNow: Math.round(fund?.saved ?? 0),
    monthsCovered: fund && essentials > 0 ? Math.round((fund.saved / essentials) * 10) / 10 : null,
    top, cheapest: cheapest ? { m: cheapest.m, spent: Math.round(cheapest.spent) } : null, bestSaving: bestSaving && bestSaving.amount > 0 ? { m: bestSaving.m, amount: Math.round(bestSaving.amount) } : null,
    onPlan: { good: recs.filter((r) => r.over < 1).length, total: recs.length },
    goals: goals.filter((g) => !g.emergency && g.saved > 0).slice(0, 3).map((g) => ({ name: g.name, saved: Math.round(g.saved), target: Math.round(g.target) })),
    shop: shop ? (() => { const s = Array.from({ length: 12 }, (_, m) => shopSummary(all, year, m)); return { sales: s.reduce((a, x) => a + x.sales, 0), costs: s.reduce((a, x) => a + x.costs, 0), profit: s.reduce((a, x) => a + x.profit, 0) } })() : null,
    count: inYear.length,
    byMonth: perMonth.map((x) => ({ m: x.m, spent: Math.round(x.spent), income: Math.round(sum(inYear.filter((t) => isIncome(t) && new Date(t.timestamp).getMonth() === x.m))) })),
    biggest: spend.reduce<Transaction | null>((a, t) => (!a || t.paymentAmount > a.paymentAmount ? t : a), null),
    ...streaks(spend, year, now),
    spentPrev: Math.round(sum(prevSpend)),
    incomePrev: Math.round(sum(prevYear.filter(isIncome))),
    monthsCounted: year < new Date(now).getFullYear() ? 12 : new Date(now).getMonth() + 1,
  }
}

/** The longest run of days with no spending (and when it was), and how many such days there were, up to today. */
function streaks(spend: Transaction[], year: number, now: number) {
  const days = new Set(spend.map((t) => new Date(t.timestamp).toDateString()))
  const end = Math.min(now, new Date(year, 11, 31, 23).getTime())
  let run = 0, best = 0, none = 0, counted = 0
  let runStart = 0, bestFrom: number | null = null, bestTo: number | null = null
  for (let d = new Date(year, 0, 1); d.getTime() <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    counted++
    if (days.has(d.toDateString())) run = 0
    else {
      if (run === 0) runStart = d.getTime()
      run++; none++
      if (run > best) { best = run; bestFrom = runStart; bestTo = d.getTime() }
    }
  }
  return { longestStreak: best, noSpendDays: none, streakFrom: bestFrom, streakTo: bestTo, daysCounted: counted }
}

export function storyHeadline(s: Story) {
  if (s.saved > 0) return { big: formatPrice(s.saved, { round: true }), line: `saved in ${s.year}` }
  return { big: formatPrice(s.spent, { round: true }), line: `spent on you in ${s.year}` }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const compact = (v: number) => (v >= 100000 ? `₹${Math.round(v / 1000) / 100}L` : v >= 1000 ? `₹${Math.round(v / 100) / 10 % 1 === 0 ? Math.round(v / 1000) : (v / 1000).toFixed(1)}K` : `₹${Math.round(v)}`)
const niceTop = (v: number) => { if (v <= 0) return 1000; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 3 ? 3 : m <= 5 ? 5 : 10) * p }
const dayText = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** The year as a 1080×1800 card: header, headline, the big number against last year, month by month, tiles, where it went, highlights. */
export async function storySvg(s: Story, name: string): Promise<string> {
  const W = CARD_W, H = CARD_H, P = 60, chartW = W - P * 2
  const money = (v: number) => formatPrice(v, { round: true })
  const brand = s.biggest ? merchantBrand(s.biggest.paymentReceiver) : null
  const [appIcon, bigLogo] = await Promise.all([dataUri('/icon-192.png'), brand ? dataUri(brandLogo(brand.key)) : Promise.resolve(null)])
  const RED = '#ff7a7a'
  let o = ''
  const label = (t: string, x: number, y: number) => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="25" font-weight="700" fill="#ffffff" fill-opacity=".62" letter-spacing="4">${esc(t)}</text>`
  const panel = (x: number, y: number, w: number, hh: number, r = 32) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${r}" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>`
  const pillW = (text: string, arrow?: boolean) => 44 + text.length * 19 + (arrow ? 36 : 0)
  const pct = (d: number) => (Math.abs(d) > 999 ? '999%+' : `${Math.abs(d)}%`)
  const pill = (x: number, y: number, text: string, color: string, arrow?: 'up' | 'down') => {
    const w = pillW(text, !!arrow)
    return `<rect x="${x}" y="${y}" width="${w}" height="54" rx="16" fill="${color}" fill-opacity=".16"/>${arrow ? icon(arrow, x + 14, y + 14, 26, color, 3) : ''}<text x="${x + (arrow ? 48 : 20)}" y="${y + 37}" font-family="${FONT}" font-size="28" font-weight="700" fill="${color}">${esc(text)}</text>`
  }
  const vs = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null)

  o += `<defs>
<radialGradient id="glow" cx="50%" cy="100%" r="92%"><stop offset="0" stop-color="#a47bff" stop-opacity=".9"/><stop offset=".2" stop-color="#6d36d6" stop-opacity=".85"/><stop offset=".5" stop-color="#2a0f5c" stop-opacity=".9"/><stop offset="1" stop-color="#06030d" stop-opacity="1"/></radialGradient>
<radialGradient id="top" cx="90%" cy="0%" r="60%"><stop offset="0" stop-color="${VIOLET}" stop-opacity=".28"/><stop offset="1" stop-color="${VIOLET}" stop-opacity="0"/></radialGradient>
<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b28cff"/><stop offset="1" stop-color="#6d36d6"/></linearGradient>
<linearGradient id="earn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#15803d"/></linearGradient>
<linearGradient id="hz" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7c4dee"/><stop offset="1" stop-color="#b28cff"/></linearGradient>
<linearGradient id="cal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#5b34c9"/></linearGradient>
<clipPath id="ico"><rect x="${P}" y="60" width="104" height="104" rx="26"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="#06030d"/><rect width="${W}" height="${H}" fill="url(#glow)"/><rect width="${W}" height="${H}" fill="url(#top)"/>
<rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="64" fill="none" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/>`

  // header: app icon, wordmark, tagline, year
  if (appIcon) o += `<image href="${appIcon}" x="${P}" y="60" width="104" height="104" clip-path="url(#ico)"/><rect x="${P}" y="60" width="104" height="104" rx="26" fill="none" stroke="#ffffff" stroke-opacity=".25" stroke-width="2"/>`
  o += `<text x="${P + 128}" y="114" font-family="${FONT}" font-size="54" fill="#ffffff"><tspan font-weight="800">Just</tspan><tspan font-style="italic" font-weight="400" fill="${LIGHT}">Money</tspan></text>
<text x="${P + 128}" y="152" font-family="${FONT}" font-size="25" fill="#ffffff" fill-opacity=".62">Track smarter. Spend better.</text>
<rect x="${W - P - 210}" y="78" width="210" height="70" rx="35" fill="#ffffff" fill-opacity=".08" stroke="#ffffff" stroke-opacity=".22" stroke-width="2"/>
<text x="${W - P - 120}" y="124" text-anchor="middle" font-family="${FONT}" font-size="31" font-weight="700" fill="#ffffff">${s.year}</text>${icon('chevronDown', W - P - 62, 100, 28, '#ffffff', 3)}`

  // headline
  const first = Math.min(...s.byMonth.map((x, i) => (x.spent > 0 || x.income > 0 ? i : 99)))
  const from = MONTHS[first > 11 ? 0 : first], to = MONTHS[Math.max(0, s.monthsCounted - 1)]
  o += `<text x="${P}" y="266" font-family="${FONT}" font-size="60" font-weight="800" fill="#ffffff">${esc(name ? `${name}’s` : 'Your')} year in <tspan font-style="italic" font-weight="500" fill="${LIGHT}">money</tspan></text>
<text x="${P}" y="314" font-family="${FONT}" font-size="29" fill="#ffffff" fill-opacity=".62">${esc(`A snapshot of your finances from ${from}${to !== from ? ` – ${to}` : ''} ${s.year}`)}</text>`

  // the big number, against the same period last year, with a small calendar picture
  const hy = 350, hh = 250
  o += panel(P, hy, chartW, hh, 38)
  o += label('TOTAL SPENT ON YOU', P + 40, hy + 56)
  const big = money(s.spent)
  o += `<text x="${P + 40}" y="${hy + 158}" font-family="${FONT}" font-size="${Math.min(132, Math.floor(560 / Math.max(4, big.length) * 1.7))}" font-weight="800" fill="#ffffff" letter-spacing="-3">${esc(big)}</text>`
  const dSpend = vs(s.spent, s.spentPrev)
  if (dSpend !== null) {
    o += pill(P + 40, hy + 176, pct(dSpend), dSpend > 0 ? RED : GREEN, dSpend > 0 ? 'up' : 'down')
    o += `<text x="${P + 40 + pillW(pct(dSpend), true) + 20}" y="${hy + 212}" font-family="${FONT}" font-size="27" fill="#ffffff" fill-opacity=".62">vs same period last year</text>`
  } else if (s.saved > 0 && s.income > 0) o += pill(P + 40, hy + 176, `${Math.round((s.saved / s.income) * 100)}% of earnings saved`, GREEN)
  // a tilted calendar with rising bars
  o += `<g transform="translate(${W - P - 270} ${hy + 20}) rotate(-7 130 100)">
<rect x="20" y="30" width="220" height="190" rx="26" fill="url(#cal)" fill-opacity=".85" stroke="#ffffff" stroke-opacity=".35" stroke-width="2"/>
<rect x="20" y="30" width="220" height="54" rx="26" fill="#ffffff" fill-opacity=".14"/>
${[60, 100, 140, 180].map((x) => `<rect x="${x}" y="8" width="12" height="40" rx="6" fill="#ffffff" fill-opacity=".85"/>`).join('')}
<text x="130" y="68" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="800" fill="#ffffff" fill-opacity=".9">${s.year}</text>
<rect x="52" y="170" width="28" height="34" rx="6" fill="#ffffff" fill-opacity=".55"/><rect x="92" y="148" width="28" height="56" rx="6" fill="#ffffff" fill-opacity=".7"/><rect x="132" y="120" width="28" height="84" rx="6" fill="#ffffff" fill-opacity=".85"/><rect x="172" y="100" width="28" height="104" rx="6" fill="#ffffff"/>
<path d="M44 150 C 90 140, 130 110, 196 86" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-opacity=".9"/><circle cx="196" cy="86" r="8" fill="#ffffff"/></g>
<path d="M${W - P - 60} ${hy + 40} l8 18 18 8 -18 8 -8 18 -8 -18 -18 -8 18 -8z" fill="#ffffff" fill-opacity=".9"/><path d="M${W - P - 300} ${hy + 90} l5 11 11 5 -11 5 -5 11 -5 -11 -11 -5 11 -5z" fill="${LIGHT}"/>`

  // month by month: spent and earned side by side, a line through what was earned, the busiest month called out
  const cy = hy + hh + 90, chartH = 170, axisW = 86, plotW = chartW - axisW, slot = plotW / 12, barW = Math.min(22, slot * 0.34)
  const top = niceTop(Math.max(1, ...s.byMonth.map((x) => Math.max(x.spent, x.income))))
  const yOf = (v: number) => cy + chartH - (v / top) * chartH
  o += label('MONTH BY MONTH', P, cy - 30)
  o += `<g font-family="${FONT}" font-size="22" fill="#ffffff" fill-opacity=".62"><circle cx="${W - P - 470}" cy="${cy - 38}" r="9" fill="${VIOLET}"/><text x="${W - P - 452}" y="${cy - 30}">Spent</text><circle cx="${W - P - 350}" cy="${cy - 38}" r="9" fill="${GREEN}"/><text x="${W - P - 332}" y="${cy - 30}">Earned</text><rect x="${W - P - 226}" y="${cy - 49}" width="20" height="20" rx="5" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="2" stroke-dasharray="4 4"/><text x="${W - P - 198}" y="${cy - 30}">Lightest month</text></g>`
  ;[0, top / 2, top].forEach((v) => {
    o += `<line x1="${P + axisW}" y1="${yOf(v)}" x2="${W - P}" y2="${yOf(v)}" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/><text x="${P}" y="${yOf(v) + 8}" font-family="${FONT}" font-size="22" fill="#ffffff" fill-opacity=".55">${esc(v === 0 ? '₹0' : compact(v))}</text>`
  })
  const lo = s.cheapest?.m ?? -1
  const hi = s.byMonth.reduce((a, x) => (x.spent > a.spent ? x : a), s.byMonth[0]).m
  const pts: string[] = []
  s.byMonth.forEach((x, i) => {
    const cx0 = P + axisW + slot * i + slot / 2
    const live = i < s.monthsCounted
    if (!live) { o += `<rect x="${(cx0 - barW - 2).toFixed(1)}" y="${cy + 4}" width="${(barW * 2 + 4).toFixed(1)}" height="${chartH - 4}" rx="8" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="2" stroke-dasharray="7 7"/>` }
    else {
      const hs = x.spent > 0 ? Math.max(8, (x.spent / top) * chartH) : 0
      const he = x.income > 0 ? Math.max(8, (x.income / top) * chartH) : 0
      if (hs) o += `<rect x="${(cx0 - barW - 1).toFixed(1)}" y="${(cy + chartH - hs).toFixed(1)}" width="${barW.toFixed(1)}" height="${hs.toFixed(1)}" rx="6" fill="url(#bar)"/>`
      if (he) o += `<rect x="${(cx0 + 1).toFixed(1)}" y="${(cy + chartH - he).toFixed(1)}" width="${barW.toFixed(1)}" height="${he.toFixed(1)}" rx="6" fill="url(#earn)"/>`
      if (i === lo) o += `<rect x="${(cx0 - barW - 8).toFixed(1)}" y="${cy + 2}" width="${(barW * 2 + 16).toFixed(1)}" height="${chartH + 2}" rx="10" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="6 6"/>`
      if (x.income > 0) pts.push(`${cx0.toFixed(1)},${yOf(x.income).toFixed(1)}`)
    }
    o += `<text x="${cx0.toFixed(1)}" y="${cy + chartH + 38}" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#ffffff" fill-opacity="${live ? 0.62 : 0.3}">${MONTHS[i]}</text>`
  })
  if (pts.length > 1) o += `<polyline points="${pts.join(' ')}" fill="none" stroke="${GREEN}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" stroke-opacity=".9"/>` + pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="6" fill="${GREEN}"/>`).join('')
  if (s.byMonth[hi].spent > 0 && hi < s.monthsCounted) {
    const bx = P + axisW + slot * hi + slot / 2, by = yOf(s.byMonth[hi].spent) - 70
    const t = money(s.byMonth[hi].spent), tw = 40 + t.length * 15
    const tx = Math.min(W - P - tw, Math.max(P + axisW, bx - tw / 2))
    o += `<rect x="${tx}" y="${by}" width="${tw}" height="50" rx="14" fill="#2a1a5e" stroke="${LIGHT}" stroke-opacity=".6" stroke-width="2"/><path d="M${bx - 9} ${by + 50} l9 11 9 -11z" fill="#2a1a5e"/><text x="${tx + tw / 2}" y="${by + 34}" text-anchor="middle" font-family="${FONT}" font-size="25" font-weight="700" fill="#ffffff">${esc(t)}</text>`
  }

  // three tiles: earned (against last year), to family (as a share of income), days with no spending
  const ty = cy + chartH + 74, tw = (chartW - 40) / 3, th = 180
  const dEarn = vs(s.income, s.incomePrev)
  const tiles: { ic: string; lab: string; value: string; sub: string; subColor?: string; color: string }[] = [
    { ic: 'down', lab: 'EARNED', value: money(s.income), sub: dEarn !== null ? `${dEarn >= 0 ? '+' : '−'}${pct(dEarn)} vs last year` : 'so far this year', subColor: dEarn === null ? undefined : dEarn >= 0 ? GREEN : RED, color: GREEN },
    { ic: 'users', lab: 'TO FAMILY', value: money(s.family), sub: s.income > 0 ? `${Math.round((s.family / s.income) * 100)}% of income` : 'sent home', color: '#fbbf77' },
    { ic: 'calendar', lab: 'NO-SPEND DAYS', value: String(s.noSpendDays), sub: s.daysCounted > 0 ? `${Math.round((s.noSpendDays / s.daysCounted) * 100)}% of the year` : '', color: LIGHT },
  ]
  tiles.forEach((t, i) => {
    const x = P + i * (tw + 20)
    o += panel(x, ty, tw, th, 30)
    o += `<circle cx="${x + 54}" cy="${ty + 56}" r="32" fill="${t.color}" fill-opacity=".18"/>${icon(t.ic, x + 38, ty + 40, 32, t.color, 2.4)}`
    o += `<text x="${x + 100}" y="${ty + 63}" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff" fill-opacity=".62" letter-spacing="2">${t.lab}</text>`
    o += `<text x="${x + 28}" y="${ty + 122}" font-family="${FONT}" font-size="${t.value.length > 8 ? 36 : 44}" font-weight="800" fill="#ffffff">${esc(t.value)}</text>`
    o += `<text x="${x + 28}" y="${ty + 158}" font-family="${FONT}" font-size="22" fill="${t.subColor ?? '#ffffff'}" fill-opacity="${t.subColor ? 1 : 0.62}">${esc(t.sub)}</text>`
  })

  // where it went, each against last year
  const gy = ty + th + 56
  o += label('WHERE IT WENT', P + 6, gy)
  o += `<text x="${W - P}" y="${gy + 2}" text-anchor="end" font-family="${FONT}" font-size="26" font-weight="600" fill="${LIGHT}">View all categories →</text>`
  s.top.forEach((t, i) => {
    const y = gy + 28 + i * 86
    const d = vs(t.value, t.prev)
    o += `<circle cx="${P + 36}" cy="${y + 36}" r="36" fill="${t.color}"/>${icon(categoryIcon(t.label), P + 18, y + 18, 36, '#ffffff', 2.2)}`
    o += `<text x="${P + 92}" y="${y + 46}" font-family="${FONT}" font-size="32" font-weight="700" fill="#ffffff">${esc(t.label.slice(0, 14))}</text>`
    const bx = P + 290, bw = 200
    o += `<rect x="${bx}" y="${y + 28}" width="${bw}" height="16" rx="8" fill="#ffffff" fill-opacity=".1"/><rect x="${bx}" y="${y + 28}" width="${Math.max(16, bw * (t.pct / Math.max(1, s.top[0].pct)))}" height="16" rx="8" fill="url(#hz)"/>`
    o += `<text x="${P + 705}" y="${y + 46}" text-anchor="end" font-family="${FONT}" font-size="32" font-weight="700" fill="#ffffff">${esc(money(t.value))}</text><text x="${P + 775}" y="${y + 46}" text-anchor="end" font-family="${FONT}" font-size="27" fill="#ffffff" fill-opacity=".62">${t.pct}%</text>`
    if (d !== null) o += pill(W - P - pillW(pct(d), true), y + 10, pct(d), d > 0 ? RED : GREEN, d > 0 ? 'up' : 'down')
    if (i < s.top.length - 1) o += `<line x1="${P + 92}" y1="${y + 78}" x2="${W - P}" y2="${y + 78}" stroke="#ffffff" stroke-opacity=".1" stroke-width="2"/>`
  })

  // highlights: the biggest expense, and the longest run with no spending
  const hiY = gy + 28 + Math.max(1, s.top.length) * 86 + 20, hw = (chartW - 24) / 2, hhh = 176
  o += panel(P, hiY, hw, hhh, 30) + panel(P + hw + 24, hiY, hw, hhh, 30)
  if (s.biggest) {
    const lx = P + 26, ly = hiY + 24
    if (bigLogo) o += `<clipPath id="lg"><circle cx="${lx + 44}" cy="${ly + 44}" r="44"/></clipPath><image href="${bigLogo}" x="${lx}" y="${ly}" width="88" height="88" clip-path="url(#lg)"/>`
    else o += `<circle cx="${lx + 44}" cy="${ly + 44}" r="44" fill="${VIOLET}" fill-opacity=".35"/>${icon('star', lx + 26, ly + 26, 36, LIGHT, 2.2)}`
    const nm = (brand?.label ?? s.biggest.paymentReceiver).slice(0, 13)
    o += `<text x="${lx + 108}" y="${ly + 18}" font-family="${FONT}" font-size="19" font-weight="700" fill="#ffffff" fill-opacity=".62" letter-spacing="2">BIGGEST EXPENSE</text>`
    o += `<text x="${lx + 108}" y="${ly + 58}" font-family="${FONT}" font-size="34" font-weight="800" fill="#fff">${esc(nm)}</text>`
    o += `<text x="${lx + 108}" y="${ly + 100}" font-family="${FONT}" font-size="30" font-weight="800" fill="${LIGHT}">${esc(money(s.biggest.paymentAmount))}</text>`
    const share = s.spent > 0 ? `${Math.round((s.biggest.paymentAmount / s.spent) * 100)}% of total` : ''
    if (share) o += `<rect x="${lx + 108}" y="${ly + 112}" width="${40 + share.length * 12}" height="34" rx="17" fill="${VIOLET}" fill-opacity=".3"/><text x="${lx + 108 + 20}" y="${ly + 136}" font-family="${FONT}" font-size="20" font-weight="600" fill="${LIGHT}">${esc(share)}</text>`
  } else o += `<text x="${P + 30}" y="${hiY + 90}" font-family="${FONT}" font-size="28" fill="#fff" fill-opacity=".62">No expenses yet</text>`
  const sx = P + hw + 24 + 26
  o += `<circle cx="${sx + 44}" cy="${hiY + 84}" r="44" fill="${GREEN}" fill-opacity=".18"/>${icon('target', sx + 24, hiY + 64, 40, GREEN, 2.4)}`
  o += `<text x="${sx + 108}" y="${hiY + 52}" font-family="${FONT}" font-size="19" font-weight="700" fill="#ffffff" fill-opacity=".62" letter-spacing="2">LONGEST STREAK</text>`
  o += `<text x="${sx + 108}" y="${hiY + 100}" font-family="${FONT}" font-size="40" font-weight="800" fill="#fff">${s.longestStreak}<tspan font-size="24" font-weight="500" fill-opacity=".75"> day${s.longestStreak === 1 ? '' : 's'} no spend</tspan></text>`
  if (s.streakFrom && s.streakTo) o += `<text x="${sx + 108}" y="${hiY + 138}" font-family="${FONT}" font-size="23" fill="#ffffff" fill-opacity=".6">${esc(`${dayText(s.streakFrom)} – ${dayText(s.streakTo)}`)}</text>`

  // savings, only when there is room above the footer
  let ey = hiY + hhh + 46
  const rows: string[] = []
  if (s.emergencyNow > 0 || s.emergencyAdded > 0) rows.push(`Emergency fund ${money(s.emergencyNow)}${s.emergencyAdded > 0 ? `, grew by ${money(s.emergencyAdded)}` : ''}${s.monthsCovered !== null ? ` (${s.monthsCovered} months covered)` : ''}`)
  if (s.onPlan.total > 0) rows.push(`${s.onPlan.good} of ${s.onPlan.total} month${s.onPlan.total === 1 ? '' : 's'} within the plan`)
  if (s.bestSaving) rows.push(`Best saving month: ${MONTH_NAMES[s.bestSaving.m]}, ${money(s.bestSaving.amount)}`)
  if (s.shop && s.shop.sales > 0) rows.push(`Shop: ${money(s.shop.sales)} sales, ${money(s.shop.profit)} kept after costs`)
  const room = Math.floor((H - 124 - ey - 30) / 44)
  if (rows.length && room >= 1) {
    o += label('SAVINGS', P + 6, ey - 8)
    rows.slice(0, Math.min(2, room)).forEach((r, i) => { o += `<circle cx="${P + 16}" cy="${ey + 26 + i * 44 - 9}" r="6" fill="${MINT}"/><text x="${P + 38}" y="${ey + 26 + i * 44}" font-family="${FONT}" font-size="27" fill="#ffffff" fill-opacity=".86">${esc(r.length > 62 ? `${r.slice(0, 61)}…` : r)}</text>` })
  }

  // footer
  o += `<line x1="${P}" y1="${H - 100}" x2="${W - P}" y2="${H - 100}" stroke="#ffffff" stroke-opacity=".14" stroke-width="2"/>
<circle cx="${P + 10}" cy="${H - 56}" r="9" fill="${GREEN}"/>
<text x="${P + 32}" y="${H - 46}" font-family="${FONT}" font-size="27" fill="#ffffff"><tspan font-weight="800">Just</tspan><tspan font-style="italic" fill="${LIGHT}">Money</tspan><tspan fill-opacity=".62"> · ${s.count} transactions</tspan></text>
<text x="${W - P}" y="${H - 46}" text-anchor="end" font-family="${FONT}" font-size="25" fill="#ffffff" fill-opacity=".55">Arya Sharma  |  Fragnite</text>`

  return retheme(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${o}</svg>`)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export async function storyImage(s: Story, name: string): Promise<Blob> {
  const svg = await storySvg(s, name)
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Could not draw the card')); img.src = svgToUrl(svg) })
  const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H
  c.getContext('2d')!.drawImage(img, 0, 0, CARD_W, CARD_H)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the card'))), 'image/png'))
}

export { getPlanSettings }
