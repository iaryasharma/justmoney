// Planning maths: saving up for a big purchase, and your pay over the years.
import { read, write, uid, KEYS } from '../core/storage'
import type { Transaction } from '../core/types'

const WEEK = 7 * 86400000

export interface PurchasePlan { need: number; weeks: number; perWeek: number; perMonth: number; emi: number; emiTotal: number; interest: number; emiCheaper: boolean }

/** What to set aside to buy something by a date, and what paying by EMI would cost instead. */
export function planPurchase(o: { price: number; downPayment?: number; by: number; now?: number; emiMonths?: number; emiRate?: number }): PurchasePlan {
  const now = o.now ?? Date.now()
  const need = Math.max(0, o.price)
  const weeks = Math.max(1, Math.ceil((o.by - now) / WEEK))
  const perWeek = need / weeks
  const months = Math.max(0, o.emiMonths ?? 0)
  const financed = Math.max(0, o.price - (o.downPayment ?? 0))
  const r = (o.emiRate ?? 0) / 100 / 12
  const emi = !months ? 0 : r === 0 ? financed / months : (financed * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
  const emiTotal = emi * months + (o.downPayment ?? 0)
  return { need, weeks, perWeek, perMonth: perWeek * (52 / 12), emi, emiTotal, interest: months ? Math.max(0, emiTotal - o.price) : 0, emiCheaper: false }
}

export interface PayEntry { id: string; date: number; amount: number; note?: string }
export const getPayLog = () => read<PayEntry[]>(KEYS.salaryLog, []).sort((a, b) => a.date - b.date)
export const addPay = (date: number, amount: number, note?: string) => write(KEYS.salaryLog, [...read<PayEntry[]>(KEYS.salaryLog, []), { id: uid(), date, amount, note }])
export const removePay = (id: string) => write(KEYS.salaryLog, read<PayEntry[]>(KEYS.salaryLog, []).filter((p) => p.id !== id))

/** Each pay change against the one before it. */
export function raises(log: PayEntry[]) {
  return log.map((p, i) => ({ ...p, change: i ? p.amount - log[i - 1].amount : 0, pct: i && log[i - 1].amount ? ((p.amount - log[i - 1].amount) / log[i - 1].amount) * 100 : 0 }))
}

/** Share of income kept each month, for the last `n` months: (income − spending) / income. */
export function savingsRateByMonth(all: Transaction[], isSpend: (t: Transaction) => boolean, isIncome: (t: Transaction) => boolean, n = 12, now = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)
    const inMonth = all.filter((t) => { const x = new Date(t.timestamp); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() })
    const income = inMonth.filter(isIncome).reduce((a, t) => a + t.paymentAmount, 0)
    const spent = inMonth.filter(isSpend).reduce((a, t) => a + t.paymentAmount, 0)
    return { year: d.getFullYear(), month: d.getMonth(), income, spent, rate: income > 0 ? ((income - spent) / income) * 100 : null }
  })
}
