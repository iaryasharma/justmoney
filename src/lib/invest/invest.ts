// Investments (stocks, IPOs, mutual funds, FD/RD, gold, PPF/NPS, crypto) and net worth.
import { read, write, uid, KEYS } from '../core/storage'
import { addTransaction, updateTransaction } from '../core/data'
import { cachedPrice } from './prices'
import { accountBalance, cardSpentThisMonth, SELF_TRANSFER, tracksBalance } from '../accounts/accounts'
import { cashInHand } from '../accounts/cash'
import { behalfPeople } from '../accounts/behalf'
import { loanTotals } from '../payees/loans'
import type { EmiPlan, Investment, InvestmentFlow, Loan, InvestmentType, NetWorthPoint, PaymentMethod, Transaction } from '../core/types'

export const INVESTMENT_TYPES: { type: InvestmentType; label: string; color: string }[] = [
  { type: 'STOCK', label: 'Stocks', color: '#0A84FF' },
  { type: 'IPO', label: 'IPO', color: '#5E5CE6' },
  { type: 'MF', label: 'Mutual funds', color: '#30D158' },
  { type: 'FD', label: 'Fixed deposit', color: '#00C7BE' },
  { type: 'RD', label: 'Recurring deposit', color: '#64D2FF' },
  { type: 'GOLD', label: 'Gold', color: '#FFD60A' },
  { type: 'PPF', label: 'PPF', color: '#FF9F0A' },
  { type: 'NPS', label: 'NPS', color: '#BF5AF2' },
  { type: 'CRYPTO', label: 'Crypto', color: '#FF375F' },
  { type: 'OTHER', label: 'Other', color: '#8E8E93' },
]
export const typeMeta = (t: InvestmentType) => INVESTMENT_TYPES.find((x) => x.type === t) ?? INVESTMENT_TYPES[INVESTMENT_TYPES.length - 1]

const YEAR = 365.25 * 86400000

/**
 * Value today. FD/RD/PPF with a rate and start date grow by compound interest
 * (quarterly for FD/RD as Indian banks do, yearly for PPF), stopping at maturity.
 * Everything else uses the value the user last entered.
 */
export function valueOf(inv: Investment, now = Date.now()) {
  if (inv.closedAt) return 0
  // a listed share with a symbol and a count is worth what the market says
  const live = inv.symbol && inv.units ? cachedPrice(inv) : undefined
  if (live) return inv.units! * live.price
  if ((inv.type === 'FD' || inv.type === 'RD' || inv.type === 'PPF') && inv.rate && inv.startDate) {
    const end = inv.maturityDate ? Math.min(now, inv.maturityDate) : now
    const years = Math.max(0, (end - inv.startDate) / YEAR)
    const r = inv.rate / 100
    return inv.type === 'PPF' ? inv.invested * Math.pow(1 + r, years) : inv.invested * Math.pow(1 + r / 4, 4 * years)
  }
  return inv.currentValue
}

/** IPO money is only blocked in the bank until allotment, so it isn't counted twice. */
export const countsTowardsWorth = (inv: Investment) => !inv.closedAt && !(inv.type === 'IPO' && inv.ipoStatus !== 'ALLOTTED')

export function portfolio(list: Investment[]) {
  const held = list.filter(countsTowardsWorth)
  const invested = held.reduce((a, i) => a + i.invested, 0)
  const value = held.reduce((a, i) => a + valueOf(i), 0)
  return { invested, value, gain: value - invested, gainPct: invested ? ((value - invested) / invested) * 100 : 0 }
}

/** Buying from a bank account moves money into investments: a self transfer, not spending. */
export function addInvestment(inv: Omit<Investment, 'id' | 'createdAt' | 'updatedAt'>, fromAccountId?: string | null) {
  const full: Investment = { ...inv, id: uid(), createdAt: Date.now(), updatedAt: Date.now(), flows: inv.flows ?? (inv.invested > 0 ? [{ id: uid(), date: inv.startDate ?? Date.now(), amount: inv.invested, kind: 'IN' }] : []) }
  write(KEYS.investments, [...read<Investment[]>(KEYS.investments, []), full])
  if (fromAccountId && inv.invested > 0 && inv.type !== 'IPO') {
    addTransaction({ paymentAmount: inv.invested, paymentType: 'DEBIT', paymentReceiver: `Invested: ${inv.name}`, paymentCategory: SELF_TRANSFER, paymentMethodId: fromAccountId, note: '#investment' })
  }
  return full
}

/**
 * Selling / redeeming. The part of the sale that returns what was put in is a self
 * transfer back to the account; only the profit is income (Stocks & IPO, or Interest
 * for deposits). A loss simply returns less.
 */
export function sellInvestment(id: string, received: number, fraction: number, toAccountId?: string | null) {
  const list = read<Investment[]>(KEYS.investments, [])
  const inv = list.find((x) => x.id === id)
  if (!inv) return null
  const f = Math.min(1, Math.max(0, fraction))
  const principal = inv.invested * f
  const profit = received - principal
  if (toAccountId) {
    const back = Math.min(received, principal)
    if (back > 0) addTransaction({ paymentAmount: Math.round(back * 100) / 100, paymentType: 'CREDIT', paymentReceiver: `Redeemed: ${inv.name}`, paymentCategory: SELF_TRANSFER, paymentMethodId: toAccountId, note: '#investment' })
    if (profit > 0) {
      const deposit = inv.type === 'FD' || inv.type === 'RD' || inv.type === 'PPF'
      addTransaction({ paymentAmount: Math.round(profit * 100) / 100, paymentType: 'CREDIT', paymentReceiver: inv.name, paymentCategory: deposit ? 'Interest' : 'Stocks & IPO', paymentMethodId: toAccountId, note: '#investment profit' })
    }
  }
  const out: InvestmentFlow = { id: uid(), date: Date.now(), amount: received, kind: 'OUT' }
  const rest = list.map((x) => (x.id !== id ? x : f >= 0.999
    ? { ...x, flows: [...flowsOf(x), out], closedAt: Date.now(), updatedAt: Date.now() }
    : { ...x, flows: [...flowsOf(x), out], invested: x.invested - principal, currentValue: Math.max(0, valueOf(x) * (1 - f)), units: x.units != null ? x.units * (1 - f) : x.units, updatedAt: Date.now() }))
  write(KEYS.investments, rest)
  return { profit }
}

/* ---------- net worth ---------- */

export function netWorth(methods: PaymentMethod[], txns: Transaction[], investments: Investment[], emis: EmiPlan[], loans: Loan[] = read<Loan[]>(KEYS.loans, [])) {
  const accounts = methods.filter(tracksBalance).reduce((a, m) => a + accountBalance(m, txns), 0)
  const invest = portfolio(investments).value
  const emiDue = emis.reduce((a, e) => a + Math.max(0, e.months - e.paidCount) * e.monthlyAmount, 0)
  const cardDue = methods.filter((m) => m.type === 'CREDIT_CARD').reduce((a, m) => a + Math.max(0, cardSpentThisMonth(m, txns)), 0)
  const { owedToYou, youOwe } = loanTotals(loans)
  // cash in hand is yours; money held for someone (On behalf) is theirs, and what they owe you for purchases is yours
  const cash = Math.max(0, cashInHand(txns).balance)
  const behalf = behalfPeople(txns)
  const heldForOthers = behalf.reduce((a, p) => a + Math.max(0, p.balance), 0)
  const owedForPurchases = behalf.reduce((a, p) => a + Math.max(0, -p.balance), 0)
  const assets = accounts + cash + invest + owedToYou + owedForPurchases
  const liabilities = emiDue + cardDue + youOwe + heldForOthers
  return { accounts: accounts + cash, invest, emiDue, cardDue, owedToYou: owedToYou + owedForPurchases, youOwe: youOwe + heldForOthers, assets, liabilities, total: assets - liabilities }
}

/** Keeps one net-worth point per month (the latest value seen that month) for the trend. */
export function recordNetWorth(value: number) {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const hist = read<NetWorthPoint[]>(KEYS.netWorthHistory, []).filter((p) => p.month !== month)
  const next = [...hist, { month, value: Math.round(value) }].sort((a, b) => a.month.localeCompare(b.month)).slice(-24)
  const prev = read<NetWorthPoint[]>(KEYS.netWorthHistory, [])
  if (JSON.stringify(prev) !== JSON.stringify(next)) write(KEYS.netWorthHistory, next)
  return next
}

/* ---------- the money trail of one investment ---------- */

/** Dated money in and out. Investments saved before the ledger existed have one buy for what is invested. */
export const flowsOf = (inv: Investment): InvestmentFlow[] => inv.flows ?? (inv.invested > 0 ? [{ id: `${inv.id}-in`, date: inv.startDate ?? inv.createdAt, amount: inv.invested, kind: 'IN' }] : [])

/** Annualised return of dated flows (XIRR), or null when it cannot be worked out. */
export function xirr(flows: { date: number; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null
  const t0 = Math.min(...flows.map((f) => f.date))
  const npv = (r: number) => flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, (f.date - t0) / YEAR), 0)
  let lo = -0.9999, hi = 100
  if (npv(lo) * npv(hi) > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid
  }
  return (lo + hi) / 2
}

/** How an investment has done: money in, money back, what it is worth, profit, how long, and per year. */
export function investmentResult(inv: Investment, now = Date.now()) {
  const flows = flowsOf(inv)
  const put = flows.filter((f) => f.kind === 'IN').reduce((a, f) => a + f.amount, 0)
  const back = flows.filter((f) => f.kind === 'OUT').reduce((a, f) => a + f.amount, 0)
  const worth = inv.closedAt ? 0 : valueOf(inv, now)
  const profit = back + worth - put
  const first = flows.length ? Math.min(...flows.map((f) => f.date)) : inv.createdAt
  const end = inv.closedAt ?? now
  const cf = [...flows.map((f) => ({ date: f.date, amount: f.kind === 'IN' ? -f.amount : f.amount })), ...(worth > 0 ? [{ date: now, amount: worth }] : [])]
  const days = Math.max(0, Math.round((end - first) / 86400000))
  return { put, back, worth, profit, pct: put ? (profit / put) * 100 : 0, days, perYear: days >= 30 ? xirr(cf) : null, closed: !!inv.closedAt }
}

/** A payment out of your account that was put into an investment: moving your own money, not spending. */
export function linkInvestmentBuy(tx: { id: string; paymentAmount: number; timestamp: number }, invId: string) {
  const list = read<Investment[]>(KEYS.investments, [])
  write(KEYS.investments, list.map((x) => (x.id !== invId ? x : {
    ...x, invested: x.invested + tx.paymentAmount, currentValue: x.currentValue + tx.paymentAmount, closedAt: null, updatedAt: Date.now(),
    flows: [...flowsOf(x), { id: uid(), date: tx.timestamp, amount: tx.paymentAmount, kind: 'IN' as const, txId: tx.id }],
  })))
  updateTransaction(tx.id, { paymentCategory: SELF_TRANSFER, investmentId: invId })
}

/** A new investment started from the payment that funded it. */
export function createInvestmentFromTx(tx: { id: string; paymentAmount: number; timestamp: number }, d: { name: string; type: InvestmentType; symbol?: string | null; exchange?: 'NSE' | 'BSE' | null; units?: number | null }) {
  const id = uid()
  const inv: Investment = {
    id, type: d.type, name: d.name.trim(), invested: 0, currentValue: 0, units: d.units ?? null, symbol: d.symbol?.trim().toUpperCase() || null, exchange: d.symbol ? d.exchange ?? 'NSE' : null,
    ipoStatus: d.type === 'IPO' ? 'APPLIED' : null, flows: [], createdAt: Date.now(), updatedAt: Date.now(),
  }
  write(KEYS.investments, [...read<Investment[]>(KEYS.investments, []), inv])
  linkInvestmentBuy(tx, id)
  return id
}

/**
 * A payment into your account that was an investment coming back. `fraction` is how much of the holding it was
 * (1 closes it). The whole payment counts as your own money returning; the profit shows on the investment.
 */
export function linkInvestmentReturn(tx: { id: string; paymentAmount: number; timestamp: number }, invId: string, fraction: number) {
  const f = Math.min(1, Math.max(0, fraction))
  const list = read<Investment[]>(KEYS.investments, [])
  write(KEYS.investments, list.map((x) => {
    if (x.id !== invId) return x
    const flows = [...flowsOf(x), { id: uid(), date: tx.timestamp, amount: tx.paymentAmount, kind: 'OUT' as const, txId: tx.id }]
    if (f >= 0.999) return { ...x, flows, closedAt: tx.timestamp, updatedAt: Date.now() }
    return { ...x, flows, invested: x.invested * (1 - f), currentValue: Math.max(0, valueOf(x) * (1 - f)), units: x.units != null ? x.units * (1 - f) : x.units, updatedAt: Date.now() }
  }))
  updateTransaction(tx.id, { paymentCategory: SELF_TRANSFER, investmentId: invId })
}
