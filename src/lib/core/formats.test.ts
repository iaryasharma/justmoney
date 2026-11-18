import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from './storage'
import { parseBankSms, looksLikeBankSms } from '../capture/sms'

// A spread of everyday Indian bank messages: the direction, amount, payee and reference must come out right.
const CASES: { name: string; sms: string; type?: 'DEBIT' | 'CREDIT'; amount?: number; payee?: RegExp; ref?: string; none?: boolean }[] = [
  { name: 'HDFC UPI debit', sms: 'Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 30/10/26 Ref 630012345678 Not You? Call 18002586161', type: 'DEBIT', amount: 250, payee: /swiggy/i, ref: '630012345678' },
  { name: 'HDFC credit', sms: 'Credit Alert! Rs.12000.00 credited to HDFC Bank A/c XX1234 on 30-10-26 from VPA rahul@okhdfcbank (UPI 630099887766)', type: 'CREDIT', amount: 12000, ref: '630099887766' },
  { name: 'SBI UPI debit', sms: 'Dear UPI user A/C X4321 debited by 340.0 on date 30Oct26 trf to MAHESH KUMAR Refno 630011223344. If not u? call 1800111109 for other services-SBI', type: 'DEBIT', amount: 340, payee: /mahesh/i, ref: '630011223344' },
  { name: 'SBI credit', sms: 'Dear UPI user A/C X4321 credited by Rs 1500 on date 30Oct26 by  (Ref no 630055667788)', type: 'CREDIT', amount: 1500, ref: '630055667788' },
  { name: 'ICICI debit', sms: 'ICICI Bank Acct XX567 debited for Rs 899.00 on 30-Oct-26; AMAZON PAY INDIA credited. UPI:630077665544. Call 18002662 for dispute.', type: 'DEBIT', amount: 899, ref: '630077665544' },
  { name: 'Axis debit', sms: 'Rs 1,250.00 debited from A/c no. XX8899 on 30-10-2026 12:30:45 to UPI-ZOMATO. UPI Ref 630088990011. Axis Bank', type: 'DEBIT', amount: 1250, ref: '630088990011' },
  { name: 'Card spend', sms: 'Spent Rs.2,499.00 on HDFC Bank Credit Card xx9012 at MYNTRA on 30-Oct-26. Avl limit Rs.45,000', type: 'DEBIT', amount: 2499, payee: /myntra/i },
  { name: 'ATM withdrawal', sms: 'Rs 5000.00 withdrawn from A/c XX1234 at ATM on 30-10-26. Avl Bal Rs 20,100.55', type: 'DEBIT', amount: 5000 },
  { name: 'Salary credit', sms: 'Your A/c XX1234 is credited with Rs.65,000.00 on 30-Oct-26 by NEFT-ACME TECH PVT LTD-SALARY. Avl bal Rs 70,000', type: 'CREDIT', amount: 65000 },
  { name: 'Refund', sms: 'Refund of Rs.399.00 for your order credited to A/c XX1234 on 30-Oct-26. Ref 630044556677', type: 'CREDIT', amount: 399 },
  { name: 'OTP', sms: '123456 is your OTP for transaction of Rs.2,000 at FLIPKART. Do not share it with anyone.', none: true },
  { name: 'Promo', sms: 'Get Rs.500 cashback on your next recharge! Use code SAVE500. T&C apply.', none: true },
  { name: 'Due notice', sms: 'Your credit card bill of Rs.12,340 is due on 05-Nov-26. Pay now to avoid late fee.', none: true },
  { name: 'Failed', sms: 'Your UPI payment of Rs 600 to SWIGGY has failed. Amount will be refunded if debited.', none: true },
]

describe('everyday bank message formats', () => {
  beforeEach(() => { write(KEYS.paymentMethods, []); write(KEYS.transactions, []) })
  for (const c of CASES) {
    it(c.name, () => {
      const r = looksLikeBankSms(c.sms) ? parseBankSms(c.sms) : null
      if (c.none) { expect(r).toBeNull(); return }
      expect(r, 'should be read').not.toBeNull()
      if (c.type) expect(r!.paymentType).toBe(c.type)
      if (c.amount) expect(r!.paymentAmount).toBe(c.amount)
      if (c.payee) expect(r!.paymentReceiver).toMatch(c.payee)
      if (c.ref) expect(r!.ref).toBe(c.ref)
    })
  }
})
