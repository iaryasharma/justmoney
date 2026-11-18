import { useMemo, useState } from 'react'
import { Icon, Sheet, SheetHeader, useToast } from '../ui/ui'
import { useStored, KEYS } from '../../lib/core/storage'
import { isNativeApp } from '../../lib/core/native'
import { normName, type Person } from '../../lib/payees/peopleMatch'
import { addPerson, loadPhoneContacts, type PhoneContact } from '../../lib/payees/people'

export const Avatar = ({ name, size = 40, family }: { name: string; size?: number; family?: boolean }) => (
  <span className="letter-avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: family ? 'var(--accent-deep)' : 'var(--glass)', color: family ? '#fff' : 'var(--text)', flex: 'none' }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>
)

/** Choose someone from the people you keep here, from the phone's contacts, or add one by hand. Nothing leaves the device. */
export default function ContactPicker({ open, onClose, onPick, title = 'Choose a contact' }: { open: boolean; onClose: () => void; onPick: (p: Person) => void; title?: string }) {
  const toast = useToast()
  const [people] = useStored<Person[]>(KEYS.people, [])
  const [q, setQ] = useState('')
  const [phone, setPhone] = useState<PhoneContact[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const native = isNativeApp()

  const needle = normName(q)
  const mine = useMemo(() => people.filter((p) => !needle || normName(p.name).includes(needle)), [people, needle])
  const fromPhone = useMemo(() => (phone ?? []).filter((c) => !needle || normName(c.name).includes(needle)).slice(0, 60), [phone, needle])

  const load = async () => {
    setBusy(true)
    try { setPhone(await loadPhoneContacts()) } catch { toast('Contacts not available', 'Allow contacts access to pick from your phone.') } finally { setBusy(false) }
  }
  const choose = (p: Person) => { setQ(''); onPick(p) }

  return (
    <Sheet open={open} onClose={onClose} full>
      <SheetHeader title={title} sub="Kept only on this device. Names and numbers are never uploaded." onClose={onClose} />
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search contacts" />
      {mine.length > 0 && <div className="section-label">Your people</div>}
      <div className="card">
        {mine.map((p) => (
          <button key={p.id} className="list-row" onClick={() => choose(p)}>
            <Avatar name={p.name} family={!!p.familyId} /><div className="grow" style={{ textAlign: 'left' }}><div>{p.name}</div>{p.relation && <div className="dim small">{p.relation}</div>}</div>
          </button>
        ))}
      </div>
      {native && phone === null && <button className="btn block" style={{ marginTop: 12 }} disabled={busy} onClick={load}><Icon name="users" size={18} />{busy ? 'Loading…' : 'Choose from phone contacts'}</button>}
      {phone && (
        <>
          <div className="section-label">Phone contacts</div>
          <div className="card">
            {fromPhone.length === 0 && <div className="empty small">No contact matches.</div>}
            {fromPhone.map((c) => (
              <button key={c.id} className="list-row" onClick={() => choose(addPerson({ name: c.name, phones: c.phones, contactId: c.id }))}>
                <Avatar name={c.name} /><div className="grow" style={{ textAlign: 'left' }}><div>{c.name}</div><div className="dim small">{c.phones[0] ?? ''}</div></div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="section-label">Add someone by hand</div>
      <form className="card pad col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const p = addPerson({ name, phones: number ? [number] : [] }); setName(''); setNumber(''); choose(p) }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
        <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="Phone number (optional, links UPI payments to it)" aria-label="Phone number" />
        <button className="btn block" disabled={!name.trim()}>Add</button>
      </form>
    </Sheet>
  )
}
