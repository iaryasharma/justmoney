import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { duplicateCharges, learnNumber, needNaming, unconfirmed } from './alerts'
import { payeeIdOf, parseBankSms } from '../capture/sms'
import { addTransaction } from '../core/data'
import type { Transaction } from '../core/types'

const DAY = 86400000
const tx = (o: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36).slice(2), timestamp: Date.now(), paymentAmount: 100, paymentType: 'DEBIT', paymentReceiver: 'Zepto', paymentCategory: 'Food', paymentSource: 'BANK', ...o } as Transaction)

describe('alerts and checks', () => {
  beforeEach(() => { write(KEYS.attentionDismissed, []); write(KEYS.numberNames, {}); write(KEYS.transactions, []) })

  it('a screenshot entry the bank never confirmed shows up after a day, but only when bank messages are being read', () => {
    const now = Date.now()
    const lone = tx({ seenIn: ['screen'], timestamp: now - 2 * DAY })
    expect(unconfirmed([lone], now)).toEqual([])                                         // no bank entries at all: nothing can be judged
    const bankSeen = tx({ seenIn: ['bank'], timestamp: now - 3 * DAY })
    expect(unconfirmed([lone, bankSeen], now)).toEqual([lone])
    expect(unconfirmed([tx({ seenIn: ['screen'], timestamp: now - 3600000 }), bankSeen], now)).toEqual([]) // too fresh
    expect(unconfirmed([{ ...lone, seenIn: ['screen', 'bank'] }, bankSeen], now)).toEqual([])               // the bank agreed
  })

  it('the same merchant and amount twice within minutes is flagged; different amounts or hours apart are not', () => {
    const now = Date.now()
    const a = tx({ timestamp: now - 60000 }), b = tx({ timestamp: now - 10000 })
    expect(duplicateCharges([a, b], now)).toHaveLength(1)
    expect(duplicateCharges([a, tx({ timestamp: now - 3 * 3600000 })], now)).toHaveLength(0)
    expect(duplicateCharges([a, tx({ timestamp: now - 10000, paymentAmount: 101 })], now)).toHaveLength(0)
    expect(duplicateCharges([tx({ ref: '111111111111', timestamp: now - 60000 }), tx({ ref: '111111111111', timestamp: now - 10000 })], now)).toHaveLength(0)
  })

  it('a subscription charged twice in a month is flagged', () => {
    const now = Date.now()
    const list = [tx({ paymentReceiver: 'Netflix', paymentCategory: 'Subscriptions', timestamp: now - 20 * DAY }), tx({ paymentReceiver: 'Netflix', paymentCategory: 'Subscriptions', timestamp: now - 2 * DAY })]
    expect(duplicateCharges(list, now)[0]?.why).toMatch(/Subscription/)
  })

  it('counts payments waiting for a name', () => {
    expect(needNaming([tx({ paymentReceiver: 'Bank debit' }), tx({ paymentReceiver: 'Bank debit', reviewed: true }), tx({})])).toHaveLength(1)
  })

  it('reads an unmasked UPI id and remembers the name given to it', () => {
    expect(payeeIdOf('Sent Rs.50.00 from X1045 to ramesh.k@okaxis on 30-10-26. UPI Ref 123456789012')).toBe('ramesh.k@okaxis')
    expect(payeeIdOf('paid to ******9501@kotakbank')).toBeUndefined()
    const sms = 'Rs 500.00 debited from A/c XX1045 on 30-10-26 to ramesh.k@okaxis UPI Ref 4412987651. -Bank'
    const parsed = parseBankSms(sms)
    expect(parsed?.payeeId).toBe('ramesh.k@okaxis')
    learnNumber('ramesh.k@okaxis', 'Ramesh Kumar')
    addTransaction({ ...parsed!, paymentReceiver: 'Bank debit', timestamp: Date.now() })
    expect(read<Transaction[]>(KEYS.transactions, [])[0].paymentReceiver).toBe('Ramesh Kumar')
  })
})
