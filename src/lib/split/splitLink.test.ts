import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from '../core/storage'
import { addTransaction, getAll } from '../core/data'
import { newSplitGroup, splitPayment, splitPaymentWithoutGroup, unsplitPayment } from './splitLink'
import { calculateProjectBalances, friendBalances, splitWithoutGroup, type SplitPerson, type SplitProject, type SplitRow, type SplitTxn } from './split'
import { isPersonalSpend } from '../core/money'
import { requestQuickSplit, takeQuickSplit } from './splitHandoff'

const NONE = new Set<string>()
const add = (amount: number) => { const id = addTransaction({ paymentAmount: amount, paymentType: 'DEBIT', paymentReceiver: 'Toing', paymentCategory: 'Food', timestamp: Date.now() }, { allowDuplicate: true }).id; return getAll().find((x) => x.id === id)! }
const spent = () => getAll().filter((t) => isPersonalSpend(t, NONE)).reduce((a, t) => a + t.paymentAmount, 0)
const people = (projectId: string) => read<SplitPerson[]>(KEYS.splitPeople, []).filter((p) => p.projectId === projectId)

describe('splitting a payment from its edit sheet', () => {
  beforeEach(() => { for (const k of [KEYS.transactions, KEYS.splitProjects, KEYS.splitPeople, KEYS.splitTransactions, KEYS.splits]) write(k, []) })

  it('keeps only your share as spending, and the group says the friends owe you', () => {
    const g = newSplitGroup('Dinner', 'Arya', ['Rohan', 'Meera'])
    const t = add(900)
    expect(splitPayment(t, g, people(g).map((p) => p.id))).toBe(300)
    expect(spent()).toBe(300)
    expect(getAll().reduce((a, x) => a + x.paymentAmount, 0)).toBe(900) // the bank still moved 900
    const net = calculateProjectBalances(g, people(g), read<SplitTxn[]>(KEYS.splitTransactions, []), read<SplitRow[]>(KEYS.splits, []))
    expect(net.get(people(g).find((p) => p.isCurrentUser)!.id)).toBe(600)
  })

  it('paid all of it for the others: none of it is yours', () => {
    const g = newSplitGroup('Gift', 'Arya', ['Rohan'])
    const t = add(500)
    expect(splitPayment(t, g, people(g).filter((p) => !p.isCurrentUser).map((p) => p.id))).toBe(0)
    expect(spent()).toBe(0)
  })

  it('removing the split brings the full amount back and drops the group expense', () => {
    const g = newSplitGroup('Cab', 'Arya', ['Rohan'])
    const t = add(401)
    splitPayment(t, g, people(g).map((p) => p.id))
    unsplitPayment(getAll().find((x) => x.id === t.id)!)
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0]).toMatchObject({ paymentAmount: 401, paymentCategory: 'Food', splitTxnId: undefined })
    expect(read<SplitTxn[]>(KEYS.splitTransactions, [])).toHaveLength(0)
  })

  it('splits a payment without a group between you and friends', () => {
    const t = add(600)
    const mine = splitPaymentWithoutGroup(t, ['Rohan', 'Meera'], 'Arya')
    expect(mine).toBe(200)
    expect(spent()).toBe(200)
    expect(getAll().reduce((a, x) => a + x.paymentAmount, 0)).toBe(600)
    // undoing brings back the full 600 and cleans up split records
    unsplitPayment(getAll().find((x) => x.id === t.id)!)
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0].paymentAmount).toBe(600)
    expect(read<SplitTxn[]>(KEYS.splitTransactions, [])).toHaveLength(0)
  })

  it('uses the exact shares given, and undoing puts the category back', () => {
    const t = add(600)
    expect(splitPaymentWithoutGroup(t, ['Rohan', 'Meera'], 'Arya', { me: 100, Rohan: 300, Meera: 200 })).toBe(100)
    expect(spent()).toBe(100)
    unsplitPayment(getAll().find((x) => x.id === t.id)!)
    expect(getAll()[0]).toMatchObject({ paymentAmount: 600, paymentCategory: 'Food' })
  })

  it('a payment entirely for friends is not your spending, and undoing it restores its category', () => {
    const t = add(500)
    expect(splitPaymentWithoutGroup(t, ['Rohan'], 'Arya', { me: 0, Rohan: 500 })).toBe(0)
    expect(spent()).toBe(0)
    unsplitPayment(getAll().find((x) => x.id === t.id)!)
    expect(getAll()[0]).toMatchObject({ paymentAmount: 500, paymentCategory: 'Food', splitTxnId: undefined, splitCategory: undefined })
  })

  it('a payment that is already split is not split again', () => {
    const t = add(300)
    splitPaymentWithoutGroup(t, ['Rohan'], 'Arya')
    const ledgerRows = read<SplitTxn[]>(KEYS.splitTransactions, []).length
    expect(splitPaymentWithoutGroup(getAll().find((x) => x.id === t.id)!, ['Meera'], 'Arya')).toBeNull()
    expect(read<SplitTxn[]>(KEYS.splitTransactions, [])).toHaveLength(ledgerRows)
  })

  it('a friend who paid: you owe your half in a private ledger with them', () => {
    expect(splitWithoutGroup({ amount: 300, description: 'Cab', friends: ['Rohan'], paidBy: 'Rohan', selfName: 'Arya' })).toMatchObject({ myShare: 150 })
    const b = friendBalances(read<SplitProject[]>(KEYS.splitProjects, []), read<SplitPerson[]>(KEYS.splitPeople, []), read<SplitTxn[]>(KEYS.splitTransactions, []), read<SplitRow[]>(KEYS.splits, []))
    expect(b).toEqual([expect.objectContaining({ amount: 150, direction: 'you-owe', project: expect.objectContaining({ direct: true, name: 'Rohan' }) })])
  })
})

describe('the Split a bill shortcut from Home', () => {
  it('opens the split sheet once', () => {
    requestQuickSplit()
    expect(takeQuickSplit()).toBe(true)
    expect(takeQuickSplit()).toBe(false)
  })
})
