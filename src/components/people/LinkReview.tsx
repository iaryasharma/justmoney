import { useMemo, useState } from 'react'
import ContactPicker, { Avatar } from './ContactPicker'
import { Icon, Sheet, SheetHeader, useToast } from '../ui/ui'
import { formatPrice } from '../../lib/core/format'
import { linkTransaction } from '../../lib/payees/people'
import { normName, type Person } from '../../lib/payees/peopleMatch'
import { looksLikePerson, personFor, rejectSuggestion, suggest, useCandidates, type Candidate } from '../../lib/payees/suggest'
import { useStored, KEYS } from '../../lib/core/storage'
import type { Transaction } from '../../lib/core/types'

interface Group { key: string; payee: string; txns: Transaction[]; total: number; guess?: Candidate }

/** Every unlinked payment from someone, grouped by payee, each with its best contact guess: link a whole month in one pass. */
export default function LinkReview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [rej] = useStored<Record<string, string[]>>(KEYS.linkRejects, {})
  const candidates = useCandidates()
  const [type, setType] = useState<'CREDIT' | 'DEBIT'>('CREDIT')
  const [skipped, setSkipped] = useState<string[]>([])
  const [choosing, setChoosing] = useState<Group | null>(null)

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>()
    for (const t of txns) {
      if (t.paymentType !== type || t.contactId || t.loanId || !looksLikePerson(t.paymentReceiver, t.paymentCategory)) continue
      const key = normName(t.paymentReceiver)
      if (!key || skipped.includes(key)) continue
      const g = m.get(key) ?? { key, payee: t.paymentReceiver.trim(), txns: [], total: 0 }
      g.txns.push(t); g.total += t.paymentAmount
      m.set(key, g)
    }
    return [...m.values()].map((g) => ({ ...g, guess: suggest(g.payee, candidates) })).sort((a, b) => Number(!!b.guess) - Number(!!a.guess) || b.txns.length - a.txns.length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, type, skipped, rej, candidates.all.length])

  const link = (g: Group, p: Person) => {
    let n = 0
    for (const t of g.txns) n += linkTransaction(t, p.id, { rememberName: n === 0, includePast: false }) 
    toast(`Linked to ${p.name}`, `${g.txns.length} payment${g.txns.length === 1 ? '' : 's'} named “${g.payee}”`)
  }
  const sure = groups.filter((g) => g.guess)

  return (
    <>
      <Sheet open={open} onClose={onClose} full>
        <SheetHeader title={<>Link payments</>} sub="Match payee names to people. Everything stays on this device." onClose={onClose} />
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button className={type === 'CREDIT' ? 'on' : ''} onClick={() => setType('CREDIT')}>Money in</button>
          <button className={type === 'DEBIT' ? 'on' : ''} onClick={() => setType('DEBIT')}>Money out</button>
        </div>
        {sure.length > 1 && (
          <button className="btn block" style={{ marginBottom: 12 }} onClick={() => sure.forEach((g) => link(g, personFor(g.guess!)))}>
            <Icon name="check" size={18} />Accept all {sure.length} suggestions
          </button>
        )}
        <div className="card">
          {groups.length === 0 && <div className="empty small">Nothing to link. Payments from shops and banks are left out.</div>}
          {groups.map((g) => (
            <div key={g.key} className="list-row" style={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
              <Avatar name={g.guess?.name ?? g.payee} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{g.payee}</div>
                <div className="dim small">{g.txns.length} payment{g.txns.length === 1 ? '' : 's'} · {formatPrice(g.total, { round: true })}</div>
              </div>
              {g.guess ? (
                <div className="row" style={{ gap: 6, flexBasis: '100%', paddingLeft: 52 }}>
                  <button className="btn sm grow" onClick={() => link(g, personFor(g.guess!))}>Link to {g.guess.name}</button>
                  <button className="qchip" onClick={() => { rejectSuggestion(g.payee, g.guess!) }}>Not them</button>
                </div>
              ) : (
                <div className="row" style={{ gap: 6 }}>
                  <button className="qchip" onClick={() => setChoosing(g)}>Choose</button>
                  <button className="qchip" onClick={() => setSkipped([...skipped, g.key])}>Skip</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Sheet>
      <ContactPicker open={!!choosing} onClose={() => setChoosing(null)} title={choosing ? `Who is “${choosing.payee}”?` : ''}
        onPick={(p) => { if (choosing) link(choosing, p); setChoosing(null) }} />
    </>
  )
}
