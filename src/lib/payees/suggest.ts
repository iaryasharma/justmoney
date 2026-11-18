// Guessing which contact a payment's name belongs to. A name is only ever a guess, so this suggests and you confirm;
// two people can share a name, and a payee with a single word ("Rohan") is too vague to guess at all.
import { useEffect, useState } from 'react'
import { read, write, KEYS } from '../core/storage'
import { isNativeApp } from '../core/native'
import { merchantLogo } from './brands'
import { loadPhoneContacts, addPerson } from './people'
import { getPeople, nameTokens, normName, sameName, type Person } from './peopleMatch'

export { nameTokens, sameName }

export interface Candidate { name: string; phones: string[]; personId?: string; contactId?: string }

export const rejects = () => read<Record<string, string[]>>(KEYS.linkRejects, {})
export function rejectSuggestion(receiver: string, c: Candidate) {
  const r = rejects(), k = normName(receiver)
  write(KEYS.linkRejects, { ...r, [k]: [...new Set([...(r[k] ?? []), normName(c.name)])] })
}

export interface Index { all: Candidate[]; byToken: Map<string, Candidate[]> }
export function buildIndex(cands: Candidate[]): Index {
  const byToken = new Map<string, Candidate[]>()
  for (const c of cands) for (const t of new Set(nameTokens(c.name))) (byToken.get(t) ?? byToken.set(t, []).get(t)!).push(c)
  return { all: cands, byToken }
}

/** The one contact this payee name could be, or undefined when there is none or more than one. */
export function suggest(receiver: string, idx: Index, rej: Record<string, string[]> = rejects()): Candidate | undefined {
  const toks = nameTokens(receiver)
  if (toks.length < 2) return undefined
  const seen = new Set<Candidate>()
  for (const t of toks) for (const c of idx.byToken.get(t) ?? []) seen.add(c)
  const declined = rej[normName(receiver)] ?? []
  const hits = [...seen].filter((c) => sameName(receiver, c.name) && !declined.includes(normName(c.name)))
  const names = new Set(hits.map((c) => normName(c.name)))
  return names.size === 1 ? hits[0] : undefined
}

let phoneCache: Candidate[] | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Loads the phone's contacts into memory (never stored) once the user has allowed access before. */
export async function warmContacts(force = false) {
  if (!isNativeApp() || phoneCache || (!force && !read<boolean>(KEYS.contactsUsed, false))) return
  try {
    phoneCache = (await loadPhoneContacts()).map((c) => ({ name: c.name, phones: c.phones, contactId: c.id }))
    write(KEYS.contactsUsed, true)
    emit()
  } catch { /* permission withdrawn: suggestions just use saved people */ }
}

const peopleAsCandidates = (people: Person[]): Candidate[] => people.map((p) => ({ name: p.name, phones: p.phones, personId: p.id, contactId: p.contactId ?? undefined }))

/** Saved people first, then phone contacts that are not saved yet. */
export function useCandidates(): Index {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l); warmContacts()
    return () => { listeners.delete(l) }
  }, [])
  const saved = peopleAsCandidates(getPeople())
  const savedNames = new Set(saved.map((c) => normName(c.name)))
  return buildIndex([...saved, ...(phoneCache ?? []).filter((c) => !savedNames.has(normName(c.name)))])
}

/** Turns a candidate into a saved person (if it is not one yet). */
export const personFor = (c: Candidate): Person => (c.personId ? getPeople().find((p) => p.id === c.personId)! : addPerson({ name: c.name, phones: c.phones, contactId: c.contactId }))

const BUSINESS = /\b(pvt|ltd|llp|limited|store|stores|mart|bank|enterprises|traders|services|solutions|technologies|cafe|restaurant|hotel|pharmacy|medical|petrol|fuel)\b|@|\d{5,}/i
const GENERIC = /^(expense|payment|money received|recd:?\s?imps)$/i

/** Could this payee be a person (not a shop, a bank or a generic label)? */
export const looksLikePerson = (payee: string, category = '') =>
  !!payee.trim() && !merchantLogo(payee) && !BUSINESS.test(payee) && !GENERIC.test(payee.trim()) && category !== 'Subscriptions' && category !== 'EMI/Bill'
