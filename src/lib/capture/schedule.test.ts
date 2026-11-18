import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from '../core/storage'
import { buildSchedule } from '../notify/nativeNotify'
import type { Transaction } from '../core/types'

const DAY = 86400000
// a Wednesday, 3 pm
const now = new Date('2026-10-28T15:00:00').getTime()
const tx = (o: Partial<Transaction>): Transaction => ({ id: Math.random().toString(36).slice(2), timestamp: now - 3600000, paymentAmount: 100, paymentType: 'DEBIT', paymentReceiver: 'Bank debit', paymentCategory: 'Others', paymentSource: 'BANK', ...o } as Transaction)
const titles = () => buildSchedule(now).map((n) => `${n.title}`)

describe('the notification schedule', () => {
  beforeEach(() => {
    write(KEYS.transactions, []); write(KEYS.alertPrefs, undefined as unknown as object); write(KEYS.autoBackup, undefined as unknown as object)
    write(KEYS.notificationPrefs, { daily: false, weekly: false, bimonthly: false, monthly: false })
  })

  it('reminds once a week, on a Sunday, only while three or more payments have no name', () => {
    write(KEYS.transactions, [tx({}), tx({})])
    expect(titles().some((t) => /need a name/.test(t))).toBe(false)
    write(KEYS.transactions, [tx({}), tx({}), tx({})])
    const n = buildSchedule(now).find((x) => /need a name/.test(String(x.title)))
    expect(n).toBeTruthy()
    expect(String(n!.title)).toContain('3 payments')
    expect((n!.extra as { route: string }).route).toBe('review')
    expect(new Date((n!.schedule as { at: Date }).at).getDay()).toBe(0)
  })

  it('named payments, reviewed ones and credits do not count', () => {
    write(KEYS.transactions, [tx({ paymentReceiver: 'Zepto' }), tx({ reviewed: true }), tx({ paymentType: 'CREDIT' }), tx({})])
    expect(titles().some((t) => /need a name/.test(t))).toBe(false)
  })

  it('the digest can be switched off', () => {
    write(KEYS.transactions, [tx({}), tx({}), tx({})]); write(KEYS.alertPrefs, { digest: false })
    expect(titles().some((t) => /need a name/.test(t))).toBe(false)
  })

  it('reminds to back up when none has run for a week, and not before', () => {
    write(KEYS.autoBackup, { lastAt: now - 2 * DAY })
    const soon = buildSchedule(now).find((x) => x.title === 'Time to back up')
    expect(soon).toBeTruthy()
    expect((soon!.schedule as { at: Date }).at.getTime()).toBeGreaterThan(now + 4 * DAY)
    write(KEYS.autoBackup, { lastAt: now - 10 * DAY })
    const overdue = buildSchedule(now).find((x) => x.title === 'Time to back up')
    const at = (overdue!.schedule as { at: Date }).at
    expect(at.getTime()).toBeGreaterThan(now)
    expect(at.getTime()).toBeLessThanOrEqual(now + DAY)
    expect(at.getHours()).toBe(10)
  })

  it('no backup reminder when it is switched off', () => {
    write(KEYS.autoBackup, { lastAt: now - 10 * DAY }); write(KEYS.alertPrefs, { backupDue: false })
    expect(titles()).not.toContain('Time to back up')
  })
})
