import { describe, expect, it } from 'vitest'
import { investmentResult, xirr } from './invest'
import type { Investment } from '../core/types'

const DAY = 86400000
const inv = (o: Partial<Investment>): Investment => ({ id: 'i1', type: 'IPO', name: 'Jio', invested: 15000, currentValue: 0, createdAt: 0, updatedAt: 0, ...o })

describe('investment result', () => {
  it('shows profit, time held and the annualised return for a closed IPO', () => {
    const t0 = Date.UTC(2026, 0, 1)
    const r = investmentResult(inv({
      closedAt: t0 + 100 * DAY,
      flows: [{ id: 'a', date: t0, amount: 15000, kind: 'IN' }, { id: 'b', date: t0 + 100 * DAY, amount: 25000, kind: 'OUT' }],
    }))
    expect(r.put).toBe(15000)
    expect(r.back).toBe(25000)
    expect(r.profit).toBe(10000)
    expect(Math.round(r.pct)).toBe(67)
    expect(r.days).toBe(100)
    expect(r.perYear).toBeGreaterThan(3) // 67% in 100 days is several hundred percent a year
  })
  it('shows a loss', () => {
    const t0 = Date.UTC(2026, 0, 1)
    const r = investmentResult(inv({ closedAt: t0 + 10 * DAY, flows: [{ id: 'a', date: t0, amount: 10000, kind: 'IN' }, { id: 'b', date: t0 + 10 * DAY, amount: 8000, kind: 'OUT' }] }))
    expect(r.profit).toBe(-2000)
    expect(r.perYear).toBeNull() // too short to annualise
  })
  it('values an open holding at what it is worth now', () => {
    const r = investmentResult(inv({ type: 'MF', invested: 10000, currentValue: 12000, flows: [{ id: 'a', date: Date.now() - 365 * DAY, amount: 10000, kind: 'IN' }] }))
    expect(r.profit).toBe(2000)
    expect(r.perYear!).toBeGreaterThan(0.19)
    expect(r.perYear!).toBeLessThan(0.21)
  })
})

describe('xirr', () => {
  it('is about 10% for 100 growing to 110 in a year', () => {
    const r = xirr([{ date: 0, amount: -100 }, { date: 365.25 * DAY, amount: 110 }])!
    expect(r).toBeGreaterThan(0.099)
    expect(r).toBeLessThan(0.101)
  })
  it('cannot be worked out without money both ways', () => expect(xirr([{ date: 0, amount: -100 }])).toBeNull())
})
