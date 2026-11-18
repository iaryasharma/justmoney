import { describe, expect, it } from 'vitest'
import { hashPin, lockoutFor, verifyPin } from '../../components/ui/AppLock'

describe('the passcode', () => {
  it('is stored salted: the same passcode never gives the same hash twice', async () => {
    const a = await hashPin('1234'), b = await hashPin('1234')
    expect(a).not.toBe(b)
    expect(a.startsWith('pbkdf2$')).toBe(true)
  })
  it('checks right and wrong tries', async () => {
    const h = await hashPin('4821')
    expect((await verifyPin('4821', h)).ok).toBe(true)
    expect((await verifyPin('4822', h)).ok).toBe(false)
  })
  it('still opens with an old unsalted hash, and upgrades it', async () => {
    const legacy = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('justmoney:1234')))].map((x) => x.toString(16).padStart(2, '0')).join('')
    const r = await verifyPin('1234', legacy)
    expect(r.ok).toBe(true)
    expect(r.upgrade?.startsWith('pbkdf2$')).toBe(true)
    expect((await verifyPin('0000', legacy)).ok).toBe(false)
  })
  it('makes wrong tries wait longer and longer', () => {
    expect(lockoutFor(4)).toBe(0)
    expect(lockoutFor(5)).toBe(30000)
    expect(lockoutFor(6)).toBe(60000)
    expect(lockoutFor(7)).toBe(300000)
    expect(lockoutFor(20)).toBe(3600000)
  })
})
