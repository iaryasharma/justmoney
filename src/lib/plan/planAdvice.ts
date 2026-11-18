// Suggestions about the plan, the pots and the shop, in plain words. These are worked out on the phone from the user's own numbers;
// when AI is switched on, the same numbers (never names) can be sent for a more personal take.
import { read, KEYS } from '../core/storage'
import { isPersonalSpend, committedCategories } from '../core/money'
import { creditTotals, getCredits } from '../payees/udhaar'
import { currentPlan, getPlanSettings, goalPace, goalShares, incomeMode, monthPlan, shopSummary, sinkingNeed, getSinking, savedThisMonth, type MonthPlan } from './plan'
import { dueForPayout, pendingSummary } from '../payees/merchant'
import { getAllocations, getMoves, getPots, lastIncome, potBalances, runway } from './pots'
import { formatPrice } from '../core/format'
import type { Commitment, Insight, SavingsGoal, Transaction } from '../core/types'

export type AdviceArea = 'plan' | 'pots' | 'shop'
export interface Advice extends Insight { area: AdviceArea; weight: number; tone: 'good' | 'warn' | 'bad' }

const money = (n: number) => formatPrice(Math.abs(n), { round: true })
const DAY = 86400000

export interface AdviceContext {
  txns: Transaction[]
  commitments: Commitment[]
  goals: SavingsGoal[]
  now: Date
}

export const adviceContext = (txns: Transaction[], now = new Date()): AdviceContext => ({
  txns, now, commitments: read<Commitment[]>(KEYS.commitments, []), goals: read<SavingsGoal[]>(KEYS.savingsGoals, []),
})

/** The month's spending by category, personal spending only. */
function byCategory(txns: Transaction[], committed: Set<string>, now: Date) {
  const m = new Map<string, number>()
  for (const t of txns) {
    const d = new Date(t.timestamp)
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && isPersonalSpend(t, committed)) m.set(t.paymentCategory, (m.get(t.paymentCategory) ?? 0) + t.paymentAmount)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export function localAdvice(c: AdviceContext): Advice[] {
  const out: Advice[] = []
  const add = (area: AdviceArea, weight: number, tone: Advice['tone'], suggestion: string, tip: string) => out.push({ area, weight, tone, suggestion, tip })
  const settings = getPlanSettings()
  const mode = incomeMode(settings, c.txns, c.now.getTime())
  const plan = currentPlan(c.txns, c.now.getFullYear(), c.now.getMonth(), c.commitments)
  const committed = committedCategories(c.commitments)
  const monthEnd = new Date(c.now.getFullYear(), c.now.getMonth() + 1, 0).getDate()
  const frac = c.now.getDate() / monthEnd
  const cats = byCategory(c.txns, committed, c.now)
  const spentTotal = cats.reduce((a, [, v]) => a + v, 0)

  if (mode !== 'INCOME' && plan.limit > 0) {
    if (plan.status === 'over') add('plan', 100, 'bad', 'You are over this month’s plan', `${money(plan.spent - plan.limit)} over. Going further dips into the ${money(plan.saveTarget)} you meant to save. ${cats[0] ? `${cats[0][0]} is the biggest spend (${money(cats[0][1])}); cutting it back is the easiest place to start.` : ''}`)
    else if (plan.status === 'ahead') {
      const pace = Math.round(plan.spent / Math.max(0.05, frac))
      add('plan', 80, 'warn', 'You are spending faster than the month', `${Math.round((plan.spent / plan.limit) * 100)}% of the plan is used with ${Math.round(frac * 100)}% of the month gone. At this pace you would end about ${money(pace - plan.limit)} over. About ${money(plan.perDay)} a day keeps you inside it.`)
    } else if (plan.isCurrent && frac >= 0.7 && plan.spent < plan.limit * 0.6) {
      add('plan', 30, 'good', 'You are ahead of your plan', `Only ${Math.round((plan.spent / plan.limit) * 100)}% used with most of the month gone. If it stays like this, about ${money(plan.limit - plan.spent)} goes to your savings when the month closes.`)
    }
    const saved = savedThisMonth(c.now.getFullYear(), c.now.getMonth())
    if (plan.saveTarget > 0 && saved < plan.saveTarget && c.now.getDate() >= 5) add('plan', 60, 'warn', 'Set your saving aside first', `${money(plan.saveTarget - saved)} of this month’s saving is not set aside yet. Money set aside early is hard to spend by accident.`)
  }

  if (cats[0] && spentTotal > 0 && cats[0][1] / spentTotal >= 0.35 && mode !== 'INCOME') {
    add('plan', 50, 'warn', `${cats[0][0]} takes ${Math.round((cats[0][1] / spentTotal) * 100)}% of your spending`, `${money(cats[0][1])} this month. Trimming it by 15% frees ${money(cats[0][1] * 0.15)}, which could go straight to savings.`)
  }
  const repeat = new Map<string, { n: number; a: number }>()
  for (const t of c.txns) {
    const d = new Date(t.timestamp)
    if (d.getFullYear() === c.now.getFullYear() && d.getMonth() === c.now.getMonth() && isPersonalSpend(t, committed) && t.paymentAmount < 1000) {
      const e = repeat.get(t.paymentReceiver) ?? { n: 0, a: 0 }; e.n++; e.a += t.paymentAmount; repeat.set(t.paymentReceiver, e)
    }
  }
  const top = [...repeat.entries()].sort((a, b) => b[1].a - a[1].a)[0]
  if (top && top[1].n >= 5) add('plan', 40, 'warn', `${top[0]}: small payments add up`, `${top[1].n} payments came to ${money(top[1].a)} this month. Small repeat spends are the easiest to trim without feeling it.`)

  // the emergency fund
  const fund = c.goals.find((g) => g.emergency)
  const essentials = plan.committed + plan.limit
  if (essentials > 0) {
    const months = fund ? fund.saved / essentials : 0
    if (months < 1) add('plan', 45, 'warn', fund ? 'Your emergency fund is thin' : 'Start an emergency fund', `${fund ? `It covers about ${months.toFixed(1)} month of family, bills and everyday spending.` : 'You have none yet.'} Aim for ${settings.emergencyMonths} months: about ${money(Math.max(0, essentials * settings.emergencyMonths - (fund?.saved ?? 0)))} more. A share of every saving goes there once you turn it on in the plan.`)
  }
  // goals that need more than they get
  const shares = goalShares(plan, c.goals)
  for (const g of c.goals) {
    if (g.emergency) continue
    const p = goalPace(g, shares.get(g.id) ?? 0)
    if (p && !p.ok) add('plan', 55, 'warn', `${g.name} is behind schedule`, `It needs ${money(p.need)} a month for ${p.months} month${p.months === 1 ? '' : 's'}, and the plan gives about ${money(p.gets)}. Save a little more or move the date.`)
  }
  // a yearly cost coming up
  for (const f of getSinking()) {
    const left = (f.dueAt - c.now.getTime()) / DAY
    if (left > 0 && left <= 60 && f.saved < f.amount * 0.8) add('plan', 35, 'warn', `${f.name} is due soon`, `${money(f.amount - f.saved)} is still missing, due in about ${Math.ceil(left / 30)} month${left > 45 ? 's' : ''}. ${money(sinkingNeed(f, c.now))} a month would cover it.`)
  }

  // planned by income: pots
  if (mode === 'INCOME') {
    const bal = potBalances(getPots(), getAllocations(), getMoves(), c.txns, c.commitments)
    const personal = bal.find((b) => b.pot.id === 'personal')
    const li = lastIncome(c.txns, getAllocations(), c.now.getTime())
    const r = runway(bal, c.goals, c.txns, c.now.getTime())
    if (personal && personal.allocated > 0) {
      if (personal.left < 0) add('pots', 100, 'bad', 'Your personal pot is used up', 'Move money from another pot, or hold back until income arrives. Using savings should be for essentials only.')
      else if (personal.left <= personal.allocated * 0.2) add('pots', 90, 'warn', 'Your personal pot is running low', `${money(personal.left)} is left of ${money(personal.allocated)}. At your usual pace it lasts about ${r.daily > 0 ? Math.floor(personal.left / r.daily) : '–'} more days.`)
    }
    if (li.days !== null && li.days >= 35) add('pots', 85, 'warn', `No income for ${li.days} days`, `${r.days !== null ? `What is in your pots lasts about ${r.days} days; with savings, about ${r.withSavings}. ` : ''}Keep savings for essentials (food, rent, bills), and put off anything that can wait for the next income.`)
    if (!personal) add('pots', 50, 'good', 'Plan by income', 'When money comes in, split it between family, bills, saving and your own spending. It works even when pay is late.')
  }

  // the shop
  if (mode === 'VARIABLE') {
    const shop = shopSummary(c.txns, c.now.getFullYear(), c.now.getMonth())
    const pend = pendingSummary(c.txns)
    const old = dueForPayout(c.txns, c.now.getTime())
    if (old.length && c.now.getTime() - Math.min(...old.map((t) => t.timestamp)) > 3 * DAY) add('shop', 70, 'warn', 'A payout is overdue', `${money(old.reduce((a, t) => a + t.paymentAmount, 0))} of sales has been with PhonePe or Paytm for more than 3 days. Check the app, or tell JustMoney if it reached your bank.`)
    const cr = creditTotals(getCredits(), c.now.getTime())
    if (cr.overdue > 0) add('shop', 65, 'warn', 'Customers are late paying', `${money(cr.overdue)} is overdue. A polite reminder this week is usually enough.`)
    else if (cr.owed > shop.sales * 0.3 && cr.owed > 0) add('shop', 45, 'warn', 'A lot is sold on credit', `${money(cr.owed)} is owed, about ${Math.round((cr.owed / Math.max(1, shop.sales)) * 100)}% of this month’s sales. It is not income until it is paid.`)
    if (shop.sales > 0 && shop.costs / shop.sales > 0.7) add('shop', 60, 'warn', 'Costs are eating the sales', `Shop costs are ${Math.round((shop.costs / shop.sales) * 100)}% of sales this month, leaving ${money(shop.profit)}. Look at stock and the biggest cost first.`)
    if (plan.setAside > 0 && shop.sales > 0) add('shop', 30, 'good', 'Keep your tax money aside', `${money(plan.setAside)} of this month’s plan is for tax and stock. Moving it to a separate account keeps it from being spent.`)
    if (pend.count > 0 && !old.length) add('shop', 20, 'good', 'Sales are on their way to the bank', `${money(pend.total)} is with PhonePe or Paytm and should be paid out soon.`)
    if (plan.notes.some((n) => n.startsWith('Sales are slower'))) add('shop', 75, 'warn', 'Sales are slower than usual', 'Spend less than the plan allows until they pick up, and lean on the cushion only if you must.')
  }

  return out.sort((a, b) => b.weight - a.weight)
}

/** The numbers an AI coach needs, with no names of people, shops or goals. */
export function adviceSummary(c: AdviceContext): string {
  const settings = getPlanSettings()
  const mode = incomeMode(settings, c.txns, c.now.getTime())
  const plan: MonthPlan = currentPlan(c.txns, c.now.getFullYear(), c.now.getMonth(), c.commitments)
  const committed = committedCategories(c.commitments)
  const cats = byCategory(c.txns, committed, c.now).slice(0, 6).map(([k, v]) => `${k}: ${Math.round(v)}`)
  const lines = [
    `Mode: ${mode === 'INCOME' ? 'planned per income (pay can be late)' : mode === 'VARIABLE' ? 'runs a shop with irregular income' : 'fixed monthly income'}.`,
    `Day ${c.now.getDate()} of ${new Date(c.now.getFullYear(), c.now.getMonth() + 1, 0).getDate()}.`,
    `Plan this month: income ${plan.income}, family and bills ${plan.committed}, saving target ${plan.saveTarget}, limit to spend ${plan.limit}, spent ${plan.spent}, left ${plan.left}.`,
    `Saving rate ${settings.saveRate}% of what is left after bills; emergency fund share ${settings.emergencyShare}%.`,
    `Spending by category this month: ${cats.join(', ') || 'none yet'}.`,
    `Goals: ${c.goals.map((g) => `${g.emergency ? 'emergency fund' : 'goal'} ${Math.round(g.saved)} of ${Math.round(g.target)}${g.deadline ? ` by ${new Date(g.deadline).toISOString().slice(0, 7)}` : ''}`).join('; ') || 'none'}.`,
  ]
  if (mode === 'INCOME') {
    const bal = potBalances(getPots(), getAllocations(), getMoves(), c.txns, c.commitments)
    const li = lastIncome(c.txns, getAllocations(), c.now.getTime())
    const r = runway(bal, c.goals, c.txns, c.now.getTime())
    lines.push(`Pots left: ${bal.map((b) => `${b.pot.kind} ${Math.round(b.left)} of ${Math.round(b.allocated)}`).join(', ') || 'none'}. Days since last income: ${li.days ?? 'none'}. Pots last about ${r.days ?? 'unknown'} days, ${r.withSavings ?? 'unknown'} with savings.`)
  }
  if (mode === 'VARIABLE') {
    const shop = shopSummary(c.txns, c.now.getFullYear(), c.now.getMonth())
    const pend = pendingSummary(c.txns)
    lines.push(`Shop this month: sales ${shop.sales}, costs ${shop.costs}, kept ${shop.profit}. Waiting for payout ${Math.round(pend.total)}. Customers owe ${Math.round(creditTotals(getCredits()).owed)}.`)
  }
  return lines.join('\n')
}

export { monthPlan }
