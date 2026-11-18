// Auto-categorise rules: "anything mentioning Zomato → Food", "UPI to 98xxxx → Family".
// Rules win over the parsers' guesses. They're created by hand in Settings, or
// learned when the user corrects a category (one tap on the "Always?" prompt).
import { read, write, uid, KEYS } from '../core/storage'
import type { CategoryRule, NewTransaction } from '../core/types'

export const getRules = () => read<CategoryRule[]>(KEYS.categoryRules, [])

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The first rule whose text appears in the payee or note (and whose direction fits). */
export function matchRule(t: Pick<NewTransaction, 'paymentReceiver' | 'note' | 'paymentType'>, rules = getRules()): CategoryRule | null {
  const hay = norm(`${t.paymentReceiver ?? ''} ${t.note ?? ''}`)
  if (!hay) return null
  return rules.find((r) => r.match && hay.includes(norm(r.match)) && (!r.type || r.type === t.paymentType)) ?? null
}

/** Adds or updates the rule for a payee. Returns it. */
export function learnRule(match: string, category: string, type?: 'DEBIT' | 'CREDIT' | null) {
  const m = norm(match)
  if (!m) return null
  const rules = getRules()
  const existing = rules.find((r) => norm(r.match) === m && (r.type ?? null) === (type ?? null))
  const rule: CategoryRule = existing ? { ...existing, category } : { id: uid(), match: match.trim(), type: type ?? null, category, createdAt: Date.now() }
  write(KEYS.categoryRules, existing ? rules.map((r) => (r.id === existing.id ? rule : r)) : [rule, ...rules])
  return rule
}

export function deleteRule(id: string) {
  write(KEYS.categoryRules, getRules().filter((r) => r.id !== id))
}

/** Counts how often each rule fired, so the Rules screen can show it. */
export function noteRuleHit(id: string) {
  write(KEYS.categoryRules, getRules().map((r) => (r.id === id ? { ...r, hits: (r.hits ?? 0) + 1 } : r)))
}
