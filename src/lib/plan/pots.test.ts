import { describe, expect, it } from 'vitest'
import { defaultPots, potBalances, potCategories, runway, splitRemainder, suggestAllocation, type Allocation } from './pots'
import type { Commitment, Transaction } from '../core/types'

let n = 0
const tx = (o: Partial<Transaction>): Transaction => ({ id: `t${++n}`, timestamp: 1000, paymentAmount: 0, paymentType: 'DEBIT', paymentReceiver: 'X', paymentCategory: 'Food', createdAt: 0, updatedAt: 0, ...o })
const NONE: Commitment[] = []
const pots = defaultPots(0)

describe('a late salary, split when it arrives', () => {
  it('40,000 with 30,000 to family: the 10,000 left is saved from first, then spent', () => {
    const s = splitRemainder(40000, 30000, 0, 20, 40)
    expect(s.family).toBe(30000)
    expect(s.emergency + s.saving).toBe(2000) // 20% of what is left, saved first
    expect(s.emergency).toBe(800)
    expect(s.personal).toBe(8000)
    expect(30000 + s.bills + s.saving + s.emergency + s.personal).toBe(40000)
  })
  it('suggests family and bills as they were last time', () => {
    const last: Allocation = { id: 'a', at: 1, amount: 40000, source: 'Salary', splits: [{ pot: 'family', amount: 15000 }, { pot: 'bills', amount: 3000 }, { pot: 'personal', amount: 20000 }], saving: 1000, emergency: 1000 }
    const s = suggestAllocation(40000, { last, commitments: NONE, saveRate: 20, emergencyShare: 40 })
    expect(s.family).toBe(15000)
    expect(s.bills).toBe(3000)
    expect(s.family + s.bills + s.saving + s.emergency + s.personal).toBe(40000)
  })
  it('never allocates more than came in', () => {
    const s = suggestAllocation(5000, { commitments: [{ id: 'c', name: 'Family', amount: 15000, category: 'Family', createdAt: 0 }], saveRate: 20, emergencyShare: 40 })
    expect(s.family).toBe(5000)
    expect(s.personal).toBe(0)
  })
})

describe('what is left in each pot', () => {
  const alloc: Allocation = { id: 'a', at: 500, amount: 40000, source: 'Salary', splits: [{ pot: 'family', amount: 30000 }, { pot: 'personal', amount: 8000 }], saving: 1200, emergency: 800 }
  it('takes spending out of the right pot', () => {
    const txns = [tx({ paymentAmount: 30000, paymentCategory: 'Family' }), tx({ paymentAmount: 1500, paymentCategory: 'Food' }), tx({ paymentAmount: 500, paymentCategory: 'Travel' })]
    const b = potBalances(pots, [alloc], [], txns, NONE)
    const get = (id: string) => b.find((x) => x.pot.id === id)!
    expect(get('family')).toMatchObject({ allocated: 30000, spent: 30000, left: 0 })
    expect(get('personal')).toMatchObject({ allocated: 8000, spent: 2000, left: 6000 })
  })
  it('ignores spending from before the money came', () => {
    const b = potBalances(pots.map((p) => ({ ...p, startAt: 2000 })), [alloc], [], [tx({ paymentAmount: 900, timestamp: 1500 })], NONE)
    expect(b.find((x) => x.pot.id === 'personal')!.spent).toBe(0)
  })
  it('moves money between pots', () => {
    const b = potBalances(pots, [alloc], [{ id: 'm', at: 600, from: 'personal', to: 'bills', amount: 1000, kind: 'pot' }], [], NONE)
    expect(b.find((x) => x.pot.id === 'personal')!.left).toBe(7000)
    expect(b.find((x) => x.pot.id === 'bills')!.left).toBe(1000)
  })
  it('counts money taken out of savings as put into the pot', () => {
    const b = potBalances(pots, [alloc], [{ id: 'm', at: 600, from: 'goal:g', to: 'personal', amount: 3000, kind: 'savings' }], [], NONE)
    expect(b.find((x) => x.pot.id === 'personal')!.left).toBe(11000)
  })
  it('keeps shop costs out of the pots', () => {
    const b = potBalances(pots, [alloc], [], [tx({ paymentAmount: 4000, business: true })], NONE)
    expect(b.find((x) => x.pot.id === 'personal')!.spent).toBe(0)
  })
  it('reads bill categories from the commitments', () => {
    const cats = potCategories(pots[1], [{ id: 'c', name: 'Insurance', amount: 1, category: 'Insurance', createdAt: 0 }])
    expect(cats).toContain('Insurance')
    expect(cats).toContain('EMI/Bill')
  })
})

describe('when income is late', () => {
  it('says how long what is left lasts, and how much longer with savings', () => {
    const now = 40 * 86400000
    const txns = [tx({ timestamp: now - 86400000, paymentAmount: 3000 })] // 3,000 over the last 30 days: 100 a day
    const bal = potBalances(pots, [{ id: 'a', at: 0, amount: 6000, source: 'x', splits: [{ pot: 'personal', amount: 6000 }], saving: 0, emergency: 0 }], [], [], NONE)
    const r = runway(bal, [{ id: 'g', name: 'Savings', target: 50000, saved: 5000, color: '', createdAt: 0 }], txns, now)
    expect(r.days).toBe(60)
    expect(r.withSavings).toBe(110)
  })
})

import { familyBreakdown } from './pots'
describe('family money, person by person', () => {
  const alloc: Allocation = { id: 'a', at: 1, amount: 40000, source: 'Salary', splits: [{ pot: 'family', amount: 30000 }], saving: 0, emergency: 0, familySplit: [{ who: 'Mom', amount: 20000 }, { who: 'Dad', amount: 10000 }] }
  it('shows what was set aside for each and what was sent', () => {
    const rows = familyBreakdown([alloc], [tx({ paymentCategory: 'Family', paymentReceiver: 'Mom', paymentAmount: 15000 }), tx({ paymentCategory: 'Family', paymentReceiver: 'Dad', paymentAmount: 10000 })], 0, [], [])
    expect(rows.find((r) => r.who === 'Mom')).toMatchObject({ given: 20000, sent: 15000, left: 5000 })
    expect(rows.find((r) => r.who === 'Dad')).toMatchObject({ given: 10000, sent: 10000, left: 0 })
  })
  it('puts money sent to someone not named on its own row', () => {
    const rows = familyBreakdown([alloc], [tx({ paymentCategory: 'Family', paymentReceiver: 'Aunt', paymentAmount: 2000 })], 0, [], [])
    expect(rows.find((r) => r.who === 'Aunt')).toMatchObject({ given: 0, sent: 2000 })
  })
})
