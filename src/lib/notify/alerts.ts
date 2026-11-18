// The "money alerts" JustMoney can send, which of them are on, the notification sound, and the checks behind
// "Check these" (payments the bank never confirmed, charges that look doubled) and the weekly "needs a name" digest.
import { read, write, KEYS } from '../core/storage'
import { isUnnamed } from '../payees/payeeGuess'
import { isTransferCategory } from '../accounts/accounts'
import type { Transaction } from '../core/types'

export interface AlertPrefs {
  /** "₹500 paid. Who to?" the moment a nameless payment arrives */
  nameIt: boolean
  /** one reminder a week while several payments still have no name */
  digest: boolean
  /** the same merchant and amount charged twice */
  duplicates: boolean
  /** payments from a receipt screenshot the bank never confirmed */
  unconfirmed: boolean
  /** "Backup saved" after each successful backup */
  backupDone: boolean
  /** a nudge when no backup has run for a week */
  backupDue: boolean
}

export const DEFAULT_ALERTS: AlertPrefs = { nameIt: true, digest: true, duplicates: true, unconfirmed: true, backupDone: true, backupDue: true }

export const alertPrefs = (): AlertPrefs => ({ ...DEFAULT_ALERTS, ...read<Partial<AlertPrefs>>(KEYS.alertPrefs, {}) })
export const alertOn = (k: keyof AlertPrefs) => alertPrefs()[k]

/** Sounds a notification can use. The files are in res/raw (phone) and public/sounds (preview in Settings). */
export const SOUNDS = [
  { id: 'default', label: 'Phone default' },
  { id: 'chime', label: 'Chime' },
  { id: 'bell', label: 'Bell' },
  { id: 'pop', label: 'Pop' },
  { id: 'soft', label: 'Soft' },
  { id: 'silent', label: 'Silent' },
] as const
export type SoundId = (typeof SOUNDS)[number]['id']
export const soundId = (): SoundId => {
  const s = read<string>(KEYS.notifSound, 'default')
  return SOUNDS.some((x) => x.id === s) ? (s as SoundId) : 'default'
}

const DAY = 86400000

const dismissed = () => new Set(read<string[]>(KEYS.attentionDismissed, []))
export function dismissAttention(key: string) {
  write(KEYS.attentionDismissed, [...dismissed(), key].slice(-300))
}

/**
 * Entries that came only from a receipt screenshot and that the bank's message never matched, a day later. Likely a payment that failed, was
 * reversed, or was read wrong. Only judged once the bank's messages are clearly being read (some entry in the last 30 days came from the bank).
 */
export function unconfirmed(all: Transaction[], now = Date.now()): Transaction[] {
  if (!all.some((t) => t.seenIn?.includes('bank') && t.timestamp > now - 30 * DAY)) return []
  const skip = dismissed()
  return all
    .filter((t) => t.seenIn?.includes('screen') && !t.seenIn.includes('bank') && now - t.timestamp > DAY && now - t.timestamp < 45 * DAY && !skip.has(t.id))
    .sort((a, b) => b.timestamp - a.timestamp)
}

export interface DuplicatePair { key: string; first: Transaction; second: Transaction; why: string }

/** Money that left twice: the same merchant and amount within 10 minutes, or a subscription charged twice within 25 days. */
export function duplicateCharges(all: Transaction[], now = Date.now()): DuplicatePair[] {
  const skip = dismissed()
  // the halves of a split or of "on behalf" are one payment, not two: transfer-type money is never a double charge
  const recent = all.filter((t) => t.paymentType === 'DEBIT' && t.timestamp > now - 60 * DAY && !isUnnamed(t) && !isTransferCategory(t.paymentCategory)).sort((a, b) => a.timestamp - b.timestamp)
  const out: DuplicatePair[] = []
  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const a = recent[i], b = recent[j]
      const gap = b.timestamp - a.timestamp
      if (gap > 25 * DAY) break
      if (a.paymentAmount !== b.paymentAmount || a.paymentReceiver.trim().toLowerCase() !== b.paymentReceiver.trim().toLowerCase()) continue
      if (a.ref && b.ref && a.ref === b.ref) continue
      const quick = gap <= 10 * 60000
      const sub = /subscri/i.test(a.paymentCategory) && gap <= 25 * DAY
      if (!quick && !sub) continue
      const key = `${a.id}|${b.id}`
      if (skip.has(key)) continue
      out.push({ key, first: a, second: b, why: quick ? 'Charged twice within minutes' : 'Subscription charged twice this month' })
    }
  }
  return out.sort((x, y) => y.second.timestamp - x.second.timestamp)
}

/** Payments that went out with no name on them and have not been looked at. */
export const needNaming = (all: Transaction[]) => all.filter((t) => t.paymentType === 'DEBIT' && isUnnamed(t) && !t.reviewed)

/** What was learned about a UPI id or mobile number: who it is. Kept on the phone, used for every later payment to it. */
export const numberNames = () => read<Record<string, string>>(KEYS.numberNames, {})
export function learnNumber(id: string, name: string) {
  if (!id || !name.trim()) return
  write(KEYS.numberNames, { ...numberNames(), [id.toLowerCase()]: name.trim() })
}
