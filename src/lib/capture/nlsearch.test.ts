import { describe, it, expect } from 'vitest'
import { parseSearch } from './nlsearch'

const now = new Date(2026, 9, 29) // Thursday 29 Oct 2026
const cats = ['Food', 'Travel', 'Shopping', 'Groceries', 'Rent', 'Others']

describe('natural-language search', () => {
  it('a payee and a month', () => {
    const r = parseSearch('swiggy last month', cats, now)
    expect(r).toMatchObject({ text: 'swiggy', from: '2026-09-01', to: '2026-09-30' })
  })
  it('an amount and a category', () => {
    const r = parseSearch('over ₹500 on travel', cats, now)
    expect(r).toMatchObject({ min: 500, categories: ['Travel'], text: '' })
  })
  it('knows k and word forms', () => {
    expect(parseSearch('above 1.5k', cats, now).min).toBe(1500)
    expect(parseSearch('under 2 lakh', cats, now).max).toBe(200000)
    expect(parseSearch('between 200 and 800 food', cats, now)).toMatchObject({ min: 200, max: 800, categories: ['Food'] })
  })
  it('dates in words', () => {
    expect(parseSearch('yesterday', cats, now)).toMatchObject({ from: '2026-10-28', to: '2026-10-28' })
    expect(parseSearch('uber in march', cats, now)).toMatchObject({ text: 'uber', from: '2026-03-01', to: '2026-03-31' })
    expect(parseSearch('last 7 days', cats, now)).toMatchObject({ from: '2026-10-22', to: '2026-10-29' })
    expect(parseSearch('this week', cats, now).from).toBe('2026-10-26')
  })
  it('income and expenses', () => {
    expect(parseSearch('income this year', cats, now)).toMatchObject({ type: 'CREDIT', from: '2026-01-01' })
    expect(parseSearch('expenses on groceries', cats, now)).toMatchObject({ type: 'DEBIT', categories: ['Groceries'] })
  })
  it('plain words stay as text', () => {
    const r = parseSearch('chai tapri', cats, now)
    expect(r).toMatchObject({ text: 'chai tapri', labels: [] })
  })
})
