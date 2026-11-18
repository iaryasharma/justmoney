// Bridge to the app's own Android plugin (android/app/src/main/java/app/justmoney/JustMoneyDbPlugin.java).
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativeBackupStatus {
  enabled: boolean
  /** The Documents/JustMoney copy on this phone. */
  localEnabled?: boolean
  lastAt: number | null
  file: string
  lastError: string | null
  foundOlder: { exportedAt: string; transactions: number } | null
  dismissedOlder: boolean
  /** The backup on the phone is encrypted (a backup password is set). */
  localEncrypted?: boolean
  /** The database is encrypted with the phone's secure key store. */
  dataEncrypted?: boolean
  cloud?: { configured: boolean; encrypted?: boolean; frequency?: 'daily' | 'weekly' | 'monthly' | 'manual'; hasLocation: boolean; name: string | null; provider: string | null; lastAt: number | null; error: string | null }
}

export interface JustMoneyDbPlugin {
  loadAll(): Promise<{ kv: Record<string, string>; transactions: string[] }>
  setItem(o: { key: string; value: string }): Promise<void>
  removeItem(o: { key: string }): Promise<void>
  applyTransactionChanges(o: { upserts: { id: string; timestamp: number; json: string }[]; deletes: string[] }): Promise<void>
  clear(): Promise<void>
  refreshWidget(): Promise<void>
  scheduleDailyBackup(o: { enabled?: boolean }): Promise<NativeBackupStatus>
  backupNow(): Promise<NativeBackupStatus & { error?: string }>
  setBackupNotify(o: { on: boolean }): Promise<void>
  backupIfDue(): Promise<NativeBackupStatus>
  getBackupStatus(): Promise<NativeBackupStatus>
  readBackup(): Promise<{ text: string | null }>
  dismissOlder(): Promise<NativeBackupStatus>
  pickCloudBackupFile(): Promise<NativeBackupStatus>
  setCloudPassword(o: { password: string }): Promise<NativeBackupStatus>
  verifyBackupPassword(o: { password: string }): Promise<{ ok: boolean }>
  disableCloudBackup(): Promise<NativeBackupStatus>
  setCloudFrequency(o: { frequency: string }): Promise<NativeBackupStatus>
  setLocalBackupEnabled(o: { enabled: boolean }): Promise<NativeBackupStatus>
  exportBackupTo(): Promise<{ saved: boolean }>
}

export const NativeDb = registerPlugin<JustMoneyDbPlugin>('JustMoneyDb')
export const isNativeApp = () => Capacitor.isNativePlatform()

export interface DevicePlugin {
  biometricStatus(): Promise<{ available: boolean; biometricEnrolled: boolean; reason: string }>
  authenticate(o?: { title?: string; subtitle?: string }): Promise<{ success: boolean; code?: number; message?: string }>
  setSecure(o: { enabled: boolean }): Promise<void>
  /** Android 13 and newer: hides the app's picture in the recent apps list without blocking screenshots. */
  setRecentsHidden(o: { enabled: boolean }): Promise<{ supported: boolean }>
  /** Whether the phone has a screen lock, looks rooted, and has USB debugging on. */
  deviceSecurity(): Promise<{ screenLock: boolean; rooted: boolean; usbDebugging: boolean }>
  setSystemBars(o: { color: string; lightBackground: boolean }): Promise<void>
  recognizeSpeech(o: { language?: string; prompt?: string }): Promise<{ text: string | null }>
}

/** Biometric unlock, speech-to-text and screenshot blocking (DevicePlugin.java). */
export const Device = registerPlugin<DevicePlugin>('Device')

export type Share =
  | { kind: 'images'; uris: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string }

export interface CapturePlugin {
  takePendingShares(): Promise<{ shares: Share[] }>
  ocr(o: { uri?: string; base64?: string }): Promise<{ text: string; lines: { text: string; top: number; left: number; height: number }[] }>
  nanoStatus(): Promise<{ status: 'available' | 'downloadable' | 'downloading' | 'unavailable'; reason?: string }>
  nanoDownload(): Promise<{ started: boolean; bytes?: number }>
  nanoGenerate(o: { prompt: string }): Promise<{ text: string }>
  addListener(event: 'shareReceived', cb: (s: Share) => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'nanoReady', cb: () => void): Promise<{ remove: () => Promise<void> }>
  addListener(event: 'paymentCaptured', cb: () => void): Promise<{ remove: () => Promise<void> }>
  notificationAccessStatus(): Promise<{ enabled: boolean }>
  openNotificationAccessSettings(): Promise<void>
  setPinnedQuickAdd(o: { on: boolean }): Promise<void>
  getAppIcon(): Promise<{ name: string }>
  setAppIcon(o: { name: string }): Promise<void>
  smsStatus(): Promise<{ granted: boolean }>
  requestSms(): Promise<{ granted: boolean }>
  scanSms(o: { days: number; holdsOnly?: boolean }): Promise<{ scanned: number; added: number }>
  takeCapturedPayments(): Promise<{ items: { id: number; pkg: string; title: string; text: string; ts: number }[] }>
}

/** On-device OCR, Gemini Nano and shares from other apps (CapturePlugin.java). */
export const Capture = registerPlugin<CapturePlugin>('Capture')

interface ContactsPlugin {
  list(): Promise<{ contacts: { id: string; name: string; phones: string[] }[] }>
}

/** Read-only phone contacts (ContactsPlugin.java); only the ones you pick are kept in the app. */
export const Contacts = registerPlugin<ContactsPlugin>('Contacts')
