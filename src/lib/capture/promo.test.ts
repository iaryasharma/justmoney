import { describe, it, expect } from 'vitest'
import { isPromoOrFuture } from '../core/data'
import { parseBankSms } from './sms'
import { parsePaymentNotification } from './autocapture'

const real = [
  'Rs 500.00 debited from A/c XX1045 on 30-Oct-26 to VPA swiggy@icici UPI Ref 4412. -Kotak Bank',
  'Rs.2500 credited to your a/c XX6469 on 30-10-26 by UPI from RAMESH KUMAR. Bal Rs 5000 -UCO Bank',
  'Interest of Rs 120.50 credited to your A/c XX1045 on 30-09-2026. -Kotak Bank',
  'Cashback of Rs 5 credited to your A/c XX1045 for UPI txn. -Kotak Bank',
  'Refund of Rs 299 credited to your account XX6469 by AMAZON. -UCO Bank',
  'Rs 2000 credited to A/c XX1045 on 30-10-26 UPI Ref 4412987651. Avl bal Rs 9000. Earn up to 7% interest on FD, T&C apply. -Kotak Bank',
]
const promo = [
  'Get cashback up to Rs 100 on your next recharge. Offer valid till 31 Oct. T&C apply',
  'Cashback of Rs 50 will be credited to your account within 7 working days',
  'Earn 7.5% p.a. interest on FD of Rs 10000. Apply now! -Kotak Bank',
  'Congrats! Rs 250 reward unlocked. Scratch card now and win up to Rs 1000',
  'Your refund of Rs 299 will be credited in 3-5 days',
  'Interest rate hike: save Rs 50000 and earn 8% returns. Click here',
]

describe('offers and money that has not arrived are never added', () => {
  it('lets real messages through', () => { for (const m of real) expect(isPromoOrFuture(m), m).toBe(false) })
  it('stops promotions and future credits', () => { for (const m of promo) expect(isPromoOrFuture(m), m).toBe(true) })
  it('reads the real ones as transactions and the promos as nothing', () => {
    expect(parseBankSms(real[1])).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 2500 })
    expect(parseBankSms(real[2])).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 120.5, paymentCategory: 'Interest' })
    for (const m of promo) expect(parseBankSms(m), m).toBeNull()
  })
  it('does the same for notifications', () => {
    const n = (text: string) => ({ pkg: 'com.phonepe.app', title: 'PhonePe', text, ts: Date.now() })
    expect(parsePaymentNotification(n('Get cashback up to ₹100 on your next payment. T&C apply'))).toBeNull()
    expect(parsePaymentNotification(n('Cashback of ₹50 will be credited within 7 days'))).toBeNull()
  })
})
