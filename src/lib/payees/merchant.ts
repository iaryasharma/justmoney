// Money a shop takes through PhonePe Business or Paytm for Business.
//
// Those apps hold sales for about a day before paying them out to the bank in one lump. Counting both the
// sales (when the app tells you) and the payout (when the bank does) would count the same money twice, so:
//  - each sale is income when it arrives, in the category "Business", with no bank account (it is not in the bank yet);
//  - the bank's payout is recognised and filed as a transfer, tied to the sales it covers, so it is not income again.
import { read, write, KEYS } from '../core/storage'
import { SELF_TRANSFER, isTransferCategory } from '../accounts/accounts'
import type { Transaction } from '../core/types'

export const BUSINESS = 'Business'
export const MERCHANT_APPS = ['PhonePe Business', 'Paytm Business'] as const

/** Android package → merchant app. PhonePe Business is confirmed; Paytm's is matched loosely too (see isMerchantPackage). */
export const MERCHANT_PACKAGES: Record<string, string> = {
  'com.phonepe.app.business': 'PhonePe Business',
  'com.paytm.business': 'Paytm Business',
}

/** A package that looks like a PhonePe or Paytm business app even if its id is not in the list above. */
export function merchantAppOfPackage(pkg: string): string | null {
  if (MERCHANT_PACKAGES[pkg]) return MERCHANT_PACKAGES[pkg]
  const p = pkg.toLowerCase()
  if (/business|merchant|soundbox|biz/.test(p)) {
    if (p.includes('phonepe')) return 'PhonePe Business'
    if (p.includes('paytm') || p.includes('one97')) return 'Paytm Business'
  }
  return null
}

export const isMerchantApp = (app?: string | null) => !!app && (MERCHANT_APPS as readonly string[]).includes(app)

/** A sale that came in through a business app and has not reached a bank account by itself. */
export const isMerchantReceipt = (t: Transaction) => t.paymentType === 'CREDIT' && isMerchantApp(t.paymentApp)

/** Sales still sitting with the app: not paid out to the bank yet. */
export const isPending = (t: Transaction) => isMerchantReceipt(t) && !t.settledBy && !t.paymentMethodId

/** What the bank writes when a business app pays its balance out. */
const SETTLEMENT = /settle|payout|one97|paytm\s*(?:payments?|services|merchant|business)|pa?ytm\s*pg|phone\s?pe\s*(?:pvt|private|ltd|limited|payments?|business|merchant)/i

export function looksLikeSettlement(t: Pick<Transaction, 'paymentReceiver' | 'note' | 'paymentType'>) {
  return t.paymentType === 'CREDIT' && SETTLEMENT.test(`${t.paymentReceiver} ${t.note ?? ''}`) && !/refund|cashback|reversal/i.test(`${t.paymentReceiver} ${t.note ?? ''}`)
}

const platformOf = (text: string) => (/phone\s?pe/i.test(text) ? 'PhonePe Business' : /paytm|one97/i.test(text) ? 'Paytm Business' : null)

/** Sales are paid out within a day or so, a long weekend or bank holiday can stretch that. */
const LOOKBACK = 6 * 86400000

/** A payout can be a little less than the sales (card and wallet fees); never more. */
const FEE_ALLOWANCE = 0.04

export interface Sale { id: string; at: number; amount: number }

/**
 * Which sales a payout of `amount` covers. Prefers the oldest sales up to a cut-off (what a payout is), then any
 * exact combination. Returns null when nothing fits, so an unrelated bank credit is never swallowed.
 */
export function matchPayout(amount: number, sales: Sale[]): { ids: string[]; total: number } | null {
  const list = [...sales].sort((a, b) => a.at - b.at)
  if (!(amount > 0) || !list.length) return null
  const pick = (ids: string[]) => ({ ids, total: Math.round(ids.reduce((a, id) => a + list.find((x) => x.id === id)!.amount, 0) * 100) / 100 })

  // the oldest k sales add up to the payout, or to a little more than it (the fee); the closest wins
  let k = 0
  let closest = Infinity
  let run = 0
  for (let i = 0; i < list.length; i++) {
    run += list[i].amount
    const diff = run - amount
    const fits = Math.abs(diff) <= 1 || (diff > 0 && diff <= run * FEE_ALLOWANCE)
    if (fits && Math.abs(diff) <= closest) { closest = Math.abs(diff); k = i + 1 }
  }
  if (k) return pick(list.slice(0, k).map((s) => s.id))

  // otherwise an exact combination (to the rupee) of any of them
  if (list.length <= 25) {
    const target = Math.round(amount)
    const from = new Map<number, number>([[0, 0]]) // reachable total → the total before the last sale added
    const used = new Map<number, number>() // reachable total → index of that sale
    list.forEach((s, i) => {
      const v = Math.max(1, Math.round(s.amount))
      for (const sum of [...from.keys()]) {
        const next = sum + v
        if (next <= target + 1 && !from.has(next)) { from.set(next, sum); used.set(next, i) }
      }
    })
    const hit = [target, target - 1, target + 1].find((t) => t > 0 && from.has(t))
    if (hit !== undefined) {
      const ids: string[] = []
      for (let t = hit; t > 0; t = from.get(t)!) ids.push(list[used.get(t)!].id)
      return pick(ids)
    }
  }
  return null
}

export interface SettlementPlan { settlementId: string; saleIds: string[]; total: number; fee: number }

/** Every bank payout in the list that clearly covers pending sales. Pure: nothing is written. */
export function planSettlements(txns: Transaction[]): SettlementPlan[] {
  const claimed = new Set<string>()
  const plans: SettlementPlan[] = []
  const payouts = txns.filter((t) => t.paymentType === 'CREDIT' && !t.settlesIds && !t.settleSkip && !isMerchantReceipt(t) && !isTransferCategory(t.paymentCategory) && looksLikeSettlement(t))
    .sort((a, b) => a.timestamp - b.timestamp)
  for (const p of payouts) {
    const app = platformOf(`${p.paymentReceiver} ${p.note ?? ''}`)
    const pool: Sale[] = txns
      .filter((t) => isPending(t) && !claimed.has(t.id) && (!app || t.paymentApp === app) && t.timestamp <= p.timestamp + 3600000 && t.timestamp >= p.timestamp - LOOKBACK)
      .map((t) => ({ id: t.id, at: t.timestamp, amount: t.paymentAmount }))
    const m = matchPayout(p.paymentAmount, pool)
    if (!m) continue
    m.ids.forEach((id) => claimed.add(id))
    plans.push({ settlementId: p.id, saleIds: m.ids, total: m.total, fee: Math.max(0, Math.round((m.total - p.paymentAmount) * 100) / 100) })
  }
  return plans
}

function applyPlans(txns: Transaction[], plans: SettlementPlan[]): Transaction[] {
  if (!plans.length) return txns
  const bySale = new Map<string, SettlementPlan>(plans.flatMap((p) => p.saleIds.map((id) => [id, p] as const)))
  const byPayout = new Map(plans.map((p) => [p.settlementId, p]))
  const now = Date.now()
  return txns.map((t) => {
    const sale = bySale.get(t.id)
    if (sale) return { ...t, settledBy: sale.settlementId, updatedAt: now }
    const payout = byPayout.get(t.id)
    if (payout) {
      const n = payout.saleIds.length
      const fee = payout.fee > 0 ? `, ₹${payout.fee} fees` : ''
      return { ...t, paymentCategory: SELF_TRANSFER, settlesIds: payout.saleIds, note: `Payout of ${n} sale${n === 1 ? '' : 's'}${fee}${t.note ? ` · ${t.note}` : ''}`, updatedAt: now }
    }
    return t
  })
}

/**
 * A payout the app recorded itself, and the bank's own credit for it arriving later: they are one payout. The bank's entry is kept
 * (it has the real time and account) and takes over the sales; the app's own entry goes.
 */
export function mergeAutoPayouts(txns: Transaction[]): { list: Transaction[]; changed: boolean } {
  const autos = txns.filter((t) => t.autoPayout && t.settlesIds)
  if (!autos.length) return { list: txns, changed: false }
  let list = txns
  let changed = false
  for (const a of autos) {
    const real = list.find((r) => r.id !== a.id && r.paymentType === 'CREDIT' && !r.autoPayout && !r.settlesIds && !isMerchantReceipt(r) && !isTransferCategory(r.paymentCategory)
      && r.paymentAmount <= a.paymentAmount + 1 && r.paymentAmount >= a.paymentAmount * 0.96
      && r.timestamp >= a.timestamp - 6 * 3600000 && r.timestamp <= a.timestamp + 4 * 86400000
      && (!a.paymentMethodId || r.paymentMethodId === a.paymentMethodId))
    if (!real) continue
    const ids = a.settlesIds!
    list = list.filter((t) => t.id !== a.id).map((t) => {
      if (t.settledBy === a.id) return { ...t, settledBy: real.id }
      if (t.id === real.id) return { ...t, paymentCategory: SELF_TRANSFER, settlesIds: ids, note: `Payout of ${ids.length} sale${ids.length === 1 ? '' : 's'}${t.note ? ` · ${t.note}` : ''}`, updatedAt: Date.now() }
      return t
    })
    changed = true
  }
  return { list, changed }
}

/** Ties each bank payout to the sales it covers and takes it out of income. Safe to run any number of times. */
export function reconcileSettlements() {
  const all = read<Transaction[]>(KEYS.transactions, [])
  let next = all
  let n = 0
  if (all.some(isPending)) {
    const plans = planSettlements(all)
    if (plans.length) { next = applyPlans(next, plans); n += plans.length }
  }
  const merged = mergeAutoPayouts(next)
  if (merged.changed) { next = merged.list; n++ }
  if (n) write(KEYS.transactions, next)
  return n
}

/* ---------- when the bank does not say ---------- */

/** Where the shop's money lands, and what to do when the bank sends no payout message. */
export interface MerchantSettings {
  /** The bank account PhonePe and Paytm pay out into. */
  accountId: string | null
  /** The morning after sales, ask whether the payout reached the bank. */
  ask: boolean
  /** If it was not answered, mark the sales settled at `time`. */
  auto: boolean
  /** HH:MM */
  time: string
}
export const DEFAULT_MERCHANT: MerchantSettings = { accountId: null, ask: true, auto: true, time: '10:00' }
export const getMerchantSettings = (): MerchantSettings => ({ ...DEFAULT_MERCHANT, ...read<Partial<MerchantSettings>>(KEYS.merchantSettings, {}) })
export const saveMerchantSettings = (patch: Partial<MerchantSettings>) => write(KEYS.merchantSettings, { ...getMerchantSettings(), ...patch })

const startOfDay = (ts: number) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
const timeToday = (hhmm: string, now: number) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0).getTime() }

/** Sales from earlier days that are still waiting. From the day after, the bank should have been paid. */
export function dueForPayout(txns: Transaction[], now = Date.now()) {
  const today = startOfDay(now)
  return txns.filter((t) => isPending(t) && t.timestamp < today)
}

/**
 * Marks sales as paid out, and records the payout in the shop's bank account so its balance goes up. One payout per app, since
 * PhonePe and Paytm pay separately. Returns what was settled.
 */
export function settleSales(opts: { ids?: string[]; auto: boolean; now?: number } = { auto: false }) {
  const now = opts.now ?? Date.now()
  const all = read<Transaction[]>(KEYS.transactions, [])
  const pick = opts.ids ? all.filter((t) => opts.ids!.includes(t.id) && isPending(t)) : dueForPayout(all, now)
  if (!pick.length) return { count: 0, total: 0, accountId: null as string | null }
  const accountId = getMerchantSettings().accountId
  const groups = new Map<string, Transaction[]>()
  pick.forEach((t) => { const k = t.paymentApp ?? 'PhonePe Business'; groups.set(k, [...(groups.get(k) ?? []), t]) })
  const payouts: Transaction[] = []
  const settledBy = new Map<string, string>()
  for (const [app, sales] of groups) {
    const id = `payout_${now.toString(36)}_${payouts.length}`
    const total = Math.round(sales.reduce((a, t) => a + t.paymentAmount, 0) * 100) / 100
    sales.forEach((t) => settledBy.set(t.id, id))
    payouts.push({
      id, timestamp: now, paymentAmount: total, paymentType: 'CREDIT', paymentReceiver: `${app.replace(' Business', '')} payout`, paymentCategory: SELF_TRANSFER,
      ...(accountId ? { paymentMethodId: accountId, paymentSource: 'BANK' as const } : {}), paymentApp: app,
      settlesIds: sales.map((t) => t.id), autoPayout: true, note: `Payout of ${sales.length} sale${sales.length === 1 ? '' : 's'} · ${opts.auto ? 'settled automatically' : 'confirmed by you'}`,
      createdAt: now, updatedAt: now,
    })
  }
  write(KEYS.transactions, [...payouts, ...all.map((t) => (settledBy.has(t.id) ? { ...t, settledBy: settledBy.get(t.id), updatedAt: now } : t))])
  return { count: pick.length, total: pick.reduce((a, t) => a + t.paymentAmount, 0), accountId }
}

export const snoozeSettlement = (until: number) => write(KEYS.settleSnooze, until)
const snoozedUntil = () => read<number>(KEYS.settleSnooze, 0)

/** The morning prompt is due: there are earlier sales still waiting, the user has not said "not yet" today, and it is before the auto time. */
export function payoutQuestion(txns: Transaction[], now = Date.now()) {
  const s = getMerchantSettings()
  const due = dueForPayout(txns, now)
  if (!due.length || !s.ask || snoozedUntil() > now) return null
  return { due, total: due.reduce((a, t) => a + t.paymentAmount, 0), since: due.reduce((a, t) => Math.min(a, t.timestamp), Infinity), accountId: s.accountId, autoAt: s.auto ? timeToday(s.time, now) : null }
}

/** At the set time, settle what was not answered. Called while the app is open (every minute) and when it opens. */
export function runAutoSettle(now = Date.now()) {
  const s = getMerchantSettings()
  if (!s.auto || now < timeToday(s.time, now) || snoozedUntil() > now) return null
  const r = settleSales({ auto: true, now })
  return r.count ? r : null
}

/** Sales waiting for their payout: how many, how much, and since when. */
export function pendingSummary(txns: Transaction[]) {
  const p = txns.filter(isPending)
  return { count: p.length, total: p.reduce((a, t) => a + t.paymentAmount, 0), since: p.reduce((a, t) => Math.min(a, t.timestamp), Infinity) }
}

/**
 * The user says this bank credit is a payout, but the app could not match it (a sale notification was missed).
 * It covers the oldest pending sales that fit; whatever is left over was a sale the app never heard about, so it
 * is kept as income instead of being lost.
 */
export function markAsPayout(settlementId: string) {
  const all = read<Transaction[]>(KEYS.transactions, [])
  const p = all.find((t) => t.id === settlementId)
  if (!p || p.paymentType !== 'CREDIT') return null
  const pending = all.filter((t) => isPending(t) && t.timestamp <= p.timestamp + 3600000).sort((a, b) => a.timestamp - b.timestamp)
  const ids: string[] = []
  let run = 0
  for (const s of pending) { if (run + s.paymentAmount > p.paymentAmount + 0.5) break; run += s.paymentAmount; ids.push(s.id) }
  const leftover = Math.round((p.paymentAmount - run) * 100) / 100
  const now = Date.now()
  const out = all.map((t) => {
    if (ids.includes(t.id)) return { ...t, settledBy: p.id, updatedAt: now }
    if (t.id === p.id) return { ...t, paymentCategory: SELF_TRANSFER, settlesIds: ids, settleSkip: undefined, note: `Payout of ${ids.length} sale${ids.length === 1 ? '' : 's'}${t.note ? ` · ${t.note}` : ''}`, updatedAt: now }
    return t
  })
  if (leftover >= 1) {
    out.unshift({ id: `${p.id}-unnoticed`, timestamp: p.timestamp, paymentAmount: leftover, paymentType: 'CREDIT', paymentReceiver: 'Business sales (no notification)', paymentCategory: BUSINESS, paymentApp: platformOf(`${p.paymentReceiver} ${p.note ?? ''}`) ?? undefined, settledBy: p.id, createdAt: now, updatedAt: now })
  }
  write(KEYS.transactions, out)
  return { covered: ids.length, leftover }
}

/** Not a payout after all: back to ordinary income, and the sales it covered wait again. */
export function undoPayout(settlementId: string) {
  const all = read<Transaction[]>(KEYS.transactions, [])
  const p = all.find((t) => t.id === settlementId)
  if (!p) return
  const now = Date.now()
  write(KEYS.transactions, all
    .filter((t) => t.id !== `${p.id}-unnoticed`)
    .map((t) => {
      if (t.settledBy === settlementId) return { ...t, settledBy: undefined, updatedAt: now }
      if (t.id === settlementId) return { ...t, paymentCategory: BUSINESS, settlesIds: undefined, settleSkip: true, note: t.note?.replace(/^Payout of [^·]*(?: · )?/, '') || undefined, updatedAt: now }
      return t
    }))
}
