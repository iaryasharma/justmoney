// Bill & income calendar: what's expected on each day of a month (salary, EMIs,
// subscriptions, recurring entries, family commitments, loan dues, reminders) and
// a projected bank balance for the rest of the month.
import { read, KEYS } from '../core/storage'
import { advance } from '../core/data'
import { accountBalance, tracksBalance } from '../accounts/accounts'
import { commitmentPaid, getFamily, plannedIncome } from '../core/money'
import { detectRecurring, CADENCE_DAYS } from '../payees/recurring'
import { outstanding } from '../payees/loans'
import type { Commitment, EmiPlan, Loan, PaymentMethod, PaymentReminder, RecurringRule, SalarySettings, Transaction } from '../core/types'

export type CalKind = 'income' | 'emi' | 'subscription' | 'recurring' | 'commitment' | 'loan' | 'reminder'
export interface CalItem {
  key: string
  date: number
  kind: CalKind
  title: string
  amount: number
  /** in: money expected to arrive; out: expected to leave; none: just a reminder. */
  flow: 'in' | 'out' | 'none'
  /** Already happened / paid this month. */
  done: boolean
}

const DAY = 86400000
const dayAt = (y: number, m: number, d: number, h = 9) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate()), h).getTime()

export function expectedItems(year: number, month: number, now = Date.now()): CalItem[] {
  const start = new Date(year, month, 1).getTime()
  const end = new Date(year, month + 1, 1).getTime()
  const txns = read<Transaction[]>(KEYS.transactions, []).filter((t) => t.timestamp >= start && t.timestamp < end)
  const out: CalItem[] = []
  const push = (i: CalItem) => { if (i.date >= start && i.date < end) out.push(i) }

  const salary = read<SalarySettings | null>(KEYS.salary, null)
  const income = plannedIncome()
  if (salary?.accountId && income > 0) {
    const date = dayAt(year, month, salary.day, 10)
    const got = txns.some((t) => t.paymentType === 'CREDIT' && t.paymentCategory === 'Salary')
    push({ key: 'salary', date, kind: 'income', title: 'Salary', amount: income, flow: 'in', done: got })
  }

  // Family support & other commitments: on payday when known, else the 1st.
  const family = getFamily()
  for (const c of read<Commitment[]>(KEYS.commitments, [])) {
    const date = dayAt(year, month, salary?.day ?? 1, 12)
    const who = c.memberId ? family.find((m) => m.id === c.memberId)?.name : null
    push({ key: `commit-${c.id}`, date, kind: 'commitment', title: who ? `${c.name} → ${who}` : c.name, amount: c.amount, flow: 'out', done: commitmentPaid(c, txns, family) >= c.amount })
  }

  for (const e of read<EmiPlan[]>(KEYS.emiPlans, [])) {
    if (e.paidCount >= e.months) continue
    push({ key: `emi-${e.id}`, date: dayAt(year, month, e.dueDay), kind: 'emi', title: `${e.name} EMI`, amount: e.monthlyAmount, flow: 'out', done: false })
  }

  // Recurring entries the app adds automatically (salary is shown above).
  const rules = read<RecurringRule[]>(KEYS.recurringRules, []).filter((r) => r.enabled && r.id !== 'salary')
  for (const r of rules) {
    let at = r.nextAt
    for (let i = 0; at < end && i < 60; i++, at = advance(at, r.cadence, r.anchorDay)) {
      push({ key: `rule-${r.id}-${at}`, date: at, kind: 'recurring', title: r.template.paymentReceiver, amount: r.template.paymentAmount, flow: r.template.paymentType === 'CREDIT' ? 'in' : 'out', done: at <= now })
    }
  }

  // Detected subscriptions / auto-debits not already covered by a recurring entry.
  const ruled = new Set(rules.map((r) => r.template.paymentReceiver.toLowerCase()))
  for (const d of detectRecurring(read<Transaction[]>(KEYS.transactions, []))) {
    if (d.ended || ruled.has(d.receiver.toLowerCase())) continue
    for (let at = d.nextDueAt, i = 0; at < end && i < 12; i++, at += CADENCE_DAYS[d.cadence] * DAY) {
      push({ key: `sub-${d.key}-${at}`, date: at, kind: 'subscription', title: d.receiver, amount: d.amount, flow: 'out', done: false })
    }
  }

  for (const l of read<Loan[]>(KEYS.loans, [])) {
    if (!l.dueDate || outstanding(l) <= 0) continue
    push({ key: `loan-${l.id}`, date: l.dueDate, kind: 'loan', title: l.direction === 'LENT' ? `${l.person} to repay you` : `Repay ${l.person}`, amount: outstanding(l), flow: l.direction === 'LENT' ? 'in' : 'out', done: false })
  }

  for (const r of read<PaymentReminder[]>(KEYS.reminders, [])) {
    if (!r.enabled || r.type === 'DAILY') continue
    const [h, mi] = r.time.split(':').map(Number)
    if (r.type === 'MONTHLY') push({ key: `rem-${r.id}`, date: new Date(year, month, Math.min(r.dayOfMonth ?? 1, new Date(year, month + 1, 0).getDate()), h, mi).getTime(), kind: 'reminder', title: r.title, amount: 0, flow: 'none', done: false })
    else {
      for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) {
        const dt = new Date(year, month, d, h, mi)
        if (dt.getDay() === (r.dayOfWeek ?? 0)) push({ key: `rem-${r.id}-${d}`, date: dt.getTime(), kind: 'reminder', title: r.title, amount: 0, flow: 'none', done: false })
      }
    }
  }
  return out.sort((a, b) => a.date - b.date)
}

/** Today's bank balance moved forward by everything still expected this month. */
export function projectBalance(items: CalItem[], now = Date.now()) {
  const methods = read<PaymentMethod[]>(KEYS.paymentMethods, [])
  const txns = read<Transaction[]>(KEYS.transactions, [])
  const today = methods.filter(tracksBalance).reduce((a, m) => a + accountBalance(m, txns), 0)
  const upcoming = items.filter((i) => !i.done && i.date >= now && i.flow !== 'none')
  const expectedIn = upcoming.filter((i) => i.flow === 'in').reduce((a, i) => a + i.amount, 0)
  const expectedOut = upcoming.filter((i) => i.flow === 'out').reduce((a, i) => a + i.amount, 0)
  // running balance by day, for the lowest point of the month
  let bal = today
  let lowest = { value: today, date: now }
  for (const i of upcoming) {
    bal += i.flow === 'in' ? i.amount : -i.amount
    if (bal < lowest.value) lowest = { value: bal, date: i.date }
  }
  return { today, expectedIn, expectedOut, end: today + expectedIn - expectedOut, lowest, tracked: methods.some(tracksBalance) }
}
