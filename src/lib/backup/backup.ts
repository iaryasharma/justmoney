// Backup snapshot, merge-restore, and the daily automatic backup.
//
// In the Android app the daily backup is done natively (BackupWriter.java + a
// WorkManager job), straight from the SQLite database, so it also runs while
// the app is closed. It writes Documents/JustMoney/justmoney-backup.json, which
// survives uninstalling the app. In a plain browser there is no such location,
// so only manual download / restore is offered.
import { Filesystem } from '@capacitor/filesystem'
import { flushStorage, read, write, KEYS } from '../core/storage'
import { excludedKeys, NEVER_BACKED_UP } from './backupScope'
import { DEFAULT_CATEGORIES, findDuplicate } from '../core/data'
import { DEFAULT_PREFS } from '../notify/notify'
import { UPI_RE } from '../core/upi'
import { isNativeApp, NativeDb, type NativeBackupStatus } from '../core/native'
import { alertOn } from '../notify/alerts'
import { notifyNow } from '../notify/nativeNotify'
import type { Loan, Transaction } from '../core/types'

export { isNativeApp }
export const BACKUP_DIR = 'JustMoney'
export const BACKUP_FILE = 'justmoney-backup.json'

export type AutoBackupState = NativeBackupStatus
export const DEFAULT_AUTO_BACKUP: AutoBackupState = {
  enabled: true, lastAt: null, file: BACKUP_FILE, lastError: null, foundOlder: null, dismissedOlder: false,
}

/** Records when this install first ran. */
export function installedAt() {
  let at = read<number>(KEYS.installedAt, 0)
  if (!at) { at = Date.now(); write(KEYS.installedAt, at) }
  return at
}

/** Manual (downloadable) backup, version 3: every stored setting under `kv`, the same shape the Android backup uses. What is left out is chosen in Settings. */
export function buildBackup() {
  const skip = new Set(excludedKeys())
  const kv: Record<string, unknown> = {}
  for (const key of Object.values(KEYS)) {
    if (key === KEYS.transactions || skip.has(key)) continue
    const v = read<unknown>(key, undefined)
    if (v !== undefined) kv[key] = v
  }
  return { app: 'JustMoney', version: 3, source: 'web', exportedAt: new Date().toISOString(), transactions: read(KEYS.transactions, []), kv }
}

/** The old version 2 shape, kept for reference and tests. */
export function buildBackupV2() {
  return {
    version: 2, app: 'JustMoney', exportedAt: new Date().toISOString(),
    transactions: read(KEYS.transactions, []), incomeSources: read(KEYS.incomeSources, []), emiPlans: read(KEYS.emiPlans, []),
    paymentReminders: read(KEYS.reminders, []),
    splitwise: { projects: read(KEYS.splitProjects, []), people: read(KEYS.splitPeople, []), transactions: read(KEYS.splitTransactions, []), splits: read(KEYS.splits, []) },
    monthlyBudget: read(KEYS.monthlyBudget, 0), creditCardLimit: read(KEYS.creditCardLimit, 0), paymentCategories: read(KEYS.categories, null),
    notificationPreferences: read(KEYS.notificationPrefs, DEFAULT_PREFS), paymentMethods: read(KEYS.paymentMethods, []),
    autoDebitReminders: read(KEYS.autoDebit, null), upiId: read(KEYS.upiId, ''), splitRequestMessage: read(KEYS.splitRequestMessage, ''),
    tax: { annualIncome: read(KEYS.taxIncome, null), deductions: read(KEYS.taxDeductions, null) }, user: read(KEYS.user, null),
    categoryBudgets: read(KEYS.categoryBudgets, {}), recurringRules: read(KEYS.recurringRules, []), savingsGoals: read(KEYS.savingsGoals, []),
    theme: read(KEYS.theme, 'dark'),
    familyMembers: read(KEYS.familyMembers, []), commitments: read(KEYS.commitments, []),
    investments: read(KEYS.investments, []), salary: read(KEYS.salary, null), netWorthHistory: read(KEYS.netWorthHistory, []),
    loans: read(KEYS.loans, []), categoryRules: read(KEYS.categoryRules, []), people: read(KEYS.people, []),
  }
}

/** Keys the field-by-field restore below handles itself. */
const MAPPED = new Set<string>([
  KEYS.transactions, KEYS.incomeSources, KEYS.emiPlans, KEYS.reminders, KEYS.splitProjects, KEYS.splitPeople,
  KEYS.splitTransactions, KEYS.splits, KEYS.monthlyBudget, KEYS.creditCardLimit, KEYS.categories, KEYS.notificationPrefs,
  KEYS.paymentMethods, KEYS.autoDebit, KEYS.upiId, KEYS.splitRequestMessage, KEYS.taxIncome, KEYS.taxDeductions,
  KEYS.user, KEYS.categoryBudgets, KEYS.recurringRules, KEYS.savingsGoals, KEYS.theme, KEYS.familyMembers, KEYS.commitments,
  KEYS.investments, KEYS.salary, KEYS.netWorthHistory, KEYS.loans, KEYS.categoryRules, KEYS.people,
])

/** Native backups (version 3) store raw storage keys under `kv`; map them onto the version 2 shape. */
function normalize(d: Record<string, unknown>) {
  if (!(Number(d.version) >= 3) || typeof d.kv !== 'object' || !d.kv) return { d, extra: {} as Record<string, unknown> }
  const k = d.kv as Record<string, unknown>
  const v2 = {
    app: d.app, exportedAt: d.exportedAt, transactions: d.transactions,
    incomeSources: k[KEYS.incomeSources], emiPlans: k[KEYS.emiPlans], paymentReminders: k[KEYS.reminders],
    splitwise: { projects: k[KEYS.splitProjects], people: k[KEYS.splitPeople], transactions: k[KEYS.splitTransactions], splits: k[KEYS.splits] },
    monthlyBudget: k[KEYS.monthlyBudget], creditCardLimit: k[KEYS.creditCardLimit], paymentCategories: k[KEYS.categories],
    notificationPreferences: k[KEYS.notificationPrefs], paymentMethods: k[KEYS.paymentMethods], autoDebitReminders: k[KEYS.autoDebit],
    upiId: k[KEYS.upiId], splitRequestMessage: k[KEYS.splitRequestMessage],
    tax: { annualIncome: k[KEYS.taxIncome], deductions: k[KEYS.taxDeductions] },
    user: k[KEYS.user], categoryBudgets: k[KEYS.categoryBudgets], recurringRules: k[KEYS.recurringRules],
    savingsGoals: k[KEYS.savingsGoals], theme: k[KEYS.theme],
    familyMembers: k[KEYS.familyMembers], commitments: k[KEYS.commitments],
    investments: k[KEYS.investments], salary: k[KEYS.salary], netWorthHistory: k[KEYS.netWorthHistory],
    loans: k[KEYS.loans], categoryRules: k[KEYS.categoryRules], people: k[KEYS.people],
  }
  const extra = Object.fromEntries(Object.entries(k).filter(([key]) => !MAPPED.has(key)))
  return { d: v2 as Record<string, unknown>, extra }
}

/**
 * Merges a backup (version 2 manual or version 3 native) into this device: missing
 * items are added, nothing is deleted or overwritten. On a fresh install this
 * restores everything, including the profile, so onboarding can be skipped.
 */
export function restoreBackup(text: string): { added: number; restoredProfile: boolean } {
  const parsed = JSON.parse(text)
  if (parsed?.app !== 'JustMoney' || !Array.isArray(parsed.transactions)) throw new Error('Not a JustMoney backup')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { d, extra } = normalize(parsed) as { d: any; extra: Record<string, unknown> }
  let added = 0
  const merge = <T extends { id: string }>(key: string, incoming: T[] | undefined) => {
    if (!Array.isArray(incoming)) return
    const cur = read<T[]>(key, [])
    const ids = new Set(cur.map((x) => x.id))
    const fresh = incoming.filter((x) => x?.id && !ids.has(x.id))
    added += fresh.length
    if (fresh.length) write(key, [...cur, ...fresh])
  }
  // payments: not the ones you deleted (in the bin), and not ones already here under a new id (captured again from SMS after a reinstall)
  if (Array.isArray(d.transactions)) {
    const binned = new Set(read<{ tx: { id: string } }[]>(KEYS.trash, []).map((i) => i.tx.id))
    const here = read<Transaction[]>(KEYS.transactions, [])
    d.transactions = (d.transactions as Transaction[]).filter((t) => t?.id && !binned.has(t.id) && (here.some((x) => x.id === t.id) || !findDuplicate(here, t)))
  }
  merge(KEYS.transactions, d.transactions); merge(KEYS.incomeSources, d.incomeSources); merge(KEYS.emiPlans, d.emiPlans)
  merge(KEYS.reminders, d.paymentReminders); merge(KEYS.paymentMethods, d.paymentMethods)
  merge(KEYS.splitProjects, d.splitwise?.projects); merge(KEYS.splitPeople, d.splitwise?.people)
  merge(KEYS.splitTransactions, d.splitwise?.transactions); merge(KEYS.splits, d.splitwise?.splits)
  merge(KEYS.recurringRules, d.recurringRules); merge(KEYS.savingsGoals, d.savingsGoals)
  merge(KEYS.familyMembers, d.familyMembers); merge(KEYS.commitments, d.commitments); merge(KEYS.investments, d.investments)
  merge(KEYS.loans, d.loans); merge(KEYS.categoryRules, d.categoryRules); merge(KEYS.people, d.people)
  // a loan already on the phone takes in the repayments the backup knew about (its repayment entries were just merged above)
  if (Array.isArray(d.loans)) {
    const from = new Map((d.loans as Loan[]).map((l) => [l.id, l]))
    write(KEYS.loans, read<Loan[]>(KEYS.loans, []).map((l) => {
      const b = from.get(l.id)
      const extra = b?.repayments?.filter((r) => !l.repayments.some((x) => x.id === r.id)) ?? []
      return extra.length ? { ...l, repayments: [...l.repayments, ...extra].sort((a, c) => a.date - c.date) } : l
    }))
  }
  if (d.categoryBudgets && typeof d.categoryBudgets === 'object') {
    write(KEYS.categoryBudgets, { ...d.categoryBudgets, ...read<Record<string, number>>(KEYS.categoryBudgets, {}) })
  }
  const fill = (key: string, v: unknown, empty: unknown) => { if (v != null && JSON.stringify(read(key, empty)) === JSON.stringify(empty)) write(key, v) }
  fill(KEYS.monthlyBudget, d.monthlyBudget, 0); fill(KEYS.creditCardLimit, d.creditCardLimit, 0); fill(KEYS.categories, d.paymentCategories, null)
  // a UPI ID that is not valid would make every pay link in the split messages fail, so it is only taken when it checks out
  fill(KEYS.upiId, typeof d.upiId === 'string' && UPI_RE.test(d.upiId) ? d.upiId : undefined, ''); fill(KEYS.splitRequestMessage, d.splitRequestMessage, '')
  fill(KEYS.autoDebit, d.autoDebitReminders, null)
  fill(KEYS.salary, d.salary, null)
  if (Array.isArray(d.netWorthHistory) && !read<unknown[]>(KEYS.netWorthHistory, []).length) write(KEYS.netWorthHistory, d.netWorthHistory)
  fill(KEYS.taxIncome, d.tax?.annualIncome, null); fill(KEYS.taxDeductions, d.tax?.deductions, null)
  if (Array.isArray(d.paymentCategories)) {
    const cur = read<string[] | null>(KEYS.categories, null) ?? DEFAULT_CATEGORIES
    const extraCats = d.paymentCategories.filter((c: string) => !cur.includes(c))
    if (extraCats.length) write(KEYS.categories, [...cur, ...extraCats])
  }
  // Other settings carried by native backups (privacy screen, AI consent, …): only where unset here.
  // (never the passcode, API keys or per-device state: a backup file is only a file, so it must not be able to set those)
  for (const [key, v] of Object.entries(extra)) if (!NEVER_BACKED_UP.includes(key) && read(key, undefined) === undefined && v != null) write(key, v)

  let restoredProfile = false
  if (d.user?.name && !read(KEYS.user, null)) {
    write(KEYS.user, d.user)
    if (d.notificationPreferences) write(KEYS.notificationPrefs, d.notificationPreferences)
    if (d.theme) write(KEYS.theme, d.theme)
    write(KEYS.onboardingCompleted, true)
    restoredProfile = true
  }
  // Restoring deals with any older backup that was found, so it may now be overwritten.
  if (isNativeApp()) NativeDb.dismissOlder().then((s) => write(KEYS.autoBackup, s)).catch(() => {})
  return { added, restoredProfile }
}

async function ensureLegacyPermission() {
  // Only Android 9 and older need a runtime permission to write to Documents.
  try {
    const p = await Filesystem.checkPermissions()
    if (p.publicStorage !== 'granted') await Filesystem.requestPermissions()
  } catch { /* not required on newer Android */ }
}

/**
 * Asks the native side to back up: `force` writes now, otherwise only if the last
 * backup is about a day old. Pending database writes are flushed first, so the
 * file includes everything just entered. A no-op in the browser.
 */
export async function runAutoBackup(force = false): Promise<AutoBackupState> {
  if (!isNativeApp()) return read<AutoBackupState>(KEYS.autoBackup, DEFAULT_AUTO_BACKUP)
  await flushStorage()
  await ensureLegacyPermission()
  const before = read<AutoBackupState>(KEYS.autoBackup, DEFAULT_AUTO_BACKUP).lastAt ?? 0
  void NativeDb.setBackupNotify({ on: alertOn('backupDone') }).catch(() => {})
  const s = force ? await NativeDb.backupNow() : await NativeDb.backupIfDue()
  const state = { ...DEFAULT_AUTO_BACKUP, ...s, lastError: s.lastError ?? (s as { error?: string }).error ?? null }
  write(KEYS.autoBackup, state)
  // a backup was just written (this app run, not the background job, which notifies by itself)
  if (!state.lastError && (state.lastAt ?? 0) > before && alertOn('backupDone')) void notifyNow('backup-done', 'Backup saved', 'Your encrypted JustMoney backup was saved.', 'settings')
  return state
}

/** Turns the daily background job on or off. */
export async function setAutoBackupEnabled(enabled: boolean) {
  if (!isNativeApp()) return
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...(await NativeDb.scheduleDailyBackup({ enabled })) })
}

export async function refreshBackupStatus() {
  if (!isNativeApp()) return
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...(await NativeDb.getBackupStatus()) })
}

export async function dismissOlderBackup() {
  if (!isNativeApp()) return
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...(await NativeDb.dismissOlder()) })
}

/** Reads the backup file this install can see, for one-tap restore. */
export async function readOwnBackup(): Promise<string | null> {
  if (!isNativeApp()) return null
  return (await NativeDb.readBackup()).text
}

/* ---------- encrypted backups (cloud copy) ---------- */

export const isEncryptedBackup = (text: string) => {
  try { return JSON.parse(text)?.format === 'justmoney-encrypted' } catch { return false }
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Decrypts a cloud backup made by CloudBackup.java (PBKDF2-SHA256 → AES-256-GCM). Throws on a wrong password. */
export async function decryptBackup(text: string, password: string): Promise<string> {
  const f = JSON.parse(text)
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(f.salt), iterations: f.iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  )
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.iv), tagLength: 128 }, key, fromB64(f.data))
  return new TextDecoder().decode(plain)
}

const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)))

/** Encrypts a backup with a password: PBKDF2-SHA256 → AES-256-GCM, the same file format the Android app makes and reads. */
export async function encryptBackup(plain: string, password: string): Promise<string> {
  const iterations = 210000
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(plain))
  return JSON.stringify({ app: 'JustMoney', format: 'justmoney-encrypted', version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(data), exportedAt: new Date().toISOString() })
}

/** Restores a backup file's text, asking for the password first if it's encrypted. */
/** Restores a backup file's text. Only encrypted backups are accepted: a plain JSON file could be written by anyone, so it is refused. */
export async function restoreFromText(text: string, askPassword: () => Promise<string | null>) {
  if (!isEncryptedBackup(text)) throw new Error('This backup is not encrypted. JustMoney only restores encrypted backups.')
  const pw = await askPassword()
  if (!pw) throw new Error('cancelled')
  let plain: string
  try { plain = await decryptBackup(text, pw) } catch { throw new Error('Wrong password, or the file is damaged.') }
  return restoreBackup(plain)
}

export async function pickCloudLocation() {
  const s = await NativeDb.pickCloudBackupFile()
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...s })
  return s
}
export async function setCloudPassword(password: string) {
  const s = await NativeDb.setCloudPassword({ password })
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...s })
  return runAutoBackup(true)
}
export async function disableCloudBackup() {
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...(await NativeDb.disableCloudBackup()) })
}

export async function setLocalBackupEnabled(enabled: boolean) {
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...(await NativeDb.setLocalBackupEnabled({ enabled })) })
}
/** One-off copy to a place picked in the system file picker (pending writes are flushed first). */
export async function exportBackupTo() {
  await flushStorage()
  return NativeDb.exportBackupTo()
}
export async function setCloudFrequency(frequency: 'daily' | 'weekly' | 'monthly' | 'manual') {
  write(KEYS.autoBackup, { ...DEFAULT_AUTO_BACKUP, ...(await NativeDb.setCloudFrequency({ frequency })) })
}
