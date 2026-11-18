import { describe, expect, it } from 'vitest'
import { looksLikeSettlement, matchPayout, merchantAppOfPackage, planSettlements } from './merchant'
import { parsePaymentNotification } from '../capture/autocapture'
import type { Transaction } from '../core/types'

const H = 3600000
let n = 0
const tx = (o: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, timestamp: 0, paymentAmount: 0, paymentType: 'CREDIT', paymentReceiver: 'X', paymentCategory: 'Business', createdAt: 0, updatedAt: 0, ...o,
})
const sale = (amount: number, at: number, app = 'PhonePe Business') => tx({ paymentAmount: amount, timestamp: at, paymentApp: app, paymentReceiver: 'Customer' })
const D0 = Date.UTC(2026, 9, 28, 10)

describe('shop payouts are not counted twice', () => {
  it('1000 + 2000 + 500 in the shop app, 3500 in the bank next day: one payout covering all three', () => {
    const sales = [sale(1000, D0), sale(2000, D0 + 2 * H), sale(500, D0 + 5 * H)]
    const bank = tx({ paymentAmount: 3500, timestamp: D0 + 26 * H, paymentReceiver: 'PHONEPE PRIVATE LIMITED', paymentCategory: 'Other income', paymentMethodId: 'acc1' })
    const plans = planSettlements([...sales, bank])
    expect(plans).toHaveLength(1)
    expect(plans[0].settlementId).toBe(bank.id)
    expect(plans[0].saleIds.sort()).toEqual(sales.map((s) => s.id).sort())
    expect(plans[0].fee).toBe(0)
  })

  it('leaves later sales waiting for their own payout', () => {
    const a = sale(1000, D0), b = sale(2000, D0 + H), later = sale(750, D0 + 30 * H)
    const bank = tx({ paymentAmount: 3000, timestamp: D0 + 26 * H, paymentReceiver: 'Settlement PhonePe', paymentMethodId: 'acc1' })
    const [plan] = planSettlements([a, b, later, bank])
    expect(plan.saleIds.sort()).toEqual([a.id, b.id].sort())
  })

  it('allows for the fees a payout can lose', () => {
    const m = matchPayout(1960, [{ id: 'a', at: 1, amount: 1000 }, { id: 'b', at: 2, amount: 1000 }])
    expect(m?.ids.sort()).toEqual(['a', 'b'])
  })

  it('finds an exact combination when the payout skips a sale', () => {
    const m = matchPayout(1500, [{ id: 'a', at: 1, amount: 1000 }, { id: 'b', at: 2, amount: 700 }, { id: 'c', at: 3, amount: 500 }])
    expect(m?.ids.sort()).toEqual(['a', 'c'])
  })

  it('does not swallow a credit that matches nothing', () => {
    expect(matchPayout(4200, [{ id: 'a', at: 1, amount: 1000 }, { id: 'b', at: 2, amount: 2000 }])).toBeNull()
    const friend = tx({ paymentAmount: 1000, timestamp: D0 + 3 * H, paymentReceiver: 'Rohan Mehta', paymentCategory: 'Gift', paymentMethodId: 'acc1' })
    expect(planSettlements([sale(1000, D0), friend])).toHaveLength(0) // does not read like a payout
  })

  it('keeps PhonePe and Paytm sales apart', () => {
    const phonepe = sale(1000, D0), paytm = sale(1000, D0 + H, 'Paytm Business')
    const bank = tx({ paymentAmount: 1000, timestamp: D0 + 26 * H, paymentReceiver: 'ONE97 COMMUNICATIONS', paymentMethodId: 'acc1' })
    const [plan] = planSettlements([phonepe, paytm, bank])
    expect(plan.saleIds).toEqual([paytm.id])
  })

  it('is safe to run again', () => {
    const s = sale(500, D0)
    const bank = tx({ paymentAmount: 500, timestamp: D0 + 25 * H, paymentReceiver: 'PhonePe payments', paymentMethodId: 'acc1' })
    const done = { ...bank, settlesIds: [s.id], paymentCategory: 'Self transfer' }
    expect(planSettlements([{ ...s, settledBy: bank.id }, done])).toHaveLength(0)
  })

  it('recognises what a bank writes for a payout, and not a refund', () => {
    expect(looksLikeSettlement({ paymentType: 'CREDIT', paymentReceiver: 'PAYTM PAYMENTS SERVICES LTD' })).toBe(true)
    expect(looksLikeSettlement({ paymentType: 'CREDIT', paymentReceiver: 'Rohan Mehta' })).toBe(false)
    expect(looksLikeSettlement({ paymentType: 'CREDIT', paymentReceiver: 'Paytm refund' })).toBe(false)
  })
})

describe('business app notifications', () => {
  const at = Date.now()
  it('files a sale as Business income with no bank account', () => {
    const t = parsePaymentNotification({ pkg: 'com.phonepe.app.business', title: 'Payment received', text: 'You received ₹500 from Rahul Kumar', ts: at })!
    expect(t).toMatchObject({ paymentAmount: 500, paymentType: 'CREDIT', paymentCategory: 'Business', paymentApp: 'PhonePe Business', paymentReceiver: 'Rahul Kumar' })
    expect(t.paymentMethodId).toBeUndefined()
  })
  it('copes with a sale that names nobody', () => {
    const t = parsePaymentNotification({ pkg: 'com.paytm.business', title: 'Paytm for Business', text: '₹1,250 received', ts: at })!
    expect(t).toMatchObject({ paymentAmount: 1250, paymentCategory: 'Business', paymentApp: 'Paytm Business' })
  })
  it('ignores the app saying it has paid out, the bank credit is the record', () => {
    expect(parsePaymentNotification({ pkg: 'com.phonepe.app.business', title: 'Settlement', text: 'Settlement of ₹3,500 credited to your bank account', ts: at })).toBeNull()
  })
  it('finds a business app by its package even when the id is new', () => {
    expect(merchantAppOfPackage('com.phonepe.app.business')).toBe('PhonePe Business')
    expect(merchantAppOfPackage('com.paytm.merchant.app')).toBe('Paytm Business')
    expect(merchantAppOfPackage('com.phonepe.app')).toBeNull()
  })
})

import { mergeAutoPayouts } from './merchant'

describe('when the bank sends no message', () => {
  const day = (d: number, h = 12) => Date.UTC(2026, 9, d, h)
  it('the bank’s own credit takes over from the app’s payout, so the money is counted once', () => {
    const s1 = sale(1000, day(28)), s2 = sale(2000, day(28, 14))
    const auto = tx({ id: 'auto', paymentAmount: 3000, timestamp: day(29, 10), paymentCategory: 'Self transfer', paymentMethodId: 'acc1', autoPayout: true, settlesIds: [s1.id, s2.id], paymentReceiver: 'PhonePe payout' })
    const real = tx({ id: 'real', paymentAmount: 3000, timestamp: day(29, 15), paymentCategory: 'Other income', paymentMethodId: 'acc1', paymentReceiver: 'UPI/CR/123' })
    const { list, changed } = mergeAutoPayouts([{ ...s1, settledBy: 'auto' }, { ...s2, settledBy: 'auto' }, auto, real])
    expect(changed).toBe(true)
    expect(list.find((t) => t.id === 'auto')).toBeUndefined()
    expect(list.find((t) => t.id === 'real')).toMatchObject({ paymentCategory: 'Self transfer', settlesIds: [s1.id, s2.id] })
    expect(list.filter((t) => t.settledBy === 'real')).toHaveLength(2)
  })
  it('leaves an unrelated credit alone', () => {
    const auto = tx({ id: 'auto', paymentAmount: 3000, timestamp: day(29, 10), paymentCategory: 'Self transfer', paymentMethodId: 'acc1', autoPayout: true, settlesIds: ['x'] })
    const other = tx({ id: 'o', paymentAmount: 5000, timestamp: day(29, 12), paymentMethodId: 'acc1' })
    expect(mergeAutoPayouts([auto, other]).changed).toBe(false)
  })
})
