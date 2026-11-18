import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from '../core/storage'
import { recordSmsHolds } from './sms'
import type { Hold } from '../core/types'

const a = 'Your UCO UPI-Mandate is successfully created towards BLS POLYMERS LIMITED for Rs. 15000.00 Funds are blocked from A/C No. XXXXXXXX6469UCO bank'
const b = 'Dear customer, Rs.15000 has been marked lien on your account XX6469. Kindly visit your nearest branch for more information.UCO Bank'
describe('two messages, one block', () => {
  beforeEach(() => { write(KEYS.holds, []); write(KEYS.paymentMethods, [{ id: 'uco', name: 'UCO Savings', type: 'BANK', last4: '6469', color: '#000', createdAt: 0, bank: 'UCO' }]) })
  it('pasted together', () => {
    recordSmsHolds(`${a}\n\n${b}`)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(1)
  })
  it('one after the other, either order', () => {
    recordSmsHolds(a); recordSmsHolds(b)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(1)
    expect(read<Hold[]>(KEYS.holds, [])[0].name).toBe('BLS POLYMERS LIMITED')
    write(KEYS.holds, [])
    recordSmsHolds(b); recordSmsHolds(a)
    const h = read<Hold[]>(KEYS.holds, [])
    expect(h).toHaveLength(1)
    expect(h[0].name).toBe('BLS POLYMERS LIMITED')
  })
})
