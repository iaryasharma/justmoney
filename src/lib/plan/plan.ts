// The spending plan: what you can really spend this month once saving comes first.
//
// Income minus family and bills is not "free money". A share of it is saved before anything else, and what is
// left is the limit for the month. For a salary the numbers are known. For a shop, whose sales change every
// month, the plan is built from what actually came in over recent months (a little under the average, to be
// safe), so nothing has to be typed in.
import { read, write, KEYS } from '../core/storage'
import { FAMILY, isIncome, isPersonalSpend, isCommittedOutflow, isBusinessExpense, committedCategories, plannedIncome } from '../core/money'
import { accountBalance, tracksBalance } from '../accounts/accounts'
import { isMerchantApp } from '../payees/merchant'
import type { Commitment, PaymentMethod, SavingsGoal, SinkingFund, Transaction } from '../core/types'

/** FIXED: a salary every month. VARIABLE: a shop. INCOME: money is planned whenever it comes in, however late. */
export type IncomeMode = 'FIXED' | 'VARIABLE' | 'INCOME'

export interface PlanSettings {
  /** Set by the user; otherwise worked out from the money coming in. */
  mode?: IncomeMode
  /** Percent of what is left after family and bills that is saved first. */
  saveRate: number
  /** Business: percent of each sale kept aside for tax, GST and restocking. */
  setAside: number
  /** Percent of every month's saving that goes to the emergency fund, until it is full. */
  emergencyShare: number
  /** How many months of essentials the emergency fund should cover. */
  emergencyMonths: number
  /** When the next income is expected, if the user knows: pots are spread over the days until then. */
  nextIncomeAt?: number | null
  /** A student: no pay to plan around. The allowance is spent as it comes; the budget and saving goal are optional. */
  student?: StudentPlan
}

/** NONE: no spending limit, nothing is marked as over. CAP: a total for the month, in rupees. saveGoal: saved each month, in rupees (0 = none). */
export interface StudentPlan { budget: 'NONE' | 'CAP'; cap: number; saveGoal: number }
export const DEFAULT_STUDENT: StudentPlan = { budget: 'NONE', cap: 0, saveGoal: 0 }

export const DEFAULT_PLAN: PlanSettings = { saveRate: 20, setAside: 10, emergencyShare: 40, emergencyMonths: 3 }
export const EMERGENCY_SHARES = [0, 25, 40, 50, 60]
export const EMERGENCY_MONTHS = [3, 6]
export const SAVE_RATES = [10, 15, 20, 30, 40]
export const SET_ASIDE = [0, 5, 10, 15, 20]

export const getPlanSettings = (): PlanSettings => ({ ...DEFAULT_PLAN, ...read<Partial<PlanSettings>>(KEYS.planSettings, {}) })
export const savePlanSettings = (patch: Partial<PlanSettings>) => write(KEYS.planSettings, { ...getPlanSettings(), ...patch })

const DAY = 86400000
const inMonth = (t: Transaction, y: number, m: number) => { const d = new Date(t.timestamp); return d.getFullYear() === y && d.getMonth() === m }
const sum = (xs: Transaction[]) => xs.reduce((a, t) => a + t.paymentAmount, 0)
const round = (n: number) => Math.round(n)
const fmtRs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** A shop if it has been taking sales through a business app lately, unless the user said otherwise. */
export function incomeMode(settings: PlanSettings, txns: Transaction[], now = Date.now()): IncomeMode {
  if (settings.mode) return settings.mode
  return txns.some((t) => t.paymentType === 'CREDIT' && isMerchantApp(t.paymentApp) && t.timestamp >= now - 90 * DAY) ? 'VARIABLE' : 'FIXED'
}

export interface PlanInput {
  settings: PlanSettings
  txns: Transaction[]
  /** Income typed in (profile and sources). Zero means unknown, and it is learned instead. */
  plannedIncome: number
  /** Monthly family support and bills typed in. Zero means unknown, and it is learned instead. */
  commitmentsTotal: number
  committed: Set<string>
  year: number
  month: number
  now?: Date
  /** Last month's overspend taken out of this month (a negative number), when the user chose to. */
  carry?: number
  /** Yearly costs set aside this month. */
  sinking?: number
  /** Spending this month that a yearly-cost fund already covered (so it is not counted twice). */
  sinkingPaid?: number
}

export interface MonthPlan {
  mode: IncomeMode
  /** Where the income figure came from. */
  basis: 'set' | 'learned' | 'early' | 'none'
  income: number
  setAside: number
  committed: number
  free: number
  saveTarget: number
  /** What can be spent freely this month. For a student with no budget, what is left of the allowance after saving. */
  limit: number
  spent: number
  left: number
  perDay: number
  daysLeft: number
  /** Income actually received so far this month. */
  earned: number
  isCurrent: boolean
  /** Overspend carried in from last month (negative), already taken off the limit. */
  carry: number
  /** Yearly costs (insurance, fees) set aside this month. */
  sinking: number
  status: 'none' | 'on' | 'ahead' | 'over'
  notes: string[]
  /** A student's plan. */
  student: boolean
  /** False when there is no spending limit to go over (a student with no budget). */
  capped: boolean
}

export function monthPlan(i: PlanInput): MonthPlan {
  const now = i.now ?? new Date()
  const mode = incomeMode(i.settings, i.txns, now.getTime())
  const isCurrent = i.year === now.getFullYear() && i.month === now.getMonth()
  const monthEnd = new Date(i.year, i.month + 1, 0).getDate()
  const dayOfMonth = isCurrent ? now.getDate() : monthEnd
  const daysLeft = isCurrent ? monthEnd - now.getDate() + 1 : 0
  const notes: string[] = []

  const cur = i.txns.filter((t) => inMonth(t, i.year, i.month))
  const earned = sum(cur.filter(isIncome))
  const earnedNet = earned - sum(cur.filter(isBusinessExpense)) // what the shop kept, after its own costs
  const spent = Math.max(0, sum(cur.filter((t) => isPersonalSpend(t, i.committed))) - (i.sinkingPaid ?? 0))

  // the months before this one, since the app has had data
  const first = i.txns.reduce((a, t) => Math.min(a, t.timestamp), Infinity)
  const history = [1, 2, 3].map((k) => new Date(i.year, i.month - k, 1))
    .filter((d) => d.getTime() + 31 * DAY > first && d.getTime() < new Date(i.year, i.month, 1).getTime())
  const monthsOf = (d: Date) => i.txns.filter((t) => inMonth(t, d.getFullYear(), d.getMonth()))
  const avg = (f: (xs: Transaction[]) => number) => (history.length ? history.reduce((a, d) => a + f(monthsOf(d)), 0) / history.length : 0)
  const learnedIncome = avg((xs) => sum(xs.filter(isIncome)) - sum(xs.filter(isBusinessExpense)))
  const learnedCommit = avg((xs) => sum(xs.filter((t) => isCommittedOutflow(t, i.committed))))

  let income = 0
  let basis: MonthPlan['basis'] = 'none'
  if (mode === 'VARIABLE') {
    // sales change, so plan on a little less than the usual month
    if (history.length && learnedIncome > 0) { income = learnedIncome * 0.8; basis = 'learned' }
    else if (earnedNet > 0) { income = earnedNet; basis = 'early'; notes.push('Early days: this plan follows the sales so far and will steady out after a month or two of history.') }
  } else if (i.plannedIncome > 0) { income = i.plannedIncome; basis = 'set' }
  else if (learnedIncome > 0) { income = learnedIncome; basis = 'learned' }
  else if (earned > 0) { income = earned; basis = 'early' }

  const st = i.settings.student
  const setAside = mode === 'VARIABLE' ? round(income * i.settings.setAside / 100) : 0
  const committed = round(i.commitmentsTotal > 0 ? i.commitmentsTotal : learnedCommit)
  const sinking = round(i.sinking ?? 0)
  const free = Math.max(0, income - setAside - committed - sinking)
  // a student saves a fixed amount rather than a share, and nothing carries over: there is no overspend to take back
  const saveTarget = st ? round(Math.min(free, st.saveGoal)) : round(free * i.settings.saveRate / 100)
  const carry = st ? 0 : i.carry ?? 0
  const cap = st && st.budget === 'CAP' && st.cap > 0 ? round(st.cap) : 0
  const capped = cap > 0
  // a student with no budget: the limit is what is left of the allowance after saving, and nothing is marked as over
  const limit = capped ? cap : st ? Math.max(0, free - saveTarget) : Math.max(0, free - saveTarget + carry)
  const left = limit - spent
  const perDay = isCurrent && daysLeft > 0 ? Math.max(0, left) / daysLeft : 0

  let status: MonthPlan['status'] = 'none'
  if (st ? capped : limit > 0 || basis !== 'none') {
    status = spent > limit ? 'over' : spent > limit * (dayOfMonth / monthEnd) + limit * 0.1 && isCurrent ? 'ahead' : 'on'
  }
  if (st && capped && cap > free - saveTarget && income > 0) notes.push(`Your limit of ${fmtRs(cap)} is more than what is left after saving, so this month may run short.`)
  if (carry < 0) notes.push(`${fmtRs(-carry)} of last month’s overspend is taken out of this month, so your saving stays balanced.`)
  if (income > 0 && income - setAside - committed - sinking <= 0) notes.push('Family and bills take all of your income, so there is nothing to save or spend freely. Look at what can come down.')
  if (mode === 'VARIABLE' && isCurrent && history.length && dayOfMonth >= 10 && earned < learnedIncome * 0.8 * (dayOfMonth / monthEnd) * 0.6) notes.push('Sales are slower than usual this month. Spend less than the plan allows until they pick up.')
  if (mode === 'VARIABLE' && isCurrent && history.length && earned > learnedIncome * 1.1 && earned > income) notes.push(`Sales are above your usual: keep ₹${round((earned - income) * 0.5).toLocaleString('en-IN')} of the extra for a slow month.`)

  return { mode, basis, income: round(income), setAside, committed, free: round(free), saveTarget, limit: round(limit), spent: round(spent), left: round(left), perDay: round(perDay), daysLeft, earned: round(earned), isCurrent, carry, sinking, status, notes, student: !!st, capped }
}

/** The plan for a month, from what is stored. */
export function currentPlan(txns: Transaction[], year: number, month: number, commitments: Commitment[]): MonthPlan {
  const before = new Date(year, month - 1, 1)
  const last = getRecords()[mk(before.getFullYear(), before.getMonth())]
  return monthPlan({
    settings: getPlanSettings(), txns, plannedIncome: plannedIncome(), commitmentsTotal: commitments.reduce((a, c) => a + c.amount, 0),
    committed: committedCategories(commitments), year, month, carry: last?.carry === 'deduct' ? -last.over : 0,
    sinking: sinkingMonthly(getSinking(), new Date(year, month, 1)), sinkingPaid: sinkingPaidIn(getSinking(), year, month),
  })
}

/** What a business keeps from each ₹1,000 of sales: tax and stock, savings, and its own pay. */
export function saleSplit(settings: PlanSettings, per = 1000) {
  const aside = per * settings.setAside / 100
  const rest = per - aside
  const save = rest * settings.saveRate / 100
  return { aside: round(aside), save: round(save), yours: round(rest - save) }
}

/* ---------- saving first ---------- */

const monthsUntil = (at: number, now = Date.now()) => Math.max(1, Math.ceil((at - now) / (30.4 * DAY)))
const mk = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`
export const savedThisMonth = (y: number, m: number) => read<Record<string, number>>(KEYS.planSaved, {})[mk(y, m)] ?? 0
/** Everything put aside through the plan, in every month. */
export const totalSaved = () => Object.values(read<Record<string, number>>(KEYS.planSaved, {})).reduce((a, v) => a + v, 0)

/** How an amount is shared between goals: by how much each still needs, never past its target. What cannot fit goes to the first. */
export function splitSavings(amount: number, goals: { id: string; target: number; saved: number; deadline?: number | null }[], now = Date.now()): { id: string; amount: number }[] {
  if (!goals.length || !(amount > 0)) return []
  const need = goals.map((g) => Math.max(0, g.target - g.saved))
  // a goal with a date needs what is left spread over the months until then; one without is spread over two years
  const weight = goals.map((g, i) => need[i] / (g.deadline ? monthsUntil(g.deadline, now) : 24))
  const total = weight.reduce((a, n) => a + n, 0)
  const out = goals.map((g, i) => ({ id: g.id, amount: total > 0 ? Math.min(need[i], Math.round(amount * weight[i] / total * 100) / 100) : 0 }))
  const given = out.reduce((a, o) => a + o.amount, 0)
  out[0].amount = Math.round((out[0].amount + (amount - given)) * 100) / 100
  return out.filter((o) => o.amount > 0)
}

/** The emergency fund covers some months of essentials: what family, bills and everyday spending come to. */
export const emergencyTarget = (essentialsPerMonth: number, months: number) => Math.max(10000, Math.round(essentialsPerMonth * months / 1000) * 1000)

/** Goals other than the emergency fund that savings go to: the ones the user picked, otherwise every goal not yet reached. */
export function savingsGoals(): SavingsGoal[] {
  const goals = read<SavingsGoal[]>(KEYS.savingsGoals, []).filter((g) => !g.emergency)
  const chosen = read<string[] | null>(KEYS.planGoals, null)
  const open = goals.filter((g) => g.saved < g.target)
  const picked = chosen ? open.filter((g) => chosen.includes(g.id)) : open
  return picked.length ? picked : open
}

/**
 * Puts an amount into the user's goals. Every month a share goes to the emergency fund first, until it covers the months of
 * essentials chosen; the rest is shared between the goals the user picked (a goal called "Savings" is made if there are none).
 * Paper only: no bank money moves.
 */
export function allocateSavings(amount: number, essentials = 0, opts: { emergencyShare?: number } = {}): { name: string; amount: number; emergency?: boolean }[] {
  if (!(amount > 0)) return []
  const cfg = { ...getPlanSettings(), ...(opts.emergencyShare !== undefined ? { emergencyShare: opts.emergencyShare } : {}) }
  let goals = read<SavingsGoal[]>(KEYS.savingsGoals, [])
  const out: { name: string; amount: number; emergency?: boolean }[] = []
  const add = (id: string, v: number) => { goals = goals.map((g) => (g.id === id ? { ...g, saved: Math.round((g.saved + v) * 100) / 100 } : g)) }

  // the emergency fund is a goal like any other, kept up to date with what a few months of essentials come to
  const target = emergencyTarget(essentials, cfg.emergencyMonths)
  let fund = goals.find((g) => g.emergency)
  if (cfg.emergencyShare > 0 && !fund) {
    fund = { id: `emergency_${Date.now()}`, name: 'Emergency fund', target, saved: 0, deadline: null, color: '#FF9F0A', createdAt: Date.now(), emergency: true }
    goals = [fund, ...goals]
  } else if (fund && essentials > 0 && fund.target !== target) {
    goals = goals.map((g) => (g.emergency ? { ...g, target } : g))
    fund = { ...fund, target }
  }
  let rest = amount
  if (fund && cfg.emergencyShare > 0) {
    const room = Math.max(0, fund.target - fund.saved)
    const part = Math.min(room, Math.round(amount * Math.min(100, cfg.emergencyShare)) / 100)
    if (part > 0) { add(fund.id, part); out.push({ name: fund.name, amount: part, emergency: true }); rest = Math.round((amount - part) * 100) / 100 }
  }
  if (rest > 0) {
    let into = savingsGoals().filter((g) => goals.some((x) => x.id === g.id))
    if (!into.length) {
      const made: SavingsGoal = { id: `plan_${Date.now()}`, name: 'Savings', target: Math.max(10000, rest), saved: 0, deadline: null, color: '#30D158', createdAt: Date.now() }
      goals = [made, ...goals]
      into = [made]
    }
    const live = goals.filter((g) => into.some((x) => x.id === g.id))
    for (const p of splitSavings(rest, live)) { add(p.id, p.amount); out.push({ name: goals.find((g) => g.id === p.id)!.name, amount: p.amount }) }
  }
  write(KEYS.savingsGoals, goals)
  if (out.length) write(KEYS.savingsLog, [...read<{ at: number }[]>(KEYS.savingsLog, []), ...out.map((o) => ({ at: Date.now(), name: o.name, amount: o.amount, emergency: !!o.emergency }))].slice(-600))
  return out
}

/** Sets this month's saving aside, in the emergency fund and the goals. */
export function putAside(amount: number, y: number, m: number, essentials = 0) {
  const into = allocateSavings(amount, essentials)
  if (!into.length) return null
  const saved = read<Record<string, number>>(KEYS.planSaved, {})
  write(KEYS.planSaved, { ...saved, [mk(y, m)]: (saved[mk(y, m)] ?? 0) + amount })
  return { into, total: savedThisMonth(y, m) }
}

/* ---------- closing a month ---------- */

/** What a finished month came to. Underspending is saved; overspending is offered back to next month. */
export interface MonthRecord {
  y: number; m: number
  limit: number; spent: number; saveTarget: number
  /** Put aside through the plan during the month. */
  setAside: number
  /** Left unspent, and added to savings when the month closed. */
  leftover: number
  /** Spent beyond the limit. */
  over: number
  /** What was done about the overspend: not decided yet, taken off next month, or left. */
  carry: 'ask' | 'deduct' | 'skip' | null
  /** Where the leftover went. */
  into: { name: string; amount: number }[]
  /** The user has seen this month's summary. */
  seen: boolean
  /** Worked out from past transactions when the plan was set up: nothing was actually saved or carried. */
  history?: boolean
}

export const getRecords = () => read<Record<string, MonthRecord>>(KEYS.planMonths, {})
const putRecords = (r: Record<string, MonthRecord>) => write(KEYS.planMonths, r)

/** Pure: the money figures of a finished month's plan. */
export function closeFigures(plan: Pick<MonthPlan, 'limit' | 'spent'>) {
  return { leftover: plan.limit > 0 ? Math.max(0, plan.limit - plan.spent) : 0, over: plan.limit > 0 ? Math.max(0, plan.spent - plan.limit) : 0 }
}

/**
 * Closes every finished month since the plan began: money not spent goes to savings (and into the goals), and an overspend is
 * remembered so next month can be asked about it. Runs once per month; running it again does nothing.
 */
export function closeMonths(txns: Transaction[], commitments: Commitment[], now = new Date()) {
  // planned by income there are no months to close: pots run until they are used
  if (incomeMode(getPlanSettings(), txns, now.getTime()) === 'INCOME') return 0
  const thisKey = mk(now.getFullYear(), now.getMonth())
  const start = read<string | null>(KEYS.planStart, null)
  if (!start) { write(KEYS.planStart, thisKey); return 0 }
  const records = getRecords()
  let closed = 0
  for (let d = new Date(Number(start.slice(0, 4)), Number(start.slice(5)) - 1, 1); mk(d.getFullYear(), d.getMonth()) < thisKey; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const key = mk(d.getFullYear(), d.getMonth())
    if (records[key]) continue
    const plan = currentPlan(txns, d.getFullYear(), d.getMonth(), commitments)
    const figures = closeFigures(plan)
    // a student's unspent money stays where it is: it is not moved to savings, and with no budget nothing is an overspend
    const leftover = plan.student ? 0 : figures.leftover
    const over = plan.student && !plan.capped ? 0 : figures.over
    const setAside = savedThisMonth(d.getFullYear(), d.getMonth())
    growSinking(d)
    let into: { name: string; amount: number }[] = []
    if (leftover >= 1) {
      into = allocateSavings(leftover, plan.committed + plan.limit)
      const saved = read<Record<string, number>>(KEYS.planSaved, {})
      write(KEYS.planSaved, { ...saved, [key]: (saved[key] ?? 0) + leftover })
    }
    records[key] = { y: d.getFullYear(), m: d.getMonth(), limit: plan.limit, spent: plan.spent, saveTarget: plan.saveTarget, setAside, leftover, over, carry: over >= 1 && !plan.student ? 'ask' : null, into, seen: plan.basis === 'none' }
    putRecords(records)
    closed++
  }
  return closed
}

/** The user's answer about last month's overspend: take it off this month, or leave it. */
export function decideCarry(key: string, choice: 'deduct' | 'skip') {
  const r = getRecords()
  if (!r[key]) return
  putRecords({ ...r, [key]: { ...r[key], carry: choice, seen: true } })
}

export function dismissSummary(key: string) {
  const r = getRecords()
  if (r[key]) putRecords({ ...r, [key]: { ...r[key], seen: true } })
}

/** The most recent finished month the user has not looked at yet, or whose overspend is still undecided. */
export function monthToReview(): (MonthRecord & { key: string }) | null {
  const list = Object.entries(getRecords()).filter(([, r]) => !r.seen || r.carry === 'ask').sort((a, b) => (a[0] < b[0] ? 1 : -1))
  return list[0] ? { ...list[0][1], key: list[0][0] } : null
}

/** A new expense that would carry the month past its limit. Small ones are let through. */
export function overPlan(plan: MonthPlan, amount: number) {
  if (plan.limit <= 0 || !plan.isCurrent) return null
  const after = plan.spent + amount
  if (after <= plan.limit || amount < plan.limit * 0.03) return null
  return { over: round(after - plan.limit), limit: plan.limit, saving: plan.saveTarget }
}

/* ---------- yearly costs, set aside a little every month ---------- */

export const getSinking = () => read<SinkingFund[]>(KEYS.sinking, [])
const monthsBetween = (from: Date, at: number) => { const t = new Date(at); return Math.max(1, (t.getFullYear() - from.getFullYear()) * 12 + t.getMonth() - from.getMonth()) }

/** What one yearly cost needs this month: what is still missing, spread over the months left. */
export const sinkingNeed = (f: SinkingFund, from: Date) => Math.max(0, Math.round((f.amount - f.saved) / monthsBetween(from, f.dueAt)))
export const sinkingMonthly = (funds: SinkingFund[], from: Date) => funds.reduce((a, f) => a + sinkingNeed(f, from), 0)
/** Money a fund paid out in a month: that spending was already saved for. */
export const sinkingPaidIn = (funds: SinkingFund[], y: number, m: number) => funds.reduce((a, f) => a + (f.paid ?? []).filter((p) => { const d = new Date(p.at); return d.getFullYear() === y && d.getMonth() === m }).reduce((b, p) => b + p.amount, 0), 0)

/** When a month closes, every fund has grown by what it needed. */
function growSinking(d: Date) {
  const funds = getSinking()
  if (!funds.length) return
  write(KEYS.sinking, funds.map((f) => ({ ...f, saved: Math.min(f.amount, f.saved + sinkingNeed(f, d)) })))
}

export function addSinking(name: string, amount: number, dueAt: number) {
  write(KEYS.sinking, [...getSinking(), { id: `sink_${Date.now()}`, name, amount, dueAt, saved: 0, createdAt: Date.now() }])
}

/** The cost was paid: what the fund held covers it, and next year's one starts again. */
export function payFromSinking(id: string) {
  const d = new Date()
  write(KEYS.sinking, getSinking().map((f) => (f.id === id
    ? { ...f, paid: [...(f.paid ?? []), { at: Date.now(), amount: Math.round(f.saved) }], saved: 0, dueAt: new Date(new Date(f.dueAt).getFullYear() + 1, new Date(f.dueAt).getMonth(), new Date(f.dueAt).getDate()).getTime() > d.getTime() ? new Date(new Date(f.dueAt).getFullYear() + 1, new Date(f.dueAt).getMonth(), new Date(f.dueAt).getDate()).getTime() : f.dueAt + 365 * DAY }
    : f)))
}

export const removeSinking = (id: string) => write(KEYS.sinking, getSinking().filter((f) => f.id !== id))

/* ---------- reading the plan back to the user ---------- */

/** What the user really keeps of what is left after bills, over the last months: a starting point for the saving rate. */
export function suggestRate(txns: Transaction[], committed: Set<string>, planned: number, commitmentsTotal: number, now = new Date()) {
  const rows = [1, 2, 3].map((k) => new Date(now.getFullYear(), now.getMonth() - k, 1)).map((d) => {
    const xs = txns.filter((t) => inMonth(t, d.getFullYear(), d.getMonth()))
    const income = planned > 0 ? planned : sum(xs.filter(isIncome))
    const bills = commitmentsTotal > 0 ? commitmentsTotal : sum(xs.filter((t) => isCommittedOutflow(t, committed)))
    return { free: income - bills, spent: sum(xs.filter((t) => isPersonalSpend(t, committed))), any: xs.length > 0 }
  }).filter((r) => r.any && r.free > 0)
  if (!rows.length) return null
  const kept = rows.reduce((a, r) => a + Math.max(0, r.free - r.spent) / r.free, 0) / rows.length
  const usual = Math.round(kept * 100)
  return { usual, suggested: Math.min(40, Math.max(10, Math.round((usual + 5) / 5) * 5)), months: rows.length }
}

/** Is the saving real? Compares what the plan says was saved with how the bank balance actually grew. */
export function savingsCheck(txns: Transaction[], methods: PaymentMethod[]) {
  const start = read<string | null>(KEYS.planStart, null)
  const tracked = methods.filter(tracksBalance)
  if (!start || !tracked.length) return null
  const from = new Date(Number(start.slice(0, 4)), Number(start.slice(5)) - 1, 1).getTime()
  const total = (list: Transaction[]) => tracked.reduce((a, m) => a + accountBalance(m, list, methods), 0)
  const growth = Math.round(total(txns) - total(txns.filter((t) => t.timestamp < from)))
  const saved = Math.round(totalSaved())
  return { growth, saved, gap: Math.max(0, saved - growth), since: from }
}

/** What a goal needs each month to be done by its date, against what the plan puts in it. */
export function goalPace(goal: SavingsGoal, perMonth: number, now = Date.now()) {
  const left = Math.max(0, goal.target - goal.saved)
  if (!goal.deadline || left <= 0) return null
  const months = monthsUntil(goal.deadline, now)
  const need = Math.ceil(left / months)
  return { months, need, gets: Math.round(perMonth), ok: perMonth + 1 >= need }
}

/** What each goal gets from one month's saving, after the emergency fund's share. */
export function goalShares(plan: MonthPlan, goals: SavingsGoal[], now = Date.now()) {
  const cfg = getPlanSettings()
  const fundFull = goals.some((g) => g.emergency && g.saved >= g.target)
  const toGoals = plan.saveTarget * (cfg.emergencyShare > 0 && !fundFull ? 1 - cfg.emergencyShare / 100 : 1)
  const open = goals.filter((g) => !g.emergency && g.saved < g.target)
  return new Map(splitSavings(toGoals, open, now).map((p) => [p.id, p.amount]))
}

/** Big money that is not pay: a bonus, a gift, a large transfer. Shown once so it can be split instead of spent. */
export function windfalls(txns: Transaction[], plan: MonthPlan) {
  const done = read<string[]>(KEYS.windfallDone, [])
  const floor = Math.max(5000, plan.income * 0.5)
  return txns.filter((t) => isIncome(t) && t.timestamp >= new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() && !done.includes(t.id) && !t.settledBy && !isMerchantApp(t.paymentApp)
    && !['Salary', 'Business', 'Refund', 'Cashback', 'Family'].includes(t.paymentCategory) && t.paymentAmount >= floor)
}
export const dismissWindfall = (id: string) => write(KEYS.windfallDone, [...read<string[]>(KEYS.windfallDone, []), id])
/** How a windfall is split: most is saved, a little is for the person. */
export const windfallSplit = (amount: number) => ({ save: Math.round(amount * 0.7), enjoy: Math.round(amount * 0.3) })

/** "Can I afford this?" against this month's plan. */
export function afford(plan: MonthPlan, amount: number) {
  const left = plan.left
  const short = Math.max(0, amount - Math.max(0, left))
  const verdict: 'fits' | 'dips' | 'wait' = amount <= left ? 'fits' : short <= plan.saveTarget ? 'dips' : 'wait'
  const months = plan.saveTarget > 0 ? Math.ceil(amount / plan.saveTarget) : null
  return { verdict, short, afterLeft: left - amount, monthsToSave: months, delayMonths: plan.saveTarget > 0 ? Math.round((short / plan.saveTarget) * 10) / 10 : null }
}

/** The shop's month: what came in, what it cost to run, what is left. */
export function shopSummary(txns: Transaction[], y: number, m: number) {
  const cur = txns.filter((t) => inMonth(t, y, m))
  const sales = sum(cur.filter((t) => isIncome(t) && (t.paymentCategory === 'Business' || isMerchantApp(t.paymentApp))))
  const costs = sum(cur.filter(isBusinessExpense))
  return { sales: round(sales), costs: round(costs), profit: round(sales - costs) }
}

/* ---------- starting from what already happened ---------- */

export interface HistorySummary { months: number; income: number; family: number; spend: number; keptPct: number }

/** The last few full months: what came in, what went to family, what was spent, and how much was kept. Null with under a month of data. */
export function historySummary(txns: Transaction[], committed: Set<string>, now = new Date()): HistorySummary | null {
  const first = txns.reduce((a, t) => Math.min(a, t.timestamp), Infinity)
  const months = [1, 2, 3].map((k) => new Date(now.getFullYear(), now.getMonth() - k, 1)).filter((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() > first)
  const rows = months.map((d) => txns.filter((t) => inMonth(t, d.getFullYear(), d.getMonth()))).filter((xs) => xs.length >= 3)
  if (!rows.length) return null
  const avg = (f: (xs: Transaction[]) => number) => Math.round(rows.reduce((a, xs) => a + f(xs), 0) / rows.length)
  const income = avg((xs) => sum(xs.filter(isIncome)))
  const family = avg((xs) => sum(xs.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === FAMILY)))
  const spend = avg((xs) => sum(xs.filter((t) => isPersonalSpend(t, committed))))
  const left = income - family
  return { months: rows.length, income, family, spend, keptPct: left > 0 ? Math.max(0, Math.round(((left - spend) / left) * 100)) : 0 }
}

export const planSetupDone = () => read<boolean>(KEYS.planSetup, false)

/**
 * One-time start from the last months: the income and family support the plan needs are filled in (only where the user has not
 * typed their own), the saving rate starts a little above what was really kept, and the months gone by are listed as how the plan
 * would have gone. Nothing is saved or carried over for them.
 */
export function setUpFromHistory(txns: Transaction[], commitments: Commitment[], now = new Date()) {
  const committed = committedCategories(commitments)
  const h = historySummary(txns, committed, now)
  write(KEYS.planSetup, true)
  if (!h) return null
  const user = read<{ monthly_income?: number } | null>(KEYS.user, null)
  const mode = incomeMode(getPlanSettings(), txns, now.getTime())
  let nextCommitments = commitments
  if (user && !(user.monthly_income ?? 0) && mode === 'FIXED' && h.income > 0) write(KEYS.user, { ...user, monthly_income: h.income })
  if (!commitments.some((c) => c.category === FAMILY) && h.family >= 500) {
    nextCommitments = [...commitments, { id: `hist_${Date.now()}`, name: 'Family support', amount: h.family, category: FAMILY, memberId: null, createdAt: Date.now() }]
    write(KEYS.commitments, nextCommitments)
  }
  const rate = suggestRate(txns, committedCategories(nextCommitments), mode === 'FIXED' ? plannedIncome() : 0, nextCommitments.reduce((a, c) => a + c.amount, 0), now)
  if (rate) savePlanSettings({ saveRate: rate.suggested })
  const thisKey = mk(now.getFullYear(), now.getMonth())
  if (!read<string | null>(KEYS.planStart, null)) write(KEYS.planStart, thisKey)
  const records = getRecords()
  for (const k of [1, 2, 3]) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const key = mk(d.getFullYear(), d.getMonth())
    if (records[key]) continue
    const plan = currentPlan(txns, d.getFullYear(), d.getMonth(), nextCommitments)
    if (plan.basis === 'none' || plan.spent === 0) continue
    const { leftover, over } = closeFigures(plan)
    records[key] = { y: d.getFullYear(), m: d.getMonth(), limit: plan.limit, spent: plan.spent, saveTarget: plan.saveTarget, setAside: 0, leftover, over, carry: null, into: [], seen: true, history: true }
  }
  putRecords(records)
  return h
}
