import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from '../core/storage'
import { addTransaction, getAll, learnPayeeName } from '../core/data'
import { processCaptured } from '../capture/autocapture'
import type { Transaction } from '../core/types'

const at = (h: number, m: number) => new Date(2026, 10, 5, h, m).getTime()
const sms = (id: number, text: string, ts: number) => ({ id, pkg: 'sms:JX-UCOBNK-T', title: 'JX-UCOBNK-T', text, ts })

describe('a nameless bank payment never takes another payment’s name', () => {
  beforeEach(() => { write(KEYS.transactions, []); write(KEYS.payeeNames, {}); write(KEYS.captureLog, []) })

  it('renaming one "Bank debit" does not teach that name to every other nameless payment', () => {
    processCaptured([sms(1, 'A/c XX6469 Debited with Rs.265.00 on 05-11-2026 by UCO-UPI.Avl Bal Rs.16337.66.', at(14, 54))] as never)
    expect(learnPayeeName('Bank debit', 'Amazon')).toBe(0)
    processCaptured([sms(2, 'A/c XX6469 Debited with Rs.1,308.00 on 05-11-2026 by UCO-UPI.Avl Bal Rs.15030.66.', at(18, 53))] as never)
    expect(getAll().find((t) => t.paymentAmount === 1308)?.paymentReceiver).toBe('Bank debit')
  })

  it('a name learned for "Bank debit" before the fix is ignored, and Paytm’s real name replaces it', () => {
    write(KEYS.payeeNames, { bankdebit: 'Amazon' })
    processCaptured([sms(3, 'A/c XX6469 Debited with Rs.1,308.00 on 05-11-2026 by UCO-UPI.Avl Bal Rs.15030.66.', at(18, 53))] as never)
    expect(getAll()[0].paymentReceiver).toBe('Bank debit')
    // an entry that already got the wrong name the old way
    write(KEYS.transactions, getAll().map((t) => ({ ...t, paymentReceiver: 'Amazon', rawReceiver: 'Bank debit' })))
    processCaptured([{ id: 4, pkg: 'net.one97.paytm', title: 'Paid ₹1,308 to Zudio', text: 'From UCO Bank - 6469', ts: at(18, 54) }] as never)
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0].paymentReceiver).toBe('Zudio')
  })

  it('a name you typed for a real payee is still learned', () => {
    addTransaction({ paymentAmount: 30, paymentType: 'DEBIT', paymentReceiver: 'SRI SAI ENTP', paymentCategory: 'Food', timestamp: at(9, 0) })
    expect(learnPayeeName('SRI SAI ENTP', 'Chai stall')).toBe(1)
    expect(read<Record<string, string>>(KEYS.payeeNames, {}).srisaientp).toBe('Chai stall')
    expect((getAll() as Transaction[])[0].paymentReceiver).toBe('Chai stall')
  })
})
