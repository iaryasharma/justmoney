// Deleted transactions wait here for 30 days so a mistake (or a bulk delete) can be undone,
// and every add / edit / delete / restore is logged so you can see what changed.
import { read, write, KEYS } from './storage'
import type { Transaction } from './types'

export interface TrashItem { tx: Transaction; deletedAt: number }
export type ActivityAction = 'added' | 'edited' | 'deleted' | 'restored'
export interface ActivityEntry { id: string; at: number; action: ActivityAction; title: string; amount: number; type: 'DEBIT' | 'CREDIT'; /** the entry as it was before this change, so the change can be undone */ before?: Transaction }

export const TRASH_DAYS = 30
const DAY = 86400000

export const getTrash = () => read<TrashItem[]>(KEYS.trash, [])
export const getActivity = () => read<ActivityEntry[]>(KEYS.activity, [])

/** Drops anything older than 30 days. Call on launch. */
export function purgeTrash(now = Date.now()) {
  const keep = getTrash().filter((i) => now - i.deletedAt < TRASH_DAYS * DAY)
  if (keep.length !== getTrash().length) write(KEYS.trash, keep)
}

export function moveToTrash(tx: Transaction) {
  write(KEYS.trash, [{ tx, deletedAt: Date.now() }, ...getTrash().filter((i) => i.tx.id !== tx.id)])
}

/** Removes the copy from the trash (used when it is restored). Returns it. */
export function takeFromTrash(id: string): Transaction | null {
  const item = getTrash().find((i) => i.tx.id === id)
  if (!item) return null
  write(KEYS.trash, getTrash().filter((i) => i.tx.id !== id))
  return item.tx
}

export const deleteForever = (id: string) => write(KEYS.trash, getTrash().filter((i) => i.tx.id !== id))
export const emptyTrash = () => write(KEYS.trash, [])

export function logActivity(action: ActivityAction, tx: Pick<Transaction, 'paymentReceiver' | 'paymentAmount' | 'paymentType'>, before?: Transaction) {
  const entry: ActivityEntry = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), action, title: tx.paymentReceiver, amount: tx.paymentAmount, type: tx.paymentType, ...(action === 'edited' && before ? { before } : {}) }
  write(KEYS.activity, [entry, ...getActivity()].slice(0, 200))
}

export const daysLeftInTrash = (deletedAt: number, now = Date.now()) => Math.max(0, TRASH_DAYS - Math.floor((now - deletedAt) / DAY))
