import { currentPlan } from '../lib/plan/plan'
import { useMemo, useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, useConfirm, useToast } from '../components/ui/ui'
import { useStored, uid, KEYS } from '../lib/core/storage'
import { addTransaction, categoryColor, withFamily } from '../lib/core/data'
import { formatPrice, monthRange, toLocalInput } from '../lib/core/format'
import {
  commitmentPaid, committedCategories, FAMILY, INCOME_CATEGORIES, isIncome, isPersonalSpend, plannedIncome, RELATIONS, sameName,
} from '../lib/core/money'
import type { Commitment, FamilyMember, IncomeSource, Transaction, User } from '../lib/core/types'

/**
 * Where the month's money goes before everyday spending (family support and other
 * commitments), what is left to spend, and where money came in from.
 */
export default function MoneyPlanPage({ onBack }: { onBack: () => void }) {
  const [user] = useStored<User | null>(KEYS.user, null)
  const [sources] = useStored<IncomeSource[]>(KEYS.incomeSources, [])
  const [commitments, setCommitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [family, setFamily] = useStored<FamilyMember[]>(KEYS.familyMembers, [])
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  const [sheet, setSheet] = useState<null | 'commitment' | 'receive' | 'member'>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const now = new Date()
  const { start, end } = monthRange(now.getFullYear(), now.getMonth())
  const month = useMemo(() => all.filter((t) => t.timestamp >= start && t.timestamp < end), [all, start, end])
  const committed = committedCategories(commitments)
  const income = plannedIncome(user, sources)
  const committedPlan = commitments.reduce((a, c) => a + c.amount, 0)
  const spendable = income - committedPlan
  const plan = currentPlan(all, now.getFullYear(), now.getMonth(), commitments)
  const spent = month.filter((t) => isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)
  const received = month.filter(isIncome)
  const receivedTotal = received.reduce((a, t) => a + t.paymentAmount, 0)
  const bySource = useMemo(() => {
    const m = new Map<string, { total: number; from: Map<string, number> }>()
    for (const t of received) {
      const cat = INCOME_CATEGORIES.includes(t.paymentCategory) ? t.paymentCategory : 'Other income'
      const e = m.get(cat) ?? { total: 0, from: new Map() }
      e.total += t.paymentAmount
      if (t.paymentReceiver && t.paymentReceiver !== cat) e.from.set(t.paymentReceiver, (e.from.get(t.paymentReceiver) ?? 0) + t.paymentAmount)
      m.set(cat, e)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [received])
  const memberName = (id?: string | null) => family.find((m) => m.id === id)?.name

  function markSent(c: Commitment) {
    const left = Math.max(0, c.amount - commitmentPaid(c, month, family))
    if (!left) { toast('Already done for this month'); return }
    addTransaction({ paymentAmount: left, paymentType: 'DEBIT', paymentReceiver: memberName(c.memberId) ?? c.name, paymentCategory: c.category, note: '#commitment' })
    toast('Recorded', `${formatPrice(left)} → ${memberName(c.memberId) ?? c.name}`)
  }

  return (
    <div className="page">
      <PageHeader title="Money plan" onBack={onBack} />

      <div className="card pad col" style={{ gap: 10 }}>
        <div className="row between"><span className="muted">Monthly income</span><b className="num">{formatPrice(income, { round: true })}</b></div>
        {commitments.map((c) => (
          <div key={c.id} className="row between small"><span className="muted">− {c.name}{memberName(c.memberId) ? ` (${memberName(c.memberId)})` : ''}</span><span className="num">{formatPrice(c.amount, { round: true })}</span></div>
        ))}
        <div className="row between" style={{ borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
          <span>Left after family and bills</span>
          <span className="h2 num" style={{ color: spendable < 0 ? 'var(--danger)' : undefined }}>{formatPrice(spendable, { round: true })}</span>
        </div>
        {spendable > 0 && plan.saveTarget > 0 && (
          <div className="row between small" style={{ background: 'var(--accent-soft)', borderRadius: 12, padding: '10px 12px' }}>
            <span>Save {formatPrice(plan.saveTarget, { round: true })} first, then spend up to</span>
            <b className="num">{formatPrice(plan.limit, { round: true })}</b>
          </div>
        )}
        {income > 0 && spendable > 0 && (
          <>
            <div className="bar"><i style={{ width: `${Math.min(100, (spent / spendable) * 100)}%`, background: spent > spendable ? 'var(--danger)' : 'var(--toggle)' }} /></div>
            <div className="row between tiny dim"><span>{formatPrice(spent, { round: true })} spent this month</span><span>{spent > spendable ? `${formatPrice(spent - spendable, { round: true })} over` : `${formatPrice(spendable - spent, { round: true })} left`}</span></div>
          </>
        )}
        {!income && <div className="small" style={{ color: 'var(--amber)' }}>Add your monthly income in Planner → Income to see what's spendable.</div>}
        {spendable < 0 && <div className="small" style={{ color: 'var(--danger)' }}>Commitments are more than your income.</div>}
      </div>

      <div className="row between"><div className="section-label">Commitments</div><button className="link small" onClick={() => setSheet('commitment')}>+ Add</button></div>
      <div className="col">
        {commitments.length === 0 && (
          <button className="card pad row" style={{ textAlign: 'left' }} onClick={() => setSheet('commitment')}>
            <Icon name="users" /><div className="grow"><b>Send money to family every month?</b><div className="dim small">Add it here — it comes out of your income first, and the rest is your spending budget.</div></div>
          </button>
        )}
        {commitments.map((c) => {
          const paid = commitmentPaid(c, month, family)
          const done = paid >= c.amount
          return (
            <div key={c.id} className="card pad col" style={{ gap: 8 }}>
              <div className="row between">
                <div>
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <div className="dim small">{memberName(c.memberId) ? `to ${memberName(c.memberId)} · ` : ''}{formatPrice(c.amount)}/month · {c.category}</div>
                </div>
                <button className="dim" aria-label="Remove commitment" onClick={async () => {
                  if (await confirm({ title: `Remove "${c.name}"?`, body: 'Past transfers stay in your list.', confirm: 'Remove', danger: true })) setCommitments(commitments.filter((x) => x.id !== c.id))
                }}><Icon name="trash" size={18} /></button>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, (paid / c.amount) * 100)}%`, background: done ? 'var(--toggle)' : '#F4A261' }} /></div>
              <div className="row between small">
                <span className="muted">{done ? 'Done for this month' : `${formatPrice(paid, { round: true })} of ${formatPrice(c.amount, { round: true })} sent`}</span>
                {!done && <button className="chip on" style={{ height: 30 }} onClick={() => markSent(c)}>Mark {formatPrice(c.amount - paid, { round: true })} sent</button>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="row between"><div className="section-label">Money in this month</div><button className="link small" onClick={() => setSheet('receive')}>+ Record</button></div>
      <div className="card">
        {bySource.length === 0 ? <div className="empty small">Nothing received yet this month.</div> : (
          <>
            {bySource.map(([cat, e]) => (
              <div key={cat} className="list-row" style={{ alignItems: 'flex-start' }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: categoryColor(cat), marginTop: 6 }} />
                <div className="grow">
                  <div>{cat}</div>
                  {e.from.size > 0 && <div className="dim small">{[...e.from].map(([who, amt]) => `${who} ${formatPrice(amt, { round: true })}`).join(' · ')}</div>}
                </div>
                <b className="num" style={{ color: 'var(--credit)' }}>+{formatPrice(e.total, { round: true })}</b>
              </div>
            ))}
            <div className="list-row"><span className="grow muted">Total received</span><b className="num">{formatPrice(receivedTotal, { round: true })}</b></div>
          </>
        )}
      </div>

      <div className="row between"><div className="section-label">Family</div><button className="link small" onClick={() => setSheet('member')}>+ Add</button></div>
      <div className="card">
        {family.length === 0 ? <div className="empty small">Add family members to tag money you send to or get from them.</div> : family.map((m) => {
          const sent = month.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === FAMILY && sameName(t.paymentReceiver, m.name)).reduce((a, t) => a + t.paymentAmount, 0)
          const got = month.filter((t) => t.paymentType === 'CREDIT' && sameName(t.paymentReceiver, m.name)).reduce((a, t) => a + t.paymentAmount, 0)
          return (
            <div key={m.id} className="list-row">
              <div className="tx-avatar" style={{ background: 'rgba(244,162,97,.18)', color: '#F4A261', fontWeight: 700 }}>{m.name.slice(0, 1).toUpperCase()}</div>
              <div className="grow"><div>{m.name}</div><div className="dim small">{m.relation ?? 'Family'}{sent || got ? ` · sent ${formatPrice(sent, { round: true })} · got ${formatPrice(got, { round: true })}` : ''}</div></div>
              <button className="dim" aria-label="Remove" onClick={async () => {
                if (await confirm({ title: `Remove ${m.name}?`, body: 'Transactions with them stay as they are.', confirm: 'Remove', danger: true })) setFamily(family.filter((x) => x.id !== m.id))
              }}><Icon name="trash" size={18} /></button>
            </div>
          )
        })}
      </div>

      <CommitmentSheet open={sheet === 'commitment'} onClose={() => setSheet(null)} family={family}
        onSave={(c) => { setCommitments([...commitments, c]); toast('Commitment added', `${formatPrice(c.amount)}/month comes out of your income first.`) }}
        onAddMember={(m) => setFamily([...family, m])} />
      <ReceiveSheet open={sheet === 'receive'} onClose={() => setSheet(null)} family={family} />
      <MemberSheet open={sheet === 'member'} onClose={() => setSheet(null)} onSave={(m) => { setFamily([...family, m]); toast(`${m.name} added`) }} />
    </div>
  )
}

function MemberFields({ name, setName, relation, setRelation }: { name: string; setName: (v: string) => void; relation: string; setRelation: (v: string) => void }) {
  return (
    <>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Mom, Rahul)" />
      <div className="chips">{RELATIONS.map((r) => <button type="button" key={r} className={`chip${relation === r ? ' on' : ''}`} onClick={() => { setRelation(relation === r ? '' : r); if (!name) setName(r) }}>{r}</button>)}</div>
    </>
  )
}

function MemberSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (m: FamilyMember) => void }) {
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Add family member</>} onClose={onClose} />
      <form className="col" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onSave({ id: uid(), name: name.trim(), relation: relation || null }); setName(''); setRelation(''); onClose() }}>
        <MemberFields name={name} setName={setName} relation={relation} setRelation={setRelation} />
        <button className="btn block">Add</button>
      </form>
    </Sheet>
  )
}

const PRESETS: { name: string; category: string }[] = [
  { name: 'Family support', category: FAMILY }, { name: 'Rent to parents', category: FAMILY },
  { name: 'Monthly SIP', category: 'Investments' }, { name: 'Loan repayment', category: 'EMI/Bill' },
]

function CommitmentSheet({ open, onClose, onSave, family, onAddMember }: {
  open: boolean; onClose: () => void; onSave: (c: Commitment) => void; family: FamilyMember[]; onAddMember: (m: FamilyMember) => void
}) {
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [name, setName] = useState('Family support')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(FAMILY)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [newMember, setNewMember] = useState('')
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Monthly commitment</>} sub="Money that goes out every month before your own spending." onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        const a = Number(amount)
        if (!name.trim() || !(a > 0)) return
        let mid = memberId
        if (category === FAMILY && !mid && newMember.trim()) {
          const m = { id: uid(), name: newMember.trim(), relation: null }
          onAddMember(m)
          mid = m.id
        }
        onSave({ id: uid(), name: name.trim(), amount: a, category, memberId: category === FAMILY ? mid : null, createdAt: Date.now() })
        setAmount(''); setMemberId(null); setNewMember(''); onClose()
      }}>
        <div className="chips">{PRESETS.map((p) => <button type="button" key={p.name} className={`chip${name === p.name ? ' on' : ''}`} onClick={() => { setName(p.name); setCategory(p.category) }}>{p.name}</button>)}</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it?" />
        <input className="input" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount per month" />
        <div className="field"><label>Paid from category</label>
          <div className="chips">{withFamily(categories).filter((c) => c !== 'Others').map((c) => <button type="button" key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        </div>
        {category === FAMILY && (
          <div className="field"><label>To whom (optional)</label>
            {family.length > 0 && <div className="chips">{family.map((m) => <button type="button" key={m.id} className={`chip${memberId === m.id ? ' on' : ''}`} onClick={() => setMemberId(memberId === m.id ? null : m.id)}>{m.name}</button>)}</div>}
            {!memberId && <input className="input" value={newMember} onChange={(e) => setNewMember(e.target.value)} placeholder={family.length ? 'or a new name' : 'e.g. Mom'} />}
          </div>
        )}
        <button className="btn block">Save commitment</button>
      </form>
    </Sheet>
  )
}

/** Records money received: salary, family, stocks/IPO profit, dividends… with an optional "from". */
export function ReceiveSheet({ open, onClose, family }: { open: boolean; onClose: () => void; family: FamilyMember[] }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('Family')
  const [from, setFrom] = useState('')
  const [when, setWhen] = useState(toLocalInput(Date.now()))
  const [note, setNote] = useState('')
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Money received</>} sub="From family, investments, work or anywhere else." onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        const a = Number(amount)
        if (!(a > 0)) return
        const r = addTransaction({ paymentAmount: a, paymentType: 'CREDIT', paymentReceiver: from.trim() || source, paymentCategory: source, note: note.trim() || undefined, timestamp: new Date(when).getTime() || Date.now() })
        toast(r.duplicate ? 'Looks like a duplicate' : 'Recorded', r.duplicate ? undefined : `+${formatPrice(a)} · ${source}${from.trim() ? ` from ${from.trim()}` : ''}`)
        setAmount(''); setFrom(''); setNote(''); onClose()
      }}>
        <input className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
        <div className="field"><label>Source</label>
          <div className="row wrap" style={{ gap: 8 }}>{INCOME_CATEGORIES.map((c) => <button type="button" key={c} className={`chip${source === c ? ' on' : ''}`} onClick={() => setSource(c)}>{c}</button>)}</div>
        </div>
        <div className="field"><label>From (optional)</label>
          <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={source === 'Family' ? 'e.g. Dad' : source === 'Stocks & IPO' ? 'e.g. Tata Tech IPO, Zerodha' : 'Who or where'} />
          {source === 'Family' && family.length > 0 && <div className="chips">{family.map((m) => <button type="button" key={m.id} className={`chip${from === m.name ? ' on' : ''}`} onClick={() => setFrom(m.name)}>{m.name}</button>)}</div>}
        </div>
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}
