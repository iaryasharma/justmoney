// Income-driven budgeting. Money is not planned month by month: whenever it comes in, it is split into pots
// (family, bills, personal spending, saving, an emergency fund), and each pot is tracked until it runs out.
// Pay can be late or arrive for several months at once, so nothing here assumes a monthly salary.
import { read, write, uid, KEYS } from '../core/storage'
import { isTransferCategory } from '../accounts/accounts'
import { FAMILY, isIncome, getCommitments, matchFamily, sameName } from '../core/money'
import { allocateSavings } from './plan'
import type { Commitment, FamilyMember, SavingsGoal, Transaction } from '../core/types'
import type { Person } from '../payees/peopleMatch'

const DAY = 86400000

export type PotKind = 'family' | 'bills' | 'personal' | 'custom'

export interface Pot {
  id: string
  kind: PotKind
  name: string
  /** Categories whose spending comes out of this pot. Personal has none: it takes everything else. */
  categories?: string[]
  createdAt: number
  /** Spending counts against the pot from here. */
  startAt: number
}

/** One income, split. `saving` and `emergency` went straight to the goals; the rest went into pots. */
export interface DelayedPay { months: number; from: string; paidOn: number; stillUnpaid: number }
export interface Allocation {
  id: string
  at: number
  amount: number
  source: string
  txId?: string | null
  splits: { pot: string; amount: number }[]
  saving: number
  emergency: number
  /** Pay that came late: how many months it covers, from which month, and how many are still unpaid. */
  delayed?: DelayedPay
  /** Who the family money was meant for (Mom, Dad). */
  familySplit?: { who: string; amount: number }[]
}

/** Money moved between pots, or taken out of savings to cover a pot. */
export interface PotMove { id: string; at: number; from: string; to: string; amount: number; kind: 'pot' | 'savings'; note?: string }

export const getPots = () => read<Pot[]>(KEYS.pots, [])
export const getAllocations = () => read<Allocation[]>(KEYS.allocations, [])
export const getMoves = () => read<PotMove[]>(KEYS.potMoves, [])

const BILL_CATEGORIES = ['EMI/Bill', 'Rent']

export function defaultPots(at = Date.now()): Pot[] {
  return [
    { id: 'family', kind: 'family', name: 'Family', categories: [FAMILY], createdAt: at, startAt: at },
    { id: 'bills', kind: 'bills', name: 'Bills', createdAt: at, startAt: at },
    { id: 'personal', kind: 'personal', name: 'Personal spending', createdAt: at, startAt: at },
  ]
}

/** The categories a pot's spending is read from. */
export function potCategories(pot: Pot, commitments: Commitment[] = getCommitments()): string[] | null {
  if (pot.kind === 'personal') return null
  if (pot.kind === 'bills') return [...new Set([...BILL_CATEGORIES, ...commitments.filter((c) => c.category !== FAMILY).map((c) => c.category)])]
  return pot.categories ?? []
}

export function potSpent(pot: Pot, pots: Pot[], txns: Transaction[], commitments: Commitment[]) {
  const cats = potCategories(pot, commitments)
  const taken = new Set(pots.filter((p) => p.id !== pot.id).flatMap((p) => potCategories(p, commitments) ?? []))
  return txns
    .filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= pot.startAt && !isTransferCategory(t.paymentCategory) && !t.business)
    .filter((t) => (cats ? cats.includes(t.paymentCategory) : !taken.has(t.paymentCategory)))
    .reduce((a, t) => a + t.paymentAmount, 0)
}

export interface PotBalance { pot: Pot; allocated: number; spent: number; left: number }

/** For each pot: what was put in (and moved in or out), what was spent from it, and what is left. */
export function potBalances(pots: Pot[], allocations: Allocation[], moves: PotMove[], txns: Transaction[], commitments: Commitment[]): PotBalance[] {
  return pots.map((pot) => {
    const into = allocations.reduce((a, al) => a + al.splits.filter((s) => s.pot === pot.id).reduce((b, s) => b + s.amount, 0), 0)
    const moved = moves.reduce((a, m) => a + (m.to === pot.id ? m.amount : 0) - (m.from === pot.id ? m.amount : 0), 0)
    const allocated = Math.round((into + moved) * 100) / 100
    const spent = Math.round(potSpent(pot, pots, txns, commitments))
    return { pot, allocated, spent, left: Math.round((allocated - spent) * 100) / 100 }
  })
}

/** What is left of an income once family and bills are set: part is saved first, part of that is the emergency fund, the rest is for spending. */
export function splitRemainder(amount: number, family: number, bills: number, saveRate: number, emergencyShare: number) {
  const rest = Math.max(0, amount - family - bills)
  const saved = Math.round(rest * saveRate / 100)
  const emergency = Math.round(saved * emergencyShare / 100)
  return { family, bills, saving: saved - emergency, emergency, personal: Math.max(0, rest - saved) }
}

/** A starting split for a new income: family and bills as they were last time (or as planned), then saving first. */
export function suggestAllocation(amount: number, o: { last?: Allocation | null; commitments: Commitment[]; saveRate: number; emergencyShare: number }) {
  const lastOf = (id: string) => o.last?.splits.find((s) => s.pot === id)?.amount
  const planned = (family: boolean) => o.commitments.filter((c) => (c.category === FAMILY) === family).reduce((a, c) => a + c.amount, 0)
  const family = Math.min(amount, lastOf('family') ?? planned(true))
  const bills = Math.min(amount - family, lastOf('bills') ?? planned(false))
  return splitRemainder(amount, family, bills, o.saveRate, o.emergencyShare)
}

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export interface AllocationInput {
  amount: number
  source: string
  txId?: string | null
  family: number
  bills: number
  saving: number
  emergency: number
  /** Extra pots by id (custom ones). */
  custom?: Record<string, number>
  /** What family, bills and everyday spending cost a month, to size the emergency fund. */
  essentials?: number
  /** Who the family amount is for. */
  familySplit?: { who: string; amount: number }[]
  delayed?: DelayedPay
}

/** Splits an income. Whatever is not given to another pot goes to personal spending, so the whole amount is always placed. */
export function allocateIncome(i: AllocationInput): Allocation {
  const now = Date.now()
  let pots = getPots()
  if (!pots.length) { pots = defaultPots(now); write(KEYS.pots, pots) }
  const custom = i.custom ?? {}
  const given = i.family + i.bills + i.saving + i.emergency + Object.values(custom).reduce((a, v) => a + v, 0)
  const personal = Math.max(0, Math.round((i.amount - given) * 100) / 100)
  const splits = [
    { pot: 'family', amount: i.family }, { pot: 'bills', amount: i.bills }, { pot: 'personal', amount: personal },
    ...Object.entries(custom).map(([pot, amount]) => ({ pot, amount })),
  ].filter((s) => s.amount > 0)
  // saving and the emergency fund are real goals: the money goes straight in
  if (i.emergency > 0) allocateSavings(i.emergency, i.essentials ?? 0, { emergencyShare: 100 })
  if (i.saving > 0) allocateSavings(i.saving, i.essentials ?? 0, { emergencyShare: 0 })
  if (i.saving + i.emergency > 0) {
    const saved = read<Record<string, number>>(KEYS.planSaved, {})
    write(KEYS.planSaved, { ...saved, [monthKey()]: (saved[monthKey()] ?? 0) + i.saving + i.emergency })
  }
  const a: Allocation = { id: uid(), at: now, amount: i.amount, source: i.source, txId: i.txId ?? null, splits, saving: i.saving, emergency: i.emergency, ...(i.familySplit?.length ? { familySplit: i.familySplit.filter((f) => f.amount > 0) } : {}), ...(i.delayed ? { delayed: i.delayed } : {}) }
  write(KEYS.allocations, [a, ...getAllocations()])
  return a
}

/** Moves money from one pot to another when something unexpected comes up. */
export function movePot(from: string, to: string, amount: number, note?: string) {
  if (!(amount > 0) || from === to) return
  write(KEYS.potMoves, [{ id: uid(), at: Date.now(), from, to, amount, kind: 'pot' as const, note }, ...getMoves()])
}

/** Covers a pot from savings (a goal): the goal goes down, the pot goes up. Used when income is late. */
export function takeFromSavings(goalId: string, to: string, amount: number) {
  const goals = read<SavingsGoal[]>(KEYS.savingsGoals, [])
  const g = goals.find((x) => x.id === goalId)
  if (!g || !(amount > 0)) return 0
  const take = Math.min(amount, g.saved)
  if (take <= 0) return 0
  write(KEYS.savingsGoals, goals.map((x) => (x.id === goalId ? { ...x, saved: Math.round((x.saved - take) * 100) / 100 } : x)))
  const saved = read<Record<string, number>>(KEYS.planSaved, {})
  write(KEYS.planSaved, { ...saved, [monthKey()]: (saved[monthKey()] ?? 0) - take })
  write(KEYS.savingsLog, [...read<{ at: number }[]>(KEYS.savingsLog, []), { at: Date.now(), name: g.name, amount: -take, emergency: !!g.emergency }].slice(-600))
  write(KEYS.potMoves, [{ id: uid(), at: Date.now(), from: `goal:${goalId}`, to, amount: take, kind: 'savings' as const, note: g.name }, ...getMoves()])
  return take
}

export function addPot(name: string, categories: string[]) {
  const pots = getPots().length ? getPots() : defaultPots()
  const p: Pot = { id: `pot_${uid()}`, kind: 'custom', name: name.trim(), categories, createdAt: Date.now(), startAt: Date.now() }
  write(KEYS.pots, [...pots, p])
  return p
}

/* ---------- when income is late ---------- */

/** Income that came in and has not been split yet. Small credits are ignored. */
export function unallocatedIncome(txns: Transaction[], allocations = getAllocations(), skipped = read<string[]>(KEYS.allocSkipped, []), floor = 1000) {
  const done = new Set(allocations.map((a) => a.txId).filter(Boolean))
  const since = allocations.length || getPots().length ? 0 : Date.now() - 45 * DAY
  return txns
    .filter((t) => isIncome(t) && t.paymentAmount >= floor && !done.has(t.id) && !skipped.includes(t.id) && t.timestamp >= since
      && !['Refund', 'Cashback'].includes(t.paymentCategory) && !t.settledBy)
    .sort((a, b) => b.timestamp - a.timestamp)
}
export const skipAllocation = (txId: string) => write(KEYS.allocSkipped, [...read<string[]>(KEYS.allocSkipped, []), txId])

/** What a month of living costs, from the last three months: family, bills and everyday spending. Zero when there is no history. */
export function monthlyEssentials(txns: Transaction[], now = Date.now()) {
  const since = now - 90 * DAY
  const xs = txns.filter((t) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory) && !t.business && t.timestamp >= since)
  const first = txns.reduce((a, t) => Math.min(a, t.timestamp), now)
  const months = Math.min(3, Math.max(1, (now - first) / (30 * DAY)))
  return Math.round(xs.reduce((a, t) => a + t.paymentAmount, 0) / months)
}

/** How long what is left will last at the pace of the last month, and how much longer with savings. */
export function runway(balances: PotBalance[], goals: SavingsGoal[], txns: Transaction[], now = Date.now()) {
  const living = balances.filter((b) => b.pot.kind !== 'family')
  const left = living.reduce((a, b) => a + Math.max(0, b.left), 0)
  const recent = txns.filter((t) => t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory) && !t.business && t.paymentCategory !== FAMILY && t.timestamp >= now - 30 * DAY)
  const daily = recent.reduce((a, t) => a + t.paymentAmount, 0) / 30
  const savings = goals.reduce((a, g) => a + g.saved, 0)
  return { left, daily, days: daily > 0 ? Math.floor(left / daily) : null, withSavings: daily > 0 ? Math.floor((left + savings) / daily) : null, savings }
}

/** When money last came in, and how many days ago that was. */
export function lastIncome(txns: Transaction[], allocations = getAllocations(), now = Date.now()) {
  const at = Math.max(0, ...allocations.map((a) => a.at), ...txns.filter((t) => isIncome(t) && t.paymentAmount >= 1000).map((t) => t.timestamp))
  return { at, days: at ? Math.floor((now - at) / DAY) : null }
}

/** The personal pot as a daily allowance, for the Home card and the nudge before a purchase. */
export function potsPlan(txns: Transaction[], commitments: Commitment[], nextIncomeAt?: number | null, now = Date.now()) {
  const pots = getPots()
  const balances = potBalances(pots, getAllocations(), getMoves(), txns, commitments)
  const personal = balances.find((b) => b.pot.id === 'personal')
  if (!personal) return { has: false as const }
  const until = nextIncomeAt && nextIncomeAt > now ? Math.ceil((nextIncomeAt - now) / DAY) : 14
  return { has: true as const, balances, personal, perDay: Math.max(0, personal.left) / Math.max(1, until), daysUntil: until }
}

/* ---------- who the family money is for ---------- */

export interface FamilyRow { who: string; given: number; sent: number; left: number }

/** The names family money can go to: family members and the contacts marked as family. */
export function familyNames(members: FamilyMember[], people: Person[]) {
  return [...new Set([...members.map((m) => m.name), ...people.filter((p) => p.familyId || p.relation).map((p) => p.name)].filter(Boolean))]
}

/**
 * For each person: what was set aside for them when income was split, what was actually sent, and what is left.
 * Money sent to someone not named in a split shows on its own row.
 */
export function familyBreakdown(allocations: Allocation[], txns: Transaction[], since: number, members: FamilyMember[], people: Person[]): FamilyRow[] {
  const rows: FamilyRow[] = []
  const rowFor = (name: string) => {
    let r = rows.find((x) => sameName(x.who, name) || x.who.toLowerCase() === name.toLowerCase())
    if (!r) { r = { who: name, given: 0, sent: 0, left: 0 }; rows.push(r) }
    return r
  }
  for (const a of allocations) for (const f of a.familySplit ?? []) rowFor(f.who).given += f.amount
  for (const t of txns) {
    if (t.paymentType !== 'DEBIT' || t.paymentCategory !== FAMILY || t.timestamp < since) continue
    const name = (t.contactId ? people.find((p) => p.id === t.contactId)?.name : undefined) ?? matchFamily(t.paymentReceiver, members)?.name ?? t.paymentReceiver
    rowFor(name).sent += t.paymentAmount
  }
  return rows.map((r) => ({ ...r, left: r.given - r.sent })).sort((a, b) => b.given + b.sent - (a.given + a.sent))
}
