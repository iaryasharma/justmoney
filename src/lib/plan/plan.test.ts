import { describe, expect, it } from 'vitest'
import { monthPlan, overPlan, saleSplit, DEFAULT_PLAN, type PlanInput } from './plan'
import type { Transaction } from '../core/types'

let n = 0
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime()
const tx = (o: Partial<Transaction>): Transaction => ({ id: `t${++n}`, timestamp: 0, paymentAmount: 0, paymentType: 'DEBIT', paymentReceiver: 'X', paymentCategory: 'Food', createdAt: 0, updatedAt: 0, ...o })
const COMMITTED = new Set(['Family'])
const base = (o: Partial<PlanInput>): PlanInput => ({ settings: DEFAULT_PLAN, txns: [], plannedIncome: 0, commitmentsTotal: 0, committed: COMMITTED, year: 2026, month: 9, now: new Date(2026, 9, 15), ...o })

describe('a salary, saving first', () => {
  it('20,000 income and 15,000 to family leaves 5,000, of which 1,000 is saved before anything else', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000 }))
    expect(p.free).toBe(5000)
    expect(p.saveTarget).toBe(1000)
    expect(p.limit).toBe(4000)
    expect(p.mode).toBe('FIXED')
  })
  it('spreads what is left over the days left', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, txns: [tx({ timestamp: at(2026, 9, 3), paymentAmount: 1000 })] }))
    expect(p.spent).toBe(1000)
    expect(p.left).toBe(3000)
    expect(p.daysLeft).toBe(17)
    expect(p.perDay).toBe(Math.round(3000 / 17))
  })
  it('says so when family and bills take everything', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 22000 }))
    expect(p.limit).toBe(0)
    expect(p.notes.join(' ')).toMatch(/take all of your income/)
  })
  it('a bigger saving rate leaves less to spend', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, settings: { ...DEFAULT_PLAN, saveRate: 40 } }))
    expect(p.saveTarget).toBe(2000)
    expect(p.limit).toBe(3000)
  })
})

describe('a shop with no fixed income', () => {
  const sale = (m: number, d: number, amount: number) => tx({ timestamp: at(2026, m, d), paymentAmount: amount, paymentType: 'CREDIT', paymentCategory: 'Business', paymentApp: 'PhonePe Business' })
  const history = [sale(6, 5, 40000), sale(7, 5, 50000), sale(8, 5, 60000)] // Jul, Aug, Sep: average 50,000
  it('plans on a little under the usual month, with tax kept aside, and needs no typed-in income', () => {
    const p = monthPlan(base({ txns: history }))
    expect(p.mode).toBe('VARIABLE')
    expect(p.basis).toBe('learned')
    expect(p.income).toBe(40000) // 80% of the 50,000 average
    expect(p.setAside).toBe(4000) // 10% for tax and stock
    expect(p.free).toBe(36000)
    expect(p.saveTarget).toBe(7200)
    expect(p.limit).toBe(28800)
  })
  it('learns the family support from what was sent, instead of asking', () => {
    const sent = [tx({ timestamp: at(2026, 7, 9), paymentAmount: 10000, paymentCategory: 'Family' }), tx({ timestamp: at(2026, 8, 9), paymentAmount: 10000, paymentCategory: 'Family' }), tx({ timestamp: at(2026, 6, 9), paymentAmount: 10000, paymentCategory: 'Family' })]
    const p = monthPlan(base({ txns: [...history, ...sent] }))
    expect(p.committed).toBe(10000)
    expect(p.limit).toBe(Math.round((40000 - 4000 - 10000) * 0.8))
  })
  it('follows the sales so far in the first month', () => {
    const p = monthPlan(base({ txns: [sale(9, 2, 10000)] }))
    expect(p.basis).toBe('early')
    expect(p.income).toBe(10000)
  })
  it('splits each 1,000 of sales', () => {
    expect(saleSplit(DEFAULT_PLAN)).toEqual({ aside: 100, save: 180, yours: 720 })
  })
})

describe('the nudge before overspending', () => {
  const plan = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, txns: [tx({ timestamp: at(2026, 9, 3), paymentAmount: 3800 })] }))
  it('speaks up when an expense crosses the limit', () => {
    expect(overPlan(plan, 500)).toMatchObject({ over: 300, limit: 4000, saving: 1000 })
  })
  it('lets a small one through', () => {
    expect(overPlan(plan, 20)).toBeNull()
  })
  it('stays quiet when there is room', () => {
    expect(overPlan({ ...plan, spent: 100 }, 500)).toBeNull()
  })
})

import { closeFigures, emergencyTarget, splitSavings } from './plan'
describe('what a finished month leaves', () => {
  it('saves what was not spent', () => expect(closeFigures({ limit: 4000, spent: 3100 })).toEqual({ leftover: 900, over: 0 }))
  it('remembers an overspend', () => expect(closeFigures({ limit: 4000, spent: 4600 })).toEqual({ leftover: 0, over: 600 }))
  it('has nothing to compare when there was no plan', () => expect(closeFigures({ limit: 0, spent: 500 })).toEqual({ leftover: 0, over: 0 }))
})

describe('last month’s overspend taken off this month', () => {
  it('lowers the limit by the carried amount, never below zero', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, carry: -600 }))
    expect(p.limit).toBe(3400)
    expect(p.carry).toBe(-600)
    expect(p.notes.join(' ')).toMatch(/overspend/)
    expect(monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, carry: -9000 })).limit).toBe(0)
  })
})

describe('sharing savings between goals', () => {
  it('shares by what each still needs', () => {
    const r = splitSavings(1000, [{ id: 'phone', target: 30000, saved: 0 }, { id: 'trip', target: 10000, saved: 0 }])
    expect(r.find((x) => x.id === 'phone')!.amount).toBe(750)
    expect(r.find((x) => x.id === 'trip')!.amount).toBe(250)
  })
  it('never goes past a goal’s target', () => {
    const r = splitSavings(1000, [{ id: 'a', target: 1000, saved: 900 }, { id: 'b', target: 5000, saved: 0 }])
    expect(r.find((x) => x.id === 'a')!.amount).toBeLessThanOrEqual(100)
    expect(r.reduce((a, x) => a + x.amount, 0)).toBe(1000)
  })
  it('sizes the emergency fund at a few months of essentials', () => {
    expect(emergencyTarget(19000, 3)).toBe(57000)
    expect(emergencyTarget(1000, 3)).toBe(10000)
  })
})

import { afford, goalPace, shopSummary, sinkingNeed, suggestRate } from './plan'

describe('can I afford it', () => {
  const plan = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000 })) // 4,000 to spend, 1,000 saved first
  it('fits when there is room', () => expect(afford(plan, 1500).verdict).toBe('fits'))
  it('dips into saving when it is a little too much', () => {
    const r = afford(plan, 4500)
    expect(r.verdict).toBe('dips')
    expect(r.short).toBe(500)
  })
  it('says wait when it is far too much', () => expect(afford(plan, 12000).verdict).toBe('wait'))
})

describe('goals with a date', () => {
  it('works out what each month has to bring', () => {
    const now = Date.UTC(2026, 0, 1)
    const p = goalPace({ id: 'g', name: 'Phone', target: 30000, saved: 6000, color: '', createdAt: 0, deadline: now + 120 * 86400000 }, 5000, now)!
    expect(p.months).toBe(4)
    expect(p.need).toBe(6000)
    expect(p.ok).toBe(false)
  })
})

describe('yearly costs', () => {
  it('sets aside what is missing over the months left', () => {
    const f = { id: 'f', name: 'Insurance', amount: 12000, dueAt: new Date(2026, 11, 28).getTime(), saved: 0, createdAt: 0 }
    expect(sinkingNeed(f, new Date(2026, 0, 1))).toBe(Math.round(12000 / 11))
    expect(sinkingNeed({ ...f, saved: 12000 }, new Date(2026, 5, 1))).toBe(0)
  })
  it('takes it off what can be spent', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, sinking: 1000 }))
    expect(p.free).toBe(4000)
    expect(p.limit).toBe(3200)
  })
  it('does not count a payment the fund already covered', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000, sinkingPaid: 3000, txns: [tx({ timestamp: at(2026, 9, 3), paymentAmount: 3500 })] }))
    expect(p.spent).toBe(500)
  })
})

describe('the shop', () => {
  const sale = (amount: number) => tx({ timestamp: at(2026, 9, 5), paymentAmount: amount, paymentType: 'CREDIT', paymentCategory: 'Business', paymentApp: 'PhonePe Business' })
  it('keeps what the shop spends out of your own spending and works from what it kept', () => {
    const cost = tx({ timestamp: at(2026, 9, 6), paymentAmount: 6000, business: true })
    expect(shopSummary([sale(20000), cost], 2026, 9)).toEqual({ sales: 20000, costs: 6000, profit: 14000 })
    const p = monthPlan(base({ txns: [sale(20000), cost], settings: { ...DEFAULT_PLAN, mode: 'VARIABLE' } }))
    expect(p.spent).toBe(0)
    expect(p.income).toBe(14000)
  })
})

describe('a saving rate that is easy to keep', () => {
  it('starts a little above what was really kept', () => {
    // income 20,000, family 15,000: 5,000 free. Spent 3,500 each month: kept 30%
    const months = [6, 7, 8].map((m) => tx({ timestamp: at(2026, m, 5), paymentAmount: 3500 }))
    const r = suggestRate(months, COMMITTED, 20000, 15000, new Date(2026, 9, 15))!
    expect(r.usual).toBe(30)
    expect(r.suggested).toBe(35)
  })
})

import { historySummary } from './plan'
describe('starting from the last months', () => {
  const credit = (m: number, amt: number) => tx({ timestamp: at(2026, m, 1), paymentAmount: amt, paymentType: 'CREDIT', paymentCategory: 'Salary' })
  const rows = (m: number) => [credit(m, 20000), tx({ timestamp: at(2026, m, 3), paymentAmount: 15000, paymentCategory: 'Family' }), tx({ timestamp: at(2026, m, 9), paymentAmount: 3000 })]
  it('averages income, family support and spending, and what was kept', () => {
    const h = historySummary([...rows(6), ...rows(7), ...rows(8)], COMMITTED, new Date(2026, 9, 15))!
    expect(h).toMatchObject({ months: 3, income: 20000, family: 15000, spend: 3000, keptPct: 40 })
  })
  it('has nothing to say with no history', () => {
    expect(historySummary([credit(9, 20000)], COMMITTED, new Date(2026, 9, 15))).toBeNull()
  })
})

describe('a student: an allowance, spent as it comes', () => {
  const STUDENT = { ...DEFAULT_PLAN, mode: 'FIXED' as const }
  it('with no budget, nothing is marked as over, and what is left is the allowance after saving', () => {
    const p = monthPlan(base({ plannedIncome: 10000, settings: { ...STUDENT, student: { budget: 'NONE', cap: 0, saveGoal: 1000 } }, txns: [tx({ timestamp: at(2026, 9, 3), paymentAmount: 4000 })] }))
    expect(p.student).toBe(true)
    expect(p.capped).toBe(false)
    expect(p.saveTarget).toBe(1000)
    expect(p.limit).toBe(9000)
    expect(p.left).toBe(5000)
    expect(p.status).toBe('none')
  })
  it('spending past the allowance is not an overspend when there is no budget', () => {
    const p = monthPlan(base({ plannedIncome: 10000, settings: { ...STUDENT, student: { budget: 'NONE', cap: 0, saveGoal: 0 } }, txns: [tx({ timestamp: at(2026, 9, 3), paymentAmount: 12000 })] }))
    expect(p.status).toBe('none')
    expect(p.left).toBeLessThan(0)
  })
  it('a set limit is the spending cap, and going past it is over', () => {
    const p = monthPlan(base({ plannedIncome: 10000, settings: { ...STUDENT, student: { budget: 'CAP', cap: 3000, saveGoal: 0 } }, txns: [tx({ timestamp: at(2026, 9, 3), paymentAmount: 3500 })] }))
    expect(p.capped).toBe(true)
    expect(p.limit).toBe(3000)
    expect(p.status).toBe('over')
  })
  it('a fixed saving goal comes off first, and cannot be more than the allowance', () => {
    expect(monthPlan(base({ plannedIncome: 10000, settings: { ...STUDENT, student: { budget: 'NONE', cap: 0, saveGoal: 2500 } } })).saveTarget).toBe(2500)
    const small = monthPlan(base({ plannedIncome: 1000, settings: { ...STUDENT, student: { budget: 'NONE', cap: 0, saveGoal: 5000 } } }))
    expect(small.saveTarget).toBe(1000)
    expect(small.limit).toBe(0)
  })
  it('a student never has a carried overspend taken off', () => {
    const p = monthPlan(base({ plannedIncome: 10000, carry: -2000, settings: { ...STUDENT, student: { budget: 'NONE', cap: 0, saveGoal: 0 } } }))
    expect(p.limit).toBe(10000)
  })
  it('a cap bigger than what is left after saving says it may run short', () => {
    const p = monthPlan(base({ plannedIncome: 10000, settings: { ...STUDENT, student: { budget: 'CAP', cap: 12000, saveGoal: 0 } } }))
    expect(p.notes.join(' ')).toMatch(/may run short/)
  })
  it('an ordinary plan is unchanged: no student flags', () => {
    const p = monthPlan(base({ plannedIncome: 20000, commitmentsTotal: 15000 }))
    expect(p.student).toBe(false)
    expect(p.capped).toBe(false)
  })
})
