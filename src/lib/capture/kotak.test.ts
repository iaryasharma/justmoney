import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { parseBankSms, refOf } from './sms'
import { processCaptured } from './autocapture'
import type { PaymentMethod, Transaction } from '../core/types'

const zepto = 'Sent Rs.86.00 from Kotak Bank A/c X1045 to ZEPTO on 24-10-26. UPI Ref 173951909602. Not done by you? Tap https://kotak.bank.in/KBANKT/Fraud'
const ram = 'Sent Rs.100.00 from XX1322 to RAM JAGTAP on 30-Oct-26. UPI ref no. 666915186642. Not you? Tap https://kotk.in/KOTAKD/IRRWLj to report -Kotak'
const noPayee = 'Rs 500.00 debited from A/c XX1045 on 30-10-26 UPI Ref 4412987651. Avl bal Rs 9000. -Kotak Bank'
const acc = (id: string, name: string, last4: string): PaymentMethod => ({ id, name, type: 'BANK', last4, color: '#000', createdAt: 0, bank: 'Kotak' })

describe('Kotak messages', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc('a', 'Kotak 811', '1045'), acc('b', 'Kotak Savings', '1322')]) })
  it('read who was paid, how much, and the reference', () => {
    expect(parseBankSms(zepto)).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 86, paymentReceiver: 'Zepto', ref: '173951909602', paymentMethodId: 'a' })
    expect(parseBankSms(ram)).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 100, paymentReceiver: 'Ram Jagtap', ref: '666915186642', paymentMethodId: 'b' })
  })
  it('read money received: who sent it, how much, the account', () => {
    const got = 'Received Rs.5.00 from ARYA SHARMA in your Kotak811 a/c XX1322 on 30-Oct-26. UPI ref no. 617128229511. View balance: https://kotk.in/KOTAKD/ -Kotak'
    expect(parseBankSms(got)).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 5, paymentReceiver: 'Arya Sharma', ref: '617128229511', paymentMethodId: 'b' })
  })
  it('find the reference in other wordings', () => {
    expect(refOf('UPI Ref No. 123456789012')).toBe('123456789012')
    expect(refOf('UTR: 987654321098')).toBe('987654321098')
    expect(refOf('Rs 5 debited. Ref 4412987651.')).toBe('4412987651')
    expect(refOf('Bal Rs 9000')).toBeUndefined()
  })
  it('a payment seen twice, hours apart, is one entry', () => {
    const t = Date.now()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'VM-KOTAKB', text: ram, ts: t }, { id: 2, pkg: 'com.google.android.apps.messaging', title: 'VM-KOTAKB', text: ram, ts: t + 3 * 3600000 }])
    expect(read<Transaction[]>(KEYS.transactions, [])).toHaveLength(1)
  })
  it('the bank message first, then the Paytm success screen: one entry that says Paytm', () => {
    const t = Date.now()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: ram, ts: t }])
    processCaptured([{ id: 2, pkg: 'screen:net.one97.paytm', title: '', text: 'Payment Successful\n₹100\nPaid to Ram Jagtap\nUPI Ref No: 666915186642', ts: t + 5000 }])
    const tx = read<Transaction[]>(KEYS.transactions, [])
    expect(tx).toHaveLength(1)
    expect(tx[0].paymentApp).toBe('Paytm')
  })
  it('the screen is the entry; the bank message that follows confirms it, in either order', () => {
    const t = Date.now()
    const screen = { id: 2, pkg: 'screen:net.one97.paytm', title: '', text: 'Payment Successful\n₹100\nPaid to Ram Jagtap\nUPI Ref No: 666915186642', ts: t }
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: ram, ts: t - 3000 }, screen])
    let tx = read<Transaction[]>(KEYS.transactions, [])
    expect(tx).toHaveLength(1)
    expect(tx[0]).toMatchObject({ paymentApp: 'Paytm', paymentReceiver: 'Ram Jagtap', paymentMethodId: 'b' })
    expect(tx[0].seenIn).toEqual(['screen', 'bank'])
    write(KEYS.transactions, [])
    processCaptured([screen])
    expect(read<Transaction[]>(KEYS.transactions, [])[0].seenIn).toEqual(['screen'])
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: ram, ts: t + 4000 }])
    tx = read<Transaction[]>(KEYS.transactions, [])
    expect(tx).toHaveLength(1)
    expect(tx[0].seenIn).toEqual(['screen', 'bank'])
  })
  it('two payments of the same amount with different references stay two', () => {
    const t = Date.now()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: ram, ts: t }, { id: 2, pkg: 'sms:VM-KOTAKB', title: 'x', text: ram.replace('666915186642', '111111111111'), ts: t + 60000 }])
    expect(read<Transaction[]>(KEYS.transactions, [])).toHaveLength(2)
  })
  it('a bank that does not name the payee still gets an entry, with the reference for later matching', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: noPayee, ts: Date.now() }])
    const tx = read<Transaction[]>(KEYS.transactions, [])
    expect(tx).toHaveLength(1)
    expect(tx[0]).toMatchObject({ paymentAmount: 500, ref: '4412987651', paymentMethodId: 'a' })
  })
  it('a late message keeps the day it names', () => {
    const day = new Date(2026, 9, 24, 0, 0).getTime()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: zepto, ts: day + 5 * 86400000 }])
    const tx = read<Transaction[]>(KEYS.transactions, [])
    expect(new Date(tx[0].timestamp).getDate()).toBe(24)
    expect(tx[0].timeUnknown).toBe(true)
  })
})
