// People you linked from your contacts, and how a payment finds its person.
// A phone number in the payment is unique, so it always links. A name is not (two people can share one),
// so a name only links when you chose "remember this name" for that exact payee.
import { read, KEYS } from '../core/storage'

export interface Person {
  id: string
  name: string
  /** last 10 digits of each number */
  phones: string[]
  /** payee names that mean this person (nicknames, how a bank writes them), as you typed them */
  aliases: string[]
  /** the matching entry in Money plan's family list, when this person is family */
  familyId?: string | null
  relation?: string | null
  /** the phone's own contact id, when picked from the address book */
  contactId?: string | null
  /** brought in with "import all contacts": used to name payments, shown in lists only once they have a payment, a loan or a family tag */
  imported?: boolean
  createdAt: number
}

export const getPeople = () => read<Person[]>(KEYS.people, [])

export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Last 10 digits of a phone number ("+91 98765-43210" → "9876543210"), or null if it is not one. */
export function phone10(s: string): string | null {
  const d = s.replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

/** Every Indian-style mobile number written in the text (UPI IDs like 9876543210@ybl included). */
export function phonesIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/g)) out.add(m[1].replace(/\D/g, ''))
  return [...out]
}

const NOISE = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'smt', 'dr', 'upi', 'imps', 'neft', 'to', 'from', 'by', 'pvt', 'ltd'])

/** Lowercase words of a name without titles and bank noise ("MR. ROHAN MEHTA" → rohan, mehta). */
export const nameTokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !NOISE.has(w))

const subset = (a: string[], b: string[]) => a.every((x) => b.some((y) => y === x || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))))

/** Same person written differently: same words in any order, or one name's words all inside the other (min 2 words). */
export function sameName(payee: string, contact: string) {
  const a = nameTokens(payee), b = nameTokens(contact)
  if (a.length < 2 || b.length < 2) return false
  return a.length <= b.length ? subset(a, b) : subset(b, a)
}

/** The person a payment belongs to, if any: by phone number first, then by a name you chose to remember. */
export function findPerson(t: { paymentReceiver: string; note?: string }, people: Person[] = getPeople()): Person | undefined {
  if (!people.length) return undefined
  const numbers = phonesIn(`${t.paymentReceiver} ${t.note ?? ''}`)
  if (numbers.length) {
    const byPhone = people.find((p) => p.phones.some((ph) => numbers.includes(ph)))
    if (byPhone) return byPhone
  }
  const n = normName(t.paymentReceiver)
  const byAlias = n ? people.find((p) => p.aliases.some((a) => normName(a) === n)) : undefined
  if (byAlias || !read<boolean>(KEYS.autoLinkNames, false)) return byAlias
  // opt-in: a name that fits exactly one saved person
  const fits = people.filter((p) => sameName(t.paymentReceiver, p.name))
  return fits.length === 1 ? fits[0] : undefined
}

/** How a person should be called in lists: their contact name. */
export const personLabel = (p: Pick<Person, 'name' | 'relation'>) => (p.relation ? `${p.name} · ${p.relation}` : p.name)
