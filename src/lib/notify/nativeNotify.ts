// Android: reminders scheduled with the system alarm service (via Capacitor Local
// Notifications), so they fire even when JustMoney is closed or the phone restarted.
// The whole schedule is rebuilt from current data whenever it changes.
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import { read, KEYS } from '../core/storage'
import { alertOn, needNaming, soundId, SOUNDS } from './alerts'
import { formatPrice, ordinal } from '../core/format'
import { detectRecurring } from '../payees/recurring'
import { getFamily } from '../core/money'
import { nextPayday } from '../accounts/accounts'
import { Capture, isNativeApp } from '../core/native'
import { outstanding } from '../payees/loans'
import { openRoute, ROUTES, type NotifyRoute } from './notifyRoute'
import { addTransaction } from '../core/data'
import type { Loan, Commitment, EmiPlan, NotificationPrefs, PaymentReminder, SalarySettings, Transaction } from '../core/types'

const CHANNEL_PUBLIC = 'reminders'
const CHANNEL_PRIVATE = 'reminders_private'
/** Details stay hidden on a locked screen unless the user turned that off. */
// one channel per sound: Android fixes a channel's sound when it is created, so choosing another sound switches channel
const channelId = () => `${read<boolean>(KEYS.notifPrivate, true) ? CHANNEL_PRIVATE : CHANNEL_PUBLIC}_${soundId()}`
const BILL_ACTIONS = 'BILL'

/** What a bill notification needs to mark the payment as done from the notification itself. */
interface BillInfo { receiver: string; amount: number; category: string }
const DAY = 86400000

/** Stable positive 31-bit id from a string key (notification ids must be ints). */
export function idFor(key: string) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) % 2147483647 || 1
}

let granted = false
export const nativeNotificationsGranted = () => granted

export async function refreshNativePermission() {
  if (!isNativeApp()) return false
  try { granted = (await LocalNotifications.checkPermissions()).display === 'granted' } catch { granted = false }
  return granted
}

export async function requestNativePermission() {
  if (!isNativeApp()) return false
  try {
    granted = (await LocalNotifications.requestPermissions()).display === 'granted'
    // Android 12+: exact timing for reminders needs "Alarms & reminders" access.
    const exact = await LocalNotifications.checkExactNotificationSetting().catch(() => null)
    if (exact && exact.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting().catch(() => {})
  } catch { granted = false }
  if (granted) await syncNativeNotifications()
  return granted
}

/** Creates the notification channels for the chosen sound (Android keeps a channel's sound as first created). */
async function ensureChannels() {
  const s = soundId()
  const label = SOUNDS.find((x) => x.id === s)?.label ?? ''
  const sound = s === 'default' || s === 'silent' ? undefined : `${s}.wav`
  const importance = s === 'silent' ? 2 : 4
  await LocalNotifications.createChannel({ id: `${CHANNEL_PUBLIC}_${s}`, name: `Reminders · ${label}`, description: 'Bills, EMIs, budgets and check-ins', importance, visibility: 1, ...(sound ? { sound } : {}) }).catch(() => {})
  await LocalNotifications.createChannel({ id: `${CHANNEL_PRIVATE}_${s}`, name: `Reminders (private) · ${label}`, description: 'Same reminders, with details hidden on the lock screen', importance, visibility: 0, ...(sound ? { sound } : {}) }).catch(() => {})
  for (const old of [CHANNEL_PUBLIC, CHANNEL_PRIVATE]) await LocalNotifications.deleteChannel({ id: old }).catch(() => {})
}

/** Shows a notification right away (budget alerts and other in-app events). */
export async function notifyNow(key: string, title: string, body: string, route?: NotifyRoute) {
  if (!isNativeApp() || !granted) return
  await ensureChannels()
  await LocalNotifications.schedule({
    notifications: [{ id: idFor(`now-${key}`), title, body, channelId: channelId(), extra: route ? { route } : undefined, schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true } }],
  }).catch(() => {})
}

const atTime = (hhmm: string) => { const [hour, minute] = hhmm.split(':').map(Number); return { hour, minute } }

/** Everything that should be on the system schedule right now. */
export function buildSchedule(now = Date.now()): LocalNotificationSchema[] {
  const out: LocalNotificationSchema[] = []
  // `route` is where tapping the notification opens the app (see notifyRoute.ts)
  const repeat = (key: string, title: string, body: string, on: { hour: number; minute: number; weekday?: number; day?: number }, route: NotifyRoute) =>
    out.push({ id: idFor(key), title, body, channelId: channelId(), extra: { route }, schedule: { on, allowWhileIdle: true } })
  const once = (key: string, title: string, body: string, at: number, route: NotifyRoute, bill?: BillInfo) => {
    if (at > now) out.push({ id: idFor(key), title, body, channelId: channelId(), extra: { route, bill }, actionTypeId: bill ? BILL_ACTIONS : undefined, schedule: { at: new Date(at), allowWhileIdle: true } })
  }

  // one reminder a week while several payments still have no name (not one alert per payment)
  const unnamed = needNaming(read<Transaction[]>(KEYS.transactions, [])).length
  if (alertOn('digest') && unnamed >= 3) {
    const sun = new Date(now); sun.setDate(sun.getDate() + ((7 - sun.getDay()) % 7 || 7)); sun.setHours(11, 0, 0, 0)
    once('digest-names', `${unnamed} payments need a name`, 'Tap to name them. Your earlier payments help suggest who they were to.', sun.getTime(), 'review')
  }
  // no backup for a week
  const bk = read<{ lastAt?: number | null; enabled?: boolean } | null>(KEYS.autoBackup, null)
  if (alertOn('backupDue') && bk) {
    const due = new Date((bk.lastAt || read<number>(KEYS.installedAt, now)) + 7 * 86400000); due.setHours(10, 0, 0, 0)
    if (due.getTime() <= now) { due.setTime(now); due.setDate(due.getDate() + (new Date(now).getHours() >= 10 ? 1 : 0)); due.setHours(10, 0, 0, 0) } // already overdue: remind at the next 10 am
    once('backup-due', 'Time to back up', 'No backup has been saved for a week. Open Settings to back up now.', due.getTime(), 'settings')
  }

  const prefs = read<NotificationPrefs>(KEYS.notificationPrefs, { daily: true, weekly: true, bimonthly: true, monthly: true })
  if (prefs.daily) {
    // a nudge at 9pm only on days you haven't logged anything (re-checked whenever entries change or the app opens)
    const txs = read<Transaction[]>(KEYS.transactions, [])
    for (let i = 0; i < 7; i++) {
      const day = new Date(now); day.setDate(day.getDate() + i); day.setHours(21, 0, 0, 0)
      const start = new Date(day); start.setHours(0, 0, 0, 0)
      const logged = i === 0 && txs.some((t) => t.timestamp >= start.getTime() && t.timestamp <= day.getTime())
      if (!logged) once(`daily-${start.getTime()}`, 'Daily check-in', 'Nothing logged today yet — add today\'s spends in 3 seconds.', day.getTime(), ROUTES.add)
    }
  }
  if (prefs.weekly) repeat('weekly', 'Weekly summary', 'See where your money went this week.', { weekday: 1, hour: 10, minute: 0 }, ROUTES.insights) // 1 = Sunday
  if (prefs.bimonthly) {
    repeat('bimonthly-1', 'Fresh insights', 'Your spending insights are ready.', { day: 1, hour: 11, minute: 0 }, ROUTES.insights)
    repeat('bimonthly-15', 'Mid-month check', 'Halfway through the month — see how your budget is doing.', { day: 15, hour: 11, minute: 0 }, ROUTES.home)
  }
  if (prefs.monthly) repeat('monthly', 'Month wrap-up', 'Your month in money is ready to review.', { day: 28, hour: 19, minute: 0 }, ROUTES.recap)

  // a day of the month (29th-31st) in every month, on the last day when the month is shorter: Android's repeating
  // "day 31" rolls into next month (Mar 3), and capping at 28 fires days early, so each month is scheduled on its own
  const monthly = (key: string, day: number, hour: number, minute: number, title: string, body: string, route: NotifyRoute) => {
    const base = new Date(now)
    for (let i = 0; i < 6; i++) {
      const y = base.getFullYear(), m = base.getMonth() + i
      const at = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), hour, minute).getTime()
      once(`${key}-${new Date(at).toDateString()}`, title, body, at, route)
    }
  }

  for (const r of read<PaymentReminder[]>(KEYS.reminders, [])) {
    if (!r.enabled) continue
    const t = atTime(r.time)
    if (r.type === 'DAILY') repeat(`rem-${r.id}`, 'Payment Reminder', r.title, t, ROUTES.reminders)
    else if (r.type === 'WEEKLY') repeat(`rem-${r.id}`, 'Payment Reminder', r.title, { ...t, weekday: (r.dayOfWeek ?? 0) + 1 }, ROUTES.reminders)
    else monthly(`rem-${r.id}`, r.dayOfMonth ?? 1, t.hour, t.minute, 'Payment Reminder', r.title, ROUTES.reminders)
  }

  for (const e of read<EmiPlan[]>(KEYS.emiPlans, [])) {
    if (!e.reminderEnabled || e.paidCount >= e.months) continue
    monthly(`emi-${e.id}`, e.dueDay, 9, 0, 'EMI day', `Today is the EMI day for ${e.name} — ${formatPrice(e.monthlyAmount)}. Mark it paid in JustMoney.`, ROUTES.emi)
  }

  const auto = read<{ enabledKeys: string[]; leadDays: number }>(KEYS.autoDebit, { enabledKeys: [], leadDays: 3 })
  if (auto.enabledKeys.length) {
    for (const r of detectRecurring(read<Transaction[]>(KEYS.transactions, []))) {
      if (r.ended || !auto.enabledKeys.includes(r.key)) continue
      const due = new Date(r.nextDueAt)
      const fire = new Date(due.getFullYear(), due.getMonth(), due.getDate() - auto.leadDays, 9).getTime()
      once(`autodebit-${r.key}-${due.toDateString()}`, 'Upcoming auto-debit', `Your ${r.receiver} payment of ${formatPrice(r.amount)} is due in ${auto.leadDays} day${auto.leadDays === 1 ? '' : 's'}. Keep your balance ready.`, fire, ROUTES.subs, { receiver: r.receiver, amount: r.amount, category: r.category })
    }
  }

  // Credit card: a nudge 2 days before the payment is due.
  const card = read<{ statementDay: number; dueDay: number } | null>(KEYS.cardCycle, null)
  if (card?.dueDay) {
    const day = card.dueDay - 2 < 1 ? 28 : Math.min(card.dueDay - 2, 28)
    repeat('card-due', 'Credit card payment due soon', `Your card payment is due on the ${ordinal(card.dueDay)}. Pay it on time to avoid interest.`, { day, hour: 10, minute: 0 }, ROUTES.card)
  }

  // Family support and other commitments: a nudge on salary day.
  const salary = read<SalarySettings | null>(KEYS.salary, null)
  const commitments = read<Commitment[]>(KEYS.commitments, [])
  if (salary?.accountId && commitments.length) {
    const family = getFamily()
    const what = commitments.map((c) => `${formatPrice(c.amount)} ${c.memberId ? `to ${family.find((m) => m.id === c.memberId)?.name ?? c.name}` : `for ${c.name}`}`).join(', ')
    // each month's payday on its own (Jan 31 + 1 month would be Mar 3)
    const base = new Date(nextPayday(salary.day, new Date(now)))
    for (let i = 0; i < 3; i++) {
      const y = base.getFullYear(), m = base.getMonth() + i
      const d = new Date(y, m, Math.min(salary.day, new Date(y, m + 1, 0).getDate()), 12)
      once(`commit-${d.toDateString()}`, 'Salary day', `Time to send ${what}. Tap “Mark sent” in Money plan once done.`, d.getTime(), ROUTES.money)
    }
  }
  const LOAN_LEAD_HOURS = [24, 12, 6, 1]
  for (const l of read<Loan[]>(KEYS.loans, [])) {
    if (!l.dueDate || outstanding(l) <= 0) continue // settled loans get no reminders
    const owe = formatPrice(outstanding(l))
    for (const h of LOAN_LEAD_HOURS) {
      const when = h === 1 ? 'in 1 hour' : h < 24 ? `in ${h} hours` : 'tomorrow'
      once(`loan-${l.id}-${h}h`, l.direction === 'LENT' ? 'Loan due soon' : 'Repayment due soon',
        l.direction === 'LENT' ? `${l.person} owes you ${owe} — due ${when}.` : `You owe ${l.person} ${owe} — due ${when}.`, l.dueDate - h * 3600000, ROUTES.loans)
    }
    once(`loan-${l.id}`, l.direction === 'LENT' ? 'Loan due' : 'Repayment due',
      l.direction === 'LENT' ? `${l.person} is due to pay you back ${owe} today.` : `Today you're due to repay ${l.person} ${owe}.`, l.dueDate, ROUTES.loans)
  }
  return out.filter((n) => !(n.schedule?.at && n.schedule.at.getTime() > now + 400 * DAY))
}

/** Tapping a notification opens the page it is about. Call once at startup (Android). */
export function startNotificationTapListener() {
  if (!isNativeApp()) return () => {}
  const sub = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const extra = a.notification.extra as { route?: string; bill?: BillInfo } | undefined
    const bill = extra?.bill
    if (bill && a.actionId === 'paid') {
      // "Mark paid" straight from the notification: log the payment and confirm quietly
      addTransaction({ paymentAmount: bill.amount, paymentType: 'DEBIT', paymentReceiver: bill.receiver, paymentCategory: bill.category, timestamp: Date.now(), manualCategory: true }, { allowDuplicate: true })
      notifyNow(`billpaid-${bill.receiver}-${Date.now()}`, 'Marked as paid', `${bill.receiver} · ${formatPrice(bill.amount)} added to your expenses.`, ROUTES.home)
      return
    }
    if (bill && a.actionId === 'snooze') {
      const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(9, 0, 0, 0)
      LocalNotifications.schedule({ notifications: [{ id: idFor(`snooze-${bill.receiver}-${at.getTime()}`), title: a.notification.title ?? 'Bill due', body: a.notification.body ?? '', channelId: channelId(), extra, actionTypeId: BILL_ACTIONS, schedule: { at, allowWhileIdle: true } }] }).catch(() => {})
      return
    }
    openRoute(extra?.route)
  })
  return () => { sub.then((h) => h.remove()).catch(() => {}) }
}

let syncing: Promise<void> | null = null
/** Replaces the system schedule with what the data says now. Safe to call often. */
export function syncNativeNotifications(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve()
  const run = async () => {
    if (!(await refreshNativePermission())) return
    await ensureChannels()
    await LocalNotifications.registerActionTypes({ types: [{ id: BILL_ACTIONS, actions: [{ id: 'paid', title: 'Mark paid' }, { id: 'snooze', title: 'Snooze 1 day' }] }] }).catch(() => {})
    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] as { id: number }[] }))
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) }).catch(() => {})
    const list = buildSchedule()
    // the pinned "tap to add an expense" notification is held by a native foreground service, so it cannot be swiped away
    await Capture.setPinnedQuickAdd({ on: read<boolean>(KEYS.quickAddNotif, false) }).catch(() => {})
    await LocalNotifications.cancel({ notifications: [{ id: idFor('quick-add') }] }).catch(() => {}) // the old swipeable one, if it is still in the shade
    if (list.length) await LocalNotifications.schedule({ notifications: list })
  }
  syncing = (syncing ?? Promise.resolve()).then(run).catch((e) => console.error('[notify] schedule failed', e))
  return syncing
}
