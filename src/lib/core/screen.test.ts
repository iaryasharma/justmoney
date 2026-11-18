import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from './storage'
import { parsePaymentScreen, processCaptured } from '../capture/autocapture'
import { refOf } from '../capture/sms'
import type { PaymentMethod, Transaction } from './types'

const phonepe = ['Payment Successful', '₹450', 'Paid to', 'SWIGGY', 'Oct 30, 2026 at 12:14 PM', 'Transaction ID', 'T2610301214123456789', 'UTR No.', '101234567890', 'Debited from', 'Kotak Mahindra Bank ••1045'].join('\n')
const gpayShop = ['₹86', 'Completed', '30 Oct 2026, 12:14 pm', 'Paid to ZEPTO', 'UPI transaction ID', '306912345678', 'From Kotak Mahindra Bank 1045'].join('\n')
const gpayPerson = ['₹100', 'Completed', 'Paid to RAM JAGTAP', 'UPI transaction ID 666915186642', 'From Kotak Mahindra Bank 1322'].join('\n')
const failed = ['Payment failed', '₹450', 'Paid to', 'SWIGGY', 'Try again'].join('\n')
const kotakSms = 'Sent Rs.86.00 from Kotak Bank A/c X1045 to ZEPTO on 30-10-26. UPI Ref 306912345678. Not done by you? Tap https://kotak.bank.in/KBANKT/Fraud'
const acc = (id: string, last4: string): PaymentMethod => ({ id, name: `Kotak ${last4}`, type: 'BANK', last4, color: '#000', createdAt: 0, bank: 'Kotak' })

describe('payment-success screens', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.people, []); write(KEYS.paymentMethods, [acc('a', '1045'), acc('b', '1322')]) })
  it('read who was paid, how much and the bank reference', () => {
    expect(parsePaymentScreen({ pkg: 'screen:com.phonepe.app', text: phonepe, ts: 5 })).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 450, paymentReceiver: 'Swiggy', paymentApp: 'PhonePe', ref: '101234567890', autoCaptured: true })
    expect(parsePaymentScreen({ pkg: 'screen:com.google.android.apps.nbu.paisa.user', text: gpayShop, ts: 5 })).toMatchObject({ paymentAmount: 86, paymentReceiver: 'Zepto', paymentApp: 'Google Pay', ref: '306912345678' })
    expect(parsePaymentScreen({ pkg: 'screen:com.google.android.apps.nbu.paisa.user', text: gpayPerson, ts: 5 })).toMatchObject({ paymentAmount: 100, paymentReceiver: 'Ram Jagtap', ref: '666915186642' })
  })
  it('a failed payment makes nothing', () => {
    expect(parsePaymentScreen({ pkg: 'screen:com.phonepe.app', text: failed, ts: 5 })).toBeNull()
  })
  it('finds Google Pay and PhonePe reference numbers', () => {
    expect(refOf('UPI transaction ID 306912345678')).toBe('306912345678')
    expect(refOf('UTR No. 101234567890')).toBe('101234567890')
  })
  it('the bank SMS that follows is matched to the screen entry, not added again', () => {
    const t = Date.now()
    processCaptured([{ id: 1, pkg: 'screen:com.google.android.apps.nbu.paisa.user', title: '', text: gpayShop, ts: t }])
    expect(read<Transaction[]>(KEYS.transactions, [])).toHaveLength(1)
    processCaptured([{ id: 2, pkg: 'sms:VM-KOTAKB', title: 'VM-KOTAKB', text: kotakSms, ts: t + 40000 }])
    const all = read<Transaction[]>(KEYS.transactions, [])
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ paymentReceiver: 'Zepto', paymentAmount: 86, paymentMethodId: 'a', ref: '306912345678' })
  })
  it('and the other way round: the SMS first, the screen later', () => {
    const t = Date.now()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: kotakSms, ts: t }])
    processCaptured([{ id: 2, pkg: 'screen:com.google.android.apps.nbu.paisa.user', title: '', text: gpayShop, ts: t + 90000 }])
    expect(read<Transaction[]>(KEYS.transactions, [])).toHaveLength(1)
  })
})
