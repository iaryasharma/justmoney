import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { parseBankSms, looksLikeBankSms } from './sms'
import { addContactsInBulk } from '../payees/people'
import { processCaptured } from './autocapture'
import type { PaymentMethod, Transaction } from '../core/types'

const bob = 'Rs.30.00 Dr. from A/C XXXXXX0215 and Cr. to 9876543210@kotakbank. Ref:476344084710. AvlBal:Rs1234.50(2026:08:14 04:10:37). Not you? Call 18005700/5000-BOB'
const bobNamed = 'Rs.250.00 Dr. from A/C XXXXXX0215 and Cr. to ramesh.k@oksbi. Ref:476344084999. AvlBal:Rs984.50(2026:08:15 11:02:10). Not you? Call 18005700/5000-BOB'
const bobIn = 'Rs.500.00 Cr. to A/C XXXXXX0215 and Dr. from 9123456780@ybl. Ref:476344085555. AvlBal:Rs1484.50(2026:08:16 09:00:00). -BOB'
const acc: PaymentMethod = { id: 'b', name: 'BOB Savings', type: 'BANK', last4: '0215', color: '#000', createdAt: 0, bank: 'BoB' }

describe('Bank of Baroda messages', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.people, []); write(KEYS.paymentMethods, [acc]) })
  it('reads the amount, the payee id, the reference, the account and the exact time', () => {
    expect(looksLikeBankSms(bob)).toBe(true)
    const r = parseBankSms(bob)!
    expect(r).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 30, paymentReceiver: '9876543210@kotakbank', ref: '476344084710', paymentMethodId: 'b' })
    expect(new Date(r.timestamp!).toISOString().slice(0, 16)).toBe(new Date(2026, 7, 14, 4, 10).toISOString().slice(0, 16))
  })
  it('keeps a name-like UPI id as a name, and reads money coming in', () => {
    expect(parseBankSms(bobNamed)).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 250, paymentReceiver: 'Ramesh K' })
    expect(parseBankSms(bobIn)).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 500, paymentReceiver: '9123456780@ybl' })
  })
  it('a payment to a number in your contacts shows the contact\'s name', () => {
    const r = addContactsInBulk([{ id: 'c1', name: 'Ramesh Kumar', phones: ['+91 98765 43210'] }, { id: 'c2', name: 'Sunita', phones: ['9123456780'] }])
    expect(r.added).toBe(2)
    processCaptured([{ id: 1, pkg: 'sms:CP-BOBSMS', title: 'x', text: bob, ts: Date.now() }])
    const tx = read<Transaction[]>(KEYS.transactions, [])[0]
    expect(tx.paymentReceiver).toBe('Ramesh Kumar')
    expect(tx.contactId).toBeTruthy()
  })
})

describe('importing contacts', () => {
  beforeEach(() => write(KEYS.people, []))
  it('adds each contact once, by number, and skips ones without a number', () => {
    expect(addContactsInBulk([{ id: 'a', name: 'A One', phones: ['9000000001'] }, { id: 'b', name: 'No Number', phones: [] }, { id: 'c', name: 'A One (work)', phones: ['+91 90000 00001'] }]).added).toBe(1)
    expect(addContactsInBulk([{ id: 'a', name: 'A One', phones: ['9000000001'] }, { id: 'd', name: 'D Four', phones: ['9000000004'] }]).added).toBe(1)
    expect(read(KEYS.people, []).length).toBe(2)
  })
})

describe('UCO messages with no name at all', () => {
  const credit = 'A/c XX6469 Credited with Rs.13,650.00 on 29-10-2026 by UCO-UPI.Avl Bal Rs.xxxx Report Dispute https://spgrs.ucoonline.bank.in/Home_Page.jsp -UCO Bank'
  const debit = 'A/c XX6469 Debited with Rs.120.00 on 29-10-2026 by UCO-UPI.Avl Bal Rs.xxxx Report Dispute https://spgrs.ucoonline.bank.in/Home_Page.jsp -UCO Bank'
  it('keep the amount, the account and the date, with a plain label instead of a made-up name', () => {
    write(KEYS.paymentMethods, [{ id: 'u', name: 'UCO Bank', type: 'BANK', last4: '6469', color: '#000', createdAt: 0, bank: 'UCO' }])
    expect(parseBankSms(credit)).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 13650, paymentReceiver: 'Bank credit', paymentMethodId: 'u' })
    expect(parseBankSms(debit)).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 120, paymentReceiver: 'Bank debit', paymentMethodId: 'u' })
  })
})
