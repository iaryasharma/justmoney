import { describe, expect, it } from 'vitest'
import { splitEntries } from '../capture/quick'
import { milestones, priceCreep, explainChange } from '../reports/analysis'
import { planPurchase, raises, savingsRateByMonth } from './planning'
import type { Transaction } from '../core/types'

const DAY = 86400000
let n = 0
const tx = (receiver: string, amount: number, at: number, o: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, timestamp: at, paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: receiver, paymentCategory: 'Others', createdAt: at, updatedAt: at, ...o,
})

describe('several payments in one line', () => {
  it('splits on commas, "and" and new lines when each part has an amount', () => {
    expect(splitEntries('tea 20, auto 100 and lunch 250')).toEqual(['tea 20', 'auto 100', 'lunch 250'])
    expect(splitEntries('tea 20\nauto 100')).toEqual(['tea 20', 'auto 100'])
  })
  it('keeps one payment as one', () => {
    expect(splitEntries('paid 250 to Ramesh for tea')).toEqual(['paid 250 to Ramesh for tea'])
    expect(splitEntries('paid rent, 12,000 to landlord')).toEqual(['paid rent, 12,000 to landlord'])
    expect(splitEntries('bought milk, bread 80')).toEqual(['bought milk, bread 80'])
  })
})

describe('big purchase plan', () => {
  it('spreads the price over the weeks left', () => {
    const now = Date.UTC(2026, 0, 1)
    const p = planPurchase({ price: 52000, by: now + 26 * 7 * DAY, now })
    expect(p.weeks).toBe(26)
    expect(p.perWeek).toBeCloseTo(2000, 5)
  })
  it('prices an EMI with interest', () => {
    const p = planPurchase({ price: 60000, by: Date.now() + 90 * DAY, emiMonths: 12, emiRate: 12 })
    expect(p.emi).toBeGreaterThan(5000)
    expect(p.interest).toBeGreaterThan(3000)
    expect(p.emiTotal).toBeGreaterThan(60000)
  })
  it('an interest-free EMI costs nothing extra', () => expect(planPurchase({ price: 12000, by: Date.now() + DAY, emiMonths: 12, emiRate: 0 }).interest).toBe(0))
})

describe('pay history', () => {
  it('shows each raise against the one before', () => {
    const r = raises([{ id: 'a', date: 1, amount: 50000 }, { id: 'b', date: 2, amount: 55000 }])
    expect(r[1].change).toBe(5000)
    expect(r[1].pct).toBeCloseTo(10, 5)
  })
  it('works out the share of income kept', () => {
    const now = new Date(2026, 5, 15)
    const at = new Date(2026, 5, 3).getTime()
    const rows = savingsRateByMonth([tx('Pay', 100000, at, { paymentType: 'CREDIT', paymentCategory: 'Salary' }), tx('Shop', 60000, at)], (t) => t.paymentType === 'DEBIT', (t) => t.paymentType === 'CREDIT', 1, now)
    expect(rows[0].rate).toBeCloseTo(40, 5)
  })
})

describe('readings of your own spending', () => {
  it('names the category that moved the month', () => {
    const jan = new Date(2026, 0, 10).getTime(), feb = new Date(2026, 1, 10).getTime()
    const all = [tx('A', 1000, jan, { paymentCategory: 'Food' }), tx('B', 3000, feb, { paymentCategory: 'Food' }), tx('C', 500, jan, { paymentCategory: 'Travel' }), tx('C', 500, feb, { paymentCategory: 'Travel' })]
    const r = explainChange(all, new Set(), 2026, 1)
    expect(r.diff).toBe(2000)
    expect(r.reasons.join(' ')).toMatch(/Food went up/)
  })
  it('spots a price that crept up', () => {
    const start = Date.UTC(2026, 0, 1)
    const all = Array.from({ length: 9 }, (_, i) => tx('Milk Dairy', i < 3 ? 100 : i < 6 ? 110 : 130, start + i * 20 * DAY))
    const r = priceCreep(all)
    expect(r[0].title).toMatch(/\+30%/)
  })
  it('finds the next milestone', () => {
    const m = milestones(320000)
    expect(m.last).toBe(250000)
    expect(m.next).toBe(500000)
    expect(m.toNext).toBe(180000)
  })
})
