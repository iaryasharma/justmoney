import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from './storage'
import { parseBankSms, looksLikeBankSms } from '../capture/sms'
import { parsePaymentNotification } from '../capture/autocapture'

type Case = { name: string; sms: string; type?: 'DEBIT' | 'CREDIT'; amount?: number; payee?: RegExp; none?: boolean; day?: number; month?: number }
const CASES: Case[] = [
  { name: 'PNB debit', sms: 'A/c XX2345 debited INR 1,200.00 Dt 30-10-26 12:15 UPI/630011110000/Paid to ZOMATO', type: 'DEBIT', amount: 1200 },
  { name: 'Canara credit', sms: 'An amount of INR 3,500.00 has been CREDITED to your account XXX4567 on 30/10/2026 by UPI/630022220000/RAHUL', type: 'CREDIT', amount: 3500 },
  { name: 'Union debit', sms: 'A/c *1234 Debited for Rs:450.00 on 30-10-2026 12:00:00 by Mobile Banking. Avl Bal Rs:9,000', type: 'DEBIT', amount: 450 },
  { name: 'IDFC debit', sms: 'Your A/C XXXXXX1234 is debited for INR 75.00 on 30-OCT-26 for UPI Txn to Rapido. Ref 630033330000', type: 'DEBIT', amount: 75 },
  { name: 'Yes bank credit', sms: 'Rs.2,000.00 credited to your A/c XX9876 on 30-Oct-2026 towards UPI/CR/630044440000/Anita', type: 'CREDIT', amount: 2000 },
  { name: 'Credit card spend', sms: 'INR 3,200.00 spent on your ICICI Bank Card XX1234 on 30-Oct-26 at AMAZON PAY. Avl Limit INR 80,000', type: 'DEBIT', amount: 3200, payee: /amazon/i },
  { name: 'Card bill payment received', sms: 'Payment of Rs.12,340.00 received on your HDFC Bank Credit Card ending 9012 on 30-10-26. Thank you.', none: false },
  { name: 'EMI debit', sms: 'Rs 5,499.00 debited from A/c XX1234 on 30-10-26 towards EMI for loan 12345. Avl Bal Rs 22,000', type: 'DEBIT', amount: 5499 },
  { name: 'Mini statement', sms: 'Mini statement A/c XX1234: 28-10 Cr 500.00; 29-10 Dr 120.00; Bal Rs 9,000.00', none: true },
  { name: 'Balance only', sms: 'Your A/c XX1234 balance is Rs 10,500.00 as on 30-Oct-26.', none: true },
  { name: 'Cheque', sms: 'Cheque no 123456 for Rs 5,000.00 deposited in your A/c XX1234 on 30-10-26 is under clearing.', none: true },
  { name: 'Date as 30Oct26', sms: 'Rs.100.00 debited from A/c X4321 on 30Oct26 to VPA shop@ybl', type: 'DEBIT', amount: 100, day: 30, month: 9 },
  { name: 'Date as 2026-10-29', sms: 'Rs 150 sent from A/c X4321 to CAFE on 2026-10-29. UPI Ref 630055550000', type: 'DEBIT', amount: 150, day: 29, month: 9 },
  { name: 'Decimal rupees', sms: 'Rs.1,05,000.50 credited to your A/c XX1234 on 30-10-26 by NEFT-ACME', type: 'CREDIT', amount: 105000.5 },
  { name: 'UPI collect request', sms: 'RAHUL has requested money Rs 500 from you on UPI. Approve or decline in your app.', none: true },
  { name: 'Insurance premium due', sms: 'Premium of Rs 8,000 is due on 05-Nov-26 for your policy. Pay now.', none: true },
]

describe('more bank message formats', () => {
  beforeEach(() => { write(KEYS.paymentMethods, []); write(KEYS.transactions, []) })
  for (const c of CASES) {
    it(c.name, () => {
      const r = looksLikeBankSms(c.sms) ? parseBankSms(c.sms) : null
      if (c.none === true) { expect(r).toBeNull(); return }
      if (c.none === false) return    // just must not crash
      expect(r, 'should be read').not.toBeNull()
      if (c.type) expect(r!.paymentType).toBe(c.type)
      if (c.amount) expect(r!.paymentAmount).toBe(c.amount)
      if (c.payee) expect(r!.paymentReceiver).toMatch(c.payee)
      if (c.day && r!.timestamp) { const d = new Date(r!.timestamp); expect(d.getDate()).toBe(c.day); expect(d.getMonth()).toBe(c.month) }
    })
  }
})

describe('UPI app notifications', () => {
  beforeEach(() => { write(KEYS.paymentMethods, []); write(KEYS.transactions, []) })
  const n = (pkg: string, title: string, text: string) => parsePaymentNotification({ pkg, title, text, ts: Date.now() })
  it('Google Pay paid', () => expect(n('com.google.android.apps.nbu.paisa.user', 'Paid ₹250 to Swiggy', 'Payment successful')).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 250 }))
  it('PhonePe received', () => expect(n('com.phonepe.app', 'Received ₹500', 'Ram Jagtap paid you ₹500')).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 500 }))
  it('Paytm paid', () => expect(n('net.one97.paytm', 'Paid ₹1,200 to Blinkit', 'Paid via UPI')).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 1200 }))
  it('a failed payment is not added', () => expect(n('com.phonepe.app', 'Payment failed', '₹300 to Swiggy could not be completed')).toBeNull())
  it('a pending payment is not added', () => expect(n('net.one97.paytm', 'Payment of ₹300 pending', 'We are processing it')).toBeNull())
  it('a reminder to pay is not added', () => expect(n('com.google.android.apps.nbu.paisa.user', 'Your bill of ₹899 is due', 'Pay now to avoid late fees')).toBeNull())
  it('a collect request is not added', () => expect(n('com.phonepe.app', 'Ram requested ₹500', 'Approve the request in the app')).toBeNull())
})
