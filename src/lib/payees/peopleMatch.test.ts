import { describe, expect, it } from 'vitest'
import { findPerson, phone10, phonesIn, type Person } from './peopleMatch'

const person = (over: Partial<Person>): Person => ({ id: 'p1', name: 'Rohan Mehta', phones: ['9876543210'], aliases: [], createdAt: 0, ...over })

describe('phone numbers', () => {
  it('keeps the last 10 digits', () => {
    expect(phone10('+91 98765-43210')).toBe('9876543210')
    expect(phone10('12345')).toBeNull()
  })
  it('finds numbers in UPI ids and text', () => {
    expect(phonesIn('9876543210@ybl')).toEqual(['9876543210'])
    expect(phonesIn('Paid to +91 98765 43210 via UPI')).toEqual(['9876543210'])
    expect(phonesIn('ref 1234567890123')).toEqual([])
  })
})

describe('finding the person for a payment', () => {
  it('links by phone number', () => {
    expect(findPerson({ paymentReceiver: '9876543210@okaxis' }, [person({})])?.id).toBe('p1')
  })
  it('never links by name alone', () => {
    expect(findPerson({ paymentReceiver: 'Rohan Mehta' }, [person({})])).toBeUndefined()
  })
  it('links by a remembered name', () => {
    expect(findPerson({ paymentReceiver: 'Rohan M.' }, [person({ aliases: ['rohanm'] })])?.id).toBe('p1')
  })
  it('does not link a different person with the same name', () => {
    expect(findPerson({ paymentReceiver: 'Rohan Mehta', note: '9123456780' }, [person({})])).toBeUndefined()
  })
})

import { buildIndex, sameName, suggest } from './suggest'

describe('name suggestions', () => {
  it('matches the same name written differently', () => {
    expect(sameName('MEHTA ROHAN', 'Rohan Mehta')).toBe(true)
    expect(sameName('ROHAN MEHTA', 'Rohan Kumar Mehta')).toBe(true)
    expect(sameName('R MEHTA', 'Rohan Mehta')).toBe(true)
  })
  it('does not guess from one word or a different person', () => {
    expect(sameName('Rohan', 'Rohan Mehta')).toBe(false)
    expect(sameName('Rohan Shah', 'Rohan Mehta')).toBe(false)
  })
  it('suggests only when exactly one contact fits', () => {
    const one = buildIndex([{ name: 'Rohan Mehta', phones: [] }, { name: 'Priya Rao', phones: [] }])
    expect(suggest('ROHAN MEHTA', one, {})?.name).toBe('Rohan Mehta')
    const two = buildIndex([{ name: 'Rohan Mehta', phones: [] }, { name: 'Rohan K Mehta', phones: [] }])
    expect(suggest('ROHAN MEHTA', two, {})).toBeUndefined()
  })
  it('stops suggesting after you say no', () => {
    const idx = buildIndex([{ name: 'Rohan Mehta', phones: [] }])
    expect(suggest('ROHAN MEHTA', idx, { rohanmehta: ['rohanmehta'] })).toBeUndefined()
  })
})

describe('nicknames', () => {
  it('links a typed payee name as written', () => {
    expect(findPerson({ paymentReceiver: 'RO  (Bhai)' }, [person({ aliases: ['Ro (bhai)'] })])?.id).toBe('p1')
  })
})

import { safeToSpend } from '../accounts/cash'
import { loanIsWith } from './loans'

describe('safe to spend', () => {
  it('spreads what is free over the days left, today included', () => {
    const r = safeToSpend(10000, 4000, new Date(2026, 9, 28)) // 28 Oct: 4 days left
    expect(r.daysLeft).toBe(4)
    expect(r.perDay).toBe(1500)
  })
  it('reports a shortfall instead of a negative amount', () => {
    const r = safeToSpend(1000, 3000, new Date(2026, 9, 28))
    expect(r.perDay).toBe(0)
    expect(r.over).toBe(2000)
  })
})

describe('loans with people', () => {
  const p = { id: 'p1', name: 'Rohan Mehta', aliases: ['Ro'] }
  it('matches by link, exact name or nickname only', () => {
    expect(loanIsWith({ person: 'x', personId: 'p1' }, p)).toBe(true)
    expect(loanIsWith({ person: 'rohan mehta' }, p)).toBe(true)
    expect(loanIsWith({ person: 'Ro' }, p)).toBe(true)
    expect(loanIsWith({ person: 'Rohan' }, p)).toBe(false)
    expect(loanIsWith({ person: 'Rohan Mehta', personId: 'other' }, p)).toBe(false)
  })
  it('a loan typed as "Mom" belongs to the contact filed as Mom', () => {
    const mom = { id: 'p2', name: 'Sunita Sharma', aliases: [], relation: 'Mom' }
    expect(loanIsWith({ person: 'Mom' }, mom)).toBe(true)
    expect(loanIsWith({ person: 'mummy' }, mom)).toBe(true)
    expect(loanIsWith({ person: 'Dad' }, mom)).toBe(false)
    expect(loanIsWith({ person: 'Mom' }, { ...mom, relation: null })).toBe(false)
  })
})

import { guessCategory } from '../capture/ai'
describe('everyday words', () => {
  it('files tea and auto rides', () => {
    expect(guessCategory('tea 20')).toBe('Snacks')
    expect(guessCategory('auto 100')).toBe('Travel')
    expect(guessCategory('auto debit mandate')).not.toBe('Travel')
  })
})
