// "Put 10% of every salary towards my emergency fund": virtual savings that move your goal forward when pay arrives.
// No money moves in the bank; the goal's saved amount grows by the share you chose.
import { read, write, uid, KEYS } from '../core/storage'
import type { SavingsGoal, Transaction } from '../core/types'

export interface SavingsRule { id: string; percent: number; goalId: string; enabled: boolean }

export const getSavingsRules = () => read<SavingsRule[]>(KEYS.savingsRules, [])
export const addSavingsRule = (percent: number, goalId: string) => write(KEYS.savingsRules, [...getSavingsRules(), { id: uid(), percent, goalId, enabled: true }])
export const removeSavingsRule = (id: string) => write(KEYS.savingsRules, getSavingsRules().filter((r) => r.id !== id))
export const toggleSavingsRule = (id: string) => write(KEYS.savingsRules, getSavingsRules().map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))

/** A salary credit just arrived: move each rule's share into its goal. Returns what went where, for a notice. */
export function applySavingsRules(t: Pick<Transaction, 'paymentType' | 'paymentCategory' | 'paymentAmount'>): { goal: string; amount: number }[] {
  if (t.paymentType !== 'CREDIT' || t.paymentCategory !== 'Salary') return []
  const rules = getSavingsRules().filter((r) => r.enabled)
  if (!rules.length) return []
  const goals = read<SavingsGoal[]>(KEYS.savingsGoals, [])
  const moved: { goal: string; amount: number }[] = []
  const next = goals.map((g) => {
    const mine = rules.filter((r) => r.goalId === g.id)
    if (!mine.length || g.saved >= g.target) return g
    const add = Math.min(g.target - g.saved, Math.round(mine.reduce((a, r) => a + (t.paymentAmount * r.percent) / 100, 0)))
    if (add <= 0) return g
    moved.push({ goal: g.name, amount: add })
    return { ...g, saved: g.saved + add }
  })
  if (moved.length) write(KEYS.savingsGoals, next)
  return moved
}
