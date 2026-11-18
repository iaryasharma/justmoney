import { describe, expect, it } from 'vitest'
import { spare } from '../plan/roundup'
import { simulate, type Debt } from '../plan/debt'
import { detectAnomalies } from '../payees/anomaly'
import { fyRange, taxSaverUsage } from '../plan/taxsaver'
import { badgeFor, challengeProgress, noSpendStreak, weekStartOf } from '../plan/savings'
import { cashInHand } from '../accounts/cash'
import { cycleOf } from '../accounts/card'
import { priceChanges, detectRecurring } from '../payees/recurring'
import { accountForHold, frozenFor, parseHold } from '../accounts/holds'
import { isBlockEvent } from './data'
import type { Transaction } from './types'

const DAY = 86400000
let n = 0
const tx = (o: Partial<Transaction> & { amount?: number; at?: number }): Transaction => ({
  id: `t${++n}`, timestamp: o.at ?? Date.now(), paymentAmount: o.amount ?? o.paymentAmount ?? 100, paymentType: 'DEBIT',
  paymentReceiver: 'Shop', paymentCategory: 'Others', createdAt: o.at ?? Date.now(), updatedAt: Date.now(), ...o,
})
const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime()

describe('round-ups', () => {
  it('rounds up to the next step', () => {
    expect(spare(245, 10)).toBe(5)
    expect(spare(245, 50)).toBe(5)
    expect(spare(201, 100)).toBe(99)
  })
  it('adds nothing when the amount already fits', () => {
    expect(spare(240, 10)).toBe(0)
    expect(spare(300, 100)).toBe(0)
  })
})

describe('debt payoff', () => {
  const debts: Debt[] = [
    { id: 'a', name: 'Card', balance: 10000, minimum: 500, rate: 36 },
    { id: 'b', name: 'Phone EMI', balance: 3000, minimum: 500, rate: 0 },
  ]
  it('clears everything and orders payoff', () => {
    const r = simulate(debts, 1000, 'avalanche')
    expect(r.never).toBe(false)
    expect(r.order.map((o) => o.name).sort()).toEqual(['Card', 'Phone EMI'])
  })
  it('avalanche never pays more interest than snowball', () => {
    const av = simulate(debts, 1000, 'avalanche'), sn = simulate(debts, 1000, 'snowball')
    expect(av.interest).toBeLessThanOrEqual(sn.interest)
  })
  it('extra payments finish sooner', () => {
    expect(simulate(debts, 3000, 'avalanche').months).toBeLessThan(simulate(debts, 0, 'avalanche').months)
  })
  it('flags a debt that can never clear', () => {
    expect(simulate([{ id: 'x', name: 'Loan', balance: 100000, minimum: 100, rate: 36 }], 0, 'avalanche').never).toBe(true)
  })
})

describe('unusual spend alerts', () => {
  const base = Date.now() - 40 * DAY
  const history = [0, 10, 20, 30].map((d) => tx({ paymentReceiver: 'Swiggy', amount: 400, at: base + d * DAY }))
  it('flags a charge 3x or more above the usual', () => {
    const big = tx({ paymentReceiver: 'Swiggy', amount: 2400 })
    const out = detectAnomalies([...history, big], [big])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('spike')
  })
  it('ignores a normal charge and small absolute jumps', () => {
    const ok = tx({ paymentReceiver: 'Swiggy', amount: 450 })
    const small = tx({ paymentReceiver: 'Swiggy', amount: 1200 }) // 3x but under ₹500 extra? 800 extra → flagged; use a tiny payee instead
    expect(detectAnomalies([...history, ok], [ok])).toHaveLength(0)
    const tiny = [0, 1, 2].map((d) => tx({ paymentReceiver: 'Chai', amount: 20, at: base + d * DAY }))
    const chai = tx({ paymentReceiver: 'Chai', amount: 90 })
    expect(detectAnomalies([...tiny, chai], [chai])).toHaveLength(0)
    expect(small.paymentAmount).toBe(1200)
  })
  it('needs history before calling something unusual', () => {
    const first = tx({ paymentReceiver: 'New Shop', amount: 5000 })
    expect(detectAnomalies([first], [first])).toHaveLength(0)
  })
  it('flags the same payment twice within minutes', () => {
    const a = tx({ paymentReceiver: 'Zomato', amount: 245, at: Date.now() - 4 * 60000 })
    const b = tx({ paymentReceiver: 'Zomato', amount: 245, at: Date.now() })
    expect(detectAnomalies([a, b], [b]).map((x) => x.kind)).toEqual(['duplicate'])
  })
})

describe('tax saver', () => {
  it('finds the financial year', () => {
    expect(fyRange(new Date(2026, 5, 1)).label).toBe('FY 2026-27')
    expect(fyRange(new Date(2027, 1, 1)).label).toBe('FY 2026-27')
  })
  it('counts qualifying payments against the limit', () => {
    const now = new Date(2026, 9, 28)
    const list = [
      tx({ paymentReceiver: 'LIC Premium', amount: 30000, at: noon(2026, 5, 10) }),
      tx({ paymentReceiver: 'Zerodha', note: 'ELSS fund', amount: 20000, at: noon(2026, 6, 10) }),
      tx({ paymentReceiver: 'Star Health', amount: 12000, at: noon(2026, 7, 1) }),
      tx({ paymentReceiver: 'LIC Premium', amount: 99999, at: noon(2025, 5, 10) }), // last financial year
    ]
    const u = taxSaverUsage(list, now)
    expect(u.sections.find((s) => s.key === '80C')!.used).toBe(50000)
    expect(u.sections.find((s) => s.key === '80C')!.left).toBe(100000)
    expect(u.sections.find((s) => s.key === '80D')!.used).toBe(12000)
  })
})

describe('streaks and challenge', () => {
  it('counts no-spend days back from today', () => {
    const now = new Date(2026, 9, 28, 15)
    const list = [tx({ at: noon(2026, 9, 24) }), tx({ at: noon(2026, 8, 1) })]
    expect(noSpendStreak(list, [], now).current).toBe(4) // 25, 26, 27 and today so far
  })
  it('a spend today ends the streak today', () => {
    const now = new Date(2026, 9, 28, 15)
    expect(noSpendStreak([tx({ at: noon(2026, 9, 28) }), tx({ at: noon(2026, 9, 1) })], [], now).current).toBe(0)
  })
  it('awards the highest badge reached', () => {
    expect(badgeFor(2)).toBe(0); expect(badgeFor(7)).toBe(7); expect(badgeFor(20)).toBe(14); expect(badgeFor(45)).toBe(30)
  })
  it('weeks start on Monday and the challenge tracks one category', () => {
    const wed = new Date(2026, 9, 28)
    const start = weekStartOf(wed)
    expect(new Date(start).getDay()).toBe(1)
    const p = challengeProgress([tx({ paymentCategory: 'Food', amount: 600, at: start + DAY }), tx({ paymentCategory: 'Travel', amount: 900, at: start + DAY })], { category: 'Food', cap: 500, weekStart: start }, start + 2 * DAY)
    expect(p.spent).toBe(600); expect(p.over).toBe(true)
  })
})

describe('cash in hand', () => {
  it('adds ATM withdrawals and takes off cash spends', () => {
    const c = cashInHand([
      tx({ paymentReceiver: 'ATM WDL Kotak', amount: 5000 }),
      tx({ paymentSource: 'CASH', amount: 800 }),
      tx({ paymentSource: 'CASH', amount: 200 }),
    ])
    expect(c.balance).toBe(4000)
    expect(c.has).toBe(true)
  })
  it('is empty without any cash activity', () => expect(cashInHand([tx({})]).has).toBe(false))
})

describe('credit card cycle', () => {
  const c = { statementDay: 12, dueDay: 2 }
  it('finds the cycle and the due date still ahead', () => {
    const r = cycleOf(c, new Date(2026, 9, 28)) // 28 Oct: last statement 12 Oct, due 2 Nov
    expect(new Date(r.statement).getMonth()).toBe(10)
    expect(new Date(r.statement).getDate()).toBe(12)
    expect(new Date(r.due).getMonth()).toBe(10)
    expect(new Date(r.due).getDate()).toBe(2)
  })
  it('moves on to the next due date once it has passed', () => {
    const r = cycleOf(c, new Date(2026, 10, 5)) // 5 Nov: paid 2 Nov already, next due 2 Dec
    expect(new Date(r.due).getMonth()).toBe(11)
  })
})

describe('price changes', () => {
  it('spots a subscription price hike', () => {
    const now = Date.now()
    const list = [90, 60, 30, 0].map((d, i) => tx({ paymentReceiver: 'Netflix', amount: i === 3 ? 649 : 499, at: now - d * DAY }))
    const found = priceChanges(list, detectRecurring(list))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ from: 499, to: 649 })
  })
})

describe('bill radar', () => {
  const now = Date.now()
  const monthly = (name: string, amt = 300) => [90, 60, 30, 0].map((d) => tx({ paymentReceiver: name, amount: amt, at: now - d * DAY }))
  it('follows streaming apps and rent only', () => {
    const list = [...monthly('Netflix'), ...monthly('Rent to landlord', 12000), ...monthly('Blinkit', 450), ...monthly('Swiggy Instamart', 380), ...monthly('Zomato')]
    const found = detectRecurring(list).map((r) => r.receiver).sort()
    expect(found).toEqual(['Netflix', 'Rent to landlord'])
  })
  it('marks a subscription that stopped being charged', () => {
    const list = [200, 170, 140, 110].map((d) => tx({ paymentReceiver: 'Spotify', amount: 119, at: now - d * DAY }))
    expect(detectRecurring(list)[0].ended).toBe(true)
  })
})

describe('UCO mandate messages', () => {
  const blocked = 'Your UCO UPI-Mandate is successfully created towards TATA CAPITAL LTD for Rs. 15000.00 Funds are blocked from A/C No. XXXXXXXX1234'
  const revoked = 'Your UCO UPI-Mandate is successfully Revoked towards TATA CAPITAL LTD for Rs. 15000.00 from A/C No. XXXXXXXX1234'
  it('reads both as holds', () => {
    expect(isBlockEvent(blocked)).toBe(true)
    expect(isBlockEvent(revoked)).toBe(true)
    expect(parseHold(blocked)).toMatchObject({ kind: 'BLOCKED', amount: 15000, name: 'TATA CAPITAL LTD' })
    expect(parseHold(revoked)).toMatchObject({ kind: 'UNBLOCKED', amount: 15000, name: 'TATA CAPITAL LTD' })
  })
  it('finds the account by the digits in the message', () => {
    const acc = (id: string, last4: string) => ({ id, name: `UCO ${last4}`, type: 'BANK' as const, last4, color: '#000', createdAt: 0, bank: 'UCO' })
    expect(accountForHold(blocked, [acc('a', '1234'), acc('b', '9999')])).toBe('a')
    expect(accountForHold(blocked, [acc('a', '5555'), acc('b', '9999')])).toBe(null)
  })
  it('reads banks that say "lien"', () => {
    const marked = 'Lien of Rs. 20,000.00 marked on your A/C XX4321 for UPI mandate towards ABC LTD IPO'
    const lifted = 'Lien of Rs. 20,000.00 on your A/C XX4321 has been released towards ABC LTD'
    expect(isBlockEvent(marked)).toBe(true)
    expect(isBlockEvent(lifted)).toBe(true)
    expect(parseHold(marked)?.kind).toBe('BLOCKED')
    expect(parseHold(lifted)?.kind).toBe('UNBLOCKED')
  })
})

describe('IPO holds', () => {
  it('reads a block and an unblock', () => {
    expect(parseHold('Rs. 15,000 blocked for Tata Capital IPO. UPI mandate created')).toMatchObject({ kind: 'BLOCKED', amount: 15000 })
    expect(parseHold('Rs 15000 unblocked in your account for Tata Capital IPO')).toMatchObject({ kind: 'UNBLOCKED', amount: 15000 })
  })
  it('holds money until the matching unblock', () => {
    const h = (id: string, kind: 'BLOCKED' | 'UNBLOCKED', at: number, amount = 15000) => ({ id, kind, timestamp: at, amount, name: 'IPO', paymentMethodId: 'a' })
    expect(frozenFor(new Set(['a']), [h('1', 'BLOCKED', 1)])).toBe(15000)
    expect(frozenFor(new Set(['a']), [h('1', 'BLOCKED', 1), h('2', 'UNBLOCKED', 2)])).toBe(0)
    expect(frozenFor(new Set(['a']), [h('1', 'BLOCKED', 1), h('2', 'BLOCKED', 2, 8000), h('3', 'UNBLOCKED', 3)])).toBe(8000)
  })
})
