import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { isUnconfirmedCashback } from '../core/data'
import { processCaptured } from '../capture/autocapture'
import type { PaymentMethod, Transaction } from '../core/types'

const acc: PaymentMethod = { id: 'k', name: 'Kotak 811', type: 'BANK', last4: '1045', color: '#000', createdAt: 0, bank: 'Kotak' }
const GPAY = 'com.google.android.apps.nbu.paisa.user'
const notif = (title: string, text: string) => processCaptured([{ id: Math.floor(Math.random() * 1e6), pkg: GPAY, title, text, ts: Date.now() }])
const txs = () => read<Transaction[]>(KEYS.transactions, [])

describe('cashback notifications are read in full before anything is added', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })

  it('a title that says "received" over text that says what you can get is an offer', () => {
    notif('₹100 cashback received', 'You can get this reward by sending money to 3 friends. Offer valid till 5 Nov.')
    notif('You received ₹50 cashback!', 'Scratch card unlocked. Claim now to see your reward.')
    notif('₹100 cashback received', 'Pay your electricity bill of ₹500 or more to get this on your next payment.')
    notif('Cashback of ₹25 received', 'Use it when you pay a minimum order of ₹199.')
    expect(txs()).toHaveLength(0)
  })

  it('the cashback notice of a UPI app counts when it says received and nothing in it is conditional', () => {
    notif('You received ₹5 cashback', '')
    notif('₹10 cashback received', 'Thanks for paying with Google Pay.')
    expect(txs()).toHaveLength(2)
    expect(txs().map((x) => x.paymentAmount).sort()).toEqual([10, 5])
  })

  it('the same app notice with offer wording anywhere in it still does not', () => {
    notif('₹7 cashback received', 'Get more cashback on your next payment of ₹100 or more.')
    notif('₹9 cashback received', 'Offer valid till tomorrow.')
    expect(txs()).toHaveLength(0)
  })

  it('outside a UPI app, a bare cashback line is not enough', () => {
    processCaptured([{ id: 11, pkg: 'com.example.news', title: 'You received ₹5 cashback', text: '', ts: Date.now() }])
    expect(txs()).toHaveLength(0)
  })

  it('a cashback into a wallet is store credit, not income', () => {
    notif('Cashback received', '₹10 cashback has been credited to your Paytm Wallet.')
    expect(txs()).toHaveLength(0)
  })

  it('a real bank credit alert that mentions cashback is still added', () => {
    processCaptured([{ id: 7, pkg: 'sms:VM-KOTAKB', title: 'x', text: 'Received Rs.5.00 in your Kotak811 a/c XX1045 on 30-Oct-26 as UPI cashback. UPI ref no. 617128229599. -Kotak', ts: Date.now() }])
    expect(txs()).toHaveLength(1)
  })

  it('knows the difference at the text level', () => {
    expect(isUnconfirmedCashback('₹100 cashback received\nYou can get this by paying a bill')).toBe(true)
    expect(isUnconfirmedCashback('Cashback received\n₹10 credited to your account XX1045')).toBe(false)
    expect(isUnconfirmedCashback('Salary credited to your account')).toBe(false)
  })
})
