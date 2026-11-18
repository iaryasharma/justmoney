// Browser stand-in for the original's scheduled native notifications.
// While the app is open (or installed as a PWA and running), this checks once
// a minute for reminders whose time has arrived and fires a Notification.
import { read, write, KEYS } from '../core/storage'
import { isNativeApp } from '../core/native'
import { isTransferCategory } from '../accounts/accounts'
import { nativeNotificationsGranted, notifyNow, requestNativePermission } from './nativeNotify'
import { formatPrice, formatTime12, ordinal } from '../core/format'
import { detectRecurring } from '../payees/recurring'
import { openRoute, ROUTES, type NotifyRoute } from './notifyRoute'
import { currentPlan, getPlanSettings, incomeMode, savedThisMonth } from '../plan/plan'
import { lastIncome, potsPlan } from '../plan/pots'
import { getMerchantSettings, payoutQuestion } from '../payees/merchant'
import type { CategoryBudgets, Commitment, EmiPlan, NotificationPrefs, PaymentReminder, Transaction } from '../core/types'

const FIRED_KEY = '@NotificationsFired'
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export { WEEKDAYS }

export const DEFAULT_PREFS: NotificationPrefs = { daily: true, weekly: true, bimonthly: true, monthly: true }

export function reminderSubtitle(r: PaymentReminder) {
  const t = formatTime12(r.time)
  if (r.type === 'DAILY') return `Every day at ${t}`
  if (r.type === 'WEEKLY') return `Every ${WEEKDAYS[r.dayOfWeek ?? 0]} at ${t}`
  return `Every ${ordinal(r.dayOfMonth ?? 1)} at ${t}`
}

export const notificationsSupported = () => isNativeApp() || typeof Notification !== 'undefined'
export const notificationsGranted = () =>
  isNativeApp() ? nativeNotificationsGranted() : typeof Notification !== 'undefined' && Notification.permission === 'granted'
export async function requestNotificationPermission() {
  if (isNativeApp()) return requestNativePermission()
  if (typeof Notification === 'undefined') return false
  return (await Notification.requestPermission()) === 'granted'
}

/** Fires a notification right away, on whichever platform this is (native alarm service or a web Notification). */
export function notifyImmediate(title: string, body: string, key: string, route?: NotifyRoute) {
  if (isNativeApp()) { notifyNow(key, title, body, route); return }
  if (!notificationsGranted()) return
  try {
    const n = new Notification(title, { body, icon: '/icon.svg' })
    n.onclick = () => { window.focus(); openRoute(route); n.close() }
  } catch {
    navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body, icon: '/icon.svg', data: { route } }))
  }
}

interface Due { key: string; title: string; body: string; route?: NotifyRoute }

function atTime(d: Date, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
}
const dayStamp = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/**
 * Browser: everything due now. Android app: only budget alerts, which depend on what was just
 * added; time-based reminders are scheduled natively (nativeNotify.ts) so they fire while closed.
 */
function collectDue(now: Date, budgetsOnly = false): Due[] {
  const out: Due[] = []
  const today = dayStamp(now)
  const ts = now.getTime()
  const isPast = (when: number) => ts >= when && ts - when < 6 * 3600000 // fire within 6h of the slot

  for (const r of budgetsOnly ? [] : read<PaymentReminder[]>(KEYS.reminders, [])) {
    if (!r.enabled) continue
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const matches = r.type === 'DAILY'
      || (r.type === 'WEEKLY' && now.getDay() === (r.dayOfWeek ?? 0))
      || (r.type === 'MONTHLY' && now.getDate() === Math.min(r.dayOfMonth ?? 1, lastDay))
    if (matches && isPast(atTime(now, r.time))) out.push({ key: `rem-${r.id}-${today}`, title: 'Payment Reminder', body: r.title, route: ROUTES.reminders })
  }

  for (const e of budgetsOnly ? [] : read<EmiPlan[]>(KEYS.emiPlans, [])) {
    if (!e.reminderEnabled || e.paidCount >= e.months) continue
    if (now.getDate() === Math.min(e.dueDay, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) && isPast(atTime(now, '09:00'))) {
      out.push({ key: `emi-${e.id}-${today}`, title: 'EMI day', body: `Today is the EMI day for ${e.name} — did you pay ${formatPrice(e.monthlyAmount)}? Mark it in JustMoney.`, route: ROUTES.emi })
    }
  }

  const card = read<{ statementDay: number; dueDay: number } | null>(KEYS.cardCycle, null)
  if (!budgetsOnly && card?.dueDay && now.getDate() === (card.dueDay - 2 < 1 ? 28 : Math.min(card.dueDay - 2, 28)) && isPast(atTime(now, '10:00'))) {
    out.push({ key: `card-due-${today}`, title: 'Credit card payment due soon', body: `Your card payment is due on the ${ordinal(card.dueDay)}. Pay it on time to avoid interest.`, route: ROUTES.card })
  }

  const auto = read<{ enabledKeys: string[]; leadDays: number }>(KEYS.autoDebit, { enabledKeys: [], leadDays: 3 })
  if (!budgetsOnly && auto.enabledKeys.length) {
    for (const r of detectRecurring(read<Transaction[]>(KEYS.transactions, []))) {
      if (r.ended || !auto.enabledKeys.includes(r.key)) continue
      const due = new Date(r.nextDueAt)
      const fire = new Date(due.getFullYear(), due.getMonth(), due.getDate() - auto.leadDays, 9).getTime()
      if (isPast(fire)) {
        out.push({ key: `autodebit-${r.key}-${dayStamp(due)}`, title: 'Upcoming auto-debit', body: `Your ${r.receiver} payment of ${formatPrice(r.amount)} is due in ${auto.leadDays} day${auto.leadDays === 1 ? '' : 's'}. Keep your balance ready.`, route: ROUTES.subs })
      }
    }
  }

  const prefs = read<NotificationPrefs>(KEYS.notificationPrefs, DEFAULT_PREFS)
  const txns = read<Transaction[]>(KEYS.transactions, [])

  // Category budgets: one alert at 80% and one when over, per category per month.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const mk = `${now.getFullYear()}-${now.getMonth() + 1}`
  for (const [cat, cap] of Object.entries(read<CategoryBudgets>(KEYS.categoryBudgets, {}))) {
    if (!(cap > 0)) continue
    const spent = txns.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === cat && t.timestamp >= monthStart).reduce((a, t) => a + t.paymentAmount, 0)
    if (spent > cap) out.push({ key: `budget-over-${cat}-${mk}`, title: `${cat} budget exceeded`, body: `You've spent ${formatPrice(spent)} of your ${formatPrice(cap)} ${cat} budget this month.`, route: ROUTES.budgets })
    else if (spent >= cap * 0.8) out.push({ key: `budget-80-${cat}-${mk}`, title: `${cat} budget at ${Math.round((spent / cap) * 100)}%`, body: `${formatPrice(cap - spent)} left for ${cat} this month.`, route: ROUTES.budgets })
  }
  // The spending plan: alerts at 80% and when over, a nudge to save first when income lands, and a heads-up near month end.
  const commitments = read<Commitment[]>(KEYS.commitments, [])
  const plan = currentPlan(txns, now.getFullYear(), now.getMonth(), commitments)
  if (incomeMode(getPlanSettings(), txns) === 'INCOME') {
    const pp = potsPlan(txns, commitments, getPlanSettings().nextIncomeAt)
    if (pp.has && pp.personal.allocated > 0) {
      const p = pp.personal
      if (p.left < 0) out.push({ key: `pot-over-${mk}-${Math.floor(p.allocated)}`, title: 'Your personal pot is used up', body: 'Move money from another pot or use savings, or hold back until income arrives.', route: ROUTES.plan })
      else if (p.left <= p.allocated * 0.2) out.push({ key: `pot-low-${mk}-${Math.floor(p.allocated)}`, title: 'Your personal pot is running low', body: `${formatPrice(p.left)} left of ${formatPrice(p.allocated)}.`, route: ROUTES.plan })
    }
    const li = lastIncome(txns)
    if (li.days !== null && li.days >= 35) out.push({ key: `income-late-${mk}`, title: `No income for ${li.days} days`, body: 'See how long your pots and savings last, and cover essentials from savings if you need to.', route: ROUTES.plan })
  } else if (plan.limit > 0) {
    if (plan.spent > plan.limit) out.push({ key: `plan-over-${mk}`, title: 'Over your spending plan', body: `${formatPrice(plan.spent)} spent of ${formatPrice(plan.limit)} this month. Going further dips into your saving.`, route: ROUTES.plan })
    else if (plan.spent >= plan.limit * 0.8) out.push({ key: `plan-80-${mk}`, title: `${Math.round((plan.spent / plan.limit) * 100)}% of your plan used`, body: `${formatPrice(plan.left)} left to spend this month.`, route: ROUTES.plan })
    const saved = savedThisMonth(now.getFullYear(), now.getMonth())
    if (plan.saveTarget > 0 && saved < plan.saveTarget && plan.income > 0 && plan.earned >= plan.income * 0.8) {
      out.push({ key: `plan-income-${mk}`, title: 'Pay yourself first', body: `Your income is in. Set aside ${formatPrice(plan.saveTarget - saved)} now, before it gets spent.`, route: ROUTES.plan })
    }
    if (now.getDate() >= 26 && plan.left > 0) {
      out.push({ key: `plan-end-${mk}`, title: `${formatPrice(plan.left)} left in your plan`, body: 'What you do not spend is added to your savings when the month closes.', route: ROUTES.plan })
    }
  }
  // shop sales no bank message covered: ask in the morning, before they are settled automatically
  const pq = payoutQuestion(txns, ts)
  if (pq && isPast(atTime(now, '09:00'))) {
    const set = getMerchantSettings()
    out.push({ key: `payout-ask-${today}`, title: 'Did your shop money reach the bank?', body: `${formatPrice(pq.total)} from ${pq.due.length} sale${pq.due.length === 1 ? '' : 's'} is waiting.${set.auto ? ` Tell JustMoney, or it is marked settled at ${set.time}.` : ''}`, route: ROUTES.home })
  }
  if (budgetsOnly) return out
  const spentSince = (from: number) => {
    // transfers, loans, splits and money for someone are not spending
    const d = txns.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= from && !isTransferCategory(t.paymentCategory) && !t.business)
    return { total: d.reduce((a, t) => a + t.paymentAmount, 0), n: d.length }
  }
  if (prefs.daily && isPast(atTime(now, '21:00'))) {
    const s = spentSince(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime())
    out.push({ key: `daily-${today}`, title: 'Daily check-in', body: s.n ? `Today: ${formatPrice(s.total)} across ${s.n} transactions. Anything you missed?` : 'Log today\'s spends before you forget — it takes 3 seconds.', route: ROUTES.add })
  }
  if (prefs.weekly && now.getDay() === 0 && isPast(atTime(now, '10:00'))) {
    const s = spentSince(ts - 7 * 86400000)
    out.push({ key: `weekly-${today}`, title: 'Weekly summary', body: `This week: ${formatPrice(s.total)} across ${s.n} transactions.`, route: ROUTES.insights })
  }
  if (prefs.bimonthly && [1, 15].includes(now.getDate()) && isPast(atTime(now, '11:00'))) {
    out.push({ key: `bimonthly-${today}`, title: 'Fresh insights', body: 'Your spending insights are ready. Take a look at where your money went.', route: ROUTES.insights })
  }
  if (prefs.monthly && now.getDate() === 28 && isPast(atTime(now, '19:00'))) {
    const s = spentSince(new Date(now.getFullYear(), now.getMonth(), 1).getTime())
    out.push({ key: `monthly-${today}`, title: 'Month wrap-up', body: `This month so far: ${formatPrice(s.total)} across ${s.n} transactions.`, route: ROUTES.recap })
  }
  return out
}

export function checkNotifications() {
  const fired = read<string[]>(FIRED_KEY, [])
  const due = collectDue(new Date(), isNativeApp()).filter((d) => !fired.includes(d.key))
  if (!due.length) return
  due.forEach((d) => notifyImmediate(d.title, d.body, d.key, d.route))
  write(FIRED_KEY, [...fired, ...due.map((d) => d.key)].slice(-300))
}

export function startNotificationLoop() {
  checkNotifications()
  const id = setInterval(checkNotifications, 60000)
  return () => clearInterval(id)
}
