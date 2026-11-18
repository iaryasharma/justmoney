import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from '../core/storage'
import { localParseTransaction } from './ai'
import { pickAmount } from './nlparse'
import type { PaymentMethod, Transaction } from '../core/types'

const acc = (id: string, name: string, type: PaymentMethod['type'], bank: string | null, last4?: string): PaymentMethod => ({ id, name, type, bank, last4, color: '#000', createdAt: 0 })
const tx = (i: number, who: string, cat: string, note = ''): Transaction => ({ id: `t${i}`, timestamp: 1000 - i, paymentAmount: 100, paymentType: 'DEBIT', paymentReceiver: who, paymentCategory: cat, note, createdAt: 0, updatedAt: 0 } as Transaction)

beforeEach(() => {
  write(KEYS.paymentMethods, [acc('k', 'Kotak Savings', 'BANK', 'Kotak', '1045'), acc('u', 'UCO Bank', 'BANK', 'UCO', '6469'), acc('hc', 'HDFC Credit Card', 'CREDIT_CARD', 'HDFC', '7788'), acc('cash', 'Cash', 'CASH', null)])
  write(KEYS.categories, null)
  write(KEYS.transactions, [tx(1, 'Raju Chai', 'Snacks'), tx(2, 'Raju Chai', 'Snacks'), tx(3, 'Raju Chai', 'Snacks', 'morning chai'), tx(4, 'Cult Gym', 'Fitness'), tx(5, 'Ramesh Stores', 'Grocery')])
})

describe('amount', () => {
  it('reads digits, k, lakh and words', () => {
    expect(pickAmount('paid 450 to swiggy')?.value).toBe(450)
    expect(pickAmount('rent 4.5k')?.value).toBe(4500)
    expect(pickAmount('car service 1.2 lakh')?.value).toBe(120000)
    expect(pickAmount('two hundred fifty for tea')?.value).toBe(250)
    expect(pickAmount('five thousand and five hundred')?.value).toBe(5500)
  })
  it('chooses the price, not a date, a time or a count', () => {
    expect(pickAmount('paid 1200 on 5th for electricity')?.value).toBe(1200)
    expect(pickAmount('2 coffees 300')?.value).toBe(300)
    expect(pickAmount('dinner at 9pm 850')?.value).toBe(850)
    expect(pickAmount('spent 40 on 3 samosas')?.value).toBe(40)
    expect(pickAmount('on 30 oct paid ₹640')?.value).toBe(640)
  })
})

describe('free-form sentences', () => {
  it('amount, merchant, category and the account in any order', () => {
    expect(localParseTransaction('paid 450 to swiggy from my kotak')).toMatchObject({ paymentAmount: 450, paymentReceiver: 'Swiggy', paymentCategory: 'Food', paymentMethodId: 'k' })
    expect(localParseTransaction('kotak swiggy 450')).toMatchObject({ paymentAmount: 450, paymentReceiver: 'Swiggy', paymentMethodId: 'k' })
    expect(localParseTransaction('450 swiggy')).toMatchObject({ paymentAmount: 450, paymentReceiver: 'Swiggy', paymentCategory: 'Food' })
  })
  it('cash and number words', () => {
    expect(localParseTransaction('two hundred fifty for tea cash')).toMatchObject({ paymentAmount: 250, paymentSource: 'CASH', paymentMethodId: 'cash', paymentCategory: 'Snacks' })
  })
  it('a UPI app, with its nicknames', () => {
    expect(localParseTransaction('gym 1500 phonepe')).toMatchObject({ paymentAmount: 1500, paymentApp: 'PhonePe' })
    expect(localParseTransaction('lunch with friends 600 gpay')).toMatchObject({ paymentAmount: 600, paymentApp: 'Google Pay' })
  })
  it('the card, by kind and bank', () => {
    expect(localParseTransaction('uber 320 hdfc credit card')).toMatchObject({ paymentAmount: 320, paymentMethodId: 'hc', paymentSource: 'CREDIT_CARD', paymentReceiver: 'Uber' })
    expect(localParseTransaction('bought shoes 2999 on credit card')).toMatchObject({ paymentMethodId: 'hc', paymentCategory: 'Shopping' })
  })
  it('learns from your own history', () => {
    expect(localParseTransaction('chai 20')).toMatchObject({ paymentAmount: 20, paymentCategory: 'Snacks' })
    expect(localParseTransaction('paid 1800 to cult gym')).toMatchObject({ paymentReceiver: 'Cult Gym', paymentCategory: 'Fitness' })
  })
  it('income', () => {
    expect(localParseTransaction('salary 80000 credited to kotak')).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 80000, paymentMethodId: 'k' })
  })
  it('does not invent a merchant or a source', () => {
    const r = localParseTransaction('paid 300 for medicine')
    expect(r).toMatchObject({ paymentAmount: 300, paymentCategory: 'Health' })
    expect(r?.paymentMethodId).toBeUndefined()
    expect(r?.paymentApp).toBeUndefined()
  })
  it('keeps what you paid for as the note, not the receiver', () => {
    expect(localParseTransaction('tea 20')).toMatchObject({ paymentAmount: 20, paymentReceiver: 'Expense', note: 'Tea', paymentCategory: 'Snacks' })
    expect(localParseTransaction('two hundred fifty for tea cash')).toMatchObject({ paymentReceiver: 'Expense', note: 'Tea', paymentSource: 'CASH' })
    // a real name stays the receiver
    expect(localParseTransaction('paid 500 to Ramesh')).toMatchObject({ paymentReceiver: 'Ramesh' })
    expect(localParseTransaction('450 swiggy')).toMatchObject({ paymentReceiver: 'Swiggy' })
    expect(localParseTransaction('paid 1800 to cult gym')).toMatchObject({ paymentReceiver: 'Cult Gym' })
  })
  it('an old entry that used "Tea" as the receiver does not make tea a merchant', () => {
    write(KEYS.transactions, [tx(1, 'Tea', 'Snacks'), tx(2, 'Tea', 'Snacks'), tx(3, 'Tea', 'Snacks')])
    expect(localParseTransaction('tea 20')).toMatchObject({ paymentReceiver: 'Expense', note: 'Tea', paymentCategory: 'Snacks' })
  })
  it('can be switched off', () => {
    write(KEYS.descriptionAsNote, false)
    expect(localParseTransaction('tea 20')).toMatchObject({ paymentReceiver: 'Tea' })
    write(KEYS.descriptionAsNote, true)
  })
})

describe('shopping stores', () => {
  it('Trends and Reliance Trends are the same shop, under Shopping', () => {
    expect(localParseTransaction('trends 1200')).toMatchObject({ paymentReceiver: 'Trends', paymentCategory: 'Shopping' })
    expect(localParseTransaction('paid 899 to reliance trends')).toMatchObject({ paymentReceiver: 'Trends', paymentCategory: 'Shopping' })
    expect(localParseTransaction('limeroad 700')).toMatchObject({ paymentReceiver: 'Limeroad', paymentCategory: 'Shopping' })
    expect(localParseTransaction('vishal mega mart 2100')).toMatchObject({ paymentCategory: 'Shopping' })
  })
})
