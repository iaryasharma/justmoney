import { useMemo, useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { useStored, uid, KEYS } from '../lib/core/storage'
import { categoryIcon, withFamily } from '../lib/core/data'
import { formatPrice } from '../lib/core/format'
import { plannedIncome } from '../lib/core/money'
import { monthTxns } from './Home'
import type { Transaction } from '../lib/core/types'

export interface Envelope { id: string; name: string; color: string; categories: string[]; amount: number; /** unspent money from last month is added to this month */ rollover?: boolean }

const COLORS = ['#8b5cf6', '#00C7BE', '#FF9500', '#FF2D55', '#0A84FF', '#34C759']

/** The classic 50/30/20 split of take-home income, mapped onto the categories the app already has. */
const PRESET: { name: string; share: number; color: string; categories: string[] }[] = [
  { name: 'Needs', share: 0.5, color: '#0A84FF', categories: ['Rent', 'Grocery', 'Health', 'EMI/Bill', 'Family'] },
  { name: 'Fun', share: 0.3, color: '#FF9500', categories: ['Food', 'Shopping', 'Travel', 'Subscriptions', 'Others'] },
  { name: 'Savings', share: 0.2, color: '#34C759', categories: ['Investments'] },
]

/** Planner page: split the month's money into envelopes and see what is left in each. */
export default function EnvelopesPage({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [list, setList] = useStored<Envelope[]>(KEYS.envelopes, [])
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [editing, setEditing] = useState<Envelope | 'new' | null>(null)
  const cats = withFamily(categories)
  const now = new Date()
  const txns = useMemo(() => monthTxns(all, now.getFullYear(), now.getMonth()), [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const income = plannedIncome()
  const prevTxns = useMemo(() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return monthTxns(all, d.getFullYear(), d.getMonth()) }, [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const sumIn = (list: Transaction[], e: Envelope) => list.filter((t) => t.paymentType === 'DEBIT' && e.categories.includes(t.paymentCategory)).reduce((a, t) => a + t.paymentAmount, 0)
  const spentIn = (e: Envelope) => sumIn(txns, e)
  /** One month of carry-over (never compounding): what was left of last month's own envelope. */
  const carryOf = (e: Envelope) => (e.rollover ? Math.max(0, e.amount - sumIn(prevTxns, e)) : 0)
  const allocated = list.reduce((a, e) => a + e.amount, 0)
  const used = new Set(list.flatMap((e) => e.categories))
  const loose = cats.filter((c) => !used.has(c))
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1

  const preset = () => {
    if (!(income > 0)) { toast('Add your income first', 'Planner → Income'); return }
    setList(PRESET.map((p) => ({ id: uid(), name: p.name, color: p.color, amount: Math.round((income * p.share) / 100) * 100, categories: p.categories.filter((c) => cats.includes(c)) })))
    toast('Envelopes ready', '50% needs · 30% fun · 20% savings')
  }

  return (
    <div className="page">
      <PageHeader title="Envelopes" onBack={onBack} right={<button className="btn sm" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Envelope</button>} />
      <p className="screen-sub" style={{ marginTop: -6 }}>What is left in each envelope this month.</p>

      {list.length === 0 ? (
        <div className="card pad col" style={{ gap: 12, alignItems: 'center', textAlign: 'center', marginTop: 16 }}>
          <span className="icon-tile" style={{ width: 52, height: 52, borderRadius: 18, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="wallet" size={26} /></span>
          <b>No envelopes yet</b>
          <div className="muted small">Start with the 50/30/20 rule based on your income{income > 0 ? ` (${formatPrice(income, { round: true })}/mo)` : ''}, then adjust.</div>
          <button className="btn block" onClick={preset}>Create 50/30/20 envelopes</button>
          <button className="btn block secondary" onClick={() => setEditing('new')}>Build my own</button>
        </div>
      ) : (
        <>
          <div className="card pad row between" style={{ marginTop: 14 }}>
            <div><div className="label">Allocated</div><div className="num" style={{ fontSize: 24, fontWeight: 800 }}>{formatPrice(allocated, { round: true })}</div></div>
            <div style={{ textAlign: 'right' }}><div className="label">Income</div><div className="num" style={{ fontSize: 18, fontWeight: 700, color: income && allocated > income ? 'var(--danger)' : undefined }}>{income ? formatPrice(income, { round: true }) : '—'}</div></div>
          </div>
          <div className="col" style={{ marginTop: 12 }}>
            {list.map((e) => {
              const spent = spentIn(e)
              const carry = carryOf(e)
              const cap = e.amount + carry
              const left = cap - spent
              const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
              const over = left < 0
              const color = over ? 'var(--danger)' : pct >= 80 ? 'var(--amber)' : e.color
              const perDay = !over && daysLeft > 0 ? left / daysLeft : 0
              const r = 26, c = 2 * Math.PI * r
              return (
                <button key={e.id} className="card pad row" style={{ gap: 14, textAlign: 'left', width: '100%' }} onClick={() => setEditing(e)} aria-label={`${e.name}: ${formatPrice(Math.abs(left), { round: true })} ${over ? 'over' : 'left'}`}>
                  <svg className="env-ring" width="64" height="64" viewBox="0 0 64 64" aria-hidden>
                    <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(var(--fg),.1)" strokeWidth="7" />
                    <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
                  </svg>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row between"><b>{e.name}</b><b className="num" style={{ color: over ? 'var(--danger)' : undefined }}>{formatPrice(Math.abs(left), { round: true })} {over ? 'over' : 'left'}</b></span>
                    <span className="dim small" style={{ display: 'block' }}>{formatPrice(spent, { round: true })} of {formatPrice(cap, { round: true })} · {pct}%{carry > 0 ? ` · incl. ${formatPrice(carry, { round: true })} carried over` : ''}</span>
                    {perDay > 0 && <span className="dim tiny" style={{ display: 'block' }}>≈ {formatPrice(perDay, { round: true })}/day for {daysLeft} more day{daysLeft === 1 ? '' : 's'}</span>}
                    <span className="row wrap tiny dim" style={{ gap: 4, marginTop: 4 }}>{e.categories.slice(0, 5).map((c) => <span key={c} className="row" style={{ gap: 2 }}><Icon name={categoryIcon(c)} size={11} />{c}</span>)}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {loose.length > 0 && <p className="dim small" style={{ marginTop: 12 }}>Not in any envelope: {loose.join(', ')}</p>}
        </>
      )}

      <EnvelopeSheet value={editing} cats={cats} takenBy={(c, id) => list.find((e) => e.id !== id && e.categories.includes(c))?.name}
        onClose={() => setEditing(null)}
        onSave={(e) => { setList(list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e]); setEditing(null) }}
        onDelete={async (e) => { if (await confirm({ title: `Delete "${e.name}"?`, body: 'Its categories go back to unassigned. No transactions change.', confirm: 'Delete', danger: true })) { setList(list.filter((x) => x.id !== e.id)); setEditing(null) } }} />
    </div>
  )
}

function EnvelopeSheet({ value, cats, takenBy, onClose, onSave, onDelete }: {
  value: Envelope | 'new' | null; cats: string[]; takenBy: (c: string, id: string) => string | undefined
  onClose: () => void; onSave: (e: Envelope) => void; onDelete: (e: Envelope) => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [picked, setPicked] = useState<string[]>([])
  const [rollover, setRollover] = useState(false)
  const [seen, setSeen] = useState<unknown>(null)
  // reset the form whenever a different envelope is opened
  if (value !== seen) {
    setSeen(value)
    const e = value && value !== 'new' ? value : null
    setName(e?.name ?? ''); setAmount(e ? String(e.amount) : ''); setColor(e?.color ?? COLORS[0]); setPicked(e?.categories ?? []); setRollover(!!e?.rollover)
  }
  const existing = value && value !== 'new' ? value : null
  const id = existing?.id ?? 'new'
  return (
    <Sheet open={value !== null} onClose={onClose}>
      <SheetHeader title={existing ? 'Edit envelope' : 'New envelope'} onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(ev) => {
        ev.preventDefault()
        if (!name.trim() || !(Number(amount) > 0) || !picked.length) return
        onSave({ id: existing?.id ?? uid(), name: name.trim(), color, amount: Number(amount), categories: picked, rollover })
      }}>
        <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Needs, Fun money" autoFocus /></div>
        <div className="field"><label>Monthly amount</label><input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 10000" /></div>
        <div className="field"><label>Colour</label><div className="row" style={{ gap: 10 }}>{COLORS.map((c) => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 15, background: c, outline: c === color ? '3px solid var(--text)' : 'none', outlineOffset: 2 }} />)}</div></div>
        <div className="field"><label>Categories in this envelope</label>
          <div className="row wrap" style={{ gap: 8 }}>
            {cats.map((c) => {
              const other = takenBy(c, id)
              const on = picked.includes(c)
              return <button type="button" key={c} className={`chip${on ? ' on' : ''}`} style={{ opacity: other && !on ? 0.5 : 1 }} title={other ? `Currently in ${other}` : undefined}
                onClick={() => setPicked(on ? picked.filter((x) => x !== c) : [...picked, c])}><Icon name={categoryIcon(c)} size={14} />{c}</button>
            })}
          </div>
        </div>
        <div className="row between"><span><b className="small">Carry over what’s left</b><span className="dim tiny" style={{ display: 'block' }}>Unspent money rolls into next month</span></span><Toggle on={rollover} onChange={setRollover} label="Carry over leftover" /></div>
        <div className="row">
          {existing && <button type="button" className="btn danger" onClick={() => onDelete(existing)}><Icon name="trash" size={16} /></button>}
          <button className="btn grow" disabled={!name.trim() || !(Number(amount) > 0) || !picked.length}>Save envelope</button>
        </div>
      </form>
    </Sheet>
  )
}
