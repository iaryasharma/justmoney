// Numbers for the monthly recap, and the branded card drawn from them (one SVG, shown in the app and exported as the share image).
import { read, KEYS } from '../core/storage'
import { categoryColor, categoryIcon } from '../core/data'
import { committedCategories, isIncome, isPersonalSpend } from '../core/money'
import { formatPrice, monthShort } from '../core/format'
import { brandLogo, merchantBrand } from '../payees/brands'
import { ICON_SVG } from '../core/iconPaths'
import type { Commitment, Transaction } from '../core/types'
import { retheme } from '../core/accent'

export interface Recap {
  year: number; month: number
  spent: number; received: number; saved: number; savingsRate: number | null
  count: number
  top: { label: string; value: number; pct: number; color: string }[]
  biggest: Transaction | null
  busiest: { day: number; total: number } | null
  /** spending on each day of the month (index 0 = the 1st) */
  daily: number[]
  noSpendDays: number; longestStreak: number; daysCounted: number
  prevSpent: number; change: number | null
}

const inMonth = (all: Transaction[], y: number, m: number) => {
  const a = new Date(y, m, 1).getTime(), b = new Date(y, m + 1, 1).getTime()
  return all.filter((t) => t.timestamp >= a && t.timestamp < b)
}

export function buildRecap(year: number, month: number, now = new Date()): Recap {
  const all = read<Transaction[]>(KEYS.transactions, [])
  const committed = committedCategories(read<Commitment[]>(KEYS.commitments, []))
  const txns = inMonth(all, year, month)
  const spend = txns.filter((t) => isPersonalSpend(t, committed))
  const spent = spend.reduce((a, t) => a + t.paymentAmount, 0)
  const received = txns.filter(isIncome).reduce((a, t) => a + t.paymentAmount, 0)

  const byCat = new Map<string, number>()
  spend.forEach((t) => byCat.set(t.paymentCategory, (byCat.get(t.paymentCategory) ?? 0) + t.paymentAmount))
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([label, value]) => ({ label, value, pct: spent ? Math.round((value / spent) * 100) : 0, color: categoryColor(label) }))

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daily = Array.from({ length: daysInMonth }, () => 0)
  spend.forEach((t) => { daily[new Date(t.timestamp).getDate() - 1] += t.paymentAmount })
  const byDay = new Map<number, number>()
  daily.forEach((v, i) => { if (v > 0) byDay.set(i + 1, v) })
  const busiestE = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]

  const isCurrent = year === now.getFullYear() && month === now.getMonth()
  const daysCounted = isCurrent ? now.getDate() : daysInMonth
  let noSpendDays = 0, streak = 0, longest = 0
  for (let d = 1; d <= daysCounted; d++) {
    if (!byDay.has(d)) { noSpendDays++; streak++; longest = Math.max(longest, streak) } else streak = 0
  }

  const pm = new Date(year, month - 1, 1)
  const prevSpent = inMonth(all, pm.getFullYear(), pm.getMonth()).filter((t) => isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)

  return {
    year, month, spent, received, saved: received - spent, savingsRate: received > 0 ? Math.round(((received - spent) / received) * 100) : null,
    count: txns.length, top,
    biggest: [...spend].sort((a, b) => b.paymentAmount - a.paymentAmount)[0] ?? null,
    busiest: busiestE ? { day: busiestE[0], total: busiestE[1] } : null,
    daily, noSpendDays, longestStreak: longest, daysCounted,
    prevSpent, change: prevSpent > 0 && spent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null,
  }
}

/** One-line headline for the card. */
export function recapHeadline(r: Recap) {
  if (!r.spent) return 'A quiet month'
  if (r.change != null && r.change <= -10) return `You spent ${Math.abs(r.change)}% less than last month`
  if (r.change != null && r.change >= 10) return `Spending was up ${r.change}% on last month`
  if (r.savingsRate != null && r.savingsRate >= 30) return `You saved ${r.savingsRate}% of your income`
  return 'Your month in money'
}

/* ---------- the card ---------- */

export const CARD_W = 1080
export const CARD_H = 1800
export const FONT = "'Google Sans','Product Sans','Segoe UI',Roboto,system-ui,sans-serif"
export const VIOLET = '#8b5cf6', LIGHT = '#c4b5fd', MINT = '#34D399', RED = '#ff7a7a', GREEN = '#6ef06e'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const dataUri = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((ok, bad) => { const f = new FileReader(); f.onloadend = () => ok(String(f.result)); f.onerror = () => bad(f.error); f.readAsDataURL(blob) })
  } catch { return null }
}

/** A stroked app icon at (x, y), `size` px square. */
export const icon = (name: string, x: number, y: number, size: number, color: string, stroke = 2) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICON_SVG[name] ?? ICON_SVG.tag}</g>`

export const wrap = (text: string, max: number) => {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 2)
}

/** The whole recap as a 1080×1800 SVG string, with the app icon and merchant logo embedded. */
export async function recapSvg(r: Recap, name: string): Promise<string> {
  const W = CARD_W, H = CARD_H, P = 72
  const money = (v: number) => formatPrice(v, { round: true })
  const brand = r.biggest ? merchantBrand(r.biggest.paymentReceiver) : null
  const [appIcon, bigLogo] = await Promise.all([dataUri('/icon-192.png'), brand ? dataUri(brandLogo(brand.key)) : Promise.resolve(null)])
  let s = ''

  // background: black with violet light rising from the bottom, like the app icon
  s += `<defs>
<radialGradient id="glow" cx="50%" cy="100%" r="92%"><stop offset="0" stop-color="#a47bff" stop-opacity=".9"/><stop offset=".2" stop-color="#6d36d6" stop-opacity=".85"/><stop offset=".5" stop-color="#2a0f5c" stop-opacity=".9"/><stop offset="1" stop-color="#06030d" stop-opacity="1"/></radialGradient>
<radialGradient id="top" cx="90%" cy="0%" r="60%"><stop offset="0" stop-color="${VIOLET}" stop-opacity=".28"/><stop offset="1" stop-color="${VIOLET}" stop-opacity="0"/></radialGradient>
<linearGradient id="mk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3d9ff"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
<clipPath id="ico"><rect x="${P}" y="64" width="104" height="104" rx="26"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="#06030d"/><rect width="${W}" height="${H}" fill="url(#glow)"/><rect width="${W}" height="${H}" fill="url(#top)"/>`

  // header: app icon, wordmark, tagline, month
  if (appIcon) s += `<image href="${appIcon}" x="${P}" y="64" width="104" height="104" clip-path="url(#ico)"/><rect x="${P}" y="64" width="104" height="104" rx="26" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="2"/>`
  s += `<text x="${P + 128}" y="120" font-family="${FONT}" font-size="54" fill="#ffffff"><tspan font-weight="800">Just</tspan><tspan font-style="italic" font-weight="400" fill="${LIGHT}">Money</tspan></text>
<text x="${P + 128}" y="158" font-family="${FONT}" font-size="25" fill="#ffffff" fill-opacity=".6">Track smarter. Spend better.</text>
<rect x="${W - P - 262}" y="82" width="262" height="68" rx="34" fill="#ffffff" fill-opacity=".1" stroke="#ffffff" stroke-opacity=".2" stroke-width="2"/>
<text x="${W - P - 131}" y="126" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff" letter-spacing="2">${esc(monthShort(r.month).toUpperCase())} ${r.year}</text>`

  // headline
  const lines = wrap(recapHeadline(r), 26)
  lines.forEach((l, i) => { s += `<text x="${P}" y="${290 + i * 62}" font-family="${FONT}" font-size="56" font-weight="800" fill="#ffffff">${esc(l)}</text>` })
  const hy = 290 + (lines.length - 1) * 62
  s += `<text x="${P}" y="${hy + 50}" font-family="${FONT}" font-size="30" fill="#ffffff" fill-opacity=".6">${esc(name ? `${name}’s month in money` : 'Your month in money')}</text>`

  // spent
  const sy = hy + 150
  s += `<text x="${P}" y="${sy}" font-family="${FONT}" font-size="26" font-weight="700" fill="#ffffff" fill-opacity=".55" letter-spacing="5">SPENT</text>`
  const amt = money(r.spent)
  const size = Math.min(168, Math.floor(880 / Math.max(4, amt.length) * 1.75))
  s += `<text x="${P}" y="${sy + 150}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="#ffffff" letter-spacing="-4">${esc(amt)}</text>`
  if (r.change != null) {
    const up = r.change >= 0, c = up ? RED : GREEN
    const label = `${Math.abs(r.change)}% vs last month`
    const w = 70 + label.length * 19
    s += `<rect x="${P}" y="${sy + 186}" width="${w}" height="58" rx="29" fill="${c}" fill-opacity=".16" stroke="${c}" stroke-opacity=".4" stroke-width="2"/>`
    s += icon(up ? 'up' : 'down', P + 20, sy + 200, 30, c, 2.6)
    s += `<text x="${P + 62}" y="${sy + 226}" font-family="${FONT}" font-size="30" font-weight="700" fill="${c}">${esc(label)}</text>`
  }

  // daily spending bars
  const cy = sy + 300
  const n = r.daily.length, max = Math.max(1, ...r.daily), chartW = W - P * 2, slot = chartW / n, barW = slot * 0.6, chartH = 150
  s += `<text x="${P}" y="${cy - 14}" font-family="${FONT}" font-size="24" font-weight="700" fill="#ffffff" fill-opacity=".55" letter-spacing="4">DAY BY DAY</text>`
  const busiest = r.busiest?.day ?? -1
  r.daily.forEach((v, i) => {
    const x = P + slot * i + (slot - barW) / 2
    const h = v > 0 ? Math.max(10, (v / max) * chartH) : 5
    const fill = v <= 0 ? '#ffffff' : i + 1 === busiest ? LIGHT : VIOLET
    const op = v <= 0 ? 0.18 : i + 1 === busiest ? 1 : 0.75
    s += `<rect x="${x.toFixed(1)}" y="${(cy + chartH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${(barW / 2.4).toFixed(1)}" fill="${fill}" fill-opacity="${op}"/>`
  })
  s += `<text x="${P}" y="${cy + chartH + 34}" font-family="${FONT}" font-size="22" fill="#ffffff" fill-opacity=".5">1</text><text x="${W - P}" y="${cy + chartH + 34}" text-anchor="end" font-family="${FONT}" font-size="22" fill="#ffffff" fill-opacity=".5">${n}</text>`
  if (r.busiest) s += `<text x="${W / 2}" y="${cy + chartH + 34}" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${LIGHT}">Busiest: ${r.busiest.day} ${esc(monthShort(r.month))} · ${esc(money(r.busiest.total))}</text>`

  // stat tiles
  const ty = cy + chartH + 80, tw = (chartW - 48) / 3
  const tiles: [string, string, string, string][] = [
    ['down', 'RECEIVED', money(r.received), GREEN],
    ['sparkles', 'SAVED', r.savingsRate != null ? `${r.savingsRate}%` : '—', LIGHT],
    ['calendar', 'NO-SPEND DAYS', String(r.noSpendDays), MINT],
  ]
  tiles.forEach(([ic, label, value, color], i) => {
    const x = P + i * (tw + 24)
    s += `<rect x="${x}" y="${ty}" width="${tw}" height="150" rx="30" fill="#ffffff" fill-opacity=".07" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>`
    s += icon(ic, x + 26, ty + 24, 34, color, 2.2)
    s += `<text x="${x + 72}" y="${ty + 49}" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff" fill-opacity=".6" letter-spacing="2">${label}</text>`
    s += `<text x="${x + 26}" y="${ty + 118}" font-family="${FONT}" font-size="${value.length > 8 ? 38 : 46}" font-weight="800" fill="#ffffff">${esc(value)}</text>`
  })

  // top categories with icons
  const gy = ty + 150 + 56
  s += `<text x="${P}" y="${gy}" font-family="${FONT}" font-size="24" font-weight="700" fill="#ffffff" fill-opacity=".55" letter-spacing="4">WHERE IT WENT</text>`
  r.top.forEach((t, i) => {
    const y = gy + 30 + i * 84
    s += `<circle cx="${P + 30}" cy="${y + 30}" r="30" fill="${t.color}"/>${icon(categoryIcon(t.label), P + 14, y + 14, 32, '#ffffff', 2.2)}`
    s += `<text x="${P + 80}" y="${y + 26}" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">${esc(t.label)}</text>`
    s += `<text x="${W - P}" y="${y + 26}" text-anchor="end" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff">${esc(money(t.value))}<tspan font-weight="500" fill-opacity=".6" font-size="28">  ·  ${t.pct}%</tspan></text>`
    s += `<rect x="${P + 80}" y="${y + 40}" width="${chartW - 80}" height="12" rx="6" fill="#ffffff" fill-opacity=".1"/><rect x="${P + 80}" y="${y + 40}" width="${Math.max(12, (chartW - 80) * (t.pct / 100))}" height="12" rx="6" fill="${t.color}"/>`
  })

  // highlights: biggest expense (with the merchant's logo) and the longest streak
  const hiY = gy + 30 + Math.max(1, r.top.length) * 84 + 26, hw = (chartW - 24) / 2
  s += `<rect x="${P}" y="${hiY}" width="${hw}" height="120" rx="30" fill="#ffffff" fill-opacity=".07" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>`
  s += `<rect x="${P + hw + 24}" y="${hiY}" width="${hw}" height="120" rx="30" fill="#ffffff" fill-opacity=".07" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>`
  if (r.biggest) {
    const lx = P + 26, ly = hiY + 24
    if (bigLogo) s += `<clipPath id="lg"><circle cx="${lx + 36}" cy="${ly + 36}" r="36"/></clipPath><image href="${bigLogo}" x="${lx}" y="${ly}" width="72" height="72" clip-path="url(#lg)"/>`
    else s += `<circle cx="${lx + 36}" cy="${ly + 36}" r="36" fill="${VIOLET}"/><text x="${lx + 36}" y="${ly + 50}" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="800" fill="#fff">${esc((r.biggest.paymentReceiver.trim()[0] ?? '?').toUpperCase())}</text>`
    const nm = (brand?.label ?? r.biggest.paymentReceiver).slice(0, 15)
    s += `<text x="${lx + 92}" y="${ly + 22}" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff" fill-opacity=".6" letter-spacing="2">BIGGEST EXPENSE</text>`
    s += `<text x="${lx + 92}" y="${ly + 54}" font-family="${FONT}" font-size="30" font-weight="700" fill="#fff">${esc(nm)}</text>`
    s += `<text x="${lx + 92}" y="${ly + 86}" font-family="${FONT}" font-size="28" font-weight="800" fill="${LIGHT}">${esc(money(r.biggest.paymentAmount))}</text>`
  } else {
    s += `<text x="${P + 30}" y="${hiY + 70}" font-family="${FONT}" font-size="28" fill="#fff" fill-opacity=".6">No expenses yet</text>`
  }
  const sx = P + hw + 24 + 26
  s += `<circle cx="${sx + 36}" cy="${hiY + 60}" r="36" fill="${MINT}" fill-opacity=".18"/>${icon('target', sx + 18, hiY + 42, 36, MINT, 2.2)}`
  s += `<text x="${sx + 92}" y="${hiY + 46}" font-family="${FONT}" font-size="20" font-weight="700" fill="#ffffff" fill-opacity=".6" letter-spacing="2">LONGEST STREAK</text>`
  s += `<text x="${sx + 92}" y="${hiY + 90}" font-family="${FONT}" font-size="40" font-weight="800" fill="#fff">${r.longestStreak}<tspan font-size="26" font-weight="500" fill-opacity=".7"> day${r.longestStreak === 1 ? '' : 's'} no spend</tspan></text>`

  // footer
  s += `<line x1="${P}" y1="${H - 96}" x2="${W - P}" y2="${H - 96}" stroke="#ffffff" stroke-opacity=".14" stroke-width="2"/>
<circle cx="${P + 8}" cy="${H - 52}" r="8" fill="${MINT}"/>
<text x="${P + 28}" y="${H - 43}" font-family="${FONT}" font-size="27" fill="#ffffff"><tspan font-weight="800">Just</tspan><tspan font-style="italic" fill="${LIGHT}">Money</tspan><tspan fill-opacity=".55">  ·  ${r.count} transaction${r.count === 1 ? '' : 's'} tracked</tspan></text>
<text x="${W - P}" y="${H - 43}" text-anchor="end" font-family="${FONT}" font-size="25" fill="#ffffff" fill-opacity=".5">Arya Sharma  |  Fragnite</text>`

  return retheme(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`)
}

export const svgToUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** Rasterises the card to a PNG for sharing. */
export async function recapImage(r: Recap, name: string): Promise<Blob> {
  const svg = await recapSvg(r, name)
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Could not draw the card')); img.src = svgToUrl(svg) })
  const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H
  c.getContext('2d')!.drawImage(img, 0, 0, CARD_W, CARD_H)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the card'))), 'image/png'))
}
