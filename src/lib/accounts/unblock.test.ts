import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { frozenFor, parseHold } from './holds'
import { processCaptured } from '../capture/autocapture'
import { isBlockEvent } from '../core/data'
import type { Hold, PaymentMethod } from '../core/types'

const unblock = 'Informed your Bank to unblock Rs. 15000.00 for BLSPOLY IPO appl no. A12581921401252 due to non-allotment - KFintech'
const block = 'Rs. 15000.00 blocked in your account XX1045 for BLSPOLY IPO application. Applications close on 29-Oct. -Kotak Bank'
const acc: PaymentMethod = { id: 'k', name: 'Kotak 811', type: 'BANK', last4: '1045', color: '#000', createdAt: 0, bank: 'Kotak' }

describe('IPO unblock for non-allotment', () => {
  beforeEach(() => { write(KEYS.holds, []); write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })

  it('is read as a release of 15,000 for the IPO', () => {
    expect(isBlockEvent(unblock)).toBe(true)
    expect(parseHold(unblock)).toMatchObject({ kind: 'UNBLOCKED', amount: 15000, name: 'BLSPOLY IPO' })
  })

  it('frees the blocked money when the message arrives as an SMS capture', () => {
    const t = new Date('2026-10-29T10:00:00').getTime()
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: block, ts: t }])
    expect(frozenFor(new Set(['k']), read<Hold[]>(KEYS.holds, []))).toBe(15000)
    processCaptured([{ id: 2, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: unblock, ts: t + 3 * 86400000 }])
    expect(frozenFor(new Set(['k']), read<Hold[]>(KEYS.holds, []))).toBe(0)
    expect(read(KEYS.transactions, [])).toHaveLength(0)       // a release is not spending or income
  })
})

describe('no duplicates from block and unblock notices', () => {
  beforeEach(() => { write(KEYS.holds, []); write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })
  const t0 = new Date('2026-10-29T10:00:00').getTime()
  const frozen = () => frozenFor(new Set(['k']), read<Hold[]>(KEYS.holds, []))

  it('the same release seen as an SMS and as a notification is one release', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: block, ts: t0 }])
    processCaptured([{ id: 2, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: unblock, ts: t0 + 3 * 86400000 }])
    processCaptured([{ id: 3, pkg: 'com.google.android.apps.messaging', title: 'KFINTE', text: unblock, ts: t0 + 3 * 86400000 + 4000 }])
    const holds = read<Hold[]>(KEYS.holds, [])
    expect(holds.filter((h) => h.kind === 'UNBLOCKED')).toHaveLength(1)
    expect(holds.filter((h) => h.kind === 'BLOCKED')).toHaveLength(1)
    expect(frozen()).toBe(0)
  })

  it('reading the messages again later (a rescan) changes nothing', () => {
    const items = [{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: block, ts: t0 }, { id: 2, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: unblock, ts: t0 + 3 * 86400000 }]
    processCaptured(items)
    const once = read<Hold[]>(KEYS.holds, [])
    processCaptured(items.map((i) => ({ ...i, id: i.id + 10 })))
    expect(read<Hold[]>(KEYS.holds, [])).toHaveLength(once.length)
    expect(frozen()).toBe(0)
  })

  it('a later block of the same amount is held again, and one release frees only that one', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: block, ts: t0 }, { id: 2, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: unblock, ts: t0 + 3 * 86400000 }])
    processCaptured([{ id: 3, pkg: 'sms:VM-KOTAKB', title: 'x', text: block.replace('BLSPOLY', 'NEWCO'), ts: t0 + 7 * 86400000 }])
    expect(frozen()).toBe(15000)
    processCaptured([{ id: 4, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: unblock.replace('BLSPOLY', 'NEWCO'), ts: t0 + 10 * 86400000 }])
    expect(frozen()).toBe(0)
    expect(read<Hold[]>(KEYS.holds, []).filter((h) => h.kind === 'BLOCKED')).toHaveLength(2)
  })
})

describe('several messages for one IPO count once, two applications stay two', () => {
  beforeEach(() => { write(KEYS.holds, []); write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })
  const t0 = new Date('2026-10-26T10:00:00').getTime()
  const holds = () => read<Hold[]>(KEYS.holds, [])
  const frozen = () => frozenFor(new Set(['k']), holds())
  const blockOf = (ipo: string, appl: string) => `Rs. 15000.00 blocked in your account XX1045 for ${ipo} IPO application. Appl no. ${appl}. -Kotak Bank`
  const releaseByBank = (ipo: string, appl: string) => `Rs. 15000.00 unblocked in your account XX1045 for ${ipo} IPO. Appl no. ${appl}. -Kotak Bank`
  const releaseByRegistrar = (ipo: string, appl: string) => `Informed your Bank to unblock Rs. 15000.00 for ${ipo} IPO appl no. ${appl} due to non-allotment - KFintech`

  it('the mandate SMS and the lien notice, worded differently, hours apart: one block', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-NPCI', title: 'x', text: 'UPI Mandate created towards TATA CAPITAL LTD for Rs. 15,000.00. Approve it in your UPI app. -NPCI', ts: t0 }])
    processCaptured([{ id: 2, pkg: 'sms:VM-KOTAKB', title: 'x', text: 'Rs 15000.00 lien marked on A/c XX1045 for Tata Capital IPO application no. T77889900112. -Kotak', ts: t0 + 20 * 3600000 }])
    expect(holds().filter((h) => h.kind === 'BLOCKED')).toHaveLength(1)
    expect(frozen()).toBe(15000)
  })

  it('two applications for the same amount are two blocks', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: blockOf('ALPHA', 'A11111111111'), ts: t0 }, { id: 2, pkg: 'sms:VM-KOTAKB', title: 'x', text: blockOf('BETA', 'B22222222222'), ts: t0 + 300000 }])
    expect(holds().filter((h) => h.kind === 'BLOCKED')).toHaveLength(2)
    expect(frozen()).toBe(30000)
  })

  it('the bank and the registrar both announce the release of one application: only that one is released', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: blockOf('ALPHA', 'A11111111111'), ts: t0 }, { id: 2, pkg: 'sms:VM-KOTAKB', title: 'x', text: blockOf('BETA', 'B22222222222'), ts: t0 + 300000 }])
    processCaptured([{ id: 3, pkg: 'sms:VM-KOTAKB', title: 'x', text: releaseByBank('ALPHA', 'A11111111111'), ts: t0 + 4 * 86400000 }])
    processCaptured([{ id: 4, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: releaseByRegistrar('ALPHA', 'A11111111111'), ts: t0 + 4 * 86400000 + 3600000 }])
    expect(holds().filter((h) => h.kind === 'UNBLOCKED')).toHaveLength(1)
    expect(frozen()).toBe(15000)                                  // BETA is still held
    processCaptured([{ id: 5, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: releaseByRegistrar('BETA', 'B22222222222'), ts: t0 + 5 * 86400000 }])
    expect(frozen()).toBe(0)
  })

  it('a release that names the application frees that one even when the other was blocked first', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-KOTAKB', title: 'x', text: blockOf('ALPHA', 'A11111111111'), ts: t0 }, { id: 2, pkg: 'sms:VM-KOTAKB', title: 'x', text: blockOf('BETA', 'B22222222222'), ts: t0 + 300000 }])
    processCaptured([{ id: 3, pkg: 'sms:VM-KFINTE', title: 'KFINTE', text: releaseByRegistrar('BETA', 'B22222222222'), ts: t0 + 4 * 86400000 }])
    const open = holds().filter((h) => h.kind === 'BLOCKED')
    expect(frozen()).toBe(15000)
    expect(open.find((h) => h.name.includes('ALPHA'))).toBeTruthy()
  })
})

describe('a UPI AutoPay mandate is not blocked money', () => {
  beforeEach(() => { write(KEYS.holds, []); write(KEYS.transactions, []); write(KEYS.paymentMethods, [acc]) })
  const t0 = new Date('2026-10-26T11:00:00').getTime()
  const holds = () => read<Hold[]>(KEYS.holds, [])

  it('setting up a subscription mandate does not freeze its amount', () => {
    processCaptured([{ id: 1, pkg: 'sms:VM-HDFCBK', title: 'x', text: 'UPI Mandate created towards NETFLIX for Rs. 649.00 monthly (AutoPay). Next debit 05-Nov-26. -HDFC Bank', ts: t0 }])
    processCaptured([{ id: 2, pkg: 'sms:VM-HDFCBK', title: 'x', text: 'Recurring UPI mandate of Rs.199 to SPOTIFY created, frequency monthly. -HDFC Bank', ts: t0 + 60000 }])
    expect(holds()).toHaveLength(0)
    expect(read(KEYS.transactions, [])).toHaveLength(0)
  })

  it('an IPO mandate still is', () => {
    processCaptured([{ id: 3, pkg: 'sms:VM-NPCI', title: 'x', text: 'UPI Mandate created towards TATA CAPITAL LTD for Rs. 15,000.00 for IPO application. -NPCI', ts: t0 }])
    expect(holds().filter((h) => h.kind === 'BLOCKED')).toHaveLength(1)
  })
})
