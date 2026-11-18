import { describe, expect, it } from 'vitest'
import { payeeKey, payeeLabel } from './payee'
import { detectAnomalies } from './anomaly'
import type { Transaction } from '../core/types'

const DAY = 86400000
let n = 0
const tx = (receiver: string, amount: number, at: number, category = 'Others'): Transaction => ({
  id: `p${++n}`, timestamp: at, paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: receiver, paymentCategory: category, createdAt: at, updatedAt: at,
})

describe('payee identity', () => {
  it('merges official merchants under their brand', () => {
    const k = payeeKey('Uber')
    expect(payeeKey('UBER INDIA SYSTEMS PVT LTD')).toBe(k)
    expect(payeeKey('Uber Trip')).toBe(k)
    expect(payeeKey('Swiggy Limited')).toBe(payeeKey('SWIGGY'))
    // Instamart and Dineout are their own apps, kept apart from Swiggy food and Zomato
    expect(payeeKey('SWIGGY INSTAMART')).not.toBe(payeeKey('Swiggy Limited'))
    expect(payeeKey('Zomato UPI')).toBe(payeeKey('Zomato Ltd'))
    // Dineout is Swiggy's own app; Zomato's dining is District
    expect(payeeKey('DINEOUT')).not.toBe(payeeKey('Swiggy Limited'))
    expect(payeeKey('Zomato Dine in')).toBe(payeeKey('ZOMATO DINEIN'))
    expect(payeeKey('Zomato Dinein')).not.toBe(payeeKey('Zomato'))
    expect(payeeKey('District Dine-in')).not.toBe(payeeKey('District'))
    expect(payeeLabel('UBER INDIA SYSTEMS PVT LTD')).toBe('Uber')
  })
  it('keeps different merchants apart', () => {
    expect(payeeKey('Zomato')).not.toBe(payeeKey('Swiggy'))
    expect(payeeKey('Jio Recharge')).not.toBe(payeeKey('JioMart'))
  })
  it('never merges people: same name stays exact', () => {
    expect(payeeKey('Rahul Sharma')).toBe('rahulsharma')
    expect(payeeKey('Rahul Sharma')).not.toBe(payeeKey('Rahul S'))
    // a person whose name happens to look like a brand, once filed under Family or a loan, is not the company
    expect(payeeKey('Uber Singh', 'Family')).toBe('ubersingh')
    expect(payeeKey('Uber Singh', 'Loan')).toBe('ubersingh')
    expect(payeeLabel('Uber Singh', 'Family')).toBe('Uber Singh')
  })
  it('history for alerts follows the brand', () => {
    const base = Date.now() - 60 * DAY
    const hist = [0, 10, 20, 30].map((d, i) => tx(['Uber', 'UBER INDIA SYSTEMS PVT LTD', 'Uber Trip', 'UBER'][i], 300, base + d * DAY))
    const big = tx('UBER INDIA SYSTEMS PVT LTD', 1800, Date.now())
    expect(detectAnomalies([...hist, big], [big]).map((a) => a.kind)).toEqual(['spike'])
  })
})
