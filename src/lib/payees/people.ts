// Linking payments to people from your contacts, and marking some of them as family.
import { write, uid, KEYS } from '../core/storage'
import { getAll, updateTransaction } from '../core/data'
import { FAMILY, getFamily } from '../core/money'
import { isTransferCategory } from '../accounts/accounts'
import { getPeople, normName, phone10, type Person } from './peopleMatch'
import { Contacts, isNativeApp } from '../core/native'
import type { FamilyMember, Transaction } from '../core/types'

export interface PhoneContact { id: string; name: string; phones: string[] }

/** The phone's address book (name and numbers only), asking permission the first time. Empty in the browser. */
export async function loadPhoneContacts(): Promise<PhoneContact[]> {
  if (!isNativeApp()) return []
  const { contacts } = await Contacts.list()
  write(KEYS.contactsUsed, true)
  return contacts
}

const save = (people: Person[]) => write(KEYS.people, people)

/** Adds every contact that has a number and is not saved yet (matched by the phone's contact id or by a number). One write, however many. */
export function addContactsInBulk(contacts: PhoneContact[]): { added: number; total: number } {
  const people = getPeople()
  const byContact = new Set(people.map((p) => p.contactId).filter(Boolean))
  const byPhone = new Set(people.flatMap((p) => p.phones))
  const fresh: Person[] = []
  for (const c of contacts) {
    const phones = [...new Set(c.phones.map(phone10).filter((p): p is string => !!p))]
    if (!c.name.trim() || !phones.length || byContact.has(c.id) || phones.every((p) => byPhone.has(p))) continue
    fresh.push({ id: uid(), name: c.name.trim(), phones, aliases: [], contactId: c.id, relation: null, familyId: null, imported: true, createdAt: Date.now() })
    byContact.add(c.id); phones.forEach((p) => byPhone.add(p))
  }
  if (fresh.length) save([...people, ...fresh])
  return { added: fresh.length, total: people.length + fresh.length }
}

/** Reads the whole address book (asking permission the first time) and adds it, so a payment to a number gets the person's name. */
export async function importAllContacts() {
  return addContactsInBulk(await loadPhoneContacts())
}

/** Adds a person, or returns the one you already have for the same contact / number. */
export function addPerson(input: { name: string; phones?: string[]; contactId?: string | null; relation?: string | null }): Person {
  const phones = [...new Set((input.phones ?? []).map(phone10).filter((p): p is string => !!p))]
  const people = getPeople()
  const existing = people.find((p) => (input.contactId && p.contactId === input.contactId) || (phones.length && p.phones.some((ph) => phones.includes(ph))))
  if (existing) {
    const merged = { ...existing, phones: [...new Set([...existing.phones, ...phones])] }
    save(people.map((p) => (p.id === existing.id ? merged : p)))
    return merged
  }
  const person: Person = { id: uid(), name: input.name.trim(), phones, aliases: [], contactId: input.contactId ?? null, relation: null, familyId: null, createdAt: Date.now() }
  save([...people, person])
  if (input.relation) return setRelation(person.id, input.relation) ?? person
  return person
}

export function updatePerson(id: string, patch: Partial<Person>) {
  save(getPeople().map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

/**
 * Marks a person as family (or clears it with null). Family people also appear in Money plan's family list,
 * and what you send them or get from them is filed under Family.
 */
export function setRelation(id: string, relation: string | null): Person | undefined {
  const person = getPeople().find((p) => p.id === id)
  if (!person) return undefined
  if (!relation) { updatePerson(id, { relation: null, familyId: null }); return { ...person, relation: null, familyId: null } }
  const members = getFamily()
  let member: FamilyMember | undefined = person.familyId ? members.find((m) => m.id === person.familyId) : members.find((m) => normName(m.name) === normName(person.name))
  if (!member) { member = { id: uid(), name: person.name, relation }; write(KEYS.familyMembers, [...members, member]) }
  else write(KEYS.familyMembers, members.map((m) => (m.id === member!.id ? { ...m, relation } : m)))
  updatePerson(id, { relation, familyId: member.id })
  return { ...person, relation, familyId: member.id }
}

/** Removes a person; their payments keep their names and go back to being ordinary payees. */
export function removePerson(id: string) {
  save(getPeople().filter((p) => p.id !== id))
  for (const t of getAll()) if (t.contactId === id) updateTransaction(t.id, { contactId: undefined })
}

/**
 * Links one payment to a person. With `rememberName`, the payee's exact name is remembered so future payments
 * under it link too (and, with `includePast`, the earlier ones). Without it only this payment is linked.
 */
export function linkTransaction(tx: Transaction, personId: string, opts: { rememberName?: boolean; includePast?: boolean } = {}) {
  const person = getPeople().find((p) => p.id === personId)
  if (!person) return 0
  const familyCategory = !!person.familyId
  // a loan or money handled for them keeps its category: it was never spending on family
  const apply = (t: Transaction) => updateTransaction(t.id, { contactId: personId, ...(familyCategory && !isTransferCategory(t.paymentCategory) ? { paymentCategory: FAMILY } : {}) })
  let n = 0
  apply(tx); n++
  if (opts.rememberName) {
    n += addAlias(personId, tx.paymentReceiver, opts.includePast, tx.id)
  }
  return n
}

/** Teaches a person another payee name (a nickname, or how a bank writes them) and links the earlier payments under it. */
export function addAlias(personId: string, payee: string, includePast = true, skipId?: string) {
  const person = getPeople().find((p) => p.id === personId)
  const alias = normName(payee)
  if (!person || !alias) return 0
  if (alias !== normName(person.name) && !person.aliases.some((a) => normName(a) === alias)) updatePerson(personId, { aliases: [...person.aliases, payee.trim()] })
  let n = 0
  if (includePast) for (const t of getAll()) if (t.id !== skipId && !t.contactId && normName(t.paymentReceiver) === alias) {
    updateTransaction(t.id, { contactId: personId, ...(person.familyId && !isTransferCategory(t.paymentCategory) ? { paymentCategory: FAMILY } : {}) }); n++
  }
  return n
}

export function unlinkTransaction(txId: string) {
  updateTransaction(txId, { contactId: undefined })
}

/** What you sent to and got from a person. */
export function personStats(personId: string, txns: Transaction[] = getAll()) {
  const mine = txns.filter((t) => t.contactId === personId).sort((a, b) => b.timestamp - a.timestamp)
  return {
    list: mine,
    sent: mine.filter((t) => t.paymentType === 'DEBIT').reduce((a, t) => a + t.paymentAmount, 0),
    received: mine.filter((t) => t.paymentType === 'CREDIT').reduce((a, t) => a + t.paymentAmount, 0),
  }
}
