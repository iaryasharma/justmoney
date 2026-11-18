// Keeps the Android home-screen widget (SummaryWidget.java) in step with the app.
// The widget totals today's / this month's spending itself from the database; the
// app only tells it the budget, which categories don't count as spending, the
// currency, and whether App Lock should hide amounts.
import { frozenFor } from '../accounts/holds'
import { flushStorage, read, write, KEYS } from '../core/storage'
import { committedCategories, getCommitments, spendable } from '../core/money'
import { getCurrency } from '../core/format'
import { isNativeApp, NativeDb } from '../core/native'
import { cardAccount, getAccounts, tracksBalance, UPI_APPS } from '../accounts/accounts'
import { appLogo, bankLogo, brandRules, logoKey, merchantLogo } from '../payees/brands'
import { categoryColor, categoryIcon, getCategories } from '../core/data'
import { expectedItems } from '../plan/calendar'
import type { SavingsGoal } from '../core/types'

export function widgetSnapshot() {
  const budget = read<number>(KEYS.monthlyBudget, 0)
  const commitments = getCommitments()
  const currency = getCurrency()
  const methods = getAccounts()
  // the balance widget adds up each account (and the debit cards spending from it) itself
  const accounts = methods.filter(tracksBalance).map((m) => ({
    name: m.last4 ? `${m.name} ••${m.last4}` : m.name,
    ids: [m.id, ...methods.filter((c) => cardAccount(c, methods)?.id === m.id).map((c) => c.id)],
    opening: (m.openingBalance ?? 0) - frozenFor(new Set([m.id, ...methods.filter((c) => cardAccount(c, methods)?.id === m.id).map((c) => c.id)])),
    from: m.openingDate ?? 0,
    logo: m.type === 'CASH' ? null : logoKey(bankLogo(m.bank, m.name)),
    icon: m.type === 'CASH' ? 'wallet' : m.type === 'BANK' ? 'bank' : 'card',
  }))
  const categories = getCategories()
  const now = Date.now()
  // what is due in the next three weeks (EMIs, subscriptions, loans, recurring entries)
  const d = new Date()
  const bills = [...expectedItems(d.getFullYear(), d.getMonth()), ...expectedItems(new Date(d.getFullYear(), d.getMonth() + 1).getFullYear(), new Date(d.getFullYear(), d.getMonth() + 1).getMonth())]
    .filter((i) => i.flow === 'out' && !i.done && i.date >= now - 86400000 && i.date <= now + 21 * 86400000 && i.kind !== 'commitment')
    .sort((a, b) => a.date - b.date).slice(0, 6)
    .map((i) => ({ name: i.title, amount: i.amount, dueAt: i.date, kind: i.kind, logo: logoKey(merchantLogo(i.title)) }))
  const goal = read<SavingsGoal[]>(KEYS.savingsGoals, []).filter((g) => g.saved < g.target).sort((a, b) => b.saved / b.target - a.saved / a.target)[0]
  return {
    accounts,
    brands: brandRules(),
    apps: Object.fromEntries(UPI_APPS.map((a) => [a, logoKey(appLogo(a))]).filter(([, k]) => k)),
    categories: Object.fromEntries(categories.map((c) => [c, { color: categoryColor(c, categories), icon: categoryIcon(c) }])),
    bills,
    goal: goal ? { name: goal.name, saved: goal.saved, target: goal.target, color: goal.color } : null,
    budget: budget > 0 ? budget : Math.max(0, spendable()),
    budgetLabel: budget > 0 ? 'budget' : commitments.length ? 'spendable' : 'income',
    committed: [...committedCategories(commitments)],
    currency,
    locale: currency === 'INR' ? 'en_IN' : 'en_US',
    // App Lock hides widget amounts only if the user chose that (Settings → App Lock → Widgets while locked)
    locked: (!!read<string>(KEYS.appLock, '') || read<boolean>(KEYS.appLockBiometric, false)) && !read<boolean>(KEYS.widgetsWhenLocked, true),
  }
}

export async function updateWidget() {
  if (!isNativeApp()) return
  const snap = widgetSnapshot()
  if (JSON.stringify(read(KEYS.widgetSnapshot, null)) !== JSON.stringify(snap)) write(KEYS.widgetSnapshot, snap)
  await flushStorage() // the widget reads the database, so pending writes must land first
  await NativeDb.refreshWidget().catch(() => {})
}
