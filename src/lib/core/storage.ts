import { useCallback, useRef, useSyncExternalStore } from 'react'
import { isNativeApp, NativeDb } from './native'

// Persistent key/value store backed by localStorage. Key names mirror the
// AsyncStorage keys of the original app, prefixed so they don't collide.
const PREFIX = 'justmoney:'
const listeners = new Map<string, Set<() => void>>()
const cache = new Map<string, unknown>()

export const KEYS = {
  session: '@Session',
  user: '@User',
  onboardingCompleted: '@OnboardingCompleted',
  transactions: '@PaymentTransactions',
  categories: '@PaymentCategories',
  paymentMethods: '@PaymentMethods',
  monthlyBudget: '@MonthlyBudget',
  incomeSources: '@IncomeSources',
  insightsCache: '@SpendingInsightsCache',
  creditCardLimit: '@CreditCardLimit',
  emiPlans: '@EmiPlans',
  reminders: '@PaymentReminders',
  autoDebit: '@AutoDebitReminders',
  splitProjects: '@SplitwiseProjects',
  splitPeople: '@SplitwisePeople',
  splitTransactions: '@SplitwiseTransactions',
  splits: '@SplitwiseSplits',
  splitRequestMessage: '@SplitRequestMessage',
  splitNudges: '@SplitNudges',
  splitRepeats: '@SplitRepeats',
  splitHinglish: '@SplitHinglish',
  upiId: '@UserUpiId',
  taxIncome: '@TaxAnnualIncome',
  taxDeductions: '@TaxDeductions',
  notificationPrefs: '@NotificationPreferences',
  aiConsent: '@AIConsentGranted',
  appLock: '@AppLockEnabled',
  appLockGrace: '@AppLockGrace',
  appLockBiometric: '@AppLockBiometric',
  privacyScreen: '@AppLockPrivacyScreen',
  lastSeenWhatsNew: '@LastSeenWhatsNewVersion',
  geminiKey: '@GeminiApiKey',
  theme: '@Theme',
  categoryBudgets: '@CategoryBudgets',
  recurringRules: '@RecurringRules',
  savingsGoals: '@SavingsGoals',
  fxRates: '@FxRates',
  autoBackup: '@AutoBackup',
  familyMembers: '@FamilyMembers',
  commitments: '@Commitments',
  salary: '@SalarySettings',
  investments: '@Investments',
  netWorthHistory: '@NetWorthHistory',
  widgetSnapshot: '@WidgetSnapshot',
  loans: '@Loans',
  people: '@People',
  contactsUsed: '@ContactsUsed',
  priceCache: '@PriceCache',
  savingsRules: '@SavingsRules',
  salaryLog: '@SalaryLog',
  quickPresets: '@QuickPresets',
  payeeNames: '@PayeeNames',
  lastMilestone: '@LastMilestone',
  snacksAdded: '@SnacksAdded',
  namesMigrated: '@NamesMigrated',
  streamingMoved: '@StreamingMoved',
  planSettings: '@PlanSettings',
  planSaved: '@PlanSaved',
  planMonths: '@PlanMonths',
  planStart: '@PlanStart',
  planGoals: '@PlanGoals',
  businessPayees: '@BusinessPayees',
  sinking: '@SinkingFunds',
  creditSales: '@CreditSales',
  windfallDone: '@WindfallDone',
  pots: '@IncomePots',
  allocations: '@IncomeAllocations',
  potMoves: '@PotMoves',
  allocSkipped: '@AllocationSkipped',
  merchantSettings: '@MerchantSettings',
  widgetsWhenLocked: '@WidgetsWhenLocked',
  notifPrivate: '@NotifPrivate',
  lockFails: '@LockFails',
  reauth: '@RequireReauth',
  settleSnooze: '@SettleSnooze',
  adviceCache: '@AdviceCache',
  linkRejects: '@LinkRejects',
  autoLinkNames: '@AutoLinkNames',
  categoryRules: '@CategoryRules',
  autoCapture: '@AutoCapture',
  installedAt: '@InstalledAt',
  receipts: '@Receipts',
  envelopes: '@Envelopes',
  trips: '@Trips',
  cardCycle: '@CardCycle',
  roundUp: '@RoundUp',
  askHistory: '@AskHistory',
  trash: '@Trash',
  activity: '@Activity',
  errorLog: '@ErrorLog',
  hideOnLaunch: '@HideOnLaunch',
  homeLayout: '@HomeLayout',
  accent: '@Accent',
  autoReport: '@AutoReport',
  coach: '@CoachMarks',
  debtPlan: '@DebtPlan',
  challenge: '@Challenge',
  emergency: '@EmergencyFund',
  holds: '@IpoHolds',
  voiceAuto: '@VoiceAutoSave',
  descriptionAsNote: '@DescriptionAsNote',
  lastExport: '@LastExport',
  anomalySeen: '@AnomalySeen',
  quickAddNotif: '@QuickAddNotif',
  heartbeat: '@AppHeartbeat',
  fitnessMoved: '@FitnessMoved',
  blockCapture: '@BlockCapture',
  securityCheck: '@SecurityCheck',
  backupScope: '@BackupScope',
  backupExcluded: '@BackupExcluded',
  planSetup: '@PlanSetup',
  savingsLog: '@SavingsLog',
  captureLog: '@CaptureLog',
  alertPrefs: '@AlertPrefs',
  smsRescanHolds: '@SmsRescanHolds',
  autopays: '@AutoPays',
  notifSound: '@NotifSound',
  numberNames: '@NumberNames',
  attentionDismissed: '@AttentionDismissed',
} as const

/*
 * Two backends behind one synchronous API:
 *  - Browser: localStorage.
 *  - Android app: the native SQLite database. Everything is loaded into the
 *    in-memory cache once at startup (initStorage), reads come from the cache,
 *    and writes are persisted to SQLite in the background, in order. Transactions
 *    are stored one row each, and only the rows that changed are written.
 */
let nativeMode = false
let queue: Promise<unknown> = Promise.resolve()
/** id → JSON of each transaction row as last sent to SQLite, to compute minimal changes. */
const persistedTx = new Map<string, string>()

function enqueue(job: () => Promise<unknown>) {
  queue = queue.then(job).catch((e) => {
    console.error('[storage] native write failed', e)
    // a save the phone refused (for example when encryption is not available) is reported, not lost silently
    window.dispatchEvent(new CustomEvent('justmoney:save-failed', { detail: e instanceof Error ? e.message : String(e) }))
  })
}

function persistNative(key: string, value: unknown) {
  if (key === KEYS.transactions) {
    const rows = Array.isArray(value) ? (value as { id: string; timestamp: number }[]) : []
    const next = new Map(rows.map((t) => [t.id, JSON.stringify(t)]))
    const upserts = rows.filter((t) => persistedTx.get(t.id) !== next.get(t.id))
      .map((t) => ({ id: t.id, timestamp: t.timestamp, json: next.get(t.id)! }))
    const deletes = [...persistedTx.keys()].filter((id) => !next.has(id))
    persistedTx.clear()
    next.forEach((v, k) => persistedTx.set(k, v))
    // a write that fails (disk full) is not marked saved: its rows go again with the next write, so nothing is lost on restart
    if (upserts.length || deletes.length) enqueue(() => NativeDb.applyTransactionChanges({ upserts, deletes }).catch((e) => {
      for (const u of upserts) if (persistedTx.get(u.id) === u.json) persistedTx.delete(u.id)
      for (const id of deletes) if (!persistedTx.has(id)) persistedTx.set(id, '')
      throw e
    }))
    return
  }
  const json = JSON.stringify(value)
  enqueue(() => NativeDb.setItem({ key, value: json }))
}

/** Loads the native database into memory. Call once before rendering; a no-op in the browser. */
export async function initStorage() {
  if (!isNativeApp()) return
  try {
    let { kv, transactions } = await NativeDb.loadAll()
    if (!Object.keys(kv).length && !transactions.length) {
      // First run of the SQLite version: carry over anything saved by the earlier localStorage build.
      await migrateFromLocalStorage()
      ;({ kv, transactions } = await NativeDb.loadAll())
    }
    nativeMode = true
    for (const [k, v] of Object.entries(kv)) {
      try { cache.set(k, JSON.parse(v)) } catch { /* skip a corrupt value */ }
    }
    const txns = transactions.flatMap((j) => { try { return [JSON.parse(j)] } catch { return [] } })
    cache.set(KEYS.transactions, txns)
    txns.forEach((t: { id: string }) => persistedTx.set(t.id, JSON.stringify(t)))
    // an older build kept a plaintext copy in the WebView's own storage; now that everything lives in the encrypted database it is only a leak
    if (Object.keys(kv).length || txns.length) {
      try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)) } catch { /* storage unavailable */ }
    }
  } catch (e) {
    console.error('[storage] SQLite unavailable, falling back to localStorage', e)
    nativeMode = false
  }
}

/**
 * Reads the database again. A background job (shop payouts settled while the app was closed) writes to it directly, so what the
 * app holds in memory can be out of date when it comes back to the front.
 */
export async function resyncFromNative() {
  if (!nativeMode) return
  try {
    await flushStorage()
    const { transactions } = await NativeDb.loadAll()
    const txns = transactions.flatMap((j) => { try { return [JSON.parse(j)] } catch { return [] } })
    const cur = cache.get(KEYS.transactions) as { id: string; updatedAt?: number }[] | undefined
    const changed = !cur || cur.length !== txns.length || txns.some((t: { id: string; updatedAt?: number }) => { const m = cur.find((x) => x.id === t.id); return !m || m.updatedAt !== t.updatedAt })
    if (changed) {
      cache.set(KEYS.transactions, txns)
      persistedTx.clear()
      txns.forEach((t: { id: string }) => persistedTx.set(t.id, JSON.stringify(t)))
      listeners.get(KEYS.transactions)?.forEach((l) => l())
    }
  } catch (e) {
    console.error('[storage] resync failed', e)
  }
}

async function migrateFromLocalStorage() {
  let entries: [string, string][] = []
  try {
    entries = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => [k.slice(PREFIX.length), localStorage.getItem(k) ?? 'null'])
  } catch { return }
  if (!entries.length) return
  for (const [key, raw] of entries) {
    if (key === KEYS.transactions) {
      const rows = JSON.parse(raw) as { id: string; timestamp: number }[]
      await NativeDb.applyTransactionChanges({ upserts: rows.map((t) => ({ id: t.id, timestamp: t.timestamp, json: JSON.stringify(t) })), deletes: [] })
    } else {
      await NativeDb.setItem({ key, value: raw })
    }
  }
  await NativeDb.setItem({ key: '@MigratedFromLocalStorage', value: String(Date.now()) })
}

/** Resolves once every pending write has reached SQLite. */
export const flushStorage = () => queue

/** Marks a key known to have no stored value; each caller then gets its own fallback. */
const MISSING = Symbol('missing')

export function read<T>(key: string, fallback: T): T {
  if (cache.has(key)) {
    const v = cache.get(key)
    return v === MISSING ? fallback : (v as T)
  }
  if (nativeMode) return fallback // everything stored was loaded at startup
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw != null) {
      const value = JSON.parse(raw) as T
      cache.set(key, value)
      return value
    }
  } catch {
    /* storage unavailable or corrupt: use fallback */
  }
  cache.set(key, MISSING)
  return fallback
}

export function write<T>(key: string, value: T) {
  cache.set(key, value)
  if (nativeMode) persistNative(key, value)
  else {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      /* quota or private mode: keep in-memory value */
    }
  }
  listeners.get(key)?.forEach((l) => l())
}

export function remove(key: string) {
  cache.delete(key)
  if (nativeMode) {
    if (key === KEYS.transactions) persistNative(key, [])
    else enqueue(() => NativeDb.removeItem({ key }))
  } else {
    try {
      localStorage.removeItem(PREFIX + key)
    } catch {
      /* ignore */
    }
  }
  listeners.get(key)?.forEach((l) => l())
}

/**
 * Empties everything without telling the screens: used by the delete-all animation, which must stay on screen until it is finished
 * (clearing normally sends the app back to onboarding at once).
 */
export function clearAllQuietly() {
  if (nativeMode) {
    cache.clear()
    persistedTx.clear()
    enqueue(() => NativeDb.clear())
    return
  }
  Object.values(KEYS).forEach((k) => { cache.delete(k); try { localStorage.removeItem(PREFIX + k) } catch { /* ignore */ } })
}

export function clearAll() {
  if (nativeMode) {
    const keys = [...cache.keys()]
    cache.clear()
    persistedTx.clear()
    enqueue(() => NativeDb.clear())
    keys.forEach((k) => listeners.get(k)?.forEach((l) => l()))
    return
  }
  Object.values(KEYS).forEach(remove)
}

function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(cb)
  return () => set!.delete(cb)
}

export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  // Fallbacks are usually literals (`[]`, `{}`): keep this component's first one so the
  // snapshot stays referentially stable while the key is unset.
  const fb = useRef(fallback).current
  const value = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => read(key, fb),
  )
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(read(key, fallback)) : v
      write(key, next)
    },
    // fallback is a literal at each call site; key is what identifies the slot
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return [value, set]
}

export const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
