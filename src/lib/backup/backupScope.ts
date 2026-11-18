// What goes into a backup. Everything, by default, except the lock and secrets, which are never written to a file.
// The user can leave whole groups out in Settings → Back up → What to back up.
import { read, write, KEYS } from '../core/storage'

/** Never in a backup: the passcode and fingerprint settings, API keys, caches and per-device state. */
export const NEVER_BACKED_UP: string[] = [
  KEYS.appLock, KEYS.appLockBiometric, KEYS.lockFails, KEYS.geminiKey, '@TwelveDataKey',
  KEYS.session, KEYS.fxRates, KEYS.insightsCache, KEYS.adviceCache, KEYS.priceCache, KEYS.widgetSnapshot, KEYS.autoBackup, KEYS.installedAt,
  KEYS.onboardingCompleted, KEYS.securityCheck, KEYS.heartbeat, KEYS.settleSnooze, KEYS.captureLog, KEYS.smsRescanHolds, KEYS.errorLog, KEYS.lastExport, KEYS.backupExcluded,
  '@NotificationsFired', '@MigratedFromLocalStorage',
]

export interface BackupGroup { id: string; label: string; desc: string; locked?: boolean; keys: string[] | null }

/** `keys: null` is everything left over (app preferences and any setting added later). */
export const BACKUP_GROUPS: BackupGroup[] = [
  // the profile goes with the transactions: without it a restore cannot skip setting the app up again
  { id: 'transactions', label: 'Transactions', desc: 'Every payment and income entry, and your profile', locked: true, keys: [KEYS.transactions, KEYS.user] },
  { id: 'accounts', label: 'Accounts, budgets and bills', desc: 'Accounts, categories and rules, budgets, recurring entries, EMIs, reminders, family support, quick presets', keys: [
    KEYS.paymentMethods, KEYS.categories, KEYS.categoryRules, KEYS.categoryBudgets, KEYS.monthlyBudget, KEYS.creditCardLimit, KEYS.recurringRules, KEYS.reminders, KEYS.emiPlans,
    KEYS.autoDebit, KEYS.incomeSources, KEYS.salary, KEYS.commitments, KEYS.familyMembers, KEYS.envelopes, KEYS.trips, KEYS.cardCycle, KEYS.roundUp, KEYS.taxIncome,
    KEYS.taxDeductions, KEYS.upiId, KEYS.debtPlan, KEYS.payeeNames, KEYS.quickPresets, KEYS.autopays] },
  { id: 'plan', label: 'Spending plan, savings and pots', desc: 'Plan settings, goals, the emergency fund, income pots, yearly costs, savings history', keys: [
    KEYS.savingsGoals, KEYS.savingsRules, KEYS.salaryLog, KEYS.planSettings, KEYS.planSaved, KEYS.planMonths, KEYS.planStart, KEYS.planGoals, KEYS.planSetup, KEYS.savingsLog,
    KEYS.sinking, KEYS.pots, KEYS.allocations, KEYS.potMoves, KEYS.allocSkipped, KEYS.windfallDone, KEYS.emergency, KEYS.challenge, KEYS.lastMilestone] },
  { id: 'shop', label: 'Shop', desc: 'Payout settings, customer credit, which payments are shop costs', keys: [KEYS.merchantSettings, KEYS.creditSales, KEYS.businessPayees] },
  { id: 'people', label: 'People, loans and splits', desc: 'Contacts you linked, loans, SplitMoney groups', keys: [
    KEYS.people, KEYS.loans, KEYS.contactsUsed, KEYS.linkRejects, KEYS.autoLinkNames, KEYS.splitProjects, KEYS.splitPeople, KEYS.splitTransactions, KEYS.splits, KEYS.splitRequestMessage, KEYS.splitNudges, KEYS.splitRepeats] },
  { id: 'invest', label: 'Investments and net worth', desc: 'Holdings, sold investments and the net worth history', keys: [KEYS.investments, KEYS.netWorthHistory, KEYS.holds] },
  { id: 'receipts', label: 'Receipt photos', desc: 'Photos attached to payments. These can make the backup large.', keys: [KEYS.receipts] },
  { id: 'history', label: 'Activity and bin', desc: 'The list of changes and deleted items that can still be undone', keys: [KEYS.trash, KEYS.activity, KEYS.askHistory, KEYS.anomalySeen] },
  { id: 'settings', label: 'App preferences', desc: 'Theme, home layout, notification choices and everything else you set', keys: null },
]

export type Scope = Record<string, boolean>
export const getScope = (): Scope => read<Scope>(KEYS.backupScope, {})
export const groupOn = (scope: Scope, id: string) => scope[id] !== false

/** Every key left out of a backup, given what the user chose. */
export function excludedKeys(scope: Scope = getScope()): string[] {
  const named = new Set(BACKUP_GROUPS.flatMap((g) => g.keys ?? []))
  const out = new Set<string>(NEVER_BACKED_UP)
  for (const g of BACKUP_GROUPS) {
    if (g.locked || groupOn(scope, g.id)) continue
    if (g.keys) g.keys.forEach((k) => out.add(k))
    else Object.values(KEYS).filter((k) => !named.has(k)).forEach((k) => out.add(k))
  }
  return [...out]
}

/** Tells the Android backup which keys to leave out (it reads this from the same database). */
export function applyScope(scope: Scope = getScope()) {
  const next = excludedKeys(scope)
  const cur = read<string[]>(KEYS.backupExcluded, [])
  if (cur.length !== next.length || next.some((k, i) => k !== cur[i])) write(KEYS.backupExcluded, next)
}

/** What each part of a backup weighs, for the summary after a backup: only the parts that are in it, largest first. */
export function groupSizes(scope: Scope = getScope()): { id: string; label: string; bytes: number }[] {
  const named = new Set(BACKUP_GROUPS.flatMap((g) => g.keys ?? []))
  const never = new Set(NEVER_BACKED_UP)
  const size = (keys: string[]) => keys.reduce((a, k) => { try { return a + JSON.stringify(read<unknown>(k, null) ?? '').length } catch { return a } }, 0)
  const short: Record<string, string> = { transactions: 'Transactions', accounts: 'Accounts and budgets', plan: 'Plan and savings', shop: 'Shop', people: 'People and loans', invest: 'Investments', receipts: 'Receipt photos', history: 'Activity and bin', settings: 'App preferences' }
  return BACKUP_GROUPS.filter((g) => g.locked || groupOn(scope, g.id))
    .map((g) => ({ id: g.id, label: short[g.id] ?? g.label, bytes: size(g.keys ?? Object.values(KEYS).filter((k) => !named.has(k) && !never.has(k))) }))
    .filter((g) => g.bytes > 4).sort((a, b) => b.bytes - a.bytes)
}

export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
