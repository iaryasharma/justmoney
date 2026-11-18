// Round-up savings: every spend is rounded up to the next ₹10 (or ₹50, ₹100) and the
// difference is "saved" on paper. One tap moves the month's total into a savings goal.
import { read, write, KEYS } from '../core/storage'
import type { SavingsGoal, Transaction } from '../core/types'

export interface RoundUpSettings { enabled: boolean; step: 10 | 50 | 100; goalId: string | null; moved: Record<string, number> }
export const DEFAULT_ROUNDUP: RoundUpSettings = { enabled: false, step: 10, goalId: null, moved: {} }

export const getRoundUp = () => ({ ...DEFAULT_ROUNDUP, ...read<Partial<RoundUpSettings>>(KEYS.roundUp, {}) }) as RoundUpSettings

const keyOf = (y: number, m: number) => `${y}-${m + 1}`

/** Spare change from one amount: 245 → 5 at a ₹10 step. Whole-rupee amounts that already fit add nothing. */
export const spare = (amount: number, step: number) => {
  const r = Math.ceil(amount / step) * step - amount
  return r >= step ? 0 : Math.round(r * 100) / 100
}

/** This month's round-ups, and how much of it is still waiting to be moved. */
export function monthRoundUps(txns: Transaction[], s: RoundUpSettings, year: number, month: number) {
  const a = new Date(year, month, 1).getTime(), b = new Date(year, month + 1, 1).getTime()
  const rows = txns.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= a && t.timestamp < b && !t.loanId)
  const total = Math.round(rows.reduce((acc, t) => acc + spare(t.paymentAmount, s.step), 0) * 100) / 100
  const moved = s.moved[keyOf(year, month)] ?? 0
  return { total, moved, waiting: Math.max(0, Math.round((total - moved) * 100) / 100), count: rows.length }
}

/** Adds what is waiting to the chosen goal. Returns the amount moved (0 if nothing to do). */
export function moveRoundUps(txns: Transaction[], year: number, month: number): number {
  const s = getRoundUp()
  const goals = read<SavingsGoal[]>(KEYS.savingsGoals, [])
  const goal = goals.find((g) => g.id === s.goalId)
  const { waiting } = monthRoundUps(txns, s, year, month)
  if (!goal || waiting <= 0) return 0
  write(KEYS.savingsGoals, goals.map((g) => (g.id === goal.id ? { ...g, saved: Math.round((g.saved + waiting) * 100) / 100 } : g)))
  write(KEYS.roundUp, { ...s, moved: { ...s.moved, [keyOf(year, month)]: (s.moved[keyOf(year, month)] ?? 0) + waiting } })
  return waiting
}
