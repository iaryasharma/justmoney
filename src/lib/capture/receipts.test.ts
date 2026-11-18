import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { parseScreenshot, type OcrResult } from './screenshot'
import { mergeIntoExisting, processCaptured } from './autocapture'
import type { PaymentMethod, Transaction } from '../core/types'

/** Lines as the on-phone OCR reads a screenshot: top to bottom, the amount in the biggest type. */
const ocr = (rows: [string, number?][]): OcrResult => {
  const lines = rows.map(([text, height], i) => ({ text, top: i * 60, left: 20, height: height ?? 30 }))
  return { text: lines.map((l) => l.text).join('\n'), lines }
}

const paytm = ocr([
  ['Paytm'], ['Money Sent Successfully', 40], ['₹5', 120], ['Rupees Five Only'], ['Money Transfer'],
  ['To: Samarth Kailash'], ['Magar'], ['UPI ID:'], ['******9501@kotakbank'],
  ['From: Arya Sharma'], ['UPI ID: testuser@ptyes'], ['Kotak Mahindra Bank - 1045'],
  ['UPI Ref No: 617128229511'], ['08:22 PM, 30 Oct 2026'], ['Powered by UPI YES BANK'],
])
const gpay = ocr([
  ['B'], ['To Blinkit', 40], ['₹274', 120], ['Blinkit Payment'], ['Completed'], ['14 May 2026, 9:06 am'],
  ['UCO Bank 6469'], ['Payment of ₹274 completed'], ["Receiver's bank has confirmed deposit"], ['of money to Blinkit\'s bank account'],
  ['UPI transaction ID'], ['613485823916'], ['To: Blinkit'], ['••••nkit@ptybl'],
  ['From: ARYA SHARMA (UCO Bank)'], ['••••1897@okicici on Google Pay'], ['Google transaction ID'], ['CICAgOjnyrPVNw'], ['POWERED BY UPI'], ['Google Pay'],
])
const phonepe = ocr([
  ['Transaction Successful', 40], ['12:15 pm on 21 Aug 2026'], ['Paid to'], ['MOHALLATECHPRIVATELIMITED', 40], ['₹1', 60], ['AUTOPAY'],
  ['Payment Details'], ['Message'], ['Subscription for MOHALLATECHP'], ['PhonePe Transaction ID'], ['OLEX26082112154386909302 38'],
  ['Debited from'], ['XXXXXXXXXX6469'], ['₹1'], ['UTR: 623306972577'], ['Powered by UPI AUTOPAY YES BANK'],
])

const acc = (id: string, bank: string, last4: string): PaymentMethod => ({ id, name: `${bank} ${last4}`, type: 'BANK', last4, color: '#000', createdAt: 0, bank })

describe('receipts shared from payment apps', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.people, []); write(KEYS.paymentMethods, [acc('k', 'Kotak', '1045'), acc('u', 'UCO', '6469')]) })

  it('Paytm: who was paid (not the sender), amount, bank, reference, time', () => {
    const p = parseScreenshot(paytm)
    expect(p.confidence).toBe('high')
    expect(p.tx).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 5, paymentReceiver: 'Samarth Kailash Magar', paymentApp: 'Paytm', paymentMethodId: 'k', ref: '617128229511' })
    expect(new Date(p.tx!.timestamp!).getHours()).toBe(20)
    expect(new Date(p.tx!.timestamp!).getMinutes()).toBe(22)
  })
  it('Google Pay: merchant, amount, UCO account, the id on the next line', () => {
    const p = parseScreenshot(gpay)
    expect(p.tx).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 274, paymentReceiver: 'Blinkit', paymentApp: 'Google Pay', paymentMethodId: 'u', ref: '613485823916' })
    expect(new Date(p.tx!.timestamp!).getMonth()).toBe(4)
  })
  it('PhonePe: merchant, the small ₹1 autopay, UCO account, UTR', () => {
    const p = parseScreenshot(phonepe)
    expect(p.tx).toMatchObject({ paymentType: 'DEBIT', paymentAmount: 1, paymentApp: 'PhonePe', paymentMethodId: 'u', ref: '623306972577' })
    expect(p.tx!.paymentReceiver.toLowerCase()).toContain('mohallatech')
  })
  it('a receipt shared after the bank message names that entry instead of adding another', () => {
    const t = new Date('2026-10-30T20:22:00').getTime()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: 'Sent Rs.5.00 from Kotak Bank A/c X1045 to 9501@kotakbank on 30-10-26. UPI Ref 617128229511. Not you? -Kotak', ts: t }])
    const hit = mergeIntoExisting({ ...parseScreenshot(paytm).tx!, timestamp: t + 60000 }, 'screen', 3 * 3600000)
    const all = read<Transaction[]>(KEYS.transactions, [])
    expect(hit).not.toBeNull()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ paymentReceiver: 'Samarth Kailash Magar', paymentApp: 'Paytm', ref: '617128229511' })
  })
})
