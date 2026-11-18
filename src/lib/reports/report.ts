// A rich, printable PDF expense report: summary, account balances, category
// breakdown and a full itemised transaction table — with merchant and bank logos.
import { Filesystem, Directory } from '@capacitor/filesystem'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { accountBalance, getAccounts, isTransferCategory, tracksBalance } from '../accounts/accounts'
import { categoryColor } from '../core/data'
import { bankLogo, merchantLogo } from '../payees/brands'
import { formatDateTime, getCurrency, monthShort } from '../core/format'
import { isNativeApp } from '../core/native'
import { read, KEYS } from '../core/storage'
import type { Transaction } from '../core/types'
import { themeHex } from '../core/accent'

const BRAND = '#e63a2e' // spending / negative amounts
const accentColor = () => themeHex('#6d28d9') // report header, logo and table heads (the app's violet, or the chosen accent)
const GREEN = '#15803d'
const INK = '#1c1c1e'
const LOGO_URL = '/icon-512.png'
const FONT_REGULAR = '/fonts/NotoSans-Regular.ttf'
const FONT_BOLD = '/fonts/NotoSans-Bold.ttf'

const isSpend = (t: Transaction) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory)
const isIncome = (t: Transaction) => t.paymentType === 'CREDIT' && !isTransferCategory(t.paymentCategory)

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `hex` blended toward white by `amt` (0–1) — a flat tint, no PDF transparency needed. */
function tint(hex: string, amt: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex)
  const mix = (c: number) => Math.round(c + (255 - c) * amt)
  return [mix(r), mix(g), mix(b)]
}

/** The report embeds Noto Sans (which has the ₹ glyph), so money reads with a real rupee sign — the sign sits after the symbol ("₹ -500"), never glued to it ("-₹500"). */
function rs(amount: number, currency = getCurrency()) {
  if (currency !== 'INR') {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(amount))
    } catch { /* fall through */ }
  }
  const v = Math.round(amount)
  return `₹${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('en-IN')}`
}

/** Like `rs`, but always signed — for rows where credit/debit direction must read at a glance even though the amount itself is stored positive. */
function rsSigned(amount: number, credit: boolean, currency = getCurrency()) {
  if (currency !== 'INR') {
    const base = rs(Math.abs(amount), currency)
    return credit ? `+${base}` : `-${base}`
  }
  return `₹${credit ? '+' : '-'}${Math.round(Math.abs(amount)).toLocaleString('en-IN')}`
}

/** Fetches a .ttf and registers it with jsPDF's virtual filesystem so non-Latin glyphs (like ₹) render instead of the base-14 fonts' blank boxes. */
async function registerFont(doc: jsPDF, url: string, name: string, style: 'normal' | 'bold'): Promise<boolean> {
  try {
    const res = await fetch(url)
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    const file = `${name}-${style}.ttf`
    doc.addFileToVFS(file, btoa(binary))
    doc.addFont(file, name, style)
    return true
  } catch {
    return false
  }
}

/** Fetches a logo and flattens it to a PNG data URL (jsPDF embeds PNG/JPEG reliably; not every viewer decodes WEBP). */
async function toPng(url: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image failed'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 128
    canvas.height = img.naturalHeight || 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function monogram(doc: jsPDF, x: number, y: number, size: number, color: string, letter: string) {
  const [r, g, b] = hexToRgb(color)
  doc.setFillColor(r, g, b)
  doc.roundedRect(x, y, size, size, size * 0.3, size * 0.3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(size * 2.1)
  doc.text((letter || '?').toUpperCase(), x + size / 2, y + size / 2 + 0.2, { align: 'center', baseline: 'middle' })
}

function logoOrMonogram(doc: jsPDF, png: string | null | undefined, x: number, y: number, size: number, color: string, letter: string) {
  if (png) {
    try {
      doc.addImage(png, 'PNG', x, y, size, size, undefined, 'FAST')
      return
    } catch { /* fall through to monogram */ }
  }
  monogram(doc, x, y, size, color, letter)
}

export interface ReportSections { summary: boolean; accounts: boolean; categories: boolean; transactions: boolean; trends: boolean; budgets: boolean; notes: boolean }
export const DEFAULT_SECTIONS: ReportSections = { summary: true, accounts: true, categories: true, transactions: true, trends: true, budgets: false, notes: false }

export interface ReportOptions {
  /** What goes in the report (everything the old report had, plus trends, budgets and notes). */
  sections?: Partial<ReportSections>
  /** Show ••••• instead of amounts, for a report that will be shared. */
  hideAmounts?: boolean
  /** The month the report ends on, for the trend chart and the budget comparison; null for an all-time or custom report. */
  month?: { year: number; month: number } | null
  /** Shown in the header, e.g. "October 2026" or "All time". */
  title: string
  /** The report's own transactions (already scoped to the period). */
  txns: Transaction[]
  /** The device's full transaction history — account balances need everything since the opening date, not just this period. */
  allTxns: Transaction[]
}

export async function buildExpenseReportPdf({ title, txns, allTxns, sections, hideAmounts, month }: ReportOptions): Promise<Blob> {
  const sec = { ...DEFAULT_SECTIONS, ...sections }
  const R = (v: number) => (hideAmounts ? '••••' : rs(v))
  const RS = (v: number, credit: boolean) => (hideAmounts ? '••••' : rsSigned(v, credit))
  const methods = getAccounts()
  const methodById = new Map(methods.map((m) => [m.id, m]))
  const sorted = [...txns].sort((a, b) => b.timestamp - a.timestamp)

  // Preload every logo this report needs, once each, converted to PNG.
  const cache = new Map<string, string | null>()
  const urls = new Set<string>()
  for (const t of sorted) { const u = merchantLogo(t.paymentReceiver); if (u) urls.add(u) }
  for (const m of methods) { const u = bankLogo(m.bank, m.name); if (u) urls.add(u) }
  await Promise.all([...urls].map(async (u) => cache.set(u, await toPng(u))))
  const logoFor = (url: string | null) => (url ? cache.get(url) ?? null : null)
  const appLogoPng = await toPng(LOGO_URL)

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 14
  const contentW = pageW - margin * 2

  const [regOk, boldOk] = await Promise.all([
    registerFont(doc, FONT_REGULAR, 'NotoSans', 'normal'),
    registerFont(doc, FONT_BOLD, 'NotoSans', 'bold'),
  ])
  const FONT = regOk && boldOk ? 'NotoSans' : 'helvetica'

  /* ---------- header ---------- */
  const logoSize = 14
  logoOrMonogram(doc, appLogoPng, margin, 8, logoSize, accentColor(), 'J')
  const titleX = margin + logoSize + 4
  doc.setFont(FONT, 'bold'); doc.setFontSize(22); doc.setTextColor(...hexToRgb(accentColor()))
  doc.text('JustMoney', titleX, 18)
  doc.setFont(FONT, 'normal'); doc.setFontSize(11); doc.setTextColor(90)
  doc.text(`Expense report — ${title}`, titleX, 25)
  doc.setFontSize(8.5); doc.setTextColor(150)
  doc.text(`Generated ${formatDateTime(Date.now())}`, pageW - margin, 16, { align: 'right' })
  doc.setDrawColor(225); doc.line(margin, 32, pageW - margin, 32)

  /* ---------- summary cards ---------- */
  const income = sorted.filter(isIncome).reduce((a, t) => a + t.paymentAmount, 0)
  const spent = sorted.filter(isSpend).reduce((a, t) => a + t.paymentAmount, 0)
  const net = income - spent
  const cards: { label: string; value: number; color: string }[] = [
    { label: 'Income', value: income, color: GREEN },
    { label: 'Spent', value: spent, color: BRAND },
    { label: 'Net', value: net, color: net >= 0 ? GREEN : BRAND },
  ]
  const gap = 6
  const boxW = (contentW - gap * 2) / 3
  if (sec.summary) cards.forEach((c, i) => {
    const x = margin + i * (boxW + gap)
    doc.setFillColor(...tint(c.color, 0.88))
    doc.roundedRect(x, 38, boxW, 24, 3, 3, 'F')
    doc.setTextColor(...hexToRgb(c.color)); doc.setFont(FONT, 'bold'); doc.setFontSize(14)
    doc.text(R(c.value), x + 5, 50)
    doc.setTextColor(120); doc.setFont(FONT, 'normal'); doc.setFontSize(9)
    doc.text(c.label, x + 5, 57)
  })
  let y = sec.summary ? 70 : 40

  /* ---------- account balances ---------- */
  const tracked = methods.filter(tracksBalance)
  if (sec.accounts && tracked.length) {
    doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...hexToRgb(INK))
    doc.text('Accounts', margin, y); y += 7
    for (const m of tracked) {
      const bal = accountBalance(m, allTxns, methods)
      logoOrMonogram(doc, logoFor(bankLogo(m.bank, m.name)), margin, y - 4.6, 6, m.color, m.name[0])
      doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(60)
      doc.text(`${m.name}${m.last4 ? ` ••${m.last4}` : ''}`, margin + 9, y)
      doc.setFont(FONT, 'bold')
      doc.setTextColor(...(bal < 0 ? hexToRgb(BRAND) : hexToRgb(INK)))
      doc.text(R(bal), pageW - margin, y, { align: 'right' })
      y += 7
    }
    y += 5
  }

  /* ---------- category breakdown ---------- */
  const byCat = new Map<string, number>()
  for (const t of sorted.filter(isSpend)) byCat.set(t.paymentCategory, (byCat.get(t.paymentCategory) ?? 0) + t.paymentAmount)
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  if (sec.categories && cats.length) {
    if (y > 250) { doc.addPage(); y = 20 }
    doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...hexToRgb(INK))
    doc.text('Spending by category', margin, y); y += 7
    const maxV = cats[0][1]
    for (const [cat, amt] of cats.slice(0, 12)) {
      if (y > 275) { doc.addPage(); y = 20 }
      const color = categoryColor(cat)
      doc.setFillColor(...hexToRgb(color)); doc.circle(margin + 1.4, y - 1.6, 1.4, 'F')
      doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(60)
      doc.text(cat, margin + 6, y)
      doc.setFont(FONT, 'bold'); doc.setTextColor(...hexToRgb(INK))
      doc.text(R(amt), pageW - margin, y, { align: 'right' })
      const barY = y + 1.6
      doc.setFillColor(238, 238, 240); doc.rect(margin, barY, contentW, 1.6, 'F')
      doc.setFillColor(...hexToRgb(color)); doc.rect(margin, barY, contentW * Math.max(0.02, amt / maxV), 1.6, 'F')
      y += 8.5
    }
    y += 4
  }

  /* ---------- trends and insights ---------- */
  if (sec.trends) {
    const endY = month?.year ?? new Date().getFullYear()
    const endM = month?.month ?? new Date().getMonth()
    const months = Array.from({ length: 6 }, (_, i) => new Date(endY, endM - 5 + i, 1))
    const per = months.map((d) => {
      const from = d.getTime(), to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
      const inM = allTxns.filter((t) => t.timestamp >= from && t.timestamp < to)
      return { label: monthShort(d.getMonth()), spend: inM.filter(isSpend).reduce((a, t) => a + t.paymentAmount, 0), income: inM.filter(isIncome).reduce((a, t) => a + t.paymentAmount, 0) }
    })
    const top = Math.max(1, ...per.flatMap((m) => [m.spend, m.income]))
    if (y > 200) { doc.addPage(); y = 20 }
    doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...hexToRgb(INK))
    doc.text('Last 6 months', margin, y); y += 6
    const chartH = 34, slotW = contentW / 6
    doc.setDrawColor(235); doc.line(margin, y + chartH, pageW - margin, y + chartH)
    per.forEach((m, i) => {
      const x = margin + i * slotW + slotW / 2
      const hs = (m.spend / top) * chartH, hi = (m.income / top) * chartH
      doc.setFillColor(...hexToRgb(BRAND)); if (hs > 0) doc.roundedRect(x - 7, y + chartH - hs, 6, hs, 1, 1, 'F')
      doc.setFillColor(...hexToRgb(GREEN)); if (hi > 0) doc.roundedRect(x + 1, y + chartH - hi, 6, hi, 1, 1, 'F')
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text(m.label, x, y + chartH + 5, { align: 'center' })
    })
    doc.setFontSize(8); doc.setTextColor(...hexToRgb(BRAND)); doc.text('Spent', margin, y - 1.5)
    doc.setTextColor(...hexToRgb(GREEN)); doc.text('Income', margin + 14, y - 1.5)
    y += chartH + 12
    // a few plain-language findings from this period
    const total = cats.reduce((a, c) => a + c[1], 0)
    const facts: string[] = []
    if (cats[0] && total > 0) facts.push(`${cats[0][0]} was the biggest spend: ${hideAmounts ? '' : `${R(cats[0][1])}, `}${Math.round((cats[0][1] / total) * 100)}% of all spending.`)
    const places = new Map<string, number>()
    for (const t of sorted.filter(isSpend)) places.set(t.paymentReceiver, (places.get(t.paymentReceiver) ?? 0) + t.paymentAmount)
    const topPlace = [...places.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topPlace) facts.push(`Most money went to ${topPlace[0]}${hideAmounts ? '' : ` (${R(topPlace[1])})`}.`)
    const days = new Set(sorted.filter(isSpend).map((t) => new Date(t.timestamp).toDateString())).size
    if (days) facts.push(`You spent on ${days} different day${days === 1 ? '' : 's'}${hideAmounts ? '' : `, about ${R(spent / days)} on each`}.`)
    if (facts.length) {
      doc.setFont(FONT, 'bold'); doc.setFontSize(11); doc.setTextColor(...hexToRgb(INK)); doc.text('Insights', margin, y); y += 6
      doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(70)
      for (const f of facts) { doc.text(`• ${f}`, margin + 1, y, { maxWidth: contentW - 2 }); y += 6 }
      y += 4
    }
  }

  /* ---------- budgets ---------- */
  if (sec.budgets && month) {
    const monthly = read<number>(KEYS.monthlyBudget, 0)
    const catBudgets = Object.entries(read<Record<string, number>>(KEYS.categoryBudgets, {})).filter(([, v]) => v > 0)
    if (monthly > 0 || catBudgets.length) {
      if (y > 235) { doc.addPage(); y = 20 }
      doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...hexToRgb(INK)); doc.text('Budgets', margin, y); y += 7
      const rows: [string, number, number][] = []
      if (monthly > 0) rows.push(['Whole month', spent, monthly])
      for (const [c, v] of catBudgets) rows.push([c, byCat.get(c) ?? 0, v])
      for (const [label, used, cap] of rows) {
        if (y > 275) { doc.addPage(); y = 20 }
        const over = used > cap
        doc.setFont(FONT, 'normal'); doc.setFontSize(10); doc.setTextColor(60); doc.text(label, margin, y)
        doc.setFont(FONT, 'bold'); doc.setTextColor(...hexToRgb(over ? BRAND : INK))
        doc.text(hideAmounts ? '••••' : `${R(used)} of ${R(cap)}`, pageW - margin, y, { align: 'right' })
        doc.setFillColor(238, 238, 240); doc.rect(margin, y + 1.6, contentW, 1.6, 'F')
        doc.setFillColor(...hexToRgb(over ? BRAND : GREEN)); doc.rect(margin, y + 1.6, contentW * Math.min(1, used / cap), 1.6, 'F')
        y += 8.5
      }
      y += 4
    }
  }

  /* ---------- transactions table ---------- */
  if (sec.transactions) {
  if (y > 255) { doc.addPage(); y = 20 }
  doc.setFont(FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(...hexToRgb(INK))
  doc.text(`Transactions (${sorted.length})`, margin, y); y += 4

  const accountLabel = (t: Transaction) => {
    const m = t.paymentMethodId ? methodById.get(t.paymentMethodId) : undefined
    return m ? `${m.name}${m.last4 ? ` ••${m.last4}` : ''}` : '—'
  }
  const body = sorted.map((t) => [
    '', t.paymentReceiver, formatDateTime(t.timestamp, t.timeUnknown), t.paymentCategory, '', accountLabel(t),
    ...(sec.notes ? [(t.note ?? '').replace(/\s+/g, ' ').trim()] : []),
    RS(t.paymentAmount, t.paymentType === 'CREDIT'),
  ])

  autoTable(doc, {
    startY: y,
    head: [['', 'Receiver', 'Date & time', 'Category', '', 'Account', ...(sec.notes ? ['Note'] : []), 'Amount']],
    body,
    margin: { left: margin, right: margin, bottom: 16 },
    styles: { font: FONT, fontSize: 8.5, cellPadding: { top: 2.6, bottom: 2.6, left: 1.5, right: 1.5 }, valign: 'middle', textColor: hexToRgb(INK) },
    headStyles: { fillColor: hexToRgb(accentColor()), textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 248, 250] },
    columnStyles: {
      0: { cellWidth: 7 },
      1: { cellWidth: 40 },
      2: { cellWidth: 29 },
      3: { cellWidth: 26 },
      4: { cellWidth: 7 },
      5: { cellWidth: sec.notes ? 24 : 32 },
      ...(sec.notes ? { 6: { cellWidth: 30 }, 7: { cellWidth: 'auto', halign: 'right', fontStyle: 'bold' } } : { 6: { cellWidth: 'auto', halign: 'right', fontStyle: 'bold' } }),
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      if (data.column.index === 0 || data.column.index === 4) data.cell.text = []
      // A row split across a page break gets a continuation piece indexed -1 — nothing to look up for it.
      const t = sorted[data.row.index]
      if (!t) return
      if (data.column.index === (sec.notes ? 7 : 6)) data.cell.styles.textColor = t.paymentType === 'CREDIT' ? hexToRgb(GREEN) : hexToRgb(BRAND)
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return
      const t = sorted[data.row.index]
      if (!t) return
      const size = Math.min(data.cell.height - 1.4, 5)
      const cx = data.cell.x + (data.cell.width - size) / 2
      const cy = data.cell.y + (data.cell.height - size) / 2
      if (data.column.index === 0) {
        const url = merchantLogo(t.paymentReceiver)
        logoOrMonogram(doc, logoFor(url), cx, cy, size, categoryColor(t.paymentCategory), t.paymentReceiver[0] ?? '?')
      } else if (data.column.index === 4) {
        const m = t.paymentMethodId ? methodById.get(t.paymentMethodId) : undefined
        if (m) logoOrMonogram(doc, logoFor(bankLogo(m.bank, m.name)), cx, cy, size, m.color, m.name[0])
      }
    },
  })
  }

  /* ---------- footer ---------- */
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(235); doc.line(margin, 284, pageW - margin, 284)
    doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(160)
    doc.text(`JustMoney · Page ${i} of ${pages}`, pageW / 2, 289, { align: 'center' })
    doc.setFontSize(7); doc.setTextColor(195)
    doc.text('Crafted by Arya Sharma', pageW / 2, 293.5, { align: 'center' })
  }

  return doc.output('blob')
}

/** Reports made this session, so tapping "Report ready" can show them even where the file isn't readable (browser). */
export const recentReports = new Map<string, Blob>()

export function reportFilename(year: number, month: number | null) {
  return month == null ? 'justmoney-report-all-time.pdf' : `justmoney-report-${monthShort(month).toLowerCase()}-${year}.pdf`
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Saves the PDF: a plain download in the browser; on the phone, into
 * Documents/JustMoney (same place the backups go), with a share sheet offered
 * as a bonus so the report can be opened or sent on straight away.
 */
export async function savePdfReport(blob: Blob, filename: string, opts: { share?: boolean } = {}): Promise<{ savedTo?: string }> {
  recentReports.set(filename, blob)
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: filename })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return {}
  }
  try {
    const p = await Filesystem.checkPermissions()
    if (p.publicStorage !== 'granted') await Filesystem.requestPermissions()
  } catch { /* not required on newer Android */ }
  const data = await blobToBase64(blob)
  await Filesystem.writeFile({ path: `JustMoney/${filename}`, data, directory: Directory.Documents, recursive: true })
  try {
    if (opts.share === false) return { savedTo: `Documents/JustMoney/${filename}` }
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: filename })
  } catch { /* sharing is a bonus, saving to Documents already succeeded */ }
  return { savedTo: `Documents/JustMoney/${filename}` }
}
