import { describe, it, expect } from 'vitest'
import { ipoApplications } from './ipo'
import { networthSeries } from '../../screens/NetWorth'
import type { Hold, Investment, Transaction } from '../core/types'

const h = (id: string, kind: Hold['kind'], t: number, extra: Partial<Hold> = {}): Hold => ({ id, kind, timestamp: t, amount: 15000, name: 'ABC LTD', paymentMethodId: 'a', ...extra })

describe('IPO applications', () => {
  it('tells held, allotted and refunded apart', () => {
    const inv = { id: 'i1', type: 'IPO', name: 'ABC', invested: 15000, currentValue: 15000, flows: [{ id: 'f', date: 50, amount: 15000, kind: 'IN', txId: 'tx1' }], createdAt: 0, updatedAt: 0 } as Investment
    const holds = [h('a', 'BLOCKED', 1, { amount: 10000 }), h('b', 'BLOCKED', 2, { settledBy: 'tx1', investmentId: 'i1' }), h('c', 'BLOCKED', 3, { amount: 20000 }), h('d', 'UNBLOCKED', 9, { amount: 20000 })]
    const apps = ipoApplications(holds, [inv])
    const by = Object.fromEntries(apps.map((a) => [a.id, a.status]))
    expect(by).toEqual({ a: 'BLOCKED', b: 'ALLOTTED', c: 'REFUNDED' })
    expect(apps.find((a) => a.id === 'c')?.endedAt).toBe(9)
  })
})

describe('net worth timeline', () => {
  it('takes back what moved since, and keeps recorded months', () => {
    const now = new Date(2026, 9, 15)
    const tx = (id: string, at: Date, type: 'DEBIT' | 'CREDIT', amt: number): Transaction => ({ id, timestamp: at.getTime(), paymentAmount: amt, paymentType: type, paymentReceiver: 'x', paymentCategory: 'Others' } as Transaction)
    const txns = [tx('1', new Date(2026, 7, 10), 'CREDIT', 50000), tx('2', new Date(2026, 8, 12), 'DEBIT', 10000), tx('3', new Date(2026, 9, 5), 'CREDIT', 20000)]
    const s = networthSeries(100000, txns, [{ month: '2026-09', value: 85000 }], now, 4)
    const by = Object.fromEntries(s.map((p) => [p.key, p]))
    expect(by['2026-10']).toMatchObject({ value: 100000, est: false })
    expect(by['2026-09']).toMatchObject({ value: 85000, est: false })
    expect(by['2026-08']).toMatchObject({ value: 100000 - (20000 - 10000), est: true })
  })
})
