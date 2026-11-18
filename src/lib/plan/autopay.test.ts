import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { isAutopaySetup, parseAutoPay, monthlyTotal, getAutoPays } from './autopay'
import { processCaptured } from '../capture/autocapture'
import type { AutoPay, Hold, PaymentMethod } from '../core/types'

const acc: PaymentMethod = { id: 'k', name: 'Kotak 811', type: 'BANK', last4: '1045', color: '#000', createdAt: 0, bank: 'Kotak' }
const t0 = new Date('2026-10-26T11:00:00').getTime()
const cap = (id: number, text: string, ts = t0) => processCaptured([{ id, pkg: 'sms:VM-HDFCBK', title: 'x', text, ts }])

describe('UPI AutoPay mandates', () => {
  beforeEach(() => { write(KEYS.autopays, []); write(KEYS.holds, []); write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })

  it('reads the merchant, amount, how often and when the next charge is due', () => {
    const p = parseAutoPay('UPI Mandate created towards NETFLIX for Rs. 649.00 monthly (AutoPay). Next debit 05-Nov-26. -HDFC Bank')
    expect(p).toMatchObject({ name: 'Netflix', amount: 649, frequency: 'monthly', status: 'active' })
    expect(new Date(p.nextAt!).getMonth()).toBe(10)
    expect(parseAutoPay('Recurring UPI mandate of Rs.199 to SPOTIFY created, frequency monthly.')).toMatchObject({ name: 'Spotify', amount: 199 })
  })

  it('tells a subscription mandate from an IPO one, and from a charge that already happened', () => {
    expect(isAutopaySetup('UPI Mandate created towards NETFLIX for Rs. 649.00 monthly')).toBe(true)
    expect(isAutopaySetup('UPI Mandate created towards TATA CAPITAL LTD for Rs. 15,000.00 for IPO application')).toBe(false)
    expect(isAutopaySetup('Rs 649 debited for Netflix AutoPay mandate monthly')).toBe(false)
  })

  it('lists it under AutoPay and counts nothing as spending or frozen money', () => {
    cap(1, 'UPI Mandate created towards NETFLIX for Rs. 649.00 monthly (AutoPay). Next debit 05-Nov-26. -HDFC Bank')
    const list = getAutoPays()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Netflix', amount: 649, status: 'active' })
    expect(read(KEYS.transactions, [])).toHaveLength(0)
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(0)
  })

  it('the same message twice, from the SMS and the notification, is one entry', () => {
    const m = 'UPI Mandate created towards NETFLIX for Rs. 649.00 monthly (AutoPay). -HDFC Bank'
    cap(1, m); cap(2, m, t0 + 4000)
    expect(getAutoPays()).toHaveLength(1)
  })

  it('a cancellation marks it cancelled, and one for something never seen adds nothing', () => {
    cap(1, 'UPI Mandate created towards NETFLIX for Rs. 649.00 monthly (AutoPay). -HDFC Bank')
    cap(2, 'Your UPI mandate towards NETFLIX for Rs. 649.00 has been revoked. -HDFC Bank', t0 + 86400000)
    expect(getAutoPays()[0].status).toBe('cancelled')
    cap(3, 'Your UPI mandate towards HOTSTAR for Rs. 299.00 has been cancelled. -HDFC Bank')
    expect(getAutoPays()).toHaveLength(1)
  })

  it('a changed amount updates the same mandate', () => {
    cap(1, 'UPI Mandate created towards NETFLIX for Rs. 649.00 monthly (AutoPay). -HDFC Bank')
    cap(2, 'UPI Mandate modified towards NETFLIX for Rs. 799.00 monthly (AutoPay). -HDFC Bank', t0 + 86400000)
    expect(getAutoPays()).toHaveLength(1)
    expect(getAutoPays()[0].amount).toBe(799)
  })

  it('an IPO mandate being revoked still releases the held money, and is not an AutoPay', () => {
    cap(1, 'UPI Mandate created towards TATA CAPITAL LTD for Rs. 15,000.00 for IPO application. -NPCI')
    expect(read<Hold[]>(KEYS.holds, []).filter((h) => h.kind === 'BLOCKED')).toHaveLength(1)
    cap(2, 'Your UPI mandate towards TATA CAPITAL LTD for Rs. 15,000.00 has been revoked. -NPCI', t0 + 3 * 86400000)
    expect(read<Hold[]>(KEYS.holds, []).filter((h) => h.kind === 'UNBLOCKED')).toHaveLength(1)
    expect(getAutoPays()).toHaveLength(0)
  })

  it('adds the active ones up to a month', () => {
    const base = { createdAt: 0, updatedAt: 0, status: 'active' } as const
    const list: AutoPay[] = [{ id: 'a', name: 'A', amount: 100, frequency: 'monthly', ...base }, { id: 'b', name: 'B', amount: 1200, frequency: 'yearly', ...base }, { id: 'c', name: 'C', amount: 500, status: 'cancelled', createdAt: 0, updatedAt: 0 }]
    expect(Math.round(monthlyTotal(list))).toBe(200)
  })
})
