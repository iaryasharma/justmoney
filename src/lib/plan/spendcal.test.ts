import { describe, it, expect } from 'vitest'
import { dayInsight, levelOf, monthDays, monthStats, patterns, thresholdsOf, categoriesOf } from './spendcal'
import type { Transaction } from '../core/types'

const tx = (id: string, y: number, m: number, d: number, amt: number, cat = 'Food', type: 'DEBIT' | 'CREDIT' = 'DEBIT'): Transaction =>
  ({ id, timestamp: new Date(y, m, d, 12).getTime(), paymentAmount: amt, paymentType: type, paymentReceiver: 'x', paymentCategory: cat, createdAt: 0, updatedAt: 0 } as Transaction)

describe('spending calendar', () => {
  const all = [tx('1', 2026, 9, 2, 100), tx('2', 2026, 9, 2, 50, 'Travel'), tx('3', 2026, 9, 10, 900), tx('4', 2026, 9, 11, 40), tx('5', 2026, 9, 12, 5000, 'Self transfer'), tx('6', 2026, 9, 12, 7000, 'Salary', 'CREDIT'), tx('7', 2026, 8, 5, 300)]
  it('adds up each day, leaving out transfers and income', () => {
    const d = monthDays(all, 2026, 9)
    expect(d).toHaveLength(31)
    expect(d[1]).toMatchObject({ total: 150, count: 2 })
    expect(d[11].total).toBe(0)
  })
  it('works out heat levels from the days that had spending', () => {
    const d = monthDays(all, 2026, 9)
    const th = thresholdsOf(d)
    expect(levelOf(0, th)).toBe(0)
    expect(levelOf(900, th)).toBe(4)
    expect(levelOf(40, th)).toBe(1)
    expect(levelOf(150, th)).toBe(2)
  })
  it('month stats against the same days last month', () => {
    const s = monthStats(all, 2026, 9, new Date(2026, 9, 15))
    expect(s.total).toBe(1090)
    expect(s.top[0].day).toBe(10)
    expect(s.noSpend).toBe(12) // 15 days so far, 3 with spending
    expect(s.prevTotal).toBe(300)
    expect(s.change).toBe(263)
  })
  it('categories with their share and last month', () => {
    const c = categoriesOf(all, 2026, 9)
    expect(c[0]).toMatchObject({ cat: 'Food', total: 1040, prev: 300 })
    expect(c.find((x) => x.cat === 'Travel')?.pct).toBe(5)
  })
  it('says something about a day', () => {
    const d = monthDays(all, 2026, 9)
    expect(dayInsight(d[9], 100)).toMatch(/more than your daily average/)
    expect(dayInsight(d[11], 100)).toBe('Nothing was spent this day.')
  })
  it('finds the week\'s rhythm only when there is enough to go on', () => {
    expect(patterns(all, 2026, 9, new Date(2026, 9, 15))).toEqual([])
    const lots: Transaction[] = []
    for (let i = 0; i < 90; i++) { const dt = new Date(2026, 9, 28 - i); lots.push(tx(`p${i}`, dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getDay() === 6 || dt.getDay() === 0 ? 600 : 200)) }
    const p = patterns(lots, 2026, 9, new Date(2026, 9, 28))
    expect(p.find((x) => x.key === 'weekend')?.body).toMatch(/200% more/)
    expect(p.find((x) => x.key === 'highest')).toBeTruthy()
  })
})
