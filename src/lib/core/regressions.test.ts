import { describe, it, expect, beforeEach } from 'vitest'
import { read, write, KEYS } from './storage'
import { addTransaction, getAll } from './data'
import { processCaptured } from '../capture/autocapture'
import { parseBankSms } from '../capture/sms'
import { isPersonalSpend, matchFamily } from './money'
import { addRepayment, createLoan, getLoans, outstanding } from '../payees/loans'
import { removeTransaction } from './remove'
import { newSplitGroup, splitPayment } from '../split/splitLink'
import { calculateProjectBalances, createTransaction, friendBalances, type SplitPerson, type SplitProject, type SplitRow, type SplitTxn } from '../split/split'
import type { CapturedNotification, FamilyMember, Transaction } from './types'

const NONE = new Set<string>()
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const uco = (amt: string, ts: number, id: number, word = 'Debited'): CapturedNotification => ({ id, pkg: 'sms:JX-UCOBNK-T', title: 'JX-UCOBNK-T', text: `A/c XX6469 ${word} with Rs.${amt} on 0${new Date(ts).getDate()}-11-2026 by UCO-UPI.Avl Bal Rs.15030.66.`, ts })
const accounts = () => write(KEYS.paymentMethods, [
  { id: 'uco', name: 'UCO Bank', bank: 'UCO', last4: '6469', type: 'BANK', createdAt: 0 },
  { id: 'kotak', name: 'Kotak', bank: 'Kotak', last4: '1045', type: 'BANK', createdAt: 0 },
])
const reset = () => {
  for (const k of [KEYS.transactions, KEYS.captureLog, KEYS.loans, KEYS.splitProjects, KEYS.splitPeople, KEYS.splitTransactions, KEYS.splits, KEYS.familyMembers]) write(k, [])
  write(KEYS.payeeNames, {})
}

describe('captured payments are neither merged wrongly nor counted twice', () => {
  beforeEach(() => { reset(); accounts() })

  it('two UCO payments of the same amount minutes apart stay two', () => {
    processCaptured([uco('20.00', at(5, 10), 1), uco('20.00', at(5, 10, 5), 2)])
    expect(getAll()).toHaveLength(2)
  })

  it('₹40 from UCO and ₹40 from Kotak are different payments', () => {
    processCaptured([uco('40.00', at(5, 19, 21), 1)])
    processCaptured([{ id: 2, pkg: 'sms:AX-KOTAKB-S', title: 'x', text: 'Sent Rs.40.00 from Kotak Bank A/c X1045 to YASH MANGALANI on 05-11-26. UPI Ref 219808672082.', ts: at(5, 19, 24) }])
    expect(getAll()).toHaveLength(2)
  })

  it('two Paytm payments of the same amount to different people stay two', () => {
    processCaptured([
      { id: 1, pkg: 'net.one97.paytm', title: 'Paid ₹40 to Yash Mangalani', text: 'From UCO Bank - 6469', ts: at(5, 19, 0) },
      { id: 2, pkg: 'net.one97.paytm', title: 'Paid ₹40 to Rahul Verma', text: 'From UCO Bank - 6469', ts: at(5, 19, 2) },
    ])
    expect(getAll().map((t) => t.paymentReceiver).sort()).toEqual(['Rahul Verma', 'Yash Mangalani'])
  })

  it('a UCO message read the next morning matches the Paytm payment from the evening before', () => {
    processCaptured([{ id: 1, pkg: 'net.one97.paytm', title: 'Paid ₹1,308 to Zudio', text: 'From UCO Bank - 6469', ts: at(5, 18, 53) }])
    processCaptured([{ ...uco('1,308.00', at(5, 18), 2), ts: at(6, 9) }])
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0].paymentReceiver).toBe('Zudio')
  })

  it('the Paytm notification and the UCO SMS for one payment are still one', () => {
    processCaptured([{ id: 1, pkg: 'net.one97.paytm', title: 'Received ₹1510 from Anita Sharma', text: 'Deposited in your UCO Bank - 6469 on 05 November at 7:37 PM', ts: at(5, 19, 37) }])
    processCaptured([uco('1,510.00', at(5, 19, 38), 2, 'Credited')])
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0].paymentReceiver).toBe('Anita Sharma')
  })

  it('money given back for a failed payment is kept', () => {
    processCaptured([{ id: 1, pkg: 'sms:JK-UCOBNK-T', title: 'x', text: 'Your A/c XX6469 is credited with Rs.1308.00 on 05-11-2026 towards reversal of failed UPI transaction. Avl Bal Rs.16338.66', ts: at(5, 20) }])
    expect(getAll()).toHaveLength(1)
    expect(getAll()[0]).toMatchObject({ paymentType: 'CREDIT', paymentAmount: 1308 })
  })

  it('salary is not counted twice when the bank credit comes hours after payday', () => {
    addTransaction({ paymentAmount: 50000, paymentType: 'CREDIT', paymentReceiver: 'Salary', paymentCategory: 'Salary', timestamp: at(5, 10), recurringId: 'r1' })
    processCaptured([{ id: 1, pkg: 'sms:JK-UCOBNK-T', title: 'x', text: 'A/c XX6469 Credited with Rs.50,000.00 on 05-11-2026 by NEFT-ACME TECHNOLOGIES PVT LTD. Avl Bal Rs.66540.66', ts: at(5, 13) }])
    expect(getAll()).toHaveLength(1)
  })
})

describe('names and family', () => {
  beforeEach(reset)
  it('a payer name never starts with a dash or is the amount', () => {
    expect(parseBankSms('A/c XX6469 Credited with Rs.50,000.00 on 05-11-2026 by NEFT-ACME TECHNOLOGIES PVT LTD. Avl Bal Rs.66540.66')?.paymentReceiver).not.toMatch(/^-/)
    expect(parseBankSms('Dear UPI user A/C X6469 credited by Rs500 on date 05Nov26 trf from YASH MANGALANI Refno 530912345678')?.paymentReceiver).not.toMatch(/^rs\s?\d/i)
  })
  it('shops with relation words in their name are still spending', () => {
    for (const shop of ['BHAI BHAI KIRANA', 'MAMA EARTH', 'DADA TEA STALL', 'NANA BAKERY']) {
      addTransaction({ paymentAmount: 100, paymentType: 'DEBIT', paymentReceiver: shop, paymentCategory: 'Others', timestamp: at(5, 12) })
    }
    expect(getAll().every((t) => isPersonalSpend(t, NONE))).toBe(true)
  })
  it('a family member saved in Hindi does not swallow every payment', () => {
    const members: FamilyMember[] = [{ id: 'f', name: 'माँ', relation: 'Mom' } as FamilyMember]
    expect(matchFamily('Zudio', members)).toBeUndefined()
    expect(matchFamily('माँ', members)?.id).toBe('f')
  })
})

describe('loans, splits and deleting', () => {
  beforeEach(reset)

  it('deleting a repayment from anywhere puts the amount back on the loan, and undo restores it', () => {
    const loan = createLoan({ person: 'Ravi', direction: 'LENT', amount: 1000, date: at(1, 10), dueDate: null, note: null, accountId: 'uco' })
    addRepayment(loan.id, 400, 'uco', at(3, 10))
    const rep = getAll().find((t) => t.paymentType === 'CREDIT')!
    const r = removeTransaction(rep)
    expect(outstanding(getLoans()[0])).toBe(1000)
    r.undo()
    expect(outstanding(getLoans()[0])).toBe(600)
  })

  it('deleting the money lent takes its repayments with it', () => {
    const loan = createLoan({ person: 'Ravi', direction: 'LENT', amount: 1000, date: at(1, 10), dueDate: null, note: null, accountId: 'uco' })
    addRepayment(loan.id, 300, 'uco', at(3, 10))
    const lent = getAll().find((t) => t.paymentType === 'DEBIT')!
    const r = removeTransaction(lent)
    expect(getAll()).toHaveLength(0)
    expect(getLoans()).toHaveLength(0)
    r.undo()
    expect(getAll()).toHaveLength(2)
    expect(outstanding(getLoans()[0])).toBe(700)
  })

  it('a repayment above what is owed records all the money that came in', () => {
    const loan = createLoan({ person: 'Ravi', direction: 'LENT', amount: 1000, date: at(1, 10), dueDate: null, note: null, accountId: null })
    addRepayment(loan.id, 1500, 'uco', at(3, 10), true)
    expect(getAll()[0].paymentAmount).toBe(1500)
    expect(outstanding(getLoans()[0])).toBe(0)
  })

  it('deleting one half of a split takes the other half and the group expense too', () => {
    const g = newSplitGroup('Dinner', 'Me', ['Rohan'])
    const id = addTransaction({ paymentAmount: 1000, paymentType: 'DEBIT', paymentReceiver: 'Toing', paymentCategory: 'Food', timestamp: at(5, 20) }).id
    splitPayment(getAll().find((t) => t.id === id)!, g, read<SplitPerson[]>(KEYS.splitPeople, []).map((p) => p.id))
    const r = removeTransaction(getAll().find((t) => t.id === id)!)
    expect(getAll()).toHaveLength(0)
    expect(read<SplitTxn[]>(KEYS.splitTransactions, [])).toHaveLength(0)
    r.undo()
    expect(getAll()).toHaveLength(2)
    expect(read<SplitTxn[]>(KEYS.splitTransactions, [])).toHaveLength(1)
  })

  it('in a group of three, a friend who owes someone else does not owe you', () => {
    write(KEYS.splitProjects, [{ id: 'g', name: 'Trip', createdAt: 0 }])
    write(KEYS.splitPeople, [{ id: 'me', name: 'Me', projectId: 'g', isCurrentUser: true, createdAt: 0 }, { id: 'a', name: 'A', projectId: 'g', isCurrentUser: false, createdAt: 0 }, { id: 'b', name: 'B', projectId: 'g', isCurrentUser: false, createdAt: 0 }])
    createTransaction(300, 'Dinner', at(5, 20), 'g', 'b', [{ personId: 'me', amount: 100 }, { personId: 'a', amount: 100 }, { personId: 'b', amount: 100 }])
    const people = read<SplitPerson[]>(KEYS.splitPeople, [])
    const bal = friendBalances(read<SplitProject[]>(KEYS.splitProjects, []), people, read<SplitTxn[]>(KEYS.splitTransactions, []), read<SplitRow[]>(KEYS.splits, []))
    const a = bal.find((x) => x.person.id === 'a')!
    const b = bal.find((x) => x.person.id === 'b')!
    expect(a.direction).toBe('settled')
    expect(b).toMatchObject({ direction: 'you-owe', amount: 100 })
    expect(calculateProjectBalances('g', people, read<SplitTxn[]>(KEYS.splitTransactions, []), read<SplitRow[]>(KEYS.splits, [])).get('me')).toBe(-100)
    expect((getAll() as Transaction[]).length).toBe(0)
  })
})
