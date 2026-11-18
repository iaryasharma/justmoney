import { describe, expect, it } from 'vitest'
import { BACKUP_GROUPS, excludedKeys, NEVER_BACKED_UP } from './backupScope'
import { KEYS } from '../core/storage'

describe('what goes into a backup', () => {
  it('never holds the passcode, the lock settings or an API key', () => {
    const out = excludedKeys({})
    for (const k of [KEYS.appLock, KEYS.appLockBiometric, KEYS.lockFails, KEYS.geminiKey, '@TwelveDataKey']) expect(out, k).toContain(k)
    expect(NEVER_BACKED_UP).toContain(KEYS.appLock)
  })
  it('holds everything else by default', () => {
    const out = new Set(excludedKeys({}))
    for (const k of [KEYS.transactions, KEYS.planSettings, KEYS.pots, KEYS.allocations, KEYS.savingsGoals, KEYS.creditSales, KEYS.merchantSettings, KEYS.people, KEYS.investments, KEYS.theme, KEYS.receipts]) expect(out.has(k), k).toBe(false)
  })
  it('leaves out a whole group when it is turned off', () => {
    const out = new Set(excludedKeys({ plan: false, receipts: false }))
    expect(out.has(KEYS.pots)).toBe(true)
    expect(out.has(KEYS.savingsGoals)).toBe(true)
    expect(out.has(KEYS.receipts)).toBe(true)
    expect(out.has(KEYS.people)).toBe(false)
  })
  it('always keeps the transactions', () => {
    expect(new Set(excludedKeys({ transactions: false })).has(KEYS.transactions)).toBe(false)
  })
  it('turning preferences off leaves out every other setting, but not the named groups', () => {
    const out = new Set(excludedKeys({ settings: false }))
    expect(out.has(KEYS.theme)).toBe(true)
    expect(out.has(KEYS.homeLayout)).toBe(true)
    expect(out.has(KEYS.pots)).toBe(false)
  })
  it('gives each key to one group only', () => {
    const seen = new Map<string, string>()
    for (const g of BACKUP_GROUPS) for (const k of g.keys ?? []) { expect(seen.has(k), `${k} in ${g.id} and ${seen.get(k)}`).toBe(false); seen.set(k, g.id) }
  })
})
