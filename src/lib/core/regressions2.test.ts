import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from './storage'
import { addTransaction, advance, deleteTransaction, getAll, processRecurring } from './data'
import { applySalarySettings, detectAccount } from '../accounts/accounts'
import { monthlyTotal } from '../plan/autopay'
import { duplicateCharges } from '../notify/alerts'
import { detectRecurring } from '../payees/recurring'
import { netWorth } from '../invest/invest'
import { cashInHand } from '../accounts/cash'
import { markOnBehalf } from '../accounts/behalf'
import { restoreBackup } from '../backup/backup'
import type { AutoPay, PaymentMethod, RecurringRule, Transaction } from './types'

const d = (y: number, m: number, day: number, h = 12) => new Date(y, m, day, h).getTime()
const reset = () => { for (const k of [KEYS.transactions, KEYS.recurringRules, KEYS.trash, KEYS.paymentMethods, KEYS.loans, KEYS.investments]) write(k, []) }

describe('dates and plans', () => {
  beforeEach(reset)

  it('a yearly rule on Feb 29 comes back to Feb 29 in the next leap year', () => {
    let t = d(2028, 1, 29)
    for (let i = 0; i < 4; i++) t = advance(t, 'YEARLY', 29)
    expect(new Date(t).toDateString()).toBe(new Date(2032, 1, 29).toDateString())
  })

  it('salary is still added when the app was not opened on payday', () => {
    write(KEYS.user, { name: 'A', monthly_income: 50000 })
    applySalarySettings({ day: 1, autoAdd: true, accountId: 'uco' } as never)
    const rule = read<RecurringRule[]>(KEYS.recurringRules, [])[0]
    write(KEYS.recurringRules, [{ ...rule, nextAt: d(2026, 10, 1, 10) }])
    // the app opens on the 3rd: settings are re-applied first, then recurring entries run
    applySalarySettings({ day: 1, autoAdd: true, accountId: 'uco' } as never)
    processRecurring(d(2026, 10, 3))
    expect(getAll().filter((t) => t.paymentCategory === 'Salary')).toHaveLength(1)
  })

  it('a half-yearly AutoPay is a sixth of it per month, and a one-time one adds nothing', () => {
    const a = (amount: number, frequency: string) => ({ id: frequency, amount, frequency, status: 'active' } as AutoPay)
    expect(monthlyTotal([a(6000, 'half-yearly'), a(500, 'one-time')])).toBe(1000)
  })

  it('rent paid on Feb 1 is next due on Mar 1', () => {
    for (const m of [10, 11, 0, 1]) addTransaction({ paymentAmount: 12000, paymentType: 'DEBIT', paymentReceiver: 'Landlord', paymentCategory: 'Rent', timestamp: d(m >= 10 ? 2026 : 2027, m, 1) }, { allowDuplicate: true })
    const r = detectRecurring(getAll()).find((x) => x.receiver === 'Landlord')!
    expect(new Date(r.nextDueAt).toDateString()).toBe(new Date(2027, 2, 1).toDateString())
  })

  it('the two halves of a split are not a "charged twice" alert', () => {
    const now = Date.now()
    addTransaction({ paymentAmount: 500, paymentType: 'DEBIT', paymentReceiver: 'Toing', paymentCategory: 'Food', timestamp: now - 60000 })
    addTransaction({ paymentAmount: 500, paymentType: 'DEBIT', paymentReceiver: 'Toing', paymentCategory: 'Split', timestamp: now - 60000 }, { allowDuplicate: true })
    expect(duplicateCharges(getAll(), now)).toHaveLength(0)
  })
})

describe('balances and backups', () => {
  beforeEach(reset)

  it('two accounts ending in the same digits: the bank named in the message decides', () => {
    const methods = [{ id: 'sbi', name: 'SBI', bank: 'SBI', last4: '1234', type: 'BANK' }, { id: 'hdfc', name: 'HDFC', bank: 'HDFC', last4: '1234', type: 'BANK' }] as PaymentMethod[]
    expect(detectAccount('HDFC Bank: Rs 500 debited from A/c XX1234', methods)).toBe('hdfc')
  })

  it('cash deposited back in the bank leaves your hand', () => {
    addTransaction({ paymentAmount: 5000, paymentType: 'DEBIT', paymentReceiver: 'ATM Withdrawal', paymentCategory: 'Self transfer', paymentSource: 'BANK', timestamp: d(2026, 10, 1) })
    addTransaction({ paymentAmount: 5000, paymentType: 'CREDIT', paymentReceiver: 'Cash deposit', paymentCategory: 'Self transfer', paymentSource: 'BANK', timestamp: d(2026, 10, 2) })
    expect(cashInHand(getAll()).balance).toBe(0)
  })

  it('net worth does not count money held for someone as yours', () => {
    write(KEYS.people, [{ id: 'mom', name: 'Mom', phones: [], aliases: [] }])
    const id = addTransaction({ paymentAmount: 10000, paymentType: 'CREDIT', paymentReceiver: 'Mom', paymentCategory: 'Family', timestamp: d(2026, 10, 1) }).id
    const acct = { id: 'uco', name: 'UCO', type: 'BANK', openingBalance: 0, openingDate: 0 } as PaymentMethod
    const before = netWorth([acct], getAll(), [], [], []).total
    markOnBehalf(getAll().find((t) => t.id === id)!, 'mom')
    expect(netWorth([acct], getAll(), [], [], []).total).toBe(before - 10000)
  })

  it('restoring a backup does not bring back deleted entries, nor duplicate ones captured again under a new id', () => {
    const old = { id: 'old1', timestamp: d(2026, 10, 5, 13), paymentAmount: 500, paymentType: 'DEBIT', paymentReceiver: 'Zomato', paymentCategory: 'Food', ref: '123456789012', createdAt: 0, updatedAt: 0 } as Transaction
    const gone = { ...old, id: 'gone', paymentAmount: 99, ref: '999999999999', paymentReceiver: 'Uber' } as Transaction
    write(KEYS.transactions, [gone])
    deleteTransaction('gone')
    addTransaction({ paymentAmount: 500, paymentType: 'DEBIT', paymentReceiver: 'Zomato', paymentCategory: 'Food', ref: '123456789012', timestamp: old.timestamp })
    restoreBackup(JSON.stringify({ app: 'JustMoney', version: 1, transactions: [old, gone] }))
    expect(getAll()).toHaveLength(1)
  })
})
