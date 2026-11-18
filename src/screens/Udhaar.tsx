import { useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, useConfirm, useToast } from '../components/ui/ui'
import { formatPrice } from '../lib/core/format'
import { useStored, KEYS } from '../lib/core/storage'
import { tracksBalance } from '../lib/accounts/accounts'
import { addCredit, creditTotals, isOverdue, knownCustomers, owedOf, receivePayment, removeCredit } from '../lib/payees/udhaar'
import type { CreditSale, PaymentMethod } from '../lib/core/types'

/** Customers who owe the shop. Not income until they pay. */
export default function UdhaarPage({ onBack }: { onBack: () => void }) {
  const [list] = useStored<CreditSale[]>(KEYS.creditSales, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState<CreditSale | null>(null)
  const [showPaid, setShowPaid] = useState(false)
  const confirm = useConfirm()
  const t = creditTotals(list)
  const open = list.filter((c) => owedOf(c) > 0).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))
  const done = list.filter((c) => owedOf(c) <= 0)
  const fmt = (v: number) => formatPrice(v, { round: true })
  const day = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  const card = (c: CreditSale) => (
    <div key={c.id} className="card pad col" style={{ gap: 6 }}>
      <div className="row between">
        <div><div style={{ fontWeight: 700 }}>{c.customer}</div><div className="dim small">{fmt(c.amount)} on {day(c.date)}{c.due ? ` · due ${day(c.due)}` : ''}{c.note ? ` · ${c.note}` : ''}</div></div>
        <div style={{ textAlign: 'right' }}>
          <div className="tiny dim">{owedOf(c) > 0 ? 'owes' : 'paid'}</div>
          <b className="num" style={{ color: isOverdue(c) ? 'var(--danger)' : owedOf(c) > 0 ? 'var(--amber)' : 'var(--credit)' }}>{fmt(owedOf(c) > 0 ? owedOf(c) : c.amount)}</b>
        </div>
      </div>
      <div className="row between small">
        <span style={{ color: isOverdue(c) ? 'var(--danger)' : 'var(--text-45)' }}>{isOverdue(c) ? 'Overdue' : c.payments.length ? `${fmt(c.payments.reduce((a, p) => a + p.amount, 0))} paid so far` : ''}</span>
        <div className="row" style={{ gap: 6 }}>
          {owedOf(c) > 0 && <button className="chip on" style={{ height: 30 }} onClick={() => setPaying(c)}>Got payment</button>}
          <button className="dim" aria-label="Delete" onClick={async () => { if (await confirm({ title: 'Delete this entry?', body: 'Payments already recorded as income stay.', confirm: 'Delete', danger: true })) removeCredit(c.id) }}><Icon name="trash" size={16} /></button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="page">
      <PageHeader title="Customer credit" onBack={onBack} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="card pad"><div className="label">Customers owe</div><div className="h2 num" style={{ color: t.owed ? 'var(--amber)' : undefined }}>{fmt(t.owed)}</div></div>
        <div className="card pad"><div className="label">Overdue</div><div className="h2 num" style={{ color: t.overdue ? 'var(--danger)' : undefined }}>{fmt(t.overdue)}</div></div>
      </div>
      <button className="btn block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}><Icon name="plus" size={18} />Sold on credit</button>
      <div className="col" style={{ marginTop: 14 }}>
        {open.length === 0 && <div className="empty"><b>Nobody owes you</b>Write down goods given on credit. It becomes income when the customer pays, not before.</div>}
        {open.map(card)}
      </div>
      {done.length > 0 && (
        <>
          <button className="link small" style={{ marginTop: 14 }} onClick={() => setShowPaid(!showPaid)}>{showPaid ? 'Hide' : 'Show'} paid ({done.length})</button>
          {showPaid && <div className="col" style={{ marginTop: 10 }}>{done.map(card)}</div>}
        </>
      )}
      <p className="dim tiny" style={{ marginTop: 14, lineHeight: 1.5 }}>Credit given is not counted as sales until it is paid, so the plan never counts money you do not have.</p>
      <NewCreditSheet open={adding} onClose={() => setAdding(false)} />
      <PaySheet credit={paying} onClose={() => setPaying(null)} accounts={methods.filter(tracksBalance)} />
    </div>
  )
}

function NewCreditSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [list] = useStored<CreditSale[]>(KEYS.creditSales, [])
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Sold on credit</>} onClose={onClose} />
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        const a = Number(amount)
        if (!name.trim() || !(a > 0)) return
        addCredit(name, a, due ? new Date(`${due}T09:00`).getTime() : null, note)
        toast('Credit written down', `${name.trim()} owes ${formatPrice(a, { round: true })}`)
        setName(''); setAmount(''); setDue(''); setNote(''); onClose()
      }}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
        {knownCustomers(list).length > 0 && <div className="chips" style={{ flexWrap: 'wrap' }}>{knownCustomers(list).map((n) => <button type="button" key={n} className={`chip${name === n ? ' on' : ''}`} onClick={() => setName(n)}>{n}</button>)}</div>}
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
        <div className="field"><label>Promised by (optional)</label><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was it for (optional)" />
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}

function PaySheet({ credit, onClose, accounts }: { credit: CreditSale | null; onClose: () => void; accounts: PaymentMethod[] }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [where, setWhere] = useState<string>('CASH')
  const left = credit ? owedOf(credit) : 0
  return (
    <Sheet open={!!credit} onClose={onClose}>
      <SheetHeader title={credit ? <>{credit.customer} paid.</> : ''} sub={`${formatPrice(left, { round: true })} outstanding`} onClose={onClose} />
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        if (!credit || !(Number(amount) > 0)) return
        const next = receivePayment(credit.id, Number(amount), where === 'CASH' ? { cash: true } : { accountId: where })
        toast('Payment recorded as income', next && owedOf(next) > 0 ? `${formatPrice(owedOf(next), { round: true })} still to come` : 'All paid')
        setAmount(''); onClose()
      }}>
        <div className="row"><input className="input grow" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" /><button type="button" className="btn sm secondary" onClick={() => setAmount(String(left))}>All</button></div>
        <div className="field"><label>Received as</label>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`chip${where === 'CASH' ? ' on' : ''}`} onClick={() => setWhere('CASH')}>Cash</button>
            {accounts.map((m) => <button type="button" key={m.id} className={`chip${where === m.id ? ' on' : ''}`} onClick={() => setWhere(m.id)}>{m.name}</button>)}
          </div>
        </div>
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}
