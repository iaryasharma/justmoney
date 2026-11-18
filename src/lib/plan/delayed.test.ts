import { describe, it, expect, beforeEach } from 'vitest'
import { write, KEYS } from '../core/storage'
import { allocateIncome, getAllocations } from './pots'
import { addPay, getPayLog } from './planning'

describe('delayed salary', () => {
  beforeEach(() => { write(KEYS.allocations, []); write(KEYS.salaryLog, []); write(KEYS.pots, []) })
  it('keeps what the money covers with the allocation', () => {
    const paidOn = Date.now()
    allocateIncome({ amount: 90000, source: 'Delayed salary (3 months)', family: 20000, bills: 30000, saving: 0, emergency: 0, delayed: { months: 3, from: '2026-07', paidOn, stillUnpaid: 1 } })
    expect(getAllocations()[0].delayed).toEqual({ months: 3, from: '2026-07', paidOn, stillUnpaid: 1 })
  })
  it('an ordinary income has no delayed note', () => {
    allocateIncome({ amount: 30000, source: 'Salary', family: 0, bills: 0, saving: 0, emergency: 0 })
    expect(getAllocations()[0].delayed).toBeUndefined()
  })
  it('pay history can take one entry per covered month', () => {
    for (let i = 0; i < 3; i++) addPay(new Date(2026, 6 + i, 1, 12).getTime(), 30000)
    expect(getPayLog()).toHaveLength(3)
  })
})
