import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from '../core/storage'
import { getAll } from '../core/data'
import { processCaptured } from './autocapture'
import type { CapturedNotification } from '../core/types'

let id = 0
const sms = (sender: string, text: string): CapturedNotification => ({ id: ++id, pkg: `sms:${sender}`, title: sender, text, ts: Date.now() - id * 3600000 })
const shown = (title: string, text: string): CapturedNotification => ({ id: ++id, pkg: 'com.google.android.apps.messaging', title, text, ts: Date.now() - id * 3600000 })

// adverts and offers that say "credited", "received" or quote a price: none of them is money that moved
const PROMOS: CapturedNotification[] = [
  sms('VM-PILGRM-S', 'CREDITED: Buy 1 Get 1 FREE in your account!\n\nBonus: FREE Vanity Bag on orders above Rs. 699.\n\nShop Now: http://u3.mnge.co/PILGRM/y0LBULA\n\n-PILGRIM'),
  sms('VM-PILGRM-P', 'CREDITED: Buy 1 Get 1 FREE in your account! Bonus on orders above Rs. 699. -PILGRIM'),
  sms('AX-HDFCBK-P', 'Pre-approved loan of Rs 5,00,000 credited to your account in 10 seconds. Apply now: hdfc.bank.in/pl'),
  sms('JD-ZOMATO-S', 'Your account has been credited with Rs.150 OFF on your next 3 orders. Order now!'),
  sms('VK-FLPKRT-S', '500 SuperCoins credited to your account. Use them on orders above Rs.999'),
  sms('AD-MYNTRA-S', 'Rs.300 received in your Myntra account as a welcome gift! Shop now, valid till Sunday'),
  sms('BZ-PAYTM-S', 'Get Rs 100 cashback credited on your next electricity bill payment via Paytm. Pay now'),
  sms('JM-SWIGGY-S', 'Congrats! Rs.75 Swiggy Money credited. Use on your next order'),
  shown('VM-AJIOLF-P', 'Flat Rs.500 credited to your AJIO wallet! Shop the sale now'),
  shown('AX-AMAZON-S', 'Deal of the day: Rs.1,299 only. Paid by 2L+ happy customers. Buy now'),
]

// real alerts in the formats Indian banks use: each must still be recorded
const REAL: CapturedNotification[] = [
  sms('JX-UCOBNK-T', 'A/c XX6469 Debited with Rs.1,308.00 on 05-11-2026 by UCO-UPI.Avl Bal Rs.15030.66. Report Dispute'),
  sms('JK-UCOBNK-T', 'A/c XX6469 Credited with Rs.1,510.00 on 05-11-2026 by UCO-UPI.Avl Bal Rs.16540.66. -UCO Bank'),
  sms('JK-UCOBNK-S', 'Your UCO Bank A/c XX6469 has been Credited with Rs.1.00 by Transfer.Avl Bal in your A/c is Rs.16,338.66.'),
  sms('JM-UCOBNK-S', 'Rs. 1.00 was spent on your Debit Card XX2434 on 03-11-2026 at BIGTREEEntertainmeMumbai. Available Balance in your Account is 16597.66.UCO Bank'),
  sms('AX-KOTAKB-S', 'Sent Rs.40.00 from Kotak Bank A/c X1045 to YASH MANGALANI on 05-11-26. UPI Ref 219808672082. Not done by you? Tap kotak.bank.in'),
  sms('VM-KOTAKB-S', 'Received Rs.5.00 in your Kotak811 a/c XX1045 on 30-Oct-26 as UPI cashback. UPI ref no. 617128229599. -Kotak'),
  sms('VM-SBIUPI-T', 'Dear UPI user A/C X6469 debited by 340.0 on date 05Nov26 trf to YASH MANGALANI Refno 530912345678. If not u? call 1800111109. -SBI'),
  sms('AD-HDFCBK-T', 'Rs.500.00 has been debited from account **1234 to VPA rohan@ybl on 05-11-26. Your UPI transaction reference number is 612345678901.'),
  sms('VM-ICICIT-S', 'INR 3,200.00 spent on your ICICI Bank Card XX1234 on 30-Oct-26 at AMAZON PAY. Avl Limit INR 80,000'),
  sms('AX-AXISBK-T', 'INR 1500.00 credited to A/c no. XX4567 on 05-11-26 13:10:22 IST. Info- UPI/P2A/612398765432/RAHUL. Avl Bal-INR 9,500.00'),
  sms('JD-UCOBNK-T', 'Rs.2000 withdrawn at ATM from A/c XX6469 on 06-11-2026. Avl Bal Rs.13030.66'),
  { id: ++id, pkg: 'net.one97.paytm', title: 'Received ₹1510 from Anita Sharma', text: 'Deposited in your UCO Bank - 6469 on 05 November at 7:37 PM', ts: Date.now() - 50 * 3600000 },
]

describe('only real money is recorded from messages', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.captureLog, []); write(KEYS.payeeNames, {}); write(KEYS.paymentMethods, []) })

  it.each(PROMOS.map((p) => [p.text.slice(0, 50), p] as const))('ignores the advert "%s…"', (_, p) => {
    processCaptured([p])
    expect(getAll()).toHaveLength(0)
  })

  it.each(REAL.map((r) => [r.text.slice(0, 50), r] as const))('records the alert "%s…"', (_, r) => {
    processCaptured([r])
    expect(getAll()).toHaveLength(1)
  })
})
