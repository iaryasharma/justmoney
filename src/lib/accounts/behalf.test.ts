import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from '../core/storage'
import { addTransaction, getAll } from '../core/data'
import { behalfBalance, fundedBy, markOnBehalf, paybackFrom, unmarkedAdvance, unmarkOnBehalf } from './behalf'
import { linkTransaction } from '../payees/people'
import { addRepayment, createLoan, detachTransactionFromLoans, getLoans, outstanding } from '../payees/loans'
import { isIncome, isPersonalSpend } from '../core/money'
import type { Transaction } from '../core/types'

const DAY = 86400000
const now = Date.now()
const NONE = new Set<string>()
const add = (t: Parameters<typeof addTransaction>[0]) => { const id = addTransaction(t, { allowDuplicate: true }).id; return getAll().find((x) => x.id === id)! }
const byId = (id: string) => read<Transaction[]>(KEYS.transactions, []).find((t) => t.id === id)!

describe('money handled for someone else', () => {
  beforeEach(() => {
    write(KEYS.transactions, [])
    write(KEYS.people, [{ id: 'mom', name: 'Sunita', phones: [], aliases: [], relation: 'Mom', familyId: 'f1' }, { id: 'ravi', name: 'Ravi', phones: [], aliases: [] }])
  })

  it('family money in and the order for them out: neither income nor spending, and they end square', () => {
    const got = add({ paymentAmount: 10000, paymentType: 'CREDIT', paymentReceiver: 'Sunita', paymentCategory: 'Family', timestamp: now - 2 * DAY })
    markOnBehalf(got, 'mom')
    expect(behalfBalance('mom')).toBe(10000)
    const order = add({ paymentAmount: 10000, paymentType: 'DEBIT', paymentReceiver: 'Amazon', paymentCategory: 'Shopping', timestamp: now })
    expect(fundedBy(order)).toBe('mom')
    markOnBehalf(order, 'mom')
    expect(behalfBalance('mom')).toBe(0)
    for (const t of getAll()) { expect(isIncome(t)).toBe(false); expect(isPersonalSpend(t, NONE)).toBe(false) }
  })

  it('splits a payment when only part of it was for them', () => {
    const order = add({ paymentAmount: 1500, paymentType: 'DEBIT', paymentReceiver: 'Blinkit', paymentCategory: 'Grocery', timestamp: now })
    const mineId = markOnBehalf(order, 'ravi', 1200)!
    expect(byId(order.id)).toMatchObject({ paymentAmount: 1200, paymentCategory: 'On behalf', behalfFrom: 'Grocery', contactId: 'ravi' })
    expect(byId(mineId)).toMatchObject({ paymentAmount: 300, paymentCategory: 'Grocery', paymentReceiver: 'Blinkit' })
    expect(behalfBalance('ravi')).toBe(-1200)
    expect(getAll().filter((t) => isPersonalSpend(t, NONE)).reduce((a, t) => a + t.paymentAmount, 0)).toBe(300)
  })

  it('friend’s card: what they sent and what you paid back cancel out', () => {
    markOnBehalf(add({ paymentAmount: 2500, paymentType: 'CREDIT', paymentReceiver: 'Ravi', paymentCategory: 'Other income', timestamp: now - DAY }), 'ravi')
    markOnBehalf(add({ paymentAmount: 2500, paymentType: 'DEBIT', paymentReceiver: 'Ravi', paymentCategory: 'Others', timestamp: now }), 'ravi')
    expect(behalfBalance('ravi')).toBe(0)
  })

  it('unmarking puts the old category back', () => {
    const order = add({ paymentAmount: 800, paymentType: 'DEBIT', paymentReceiver: 'Myntra', paymentCategory: 'Shopping', timestamp: now })
    markOnBehalf(order, 'ravi')
    unmarkOnBehalf(byId(order.id))
    expect(byId(order.id).paymentCategory).toBe('Shopping')
    expect(isPersonalSpend(byId(order.id), NONE)).toBe(true)
  })

  it('linking a family member keeps it On behalf instead of filing it under Family', () => {
    const order = add({ paymentAmount: 800, paymentType: 'DEBIT', paymentReceiver: 'Myntra', paymentCategory: 'Shopping', timestamp: now })
    markOnBehalf(order, 'ravi')
    linkTransaction(byId(order.id), 'mom')
    expect(byId(order.id).paymentCategory).toBe('On behalf')
  })

  it('a payback from someone you bought for is offered against what they owe, by name, and the extra stays income', () => {
    markOnBehalf(add({ paymentAmount: 1200, paymentType: 'DEBIT', paymentReceiver: 'Blinkit', paymentCategory: 'Grocery', timestamp: now - DAY }), 'ravi')
    const back = add({ paymentAmount: 1500, paymentType: 'CREDIT', paymentReceiver: 'RAVI', paymentCategory: 'Other income', timestamp: now })
    expect(paybackFrom(back)).toEqual({ personId: 'ravi', owed: 1200 })
    const extraId = markOnBehalf(back, 'ravi', 1200)!
    expect(behalfBalance('ravi')).toBe(0)
    expect(isIncome(byId(extraId))).toBe(true)
    expect(byId(extraId).paymentAmount).toBe(300)
    expect(paybackFrom(add({ paymentAmount: 100, paymentType: 'CREDIT', paymentReceiver: 'Ravi', paymentCategory: 'Other income', timestamp: now }))).toBeNull()
  })

  it('they paid first but only the purchase was marked: their earlier money is offered, and then they are square', () => {
    const sent = add({ paymentAmount: 10000, paymentType: 'CREDIT', paymentReceiver: 'Sunita', paymentCategory: 'Family', timestamp: now - 3 * DAY })
    const order = add({ paymentAmount: 10000, paymentType: 'DEBIT', paymentReceiver: 'Amazon', paymentCategory: 'Shopping', timestamp: now })
    markOnBehalf(order, 'mom')
    expect(unmarkedAdvance(byId(order.id))?.id).toBe(sent.id)
    markOnBehalf(byId(sent.id), 'mom')
    expect(behalfBalance('mom')).toBe(0)
    expect(unmarkedAdvance(byId(order.id))).toBeNull()
    expect(getAll().some((t) => isIncome(t) || isPersonalSpend(t, NONE))).toBe(false)
  })

  it('family money through a friend’s card: a loan repayment moved to On behalf, part kept as yours, the gap as commission', () => {
    write(KEYS.loans, [])
    const loan = createLoan({ person: 'Aagman', direction: 'BORROWED', amount: 15740, date: now - 2 * DAY, dueDate: null, note: null, accountId: null })
    addRepayment(loan.id, 15740, null, now, true)
    const paid = getAll().find((t) => t.loanId === loan.id)!
    // what the app does when "Paid for someone else" is saved on it
    detachTransactionFromLoans(paid)
    markOnBehalf(byId(paid.id), 'mom')
    expect(byId(paid.id)).toMatchObject({ paymentCategory: 'On behalf', behalfFrom: 'Others', loanId: undefined })
    expect(outstanding(getLoans()[0])).toBe(15740) // the loan is open again; delete it if it was only for this
    markOnBehalf(add({ paymentAmount: 3105, paymentType: 'CREDIT', paymentReceiver: 'Anita Sharma', paymentCategory: 'Family', timestamp: now - DAY }), 'mom', 2605)
    markOnBehalf(add({ paymentAmount: 365, paymentType: 'CREDIT', paymentReceiver: 'Rakesh Sharma', paymentCategory: 'Other income', timestamp: now - DAY }), 'mom')
    markOnBehalf(add({ paymentAmount: 12792, paymentType: 'CREDIT', paymentReceiver: 'Mukesh Sharma', paymentCategory: 'Dividends', timestamp: now - DAY }), 'mom', 12770)
    expect(behalfBalance('mom')).toBe(0)
    const income = getAll().filter(isIncome).map((t) => [t.paymentCategory, t.paymentAmount])
    expect(income).toEqual(expect.arrayContaining([['Family', 500], ['Dividends', 22]]))
    expect(income).toHaveLength(2)
  })

  it('your own cash sent along with theirs stays a Self transfer, not income', () => {
    const got = add({ paymentAmount: 3105, paymentType: 'CREDIT', paymentReceiver: 'Anita Sharma', paymentCategory: 'Self transfer', timestamp: now })
    const mineId = markOnBehalf(got, 'ravi', 2605)!
    expect(byId(mineId)).toMatchObject({ paymentAmount: 500, paymentCategory: 'Self transfer' })
    expect(isIncome(byId(mineId))).toBe(false)
  })

  it('does not suggest someone whose money is spent or weeks old', () => {
    markOnBehalf(add({ paymentAmount: 5000, paymentType: 'CREDIT', paymentReceiver: 'Sunita', paymentCategory: 'Family', timestamp: now - 40 * DAY }), 'mom')
    expect(fundedBy(add({ paymentAmount: 3000, paymentType: 'DEBIT', paymentReceiver: 'Amazon', paymentCategory: 'Shopping', timestamp: now }))).toBeNull()
  })
})
