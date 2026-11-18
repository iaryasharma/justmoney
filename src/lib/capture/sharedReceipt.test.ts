import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from '../core/storage'
import { getAll } from '../core/data'
import { processCaptured } from './autocapture'
import { matchShared } from './capture'
import { amountInWords, parseScreenshot } from './screenshot'
import paytmMyJio from '../fixtures/paytm-myjio-receipt.ocr.json'

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m).getTime()
const line = (text: string, i: number, height = 22) => ({ text, top: i * 40, left: 0, height })

describe('a shared Paytm receipt completes the bank entry instead of adding a wrong one', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.captureLog, []); write(KEYS.payeeNames, {}) })

  it('"₹" read as a leading 7 is the bank’s ₹330, and the entry gets the name', () => {
    processCaptured([{ id: 1, pkg: 'sms:JX-UCOBNK-T', title: 'x', text: 'A/c XX6469 Debited with Rs.330.00 on 12-11-2026 by UCO-UPI.Avl Bal Rs.15030.66.', ts: at(11, 40) }])
    // how the receipt came back, from any reader (on-device guess, AI): one row, amount 7330
    const hit = matchShared({ paymentAmount: 7330, paymentType: 'DEBIT', paymentReceiver: 'Jio', paymentCategory: 'EMI/Bill', paymentApp: 'Paytm', timestamp: at(11, 42) })
    expect(hit).not.toBeNull()
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0]).toMatchObject({ paymentAmount: 330, paymentReceiver: 'Jio' })
  })

  it('a different real amount nearby is not taken for it', () => {
    processCaptured([{ id: 1, pkg: 'sms:JX-UCOBNK-T', title: 'x', text: 'A/c XX6469 Debited with Rs.330.00 on 12-11-2026 by UCO-UPI.Avl Bal Rs.15030.66.', ts: at(11, 40) }])
    expect(matchShared({ paymentAmount: 1330, paymentType: 'DEBIT', paymentReceiver: 'Jio', paymentCategory: 'Others', timestamp: at(11, 42) })).toBeNull()
  })

  it('a real Paytm receipt the phone reads as "7329" is ₹329, from the amount in words', () => {
    expect(parseScreenshot(paytmMyJio).tx).toMatchObject({ paymentAmount: 329, paymentReceiver: 'Myjio', paymentApp: 'Paytm', ref: '318863813787' })
  })

  it('reads amounts in words with lakhs, thousands and paise', () => {
    expect(amountInWords('Rupees Three Hundred Twenty Nine Only')).toBe(329)
    expect(amountInWords('Rupees Fifteen Thousand Seven Hundred Forty Only')).toBe(15740)
    expect(amountInWords('Rupees One Lakh Twenty Five Thousand Only')).toBe(125000)
    expect(amountInWords('Rupees Forty and Fifty Paise Only')).toBe(40.5)
    expect(amountInWords('Pay now, Only today')).toBe(0)
  })

  it('the parser itself prefers ₹330 when the big number reads 7330 and 330 appears elsewhere', () => {
    const p = parseScreenshot({ text: '', lines: [line('Recharge Successful', 0), line('7330', 1, 64), line('Jio Prepaid', 2), line('Plan 330 · 28 days', 3), line('12 Nov 2026, 11:42 AM', 4)] })
    expect(p.tx?.paymentAmount).toBe(330)
  })
})
