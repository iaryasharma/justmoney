import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from '../core/storage'
import { calculateProjectBalances, createTransaction, type SplitPerson, type SplitRow, type SplitTxn } from './split'
import { addRepeat, billItems, computeItemSplits, nudgeMessage, overdueFriends, PAY_PAGE, payLink, processSplitRepeats, realNameOf, roundedEven, settlePart, splitPaybackFrom, splitShareMessage } from './splitPlus'

const ppl = () => read<SplitPerson[]>(KEYS.splitPeople, [])
const net = (g = 'g') => calculateProjectBalances(g, ppl(), read<SplitTxn[]>(KEYS.splitTransactions, []), read<SplitRow[]>(KEYS.splits, []))
const group = () => {
  write(KEYS.splitProjects, [{ id: 'g', name: 'Goa', createdAt: 0 }])
  write(KEYS.splitPeople, [
    { id: 'me', name: 'Arya', projectId: 'g', isCurrentUser: true, createdAt: 0 },
    { id: 'r', name: 'Rohan Mehta', projectId: 'g', isCurrentUser: false, createdAt: 0 },
    { id: 'm', name: 'Meera', projectId: 'g', isCurrentUser: false, createdAt: 0 },
  ])
  write(KEYS.splitTransactions, []); write(KEYS.splits, []); write(KEYS.splitNudges, {}); write(KEYS.splitRepeats, [])
}

describe('item by item', () => {
  it('each item is shared by who had it, tax in proportion, and it adds up to the bill', () => {
    const s = computeItemSplits([
      { name: 'Paneer Tikka', price: 360, who: ['me', 'r'] },
      { name: 'Beer', price: 300, who: ['r'] },
      { name: 'Naan', price: 90, who: [] }, // nobody ticked: everyone
    ], 75, ['me', 'r', 'm'])
    const by = Object.fromEntries(s.map((x) => [x.personId, x.amount]))
    expect(by.me + by.r + by.m).toBeCloseTo(825, 2)
    // Arya had 180 + 30 = 210 of 750, so 21 of the 75 tax
    expect(by.me).toBeCloseTo(231, 2)
    expect(by.m).toBeCloseTo(33, 2)
  })

  it('a discount comes off in proportion too', () => {
    const s = computeItemSplits([{ name: 'A', price: 100, who: ['me'] }, { name: 'B', price: 300, who: ['r'] }], -40, ['me', 'r'])
    expect(s).toEqual([{ personId: 'me', amount: 90 }, { personId: 'r', amount: 270 }])
  })

  it('reads items, taxes and the total off a bill, in English or Hindi', () => {
    const b = billItems(['Hotel Sagar', 'Bill No: 1042  Table 4', 'Paneer Tikka 2 x 180   360.00', 'Butter Naan 3 x 30   90.00', 'Sub Total 450.00', 'CGST 2.5% 11.25', 'SGST 2.5% 11.25', 'Service Charge 22.50', 'Grand Total 495.00', 'Thank you! Visit again'])
    expect(b.items.map((i) => [i.name, i.price])).toEqual([['Paneer Tikka', 360], ['Butter Naan', 90]])
    expect(b.extras).toBeCloseTo(45, 2)
    expect(b.total).toBe(495)
    const h = billItems(['शर्मा किराना स्टोर', 'आटा 5 किलो ₹245', 'चावल 2 किलो ₹180', 'तेल 1 लीटर ₹165', 'कुल राशि ₹590'])
    expect(h.items.map((i) => i.price)).toEqual([245, 180, 165])
    expect(h.total).toBe(590)
  })

  it('a total higher than the items, with no tax lines, is the tax', () => {
    expect(billItems(['Pizza 400', 'Coke 100', 'Total 525']).extras).toBe(25)
  })
})

describe('messages friends act on without the app', () => {
  it('each person gets their own pay link with their amount', () => {
    const m = splitShareMessage({ title: 'Dinner', total: 900, payer: 'Arya', lines: [{ name: 'Rohan', amount: 300, upiUrl: 'upi://pay?pa=a@ybl&am=300.00' }, { name: 'Meera', amount: 300 }] })
    expect(m).toContain('Rohan: ₹300')
    expect(m).toContain('am=300.00')
  })

  it('a contact nickname is left out of the name a message uses', () => {
    expect(realNameOf('Samarth (Neo)')).toBe('Samarth')
    expect(realNameOf('Ravi [Office]')).toBe('Ravi')
    expect(realNameOf('(Neo)')).toBe('(Neo)')
    expect(realNameOf('Priya Sharma')).toBe('Priya Sharma')
  })

  it('with a pay page set, the link is a tappable https one carrying the payment in the # part', () => {
    expect(payLink('test.user@okaxis', 'Test User', 462, 'Dinner')).toBe(`${PAY_PAGE}#pa=test.user%40okaxis&pn=Test%20User&am=462.00&tn=Dinner`)
    expect(PAY_PAGE).toBe('https://justmoney.aryasharma.in/pay') // built in: never a setting
    expect(payLink(undefined, 'Test User', 462, 'Dinner')).toBeUndefined()
  })

  it('reminders get firmer, and stop at the joke', () => {
    const at = (nth: number, hinglish = false) => nudgeMessage({ name: 'Rohan Mehta', amount: 300, title: 'Dinner', nth, days: 12, hinglish })
    expect(at(1)).toMatch(/gentle/)
    expect(at(2)).toMatch(/still pending/)
    expect(at(3)).toMatch(/reminder number 3.*12 days/)
    expect(at(9)).toMatch(/rent/)
    expect(at(1, true)).toMatch(/chhota sa reminder/)
  })
})

describe('settling', () => {
  beforeEach(group)

  it('a part payment leaves the rest owed', () => {
    createTransaction(900, 'Dinner', Date.now(), 'g', 'me', [{ personId: 'me', amount: 300 }, { personId: 'r', amount: 300 }, { personId: 'm', amount: 300 }])
    expect(settlePart('g', 'r', 'me', 100, 300)).toBe(200)
    expect(net().get('r')).toBe(-200)
  })

  it('"call it even" closes the debt at a rounded amount, and the group still adds up', () => {
    createTransaction(1494, 'Hotel', Date.now(), 'g', 'me', [{ personId: 'me', amount: 498 }, { personId: 'r', amount: 498 }, { personId: 'm', amount: 498 }])
    expect(roundedEven(498)).toBe(500)
    settlePart('g', 'r', 'me', 500, 498, true)
    expect(net().get('r')).toBe(0)
    const total = [...net().values()].reduce((a, b) => a + b, 0)
    expect(Math.abs(total)).toBeLessThan(0.01)
  })

  it('a friend who owes for a month, or for three expenses, is nudged to settle', () => {
    const old = Date.now() - 40 * 86400000
    createTransaction(600, 'Cab', old, 'g', 'me', [{ personId: 'me', amount: 300 }, { personId: 'r', amount: 300 }])
    const due = overdueFriends(read(KEYS.splitProjects, []), ppl(), read(KEYS.splitTransactions, []), read(KEYS.splits, []))
    expect(due.map((d) => d.person.name)).toEqual(['Rohan Mehta'])
    expect(due[0].days).toBeGreaterThanOrEqual(40)
  })

  it('a friend’s UPI payment is matched to what they owe, by full or first name', () => {
    createTransaction(900, 'Dinner', Date.now(), 'g', 'me', [{ personId: 'me', amount: 300 }, { personId: 'r', amount: 300 }, { personId: 'm', amount: 300 }])
    const args = [read(KEYS.splitProjects, []), ppl(), read(KEYS.splitTransactions, []), read(KEYS.splits, [])] as const
    expect(splitPaybackFrom('ROHAN MEHTA', 300, ...args)?.person.id).toBe('r')
    expect(splitPaybackFrom('Rohan', 300, ...args)?.owed).toBe(300)
    expect(splitPaybackFrom('Zudio', 300, ...args)).toBeNull()
  })
})

describe('repeating group expenses', () => {
  beforeEach(group)

  it('rent on the 31st is added every month on the last day when shorter, and catches up missed months', () => {
    addRepeat({ projectId: 'g', description: 'Rent', amount: 30000, payerId: 'me', splits: [{ personId: 'me', amount: 10000 }, { personId: 'r', amount: 10000 }, { personId: 'm', amount: 10000 }], day: 31 }, new Date(2027, 0, 1).getTime())
    expect(processSplitRepeats(new Date(2027, 2, 31, 12).getTime())).toBe(3) // Jan 31, Feb 28, Mar 31
    const dates = read<SplitTxn[]>(KEYS.splitTransactions, []).map((t) => new Date(t.date).getDate())
    expect(dates).toEqual([31, 28, 31])
    expect(net().get('r')).toBe(-30000)
  })
})
