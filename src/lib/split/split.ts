import { read, write, uid, KEYS } from '../core/storage'

/** A group (a trip, a flat), or with `direct` a private ledger between you and one friend, for splits that belong to no group. */
export interface SplitProject { id: string; name: string; createdAt: number; direct?: boolean }
export interface SplitPerson { id: string; name: string; projectId: string; isCurrentUser: boolean; createdAt: number }
export interface SplitTxn {
  id: string; amount: number; description: string; date: number; projectId: string
  payerId: string; transactionType: 'DEBIT' | 'SETTLEMENT'; createdAt: number
  /** How the expense was divided, and the raw per-person inputs (amounts, percents or shares). */
  splitMode?: SplitMode; splitValues?: Record<string, number>
  /** Split item by item (ITEMS): what was on the bill, who had each, and the tax / charges / discount shared in proportion. */
  items?: { name: string; price: number; qty?: number; who: string[] }[]; extras?: number
  /** One bill split with several friends outside a group: one expense in each friend's ledger, all sharing this key. */
  linkKey?: string
}
export type SplitMode = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES' | 'ITEMS'
export interface SplitRow { id: string; transactionId: string; personId: string; splitAmount: number; createdAt: number }

const all = <T,>(k: string) => read<T[]>(k, [])

/** Splits `total` across n people in paise; the first `remainder` people get +1 paisa. */
export function splitAmountEvenly(total: number, n: number): number[] {
  const paise = Math.round(total * 100)
  const base = Math.floor(paise / n)
  const rem = paise - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1 : 0)) / 100)
}

/** Divides `total` in proportion to `weights`, in paise, handing leftover paise to the largest remainders. */
export function splitByWeights(total: number, weights: number[]): number[] {
  const paise = Math.round(total * 100)
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (paise * w) / sum)
  const base = raw.map(Math.floor)
  let left = paise - base.reduce((a, b) => a + b, 0)
  raw.map((r, i) => [r - base[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left-- } })
  return base.map((p) => p / 100)
}

/** Turns the chosen mode and per-person inputs into split rows, or explains what's wrong. */
export function computeSplits(total: number, mode: SplitMode, ids: string[], values: Record<string, number>):
  { splits: { personId: string; amount: number }[] } | { error: string } {
  if (!ids.length) return { error: 'Pick who to split with' }
  if (mode === 'EQUAL') {
    const shares = splitAmountEvenly(total, ids.length)
    return { splits: ids.map((personId, i) => ({ personId, amount: shares[i] })) }
  }
  const vals = ids.map((id) => values[id] ?? 0)
  if (vals.some((v) => !(v >= 0))) return { error: 'Enter a number for everyone' }
  if (mode === 'EXACT') {
    const sum = Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100
    if (Math.abs(sum - total) > 0.009) return { error: `Amounts add up to ${sum.toFixed(2)}, not ${total.toFixed(2)}` }
    return { splits: ids.map((personId, i) => ({ personId, amount: vals[i] })) }
  }
  const sum = vals.reduce((a, b) => a + b, 0)
  if (mode === 'PERCENT' && Math.abs(sum - 100) > 0.01) return { error: `Percentages add up to ${Math.round(sum * 100) / 100}%, not 100%` }
  if (!(sum > 0)) return { error: 'Give at least one person a share' }
  const shares = splitByWeights(total, vals)
  return { splits: ids.map((personId, i) => ({ personId, amount: shares[i] })) }
}

/** Fewest payments that settle a group: repeatedly match the biggest debtor with the biggest creditor. */
export function simplifyDebts(net: Map<string, number>) {
  const debtors = [...net].filter(([, v]) => v < -0.004).map(([id, v]) => ({ id, amt: -v }))
  const creditors = [...net].filter(([, v]) => v > 0.004).map(([id, v]) => ({ id, amt: v }))
  const out: { from: string; to: string; amount: number }[] = []
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.amt - a.amt); creditors.sort((a, b) => b.amt - a.amt)
    const d = debtors[0], c = creditors[0]
    const amt = Math.round(Math.min(d.amt, c.amt) * 100) / 100
    out.push({ from: d.id, to: c.id, amount: amt })
    d.amt -= amt; c.amt -= amt
    if (d.amt < 0.005) debtors.shift()
    if (c.amt < 0.005) creditors.shift()
  }
  return out
}

export function createProject(name: string, selfName: string) {
  const p: SplitProject = { id: uid(), name, createdAt: Date.now() }
  write(KEYS.splitProjects, [...all<SplitProject>(KEYS.splitProjects), p])
  ensureCurrentUserInProject(p.id, selfName)
  return p
}

export function deleteProject(projectId: string) {
  const txIds = new Set(all<SplitTxn>(KEYS.splitTransactions).filter((t) => t.projectId === projectId).map((t) => t.id))
  write(KEYS.splitProjects, all<SplitProject>(KEYS.splitProjects).filter((p) => p.id !== projectId))
  write(KEYS.splitPeople, all<SplitPerson>(KEYS.splitPeople).filter((p) => p.projectId !== projectId))
  write(KEYS.splitTransactions, all<SplitTxn>(KEYS.splitTransactions).filter((t) => !txIds.has(t.id)))
  write(KEYS.splits, all<SplitRow>(KEYS.splits).filter((s) => !txIds.has(s.transactionId)))
}

export function ensureCurrentUserInProject(projectId: string, name = 'You') {
  const people = all<SplitPerson>(KEYS.splitPeople)
  if (people.some((p) => p.projectId === projectId && p.isCurrentUser)) return
  write(KEYS.splitPeople, [...people, { id: uid(), name, projectId, isCurrentUser: true, createdAt: Date.now() }])
}

export function addPeople(projectId: string, names: string[]) {
  const now = Date.now()
  const added = names.map((name) => ({ id: uid(), name, projectId, isCurrentUser: false, createdAt: now }))
  write(KEYS.splitPeople, [...all<SplitPerson>(KEYS.splitPeople), ...added])
}

export function createTransaction(
  amount: number, description: string, date: number, projectId: string, payerId: string,
  splits: { personId: string; amount: number }[], type: SplitTxn['transactionType'] = 'DEBIT',
  mode?: { splitMode: SplitMode; splitValues?: Record<string, number>; items?: SplitTxn['items']; extras?: number },
) {
  const now = Date.now()
  const t: SplitTxn = { id: uid(), amount, description, date, projectId, payerId, transactionType: type, createdAt: now, ...mode }
  write(KEYS.splitTransactions, [...all<SplitTxn>(KEYS.splitTransactions), t])
  write(KEYS.splits, [
    ...all<SplitRow>(KEYS.splits),
    ...splits.map((s) => ({ id: uid(), transactionId: t.id, personId: s.personId, splitAmount: s.amount, createdAt: now })),
  ])
  return t
}

export function updateTransaction(id: string, patch: Partial<Pick<SplitTxn, 'amount' | 'description' | 'date' | 'payerId' | 'splitMode' | 'splitValues' | 'items' | 'extras'>>, splits: { personId: string; amount: number }[]) {
  write(KEYS.splitTransactions, all<SplitTxn>(KEYS.splitTransactions).map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const now = Date.now()
  write(KEYS.splits, [
    ...all<SplitRow>(KEYS.splits).filter((s) => s.transactionId !== id),
    ...splits.map((s) => ({ id: uid(), transactionId: id, personId: s.personId, splitAmount: s.amount, createdAt: now })),
  ])
}

/** Removes every expense of one bill: the expense with this id, or all that share it as their link key. */
export function deleteLinked(key: string) {
  const ids = new Set(all<SplitTxn>(KEYS.splitTransactions).filter((t) => t.id === key || t.linkKey === key).map((t) => t.id))
  write(KEYS.splitTransactions, all<SplitTxn>(KEYS.splitTransactions).filter((t) => !ids.has(t.id)))
  write(KEYS.splits, all<SplitRow>(KEYS.splits).filter((s) => !ids.has(s.transactionId)))
}

export function deleteTransaction(id: string) {
  write(KEYS.splitTransactions, all<SplitTxn>(KEYS.splitTransactions).filter((t) => t.id !== id))
  write(KEYS.splits, all<SplitRow>(KEYS.splits).filter((s) => s.transactionId !== id))
}

/** Debtor pays creditor: debtor is the payer, creditor carries the split row. */
export function settleUp(projectId: string, debtorId: string, creditorId: string, amount: number) {
  return createTransaction(amount, 'Settlement', Date.now(), projectId, debtorId, [{ personId: creditorId, amount }], 'SETTLEMENT')
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** net > 0: gets back; net < 0: owes. */
export function calculateProjectBalances(projectId: string, people: SplitPerson[], txns: SplitTxn[], rows: SplitRow[]) {
  const net = new Map<string, number>()
  people.filter((p) => p.projectId === projectId).forEach((p) => net.set(p.id, 0))
  const pt = txns.filter((t) => t.projectId === projectId)
  const ids = new Set(pt.map((t) => t.id))
  pt.forEach((t) => net.set(t.payerId, (net.get(t.payerId) ?? 0) + t.amount))
  rows.filter((s) => ids.has(s.transactionId)).forEach((s) => net.set(s.personId, (net.get(s.personId) ?? 0) - s.splitAmount))
  net.forEach((v, k) => net.set(k, r2(v)))
  return net
}

export const isSettled = (n: number) => Math.abs(n) < 0.005

export interface FriendBalance { person: SplitPerson; project: SplitProject; amount: number; direction: 'owes-you' | 'you-owe' | 'settled' }

/**
 * Balances are pairwise relative to the current user: in each group, a
 * non-self person's net is what they owe (negative) or are owed (positive)
 * across the group. This matches the original's per-person view.
 */
export function friendBalances(projects: SplitProject[], people: SplitPerson[], txns: SplitTxn[], rows: SplitRow[]): FriendBalance[] {
  const out: FriendBalance[] = []
  for (const project of projects) {
    const net = calculateProjectBalances(project.id, people, txns, rows)
    const self = people.find((p) => p.projectId === project.id && p.isCurrentUser)
    // who pays whom once the group settles up: only the payments to or from you are between you and that friend
    // (in a group of three, "A owes B" is not "A owes you")
    const transfers = simplifyDebts(net)
    for (const person of people.filter((p) => p.projectId === project.id && !p.isCurrentUser)) {
      const n = self ? r2(transfers.reduce((a, t) => a + (t.from === person.id && t.to === self.id ? t.amount : t.from === self.id && t.to === person.id ? -t.amount : 0), 0)) : 0
      out.push({ person, project, amount: Math.abs(n), direction: isSettled(n) ? 'settled' : n > 0 ? 'owes-you' : 'you-owe' })
    }
  }
  return out.sort((a, b) => b.amount - a.amount)
}

/* ---------- splits without a group ---------- */

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

/** Your private ledger with one friend (made the first time). */
export function directLedger(friendName: string, selfName = 'You') {
  const name = friendName.trim()
  const people = all<SplitPerson>(KEYS.splitPeople)
  const found = all<SplitProject>(KEYS.splitProjects).find((p) => p.direct && people.some((x) => x.projectId === p.id && !x.isCurrentUser && sameName(x.name, name)))
  const project = found ?? (() => {
    const p: SplitProject = { id: uid(), name, createdAt: Date.now(), direct: true }
    write(KEYS.splitProjects, [...all<SplitProject>(KEYS.splitProjects), p])
    ensureCurrentUserInProject(p.id, selfName)
    addPeople(p.id, [name])
    return p
  })()
  const members = all<SplitPerson>(KEYS.splitPeople).filter((x) => x.projectId === project.id)
  return { projectId: project.id, selfId: members.find((x) => x.isCurrentUser)!.id, friendId: members.find((x) => !x.isCurrentUser)!.id }
}

export interface NoGroupSplit {
  amount: number; description: string; date?: number
  /** The friends, by name. */
  friends: string[]
  /** Who paid: 'me', or a friend's name (only when there is exactly one friend: money between two friends belongs in a group). */
  paidBy: string
  /** Each person's share by name ('me' for you); leave out to split equally among you and the friends. */
  shares?: Record<string, number>
  selfName?: string
}

/** Splits a bill outside any group: each friend's part goes into your ledger with them. Returns the link key, or an error. */
export function splitWithoutGroup(o: NoGroupSplit): { key: string; myShare: number } | { error: string } {
  const friends = [...new Map(o.friends.map((f) => [f.trim().toLowerCase(), f.trim()])).values()].filter(Boolean)
  if (!friends.length) return { error: 'Add at least one friend' }
  if (!(o.amount > 0)) return { error: 'Enter the amount' }
  const friendPaid = o.paidBy !== 'me'
  if (friendPaid && (friends.length !== 1 || !sameName(o.paidBy, friends[0]))) return { error: 'Without a group, the bill is paid by you or by the one friend you split it with' }
  const names = ['me', ...friends]
  const even = splitAmountEvenly(o.amount, names.length)
  const share = (n: string, i: number) => (o.shares ? r2(o.shares[n] ?? 0) : even[i])
  const total = r2(names.reduce((a, n, i) => a + share(n, i), 0))
  if (o.shares && Math.abs(total - o.amount) > 0.005) return { error: `The shares add up to ${total}, not ${o.amount}` }
  const date = o.date ?? Date.now()
  const desc = o.description.trim() || 'Split'
  const label = friends.length > 1 ? `${desc} (with ${friends.length} friends)` : desc
  let key = ''
  const myShare = share('me', 0)
  if (friendPaid) {
    // the friend paid: you owe them your share
    const l = directLedger(friends[0], o.selfName)
    if (myShare > 0) key = createTransaction(myShare, label, date, l.projectId, l.friendId, [{ personId: l.selfId, amount: myShare }], 'DEBIT', { splitMode: o.shares ? 'EXACT' : 'EQUAL' }).id
  } else {
    friends.forEach((f, i) => {
      const part = share(f, i + 1)
      if (part <= 0) return
      const l = directLedger(f, o.selfName)
      const t = createTransaction(part, label, date, l.projectId, l.selfId, [{ personId: l.friendId, amount: part }], 'DEBIT', { splitMode: o.shares ? 'EXACT' : 'EQUAL' })
      if (!key) key = t.id
      if (friends.length > 1) write(KEYS.splitTransactions, all<SplitTxn>(KEYS.splitTransactions).map((x) => (x.id === t.id ? { ...x, linkKey: key } : x)))
    })
  }
  if (!key) return { error: 'Nobody owes anything on this split' }
  return { key, myShare }
}
