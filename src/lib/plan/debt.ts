// Debt payoff: the same total monthly payment, aimed either at the highest interest rate first
// (avalanche — least interest) or the smallest balance first (snowball — quickest wins).
export interface Debt { id: string; name: string; balance: number; minimum: number; /** annual interest, % */ rate: number }
export type Strategy = 'avalanche' | 'snowball'
export interface Payoff { months: number; interest: number; order: { name: string; month: number }[]; never: boolean }

const MAX_MONTHS = 600

export function simulate(debts: Debt[], extra: number, strategy: Strategy): Payoff {
  const live = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }))
  const order: Payoff['order'] = []
  if (!live.length) return { months: 0, interest: 0, order, never: false }
  // one fixed budget every month: all minimums plus the extra (cleared debts' minimums roll into the target)
  const budget = live.reduce((a, d) => a + d.minimum, 0) + Math.max(0, extra)
  let interest = 0
  let month = 0
  while (live.some((d) => d.balance > 0.005) && month < MAX_MONTHS) {
    month++
    for (const d of live) if (d.balance > 0) { const i = d.balance * (d.rate / 1200); d.balance += i; interest += i }
    let pool = budget
    for (const d of live) if (d.balance > 0) { const pay = Math.min(d.minimum, d.balance, pool); d.balance -= pay; pool -= pay }
    const target = [...live].filter((d) => d.balance > 0.005).sort((a, b) => (strategy === 'avalanche' ? b.rate - a.rate || a.balance - b.balance : a.balance - b.balance))
    for (const d of target) { if (pool <= 0) break; const pay = Math.min(d.balance, pool); d.balance -= pay; pool -= pay }
    for (const d of live) if (d.balance <= 0.005 && !order.some((o) => o.name === d.name)) { d.balance = 0; order.push({ name: d.name, month }) }
  }
  const never = live.some((d) => d.balance > 0.005)
  return { months: month, interest: Math.round(interest), order, never }
}

export const payoffDate = (months: number, now = new Date()) => new Date(now.getFullYear(), now.getMonth() + months, 1)
