import { useEffect, useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, useConfirm, useToast } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { formatPrice, toLocalInput } from '../lib/core/format'
import { tracksBalance } from '../lib/accounts/accounts'
import { addRepayment, createLoan, createLoanFromTransaction, deleteLoan, isSettledLoan, loanIsWith, loanTotals, outstanding, repaid, settleWithTransaction } from '../lib/payees/loans'
import PaymentPick from '../components/transactions/PaymentPick'
import { read } from '../lib/core/storage'
import type { Person } from '../lib/payees/peopleMatch'
import type { FamilyMember, Loan, PaymentMethod, Transaction } from '../lib/core/types'

/** Money lent to / borrowed from people, with partial repayments and due dates. */
export default function LoansPage({ onBack }: { onBack: () => void }) {
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [family] = useStored<FamilyMember[]>(KEYS.familyMembers, [])
  const [adding, setAdding] = useState<null | 'LENT' | 'BORROWED'>(null)
  const [repaying, setRepaying] = useState<Loan | null>(null)
  const [showSettled, setShowSettled] = useState(false)
  const confirm = useConfirm()
  const accounts = methods.filter(tracksBalance)
  const { owedToYou, youOwe } = loanTotals(loans)
  const open = loans.filter((l) => !isSettledLoan(l))
  const settled = loans.filter(isSettledLoan)
  const now = Date.now()

  const LoanCard = (l: Loan) => {
    const left = outstanding(l)
    const overdue = !!l.dueDate && l.dueDate < now && left > 0
    const lent = l.direction === 'LENT'
    return (
      <div key={l.id} className="card pad col" style={{ gap: 8 }}>
        <div className="row">
          <div className="tx-avatar" style={{ background: lent ? 'rgba(74,222,128,.15)' : 'rgba(255,107,107,.15)', color: lent ? 'var(--credit)' : 'var(--up)', fontWeight: 700 }}>{l.person.slice(0, 1).toUpperCase()}</div>
          <div className="grow">
            <div style={{ fontWeight: 700 }}>{l.person}</div>
            <div className="dim small">
              {lent ? 'You lent' : 'You borrowed'} {formatPrice(l.amount, { round: true })} · {new Date(l.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              {l.dueDate ? ` · due ${new Date(l.dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
            </div>
            {l.note && <div className="dim tiny">{l.note}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tiny dim">{left > 0 ? (lent ? 'owes you' : 'you owe') : 'settled'}</div>
            <div className="num" style={{ fontWeight: 800, color: left > 0 ? (lent ? 'var(--credit)' : 'var(--up)') : 'var(--text-45)' }}>{formatPrice(left, { round: true })}</div>
          </div>
        </div>
        {l.repayments.length > 0 && (
          <div className="bar" style={{ height: 6 }}><i style={{ width: `${Math.min(100, (repaid(l) / l.amount) * 100)}%`, background: lent ? 'var(--credit)' : 'var(--up)' }} /></div>
        )}
        <div className="row between small">
          <span style={{ color: overdue ? 'var(--danger)' : 'var(--text-45)' }}>{overdue ? 'Overdue' : l.repayments.length ? `${l.repayments.length} repayment${l.repayments.length === 1 ? '' : 's'} · ${formatPrice(repaid(l), { round: true })} back` : ''}</span>
          <div className="row" style={{ gap: 6 }}>
            {left > 0 && <button className="chip on" style={{ height: 30 }} onClick={() => setRepaying(l)}>{lent ? 'Got money back' : 'Paid back'}</button>}
            <button className="dim" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete this ${lent ? 'loan' : 'debt'}?`, body: 'Linked account entries stay as they are.', confirm: 'Delete', danger: true })) deleteLoan(l.id) }}><Icon name="trash" size={16} /></button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader title="Loans & IOUs" onBack={onBack} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="card pad"><div className="label">Owed to you</div><div className="h2 num" style={{ color: 'var(--credit)' }}>{formatPrice(owedToYou, { round: true })}</div></div>
        <div className="card pad"><div className="label">You owe</div><div className="h2 num" style={{ color: youOwe ? 'var(--up)' : undefined }}>{formatPrice(youOwe, { round: true })}</div></div>
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn sm grow" onClick={() => setAdding('LENT')}><Icon name="up" size={16} /> I lent money</button>
        <button className="btn sm secondary grow" onClick={() => setAdding('BORROWED')}><Icon name="down" size={16} /> I borrowed</button>
      </div>
      <div className="col" style={{ marginTop: 14 }}>
        {open.length === 0 && <div className="empty"><b>No open loans</b>Track money you lend to friends or family, or borrow — with reminders on the due date.</div>}
        {open.sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)).map(LoanCard)}
      </div>
      {settled.length > 0 && (
        <>
          <button className="link small" style={{ marginTop: 14 }} onClick={() => setShowSettled(!showSettled)}>{showSettled ? 'Hide' : 'Show'} settled ({settled.length})</button>
          {showSettled && <div className="col" style={{ marginTop: 10 }}>{settled.map(LoanCard)}</div>}
        </>
      )}
      <p className="dim tiny" style={{ marginTop: 14, lineHeight: 1.5 }}>Not counted as spending or income.</p>

      <NewLoanSheet direction={adding} onClose={() => setAdding(null)} accounts={accounts} family={family} />
      <RepaySheet loan={repaying} onClose={() => setRepaying(null)} accounts={accounts} />
    </div>
  )
}

function NewLoanSheet({ direction, onClose, accounts, family }: { direction: 'LENT' | 'BORROWED' | null; onClose: () => void; accounts: PaymentMethod[]; family: FamilyMember[] }) {
  const toast = useToast()
  const [person, setPerson] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [people] = useStored<Person[]>(KEYS.people, [])
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toLocalInput(Date.now()).slice(0, 10))
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [acc, setAcc] = useState<string | null>(null)
  // the money may already be in the list (the bank's message): link it instead of adding it again
  const [linked, setLinked] = useState<string | null>(null)
  const lent = direction === 'LENT'
  // a sheet closed without saving must not carry its half-typed loan into the next one
  useEffect(() => { if (direction) { setPerson(''); setPersonId(null); setAmount(''); setDate(toLocalInput(Date.now()).slice(0, 10)); setDue(''); setNote(''); setAcc(null); setLinked(null) } }, [direction])
  return (
    <Sheet open={!!direction} onClose={onClose}>
      <SheetHeader title={lent ? <>You lent</> : <>You borrowed</>} onClose={onClose} />
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        const a = Number(amount)
        const tx = linked ? read<Transaction[]>(KEYS.transactions, []).find((t) => t.id === linked) : undefined
        if (!person.trim() || !(a > 0 || tx) || !direction) return
        const typed = person.trim()
        const match = people.find((p) => p.id === personId) ?? people.find((p) => loanIsWith({ person: typed }, p))
        const dueDate = due ? new Date(`${due}T09:00`).getTime() : null
        if (tx) createLoanFromTransaction({ person: typed, personId: match?.id ?? null, direction, dueDate, note: note.trim() || null }, tx)
        else createLoan({ person: typed, personId: match?.id ?? null, direction, amount: a, date: new Date(date).getTime() || Date.now(), dueDate, note: note.trim() || null, accountId: acc })
        toast(lent ? 'Loan recorded' : 'Debt recorded', tx ? `Linked to ${tx.paymentReceiver} · ${formatPrice(tx.paymentAmount)}, not added again` : due ? 'You’ll get a reminder on the due date.' : undefined)
        setPerson(''); setPersonId(null); setAmount(''); setDue(''); setNote(''); setAcc(null); setLinked(null); onClose()
      }}>
        <input className="input" autoFocus value={person} onChange={(e) => { setPerson(e.target.value); setPersonId(null) }} placeholder={lent ? 'To whom? (e.g. Rahul)' : 'From whom? (e.g. Dad)'} />
        {(people.length > 0 || family.length > 0) && <div className="chips">
          {people.map((p) => <button type="button" key={p.id} className={`chip${personId === p.id ? ' on' : ''}`} onClick={() => { setPerson(p.name); setPersonId(p.id) }}>{p.relation ? `${p.name} · ${p.relation}` : p.name}</button>)}
          {family.filter((m) => !people.some((p) => p.familyId === m.id || p.name === m.name)).map((m) => <button type="button" key={m.id} className={`chip${!personId && person === m.name ? ' on' : ''}`} onClick={() => { setPerson(m.name); setPersonId(null) }}>{m.name}</button>)}
        </div>}
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
        <div className="row">
          <div className="field grow"><label>On</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field grow"><label>Due (optional)</label><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        <PaymentPick type={lent ? 'DEBIT' : 'CREDIT'} amount={Number(amount) || 0} near={new Date(date).getTime() || Date.now()} value={linked}
          onChange={(id) => { setLinked(id); const t = id ? read<Transaction[]>(KEYS.transactions, []).find((x) => x.id === id) : undefined; if (t) { setAmount(String(t.paymentAmount)); setDate(toLocalInput(t.timestamp).slice(0, 10)) } }}
          label={lent ? 'Already paid? Pick the payment' : 'Already received? Pick the payment'} />
        {accounts.length > 0 && !linked && (
          <div className="field"><label>{lent ? 'Paid from account (optional)' : 'Received in account (optional)'}</label>
            <div className="chips">{accounts.map((m) => <button type="button" key={m.id} className={`chip${acc === m.id ? ' on' : ''}`} onClick={() => setAcc(acc === m.id ? null : m.id)}>{m.name}</button>)}</div>
          </div>
        )}
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}

function RepaySheet({ loan, onClose, accounts }: { loan: Loan | null; onClose: () => void; accounts: PaymentMethod[] }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [acc, setAcc] = useState<string | null>(null)
  const [linked, setLinked] = useState<string | null>(null)
  const left = loan ? outstanding(loan) : 0
  useEffect(() => { setAmount(''); setAcc(null); setLinked(null) }, [loan?.id])
  const backIn = loan?.direction === 'LENT'
  return (
    <Sheet open={!!loan} onClose={onClose}>
      <SheetHeader title={loan?.direction === 'LENT' ? <>{loan?.person} paid back.</> : <>You paid back</>} sub={`${formatPrice(left)} outstanding`} onClose={onClose} />
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        const tx = linked ? read<Transaction[]>(KEYS.transactions, []).find((t) => t.id === linked) : undefined
        if (!loan || !(Number(amount) > 0 || tx)) return
        if (tx) settleWithTransaction(tx, loan.id)
        const next = tx ? read<Loan[]>(KEYS.loans, []).find((l) => l.id === loan.id) ?? null : addRepayment(loan.id, Number(amount), acc)
        toast(next && isSettledLoan(next) ? 'Fully settled' : 'Repayment recorded', next ? `${formatPrice(outstanding(next))} left${tx ? ' · linked, not added again' : ''}` : undefined)
        setAmount(''); setAcc(null); setLinked(null); onClose()
      }}>
        <div className="row">
          <input className="input grow" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
          <button type="button" className="btn sm secondary" onClick={() => setAmount(String(left))}>All</button>
        </div>
        <PaymentPick type={backIn ? 'CREDIT' : 'DEBIT'} amount={Number(amount) || left} value={linked}
          onChange={(id) => { setLinked(id); const t = id ? read<Transaction[]>(KEYS.transactions, []).find((x) => x.id === id) : undefined; if (t) setAmount(String(Math.min(t.paymentAmount, left))) }}
          label={backIn ? 'Already received? Pick the payment' : 'Already paid? Pick the payment'} />
        {accounts.length > 0 && !linked && (
          <div className="field"><label>{loan?.direction === 'LENT' ? 'Into account (optional)' : 'From account (optional)'}</label>
            <div className="chips">{accounts.map((m) => <button type="button" key={m.id} className={`chip${acc === m.id ? ' on' : ''}`} onClick={() => setAcc(acc === m.id ? null : m.id)}>{m.name}</button>)}</div>
          </div>
        )}
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}
