import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from '../core/storage'
import { settleHoldsWith, frozenFor } from './holds'
import { addTransaction } from '../core/data'
import type { Hold, Investment, Transaction } from '../core/types'

const now = Date.now()
const hold = (): Hold => ({ id: 'h1', timestamp: now - 3600000, amount: 15000, kind: 'BLOCKED', name: 'HEXAWARE TECHNOLOGIES LTD', paymentMethodId: 'acc' })

describe('a block that the bank takes', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.investments, []); write(KEYS.holds, [hold()]) })
  it('becomes an IPO investment and ends the hold', () => {
    expect(frozenFor(new Set(['acc']))).toBe(15000)
    const r = addTransaction({ paymentAmount: 15000, paymentType: 'DEBIT', paymentReceiver: 'Hexaware Technologies allotment', paymentCategory: 'Others', paymentMethodId: 'acc', timestamp: now })
    expect(r.added).toBe(true)
    const inv = read<Investment[]>(KEYS.investments, [])
    expect(inv).toHaveLength(1)
    expect(inv[0]).toMatchObject({ type: 'IPO', name: 'HEXAWARE TECHNOLOGIES LTD', invested: 15000, ipoStatus: 'ALLOTTED' })
    expect(read<Transaction[]>(KEYS.transactions, [])[0].investmentId).toBe(inv[0].id)
    expect(frozenFor(new Set(['acc']))).toBe(0)
  })
  it('leaves an ordinary payment alone', () => {
    addTransaction({ paymentAmount: 15000, paymentType: 'DEBIT', paymentReceiver: 'Landlord', paymentCategory: 'Rent', paymentMethodId: 'acc', timestamp: now })
    expect(read<Investment[]>(KEYS.investments, [])).toHaveLength(0)
    expect(frozenFor(new Set(['acc']))).toBe(15000)
  })
  it('does nothing without a debit', () => {
    expect(settleHoldsWith({ id: 'x', timestamp: now, paymentAmount: 15000, paymentType: 'CREDIT', paymentReceiver: 'IPO', paymentCategory: 'Others' } as Transaction)).toBe(false)
  })
})

describe('two messages for one block', () => {
  const mandate = 'Your UCO UPI-Mandate is successfully created towards BLS POLYMERS LIMITED for Rs. 15000.00 Funds are blocked from A/C No. XXXXXXXX6469'
  const lien = 'Dear customer, Rs.15000 has been marked lien on your account XX6469. Kindly visit your nearest branch for more information.UCO Bank'
  beforeEach(() => { write(KEYS.holds, []) })
  it('keeps one hold whichever arrives first, with the IPO name', async () => {
    const { recordHold } = await import('./holds')
    expect(recordHold(mandate, now)).toBe(true)
    expect(recordHold(lien, now + 40000)).toBe(false)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(1)
    write(KEYS.holds, [])
    expect(recordHold(lien, now)).toBe(true)
    expect(recordHold(mandate, now + 40000)).toBe(false)
    const h = read<Hold[]>(KEYS.holds, [])
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ kind: 'BLOCKED', amount: 15000, name: 'BLS POLYMERS LIMITED' })
  })
})

describe('daily reminders and market hours', () => {
  const mandate = (name: string) => `Your UCO UPI-Mandate is successfully created towards ${name} for Rs. 15000.00 Funds are blocked from A/C No. XXXXXXXX6469`
  const lien = 'Dear customer, Rs.15000 has been marked lien on your account XX6469. Kindly visit your nearest branch for more information.UCO Bank'
  const mon11 = new Date(2026, 9, 26, 11, 0).getTime() // Monday 11:00
  beforeEach(() => { write(KEYS.holds, []) })
  it('knows when blocking is possible', async () => {
    const { inBlockWindow } = await import('./holds')
    expect(inBlockWindow(mon11)).toBe(true)
    expect(inBlockWindow(new Date(2026, 9, 26, 17, 20).getTime())).toBe(true)
    expect(inBlockWindow(new Date(2026, 9, 26, 17, 45).getTime())).toBe(false)
    expect(inBlockWindow(new Date(2026, 9, 27, 2, 30).getTime())).toBe(false)
    expect(inBlockWindow(new Date(2026, 9, 31, 12, 0).getTime())).toBe(false) // Saturday
  })
  it('ignores the nightly and next-day reminders for a block that is still held', async () => {
    const { recordHold } = await import('./holds')
    expect(recordHold(mandate('BLS POLYMERS LIMITED'), mon11, { fromNotification: true })).toBe(true)
    expect(recordHold(lien, new Date(2026, 9, 27, 2, 10).getTime(), { fromNotification: true })).toBe(false) // 2 AM
    expect(recordHold(lien, new Date(2026, 9, 27, 3, 40).getTime(), { fromNotification: true })).toBe(false)
    expect(recordHold(lien, new Date(2026, 9, 27, 11, 0).getTime(), { fromNotification: true })).toBe(false) // next day, in hours: still a reminder
    expect(recordHold(mandate('BLS POLYMERS LIMITED'), new Date(2026, 9, 28, 11, 0).getTime(), { fromNotification: true })).toBe(false)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(1)
  })
  it('a different IPO for the same amount is its own block', async () => {
    const { recordHold } = await import('./holds')
    recordHold(mandate('BLS POLYMERS LIMITED'), mon11, { fromNotification: true })
    expect(recordHold(mandate('OTHER LTD'), new Date(2026, 9, 27, 11, 0).getTime(), { fromNotification: true })).toBe(true)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(2)
  })
  it('a "blocked" message at night, with no block on record, is not a new block', async () => {
    const { recordHold } = await import('./holds')
    expect(recordHold(lien, new Date(2026, 9, 27, 3, 0).getTime(), { fromNotification: true })).toBe(false)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(0)
    // pasted by hand it is taken as given
    expect(recordHold(lien, new Date(2026, 9, 27, 3, 0).getTime())).toBe(true)
  })
  it('repeated unblock notices are one release', async () => {
    const { recordHold } = await import('./holds')
    const out = 'Your UCO UPI-Mandate is successfully Revoked towards BLS POLYMERS LIMITED for Rs. 15000.00 from A/C No. XXXXXXXX6469'
    recordHold(mandate('BLS POLYMERS LIMITED'), mon11)
    expect(recordHold(out, mon11 + 2 * 86400000)).toBe(true)
    expect(recordHold(out, mon11 + 2 * 86400000 + 3600000 * 15)).toBe(false)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(2)
  })
})
