import { describe, it, expect } from 'vitest'
import { isUnnamed, payeeSuggestions } from './payeeGuess'
import type { Transaction } from '../core/types'

const tx = (id: string, who: string, amt: number, type: 'DEBIT' | 'CREDIT', y: number, m: number, d: number): Transaction =>
  ({ id, timestamp: new Date(y, m, d, 12).getTime(), paymentAmount: amt, paymentType: type, paymentReceiver: who, paymentCategory: 'Others', createdAt: 0, updatedAt: 0 } as Transaction)

describe('who was this, when the bank does not say', () => {
  const all = [
    tx('1', 'Acme Pvt Ltd', 13650, 'CREDIT', 2026, 8, 29), tx('2', 'Acme Pvt Ltd', 13650, 'CREDIT', 2026, 7, 28), tx('3', 'Rohan', 13500, 'CREDIT', 2026, 6, 2),
    tx('4', 'Zepto', 120, 'DEBIT', 2026, 9, 1), tx('5', 'Bank debit', 120, 'DEBIT', 2026, 9, 5),
  ]
  it('knows an unnamed entry', () => { expect(isUnnamed(all[4])).toBe(true); expect(isUnnamed(all[3])).toBe(false) })
  it('suggests who paid the same amount before', () => {
    const t = tx('n', 'Bank credit', 13650, 'CREDIT', 2026, 9, 29)
    expect(payeeSuggestions(t, all)[0]).toBe('Acme Pvt Ltd')
  })
  it('for money in, a similar amount around the same day of the month also counts', () => {
    const t = tx('n', 'Bank credit', 13640, 'CREDIT', 2026, 9, 30)
    expect(payeeSuggestions(t, all)).toContain('Acme Pvt Ltd')
  })
  it('for a payment, the same amount before', () => {
    expect(payeeSuggestions(all[4], all)).toEqual(['Zepto'])
  })
  it('does not suggest a name for money going the other way', () => {
    expect(payeeSuggestions(tx('n', 'Bank debit', 13650, 'DEBIT', 2026, 9, 29), all)).toEqual([])
  })
})
