import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { isStoreWalletCredit } from '../core/data'
import { processCaptured } from '../capture/autocapture'
import type { PaymentMethod, Transaction } from '../core/types'

const acc: PaymentMethod = { id: 'k', name: 'Kotak 811', type: 'BANK', last4: '1045', color: '#000', createdAt: 0, bank: 'Kotak' }
const txs = () => read<Transaction[]>(KEYS.transactions, [])
let n = 1
const note = (pkg: string, title: string, text: string) => processCaptured([{ id: n++, pkg, title, text, ts: Date.now() + n * 20 * 60000 }])

describe('store credit put in a shop wallet is not income', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })

  it('notifications from the shop apps themselves are ignored', () => {
    note('com.zeptoconsumerapp', '₹100 credited in your Zepto Cash wallet', 'Use it on your next order. Valid for 30 days.')
    note('in.jiomart.android', '₹150 added to your JioMart wallet', 'Shop more and save.')
    note('com.bigbasket.mobileapp', 'Rs. 75 credited to your BB wallet', '')
    note('com.bewakoof.bewakoof', '₹200 credited to your Bewakoof wallet', 'Redeem on orders above ₹999.')
    note('in.amazon.mShop.android.shopping', '₹50 added to your Amazon Pay balance', 'Cashback on your order.')
    expect(txs()).toHaveLength(0)
  })

  it('texts from a shop, saying the same thing, are ignored too', () => {
    processCaptured([{ id: 90, pkg: 'sms:AX-ZEPTOO', title: 'ZEPTOO', text: 'Rs.100 has been credited to your Zepto Cash wallet. Use it on your next order. T&C apply', ts: Date.now() }])
    processCaptured([{ id: 91, pkg: 'sms:VM-BIGBSK', title: 'BIGBSK', text: 'Rs 250 credited in your bigbasket wallet for use on your orders.', ts: Date.now() }])
    expect(txs()).toHaveLength(0)
  })

  it('cashback into a payment app wallet is store credit too, with or without usage wording', () => {
    note('com.google.android.apps.nbu.paisa.user', 'Cashback received', '₹10 cashback has been credited to your wallet.')
    expect(txs()).toHaveLength(0)
    note('com.phonepe.app', 'Cashback of ₹5 received', '₹5 cashback has been credited to your PhonePe wallet')
    note('com.flipkart.android', 'SuperCoins credited', '25 SuperCoins credited to your account. Use them on Flipkart')
    note('com.application.zomato', 'Zomato Money', '₹40 added to Zomato Money as refund')
    note('in.swiggy.android', 'Swiggy Money', '₹75 Swiggy Money credited')
    note('com.dreamplug.androidapp', 'CRED', 'You earned 500 CRED coins on your bill payment of ₹2,000')
    expect(txs()).toHaveLength(0)
    note('net.one97.paytm', '₹30 added to your Paytm wallet', 'Use it on movie tickets and recharges. Valid till 10 Nov.')
    expect(txs()).toHaveLength(0)
    // real money still counts: a payment received into the bank
    note('net.one97.paytm', 'Received ₹1510 from Anita Sharma', 'Deposited in your UCO Bank - 6469 on 05 November at 7:37 PM')
    expect(txs()).toHaveLength(1)
  })

  it('a real bank credit that mentions a wallet is not caught', () => {
    processCaptured([{ id: 95, pkg: 'sms:VM-KOTAKB', title: 'x', text: 'Received Rs.500.00 in your Kotak811 a/c XX1045 on 30-Oct-26 from Paytm wallet. UPI ref no. 617128229500. -Kotak', ts: Date.now() }])
    expect(txs()).toHaveLength(1)
  })

  it('money from a person, and ordinary payments, are untouched', () => {
    note('com.phonepe.app', 'Received ₹250', 'Ram Jagtap paid you ₹250.')
    expect(txs()).toHaveLength(1)
    expect(isStoreWalletCredit('You received ₹100 from Ram on UPI')).toBe(false)
    expect(isStoreWalletCredit('Salary credited to your account XX1045. Avl balance Rs 20,000')).toBe(false)
    expect(isStoreWalletCredit('₹100 credited in your Zepto Cash wallet')).toBe(true)
  })
})
