// Counts payments that usually qualify for Indian tax deductions in the current financial year (April–March).
import type { Transaction } from '../core/types'

export interface TaxSection { key: string; label: string; limit: number; match: RegExp; hint: string }

export const TAX_SECTIONS: TaxSection[] = [
  { key: '80C', label: 'Section 80C', limit: 150000, hint: 'LIC, PPF, ELSS, EPF, NSC, tuition, home-loan principal', match: /\b(lic|life insurance|ppf|elss|nsc|tax saver|epf|vpf|sukanya|ulip|tuition fee|home loan principal)\b/i },
  { key: '80D', label: 'Section 80D', limit: 25000, hint: 'Health insurance premiums', match: /(health insurance|mediclaim|star health|care health|niva bupa|medical insurance|hdfc ergo)/i },
  { key: '80CCD', label: 'NPS 80CCD(1B)', limit: 50000, hint: 'Extra NPS contribution', match: /\b(nps|national pension)\b/i },
]

/** [start, end) of the financial year containing `now`. */
export function fyRange(now = new Date()) {
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { start: new Date(y, 3, 1).getTime(), end: new Date(y + 1, 3, 1).getTime(), label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` }
}

export function taxSaverUsage(txns: Transaction[], now = new Date()) {
  const { start, end, label } = fyRange(now)
  const inFy = txns.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= start && t.timestamp < end)
  const sections = TAX_SECTIONS.map((s) => {
    const rows = inFy.filter((t) => s.match.test(`${t.paymentReceiver} ${t.note ?? ''} ${t.paymentCategory === 'Investments' ? 'investments' : ''}`))
    const used = rows.reduce((a, t) => a + t.paymentAmount, 0)
    return { ...s, used, left: Math.max(0, s.limit - used), pct: Math.min(100, Math.round((used / s.limit) * 100)), count: rows.length }
  })
  const daysLeft = Math.max(0, Math.ceil((end - now.getTime()) / 86400000))
  return { label, sections, daysLeft }
}
