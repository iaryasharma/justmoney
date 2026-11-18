import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Icon, Sheet, SheetHeader, Toggle, useBackHandler, useConfirm, useToast } from '../components/ui/ui'
import ContactPicker from '../components/people/ContactPicker'
import type { Person } from '../lib/payees/peopleMatch'
import { useStored, KEYS } from '../lib/core/storage'
import {
  addPeople, calculateProjectBalances, createProject, createTransaction, deleteProject, deleteTransaction,
  computeSplits, friendBalances, isSettled, simplifyDebts, splitAmountEvenly, splitWithoutGroup, updateTransaction,
  type SplitMode, type SplitPerson, type SplitProject, type SplitRow, type SplitTxn,
} from '../lib/split/split'
import { buildCollectionMessage, buildUpiUrl, UPI_RE } from '../lib/core/upi'
import { formatPrice, getCurrency, monthShort } from '../lib/core/format'
import { takePendingSplit, takeQuickSplit, type SplitPrefill } from '../lib/split/splitHandoff'
import type { Transaction, User } from '../lib/core/types'
import PaymentPick from '../components/transactions/PaymentPick'
import { splitPaymentWithoutGroup, unsplitLinked } from '../lib/split/splitLink'
import { read } from '../lib/core/storage'
import { SPLIT } from '../lib/accounts/accounts'
import { updateTransaction as updatePayment } from '../lib/core/data'
import { addRepeat, billItems, clearNudges, computeItemSplits, getRepeats, nudgeCount, nudgeMessage, overdueFriends, payLink, realNameOf, recordNudge, removeRepeat, roundedEven, settlePart, splitShareMessage, type SplitItem } from '../lib/split/splitPlus'
import { ocrImage } from '../lib/capture/capture'
import { isNativeApp } from '../lib/core/native'
import { splitCardImage } from '../lib/split/splitCard'
import BottleSpin from '../components/split/BottleSpin'

function useSplitData() {
  const [projects] = useStored<SplitProject[]>(KEYS.splitProjects, [])
  const [people] = useStored<SplitPerson[]>(KEYS.splitPeople, [])
  const [txns] = useStored<SplitTxn[]>(KEYS.splitTransactions, [])
  const [rows] = useStored<SplitRow[]>(KEYS.splits, [])
  return { projects, people, txns, rows }
}

export default function Split({ onBack }: { onBack?: () => void } = {}) {
  const { projects, people, txns, rows } = useSplitData()
  const [user] = useStored<User | null>(KEYS.user, null)
  const [tab, setTab] = useState<'FRIENDS' | 'GROUPS' | 'SETTLED'>('FRIENDS')
  const [openProject, setOpenProject] = useState<string | null>(null)
  const [sheet, setSheet] = useState<null | 'project' | 'settings' | 'bottle' | 'quicksplit'>(null)
  const [quickSplitPrefill, setQuickSplitPrefill] = useState<SplitPrefill | null>(null)
  const [settle, setSettle] = useState<{ projectId: string; person: SplitPerson; amount: number; owesYou: boolean } | null>(null)
  // "Split this" from a transaction: parked until the user picks (or creates) a group
  const [pending, setPending] = useState<SplitPrefill | null>(() => takePendingSplit())
  // Home's "Split a bill" lands here with the sheet already open
  useEffect(() => { if (takeQuickSplit()) setSheet('quicksplit') }, [])
  // groups only: a friend's private ledger (direct) is not a group to pick
  const groups = projects.filter((p) => !p.direct)
  const soleProject = groups.length === 1 ? groups[0].id : null
  useEffect(() => { if (pending && soleProject) setOpenProject(soleProject) }, [pending, soleProject])

  const balances = useMemo(() => friendBalances(projects, people, txns, rows), [projects, people, txns, rows])
  const owedToYou = balances.filter((b) => b.direction === 'owes-you').reduce((a, b) => a + b.amount, 0)
  const youOwe = balances.filter((b) => b.direction === 'you-owe').reduce((a, b) => a + b.amount, 0)
  const net = owedToYou - youOwe

  useBackHandler(!!onBack && !openProject, onBack)

  const project = projects.find((p) => p.id === openProject)
  if (project) {
    return <GroupDetail project={project} onBack={() => { setOpenProject(null); setPending(null) }} onSettle={setSettle} settle={settle} setSettle={setSettle} prefill={pending} onPrefillDone={() => setPending(null)} />
  }

  return (
    <div className="page">
      <div className="row between">
        {onBack ? <div className="row"><button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button><h1 className="h2">SplitMoney</h1></div> : <div className="eyebrow">SplitMoney</div>}
        <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="Split settings"><Icon name="gear" size={18} /></button>
      </div>
      <h1 className="h1" style={{ marginTop: 6 }}>
        {isSettled(net) ? <>You are settled up</> : net > 0
          ? <>You get back <span style={{ color: 'var(--credit)' }}>{formatPrice(net)}</span></>
          : <>You owe <span style={{ color: 'var(--up)' }}>{formatPrice(-net)}</span></>}
      </h1>
      {(owedToYou > 0 || youOwe > 0) && <div className="muted small" style={{ marginTop: 6 }}>{formatPrice(owedToYou)} owed to you · {formatPrice(youOwe)} you owe</div>}

      {pending && (
        <div className="card pad col" style={{ marginTop: 16, gap: 10, borderColor: 'var(--accent)' }} role="status">
          <div className="row between">
            <b>Split “{pending.description}” · {formatPrice(pending.amount, { round: true })}</b>
            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setPending(null)} aria-label="Cancel split"><Icon name="close" size={14} /></button>
          </div>
          <div className="muted small">Split this payment without a group or pick an existing group:</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => { setQuickSplitPrefill(pending); setPending(null); setSheet('quicksplit') }}>
              Split with friends (no group)
            </button>
            {groups.map((p) => <button key={p.id} className="chip" onClick={() => setOpenProject(p.id)}>{p.name}</button>)}
            <button className="chip" onClick={() => setSheet('project')}>+ New group</button>
          </div>
        </div>
      )}

      {(() => {
        const due = overdueFriends(projects, people, txns, rows)
        if (!due.length) return null
        return (
          <div className="card pad col" style={{ marginTop: 16, gap: 8, borderColor: 'var(--amber)' }} role="status">
            <b className="small">Time to settle</b>
            {due.slice(0, 3).map((d) => (
              <button key={`${d.project.id}-${d.person.id}`} className="row" style={{ gap: 10, textAlign: 'left' }} onClick={() => setSettle({ projectId: d.project.id, person: d.person, amount: d.amount, owesYou: true })}>
                <span className="grow small muted">{d.person.name}: {formatPrice(d.amount, { round: true })} across {d.count} expense{d.count === 1 ? '' : 's'}{d.days >= 1 ? `, ${d.days} days` : ''}. This is starting to look like a loan.</span>
                <span className="chip" style={{ height: 30 }}>Nudge</span>
              </button>
            ))}
          </div>
        )
      })()}

      <button className="btn block" style={{ marginTop: 18 }} onClick={() => { setQuickSplitPrefill(null); setSheet('quicksplit') }}>Split a bill</button>
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button className="btn sm secondary" onClick={() => setSheet('project')}><Icon name="plus" size={16} /> Group</button>
        <button className="btn sm secondary" onClick={() => setSheet('bottle')}>Who pays?</button>
      </div>
      {sheet === 'bottle' && <BottleSpin open onClose={() => setSheet(null)} names={['You', ...new Set(people.filter((p) => !p.isCurrentUser).map((p) => p.name.trim()).filter(Boolean))]} />}

      <div className="segmented" style={{ marginTop: 20 }}>
        {(['FRIENDS', 'GROUPS', 'SETTLED'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0] + t.slice(1).toLowerCase()}</button>)}
      </div>

      <div style={{ marginTop: 12 }}>
        {tab === 'GROUPS' && (groups.length === 0
          ? <div className="empty">Create a group to split expenses with friends.</div>
          : <div className="card">{groups.map((p) => {
              const net = calculateProjectBalances(p.id, people, txns, rows)
              const self = people.find((x) => x.projectId === p.id && x.isCurrentUser)
              const mine = self ? net.get(self.id) ?? 0 : 0
              const n = people.filter((x) => x.projectId === p.id && !x.isCurrentUser).length
              return (
                <button key={p.id} className="list-row" onClick={() => setOpenProject(p.id)}>
                  <div className="tx-avatar" style={{ background: 'rgba(0,136,255,.15)', color: 'var(--blue)' }}><Icon name="users" size={20} /></div>
                  <div className="grow"><div className="ellipsis">{p.name}</div><div className="dim small">{n} friend{n === 1 ? '' : 's'}</div></div>
                  <div className="small" style={{ textAlign: 'right', color: isSettled(mine) ? 'var(--text-45)' : mine > 0 ? 'var(--credit)' : 'var(--up)' }}>
                    {isSettled(mine) ? 'settled up' : `${mine > 0 ? 'you get back' : 'you owe'} ${formatPrice(Math.abs(mine))}`}
                  </div>
                  <Icon name="chevron" size={18} />
                </button>
              )
            })}</div>)}

        {tab !== 'GROUPS' && (() => {
          const list = balances.filter((b) => (tab === 'SETTLED' ? b.direction === 'settled' : b.direction !== 'settled'))
          if (!list.length) return <div className="empty">{tab === 'SETTLED' ? 'No settled friends yet.' : 'No one owes you yet. Add friends and split expenses to track who owes what.'}</div>
          return (
            <div className="card">{list.map((b) => (
              <button key={b.person.id} className="list-row" onClick={() => b.direction === 'settled' ? setOpenProject(b.project.id) : setSettle({ projectId: b.project.id, person: b.person, amount: b.amount, owesYou: b.direction === 'owes-you' })}>
                <Avatar name={b.person.name} />
                <div className="grow"><div className="ellipsis">{b.person.name}</div><div className="dim small">{b.project.direct ? 'Outside a group' : b.project.name}</div></div>
                <div style={{ textAlign: 'right' }}>
                  {b.direction === 'settled' ? <span className="dim small">settled up</span> : <>
                    <div className="tiny dim">{b.direction === 'owes-you' ? 'owes you' : 'you owe'}</div>
                    <div className="num" style={{ fontWeight: 700, color: b.direction === 'owes-you' ? 'var(--credit)' : 'var(--up)' }}>{formatPrice(b.amount)}</div>
                  </>}
                </div>
              </button>
            ))}</div>
          )
        })()}
      </div>

      <AddProjectSheet open={sheet === 'project'} onClose={() => setSheet(null)} selfName={user?.name || 'You'} onCreated={(id) => setOpenProject(id)} />
      <SplitSettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} />
      <QuickSplitSheet open={sheet === 'quicksplit'} onClose={() => { setSheet(null); setQuickSplitPrefill(null) }} prefill={quickSplitPrefill} />
      {settle && <SettleUpSheet {...settle} onClose={() => setSettle(null)} />}
    </div>
  )
}

const Avatar = ({ name }: { name: string }) => (
  <div className="tx-avatar" style={{ background: `hsl(${[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 60% 30%)`, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</div>
)

function GroupDetail({ project, onBack, settle, setSettle, prefill, onPrefillDone }: {
  project: SplitProject; onBack: () => void; prefill: SplitPrefill | null; onPrefillDone: () => void
  onSettle: (s: { projectId: string; person: SplitPerson; amount: number; owesYou: boolean }) => void
  settle: { projectId: string; person: SplitPerson; amount: number; owesYou: boolean } | null
  setSettle: (s: { projectId: string; person: SplitPerson; amount: number; owesYou: boolean } | null) => void
}) {
  useBackHandler(true, onBack)
  const { people, txns, rows } = useSplitData()
  const confirm = useConfirm()
  const toast = useToast()
  const [sheet, setSheet] = useState<null | 'people' | 'expense'>(prefill ? 'expense' : null)
  const [editing, setEditing] = useState<SplitTxn | null>(null)
  const [sharing, setSharing] = useState<SplitTxn | null>(null)
  const [repeats, setRepeatsTick] = useState(0)
  const members = people.filter((p) => p.projectId === project.id)
  const groupRepeats = getRepeats().filter((r) => r.projectId === project.id && repeats >= 0)
  const ptx = txns.filter((t) => t.projectId === project.id).sort((a, b) => b.date - a.date)
  const net = calculateProjectBalances(project.id, people, txns, rows)
  const spent = ptx.filter((t) => t.transactionType !== 'SETTLEMENT').reduce((a, t) => a + t.amount, 0)
  const nameOf = (id: string) => { const p = members.find((m) => m.id === id); return p ? (p.isCurrentUser ? 'You' : p.name) : '—' }
  const last = ptx.find((t) => t.transactionType !== 'SETTLEMENT')

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <button className="icon-btn" aria-label="Delete group" onClick={async () => {
          if (await confirm({ title: `Delete "${project.name}"?`, body: project.direct ? 'This removes your split history with them. The bank payments count in full again.' : 'This removes the group, its people and all its expenses.', confirm: 'Delete', danger: true })) { for (const x of read<SplitTxn[]>(KEYS.splitTransactions, []).filter((x) => x.projectId === project.id)) unsplitLinked(x.id); deleteProject(project.id); onBack() }
        }}><Icon name="trash" size={18} /></button>
      </div>
      <h1 className="h1">{project.name}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 16 }}>
        <div className="card pad"><div className="label">Friends</div><div className="h2 num">{members.length - 1}</div></div>
        <div className="card pad"><div className="label">Expenses</div><div className="h2 num">{ptx.filter((t) => t.transactionType !== 'SETTLEMENT').length}</div></div>
        <div className="card pad"><div className="label">Total Spent</div><div className="h2 num">{formatPrice(spent, { round: true })}</div></div>
        <div className="card pad"><div className="label">Last Expense</div><div className="small" style={{ marginTop: 6 }}>{last ? new Date(last.date).toLocaleDateString() : '—'}</div></div>
      </div>

      <div className="row between"><div className="section-label">Participants</div>{!project.direct && <button className="link small" onClick={() => setSheet('people')}>+ Friend</button>}</div>
      <div className="chips">{members.map((m) => <span key={m.id} className="chip">{m.isCurrentUser ? `${m.name} (You)` : m.name}</span>)}</div>

      <div className="section-label">Balances</div>
      <div className="card">
        {members.filter((m) => !m.isCurrentUser).length === 0 ? <div className="empty small">No debts yet.</div> : members.filter((m) => !m.isCurrentUser).map((m) => {
          const n = net.get(m.id) ?? 0
          return (
            <button key={m.id} className="list-row" onClick={() => !isSettled(n) && setSettle({ projectId: project.id, person: m, amount: Math.abs(n), owesYou: n < 0 })}>
              <Avatar name={m.name} />
              <div className="grow">{m.name} <span className="dim small">{isSettled(n) ? 'settled up' : n < 0 ? 'owes ' : 'gets back '}</span>{!isSettled(n) && <b className="num" style={{ color: n < 0 ? 'var(--credit)' : 'var(--up)' }}>{formatPrice(Math.abs(n))}</b>}</div>
              {!isSettled(n) && <span className="chip" style={{ height: 30 }}>Settle</span>}
            </button>
          )
        })}
      </div>

      {(() => {
        const plan = simplifyDebts(net)
        if (plan.length < 1 || members.length < 3) return null
        return (
          <>
            <div className="section-label">Simplified settle-up</div>
            <div className="card">
              {plan.map((p, i) => (
                <div key={i} className="list-row small">
                  <span className="grow"><b>{nameOf(p.from)}</b> <span className="dim">pays</span> <b>{nameOf(p.to)}</b></span>
                  <b className="num">{formatPrice(p.amount)}</b>
                </div>
              ))}
            </div>
            <div className="dim tiny" style={{ margin: '6px 4px 0' }}>{plan.length} payment{plan.length === 1 ? '' : 's'} clear every balance in this group.</div>
          </>
        )
      })()}

      {groupRepeats.length > 0 && (
        <>
          <div className="section-label">Every month</div>
          <div className="card">{groupRepeats.map((r) => (
            <div key={r.id} className="list-row">
              <span className="legend-icon"><Icon name="repeat" size={15} /></span>
              <div className="grow"><div>{r.description}</div><div className="dim small">{formatPrice(r.amount, { round: true })} on the {r.day}{r.day === 1 ? 'st' : r.day === 2 ? 'nd' : r.day === 3 ? 'rd' : 'th'} · next {new Date(r.nextAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div></div>
              <button className="dim" aria-label={`Stop repeating ${r.description}`} onClick={async () => { if (await confirm({ title: `Stop repeating ${r.description}?`, body: 'Expenses already added stay.', confirm: 'Stop', danger: true })) { removeRepeat(r.id); setRepeatsTick((n) => n + 1) } }}><Icon name="close" size={16} /></button>
            </div>
          ))}</div>
        </>
      )}

      <div className="row between"><div className="section-label">Recent Expenses</div><button className="link small" onClick={() => { setEditing(null); setSheet('expense') }}>+ Add expense</button></div>
      <div className="card">
        {ptx.length === 0 ? <div className="empty small">No expenses yet.</div> : ptx.map((t) => {
          const d = new Date(t.date)
          const settlement = t.transactionType === 'SETTLEMENT'
          return (
            <div key={t.id} className="list-row">
              <div className="col" style={{ width: 40, gap: 0, alignItems: 'center' }}><span className="tiny dim">{monthShort(d.getMonth()).toUpperCase()}</span><b>{String(d.getDate()).padStart(2, '0')}</b></div>
              <button className="grow" style={{ textAlign: 'left' }} onClick={() => { if (!settlement) { setEditing(t); setSheet('expense') } }}>
                <div className="ellipsis">{settlement ? `${nameOf(t.payerId)} paid ${nameOf(rows.find((r) => r.transactionId === t.id)?.personId ?? '')}` : t.description}</div>
                <div className="dim small">{settlement ? t.description === 'Rounded off' ? 'Rounded off' : 'Settlement' : `${nameOf(t.payerId)} paid ${formatPrice(t.amount)}${t.splitMode === 'ITEMS' ? ' · by item' : ''}`}</div>
              </button>
              {!settlement && <button className="dim" aria-label="Share with the group" onClick={() => setSharing(t)}><Icon name="share" size={18} /></button>}
              <button className="dim" aria-label={settlement ? 'Undo settlement' : 'Delete expense'} onClick={async () => {
                const ok = await confirm(settlement
                  ? { title: 'Undo settlement', body: 'This reopens the balance between these people.', confirm: 'Undo', danger: true }
                  : { title: 'Delete expense', body: 'This will remove the expense and its splits.', confirm: 'Delete', danger: true })
                if (ok) { const linked = unsplitLinked(t.id); deleteTransaction(t.id); toast(settlement ? 'Settlement undone' : 'Expense deleted', linked ? 'The bank payment counts in full again' : undefined) }
              }}><Icon name="trash" size={18} /></button>
            </div>
          )
        })}
      </div>

      <AddPeopleSheet open={sheet === 'people'} onClose={() => setSheet(null)} projectId={project.id} />
      <AddExpenseSheet open={sheet === 'expense'} onClose={(saved) => { setSheet(null); onPrefillDone(); setRepeatsTick((n) => n + 1); if (saved) setSharing(saved) }} project={project} members={members} editing={editing} rows={rows} prefill={prefill} />
      {sharing && <ShareSplitSheet txn={sharing} project={project} members={members} rows={rows} onClose={() => setSharing(null)} />}
      {settle && <SettleUpSheet {...settle} onClose={() => setSettle(null)} />}
    </div>
  )
}

function QuickSplitSheet({ open, onClose, prefill }: {
  open: boolean
  onClose: () => void
  prefill?: SplitPrefill | null
}) {
  const [user] = useStored<User | null>(KEYS.user, null)
  const [allTx] = useStored<Transaction[]>(KEYS.transactions, [])
  const toast = useToast()

  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [friends, setFriends] = useState<string[]>([])
  const [draftFriend, setDraftFriend] = useState('')
  const [pickingContact, setPickingContact] = useState(false)
  const [paidBy, setPaidBy] = useState<'me' | string>('me')
  const [mode, setMode] = useState<'EQUAL' | 'EXACT'>('EQUAL')
  const [shares, setShares] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    setDesc(prefill?.description ?? '')
    setAmount(prefill ? String(prefill.amount) : '')
    setFriends([])
    setDraftFriend('')
    setPaidBy('me')
    setMode('EQUAL')
    setShares({})
  }, [open, prefill])

  const addFriend = (raw: string) => {
    const n = raw.trim()
    if (!n) return
    if (friends.some((f) => f.toLowerCase() === n.toLowerCase())) return
    setFriends([...friends, n])
    setDraftFriend('')
    setErr('')
  }

  const removeFriend = (name: string) => {
    setFriends(friends.filter((f) => f !== name))
    if (paidBy === name) setPaidBy('me')
  }

  const selfName = user?.name || 'You'
  const numAmount = Number(amount) || 0
  const totalPeople = friends.length + 1
  const evenShare = numAmount > 0 && totalPeople > 1 ? splitAmountEvenly(numAmount, totalPeople) : []

  const save = () => {
    const a = Number(amount)
    if (!desc.trim()) return setErr('Enter a description')
    if (!(a > 0)) return setErr('Enter a valid amount')
    if (friends.length === 0) return setErr('Add at least one friend')

    let numericShares: Record<string, number> | undefined
    if (mode === 'EXACT') {
      numericShares = { me: Number(shares['me'] || 0) }
      for (const f of friends) numericShares[f] = Number(shares[f] || 0)
      const sum = Object.values(numericShares).reduce((s, v) => s + v, 0)
      if (Math.abs(sum - a) > 0.01) return setErr(`Shares add up to ${formatPrice(sum)}, not ${formatPrice(a)}`)
    }

    // a friend paid only makes sense with one friend (the paid-by choice is hidden otherwise)
    const payer = friends.length === 1 ? paidBy : 'me'

    // "Split this" on a payment: its own amount is split, and the bank payment stays in your spending as your share
    if (prefill?.txnId) {
      const tx = allTx.find((x) => x.id === prefill.txnId)
      const mine = tx ? splitPaymentWithoutGroup(tx, friends, selfName, numericShares) : null
      if (!tx || mine === null) return setErr('This payment can’t be split. It may be split already.')
      const others = Math.round((tx.paymentAmount - mine) * 100) / 100
      toast('Split recorded', friends.length === 1 ? `${friends[0]} owes you ${formatPrice(others)}` : `Split with ${friends.length} friends`)
      onClose()
      return
    }

    const res = splitWithoutGroup({
      amount: a,
      description: desc.trim(),
      friends,
      paidBy: payer,
      shares: numericShares,
      selfName,
    })

    if ('error' in res) {
      setErr(res.error)
      return
    }

    if (payer !== 'me') {
      toast('Split recorded', `You owe ${payer} ${formatPrice(res.myShare)}`)
    } else if (friends.length === 1) {
      toast('Split recorded', `${friends[0]} owes you ${formatPrice(a - res.myShare)}`)
    } else {
      toast('Split recorded', `Split among ${totalPeople} people`)
    }
    onClose()
  }

  return (
    <>
      <Sheet open={open} onClose={onClose}>
        <SheetHeader title={<>Split a bill</>} sub="Split with friends directly — no group required." onClose={onClose} />
        <div className="col" style={{ gap: 14 }}>
          <div className="field">
            <label>Description</label>
            <input className="input" autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Dinner, Taxi, Coffee" />
          </div>

          <div className="field">
            <label>Amount</label>
            <input className="input" inputMode="decimal" value={amount} readOnly={!!prefill?.txnId} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
            {prefill?.txnId && <div className="dim tiny">Amount from payment</div>}
          </div>

          <div className="field">
            <label>Friends to split with</label>
            <form onSubmit={(e) => { e.preventDefault(); addFriend(draftFriend) }} className="row" style={{ gap: 8 }}>
              <input className="input grow" value={draftFriend} onChange={(e) => setDraftFriend(e.target.value)} placeholder="Friend’s name" />
              <button type="button" className="btn sm" disabled={!draftFriend.trim()} onClick={() => addFriend(draftFriend)}>Add</button>
            </form>
            {friends.length > 0 && (
              <div className="chips" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                {friends.map((f) => (
                  <button type="button" key={f} className="chip on" onClick={() => removeFriend(f)}>
                    {f} <Icon name="close" size={14} />
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn sm secondary" style={{ marginTop: 8, alignSelf: 'flex-start' }} onClick={() => setPickingContact(true)}>
              <Icon name="users" size={16} /> Choose from contacts
            </button>
          </div>

          {friends.length === 1 && !prefill?.txnId && (
            <div className="field">
              <label>Paid by</label>
              <div className="segmented">
                <button type="button" className={paidBy === 'me' ? 'on' : ''} onClick={() => setPaidBy('me')}>You paid</button>
                <button type="button" className={paidBy === friends[0] ? 'on' : ''} onClick={() => setPaidBy(friends[0])}>{friends[0]} paid</button>
              </div>
            </div>
          )}

          {friends.length > 0 && numAmount > 0 && (
            <div className="field">
              <label>How to split</label>
              <div className="segmented">
                <button type="button" className={mode === 'EQUAL' ? 'on' : ''} onClick={() => setMode('EQUAL')}>Equally</button>
                <button type="button" className={mode === 'EXACT' ? 'on' : ''} onClick={() => setMode('EXACT')}>Exact shares</button>
              </div>
              {mode === 'EQUAL' ? (
                <div className="dim small" style={{ marginTop: 6 }}>
                  {formatPrice(evenShare[0] || 0)} each among {totalPeople} people ({selfName} + {friends.join(', ')})
                </div>
              ) : (
                <div className="card" style={{ marginTop: 8 }}>
                  <div className="list-row" style={{ padding: '8px 12px' }}>
                    <span className="grow">{selfName}</span>
                    <input className="input num" inputMode="decimal" style={{ width: 100, textAlign: 'right' }} placeholder={String(evenShare[0] || 0)} value={shares['me'] ?? ''} onChange={(e) => setShares({ ...shares, me: e.target.value.replace(/[^0-9.]/g, '') })} />
                  </div>
                  {friends.map((f) => (
                    <div key={f} className="list-row" style={{ padding: '8px 12px' }}>
                      <span className="grow">{f}</span>
                      <input className="input num" inputMode="decimal" style={{ width: 100, textAlign: 'right' }} placeholder={String(evenShare[0] || 0)} value={shares[f] ?? ''} onChange={(e) => setShares({ ...shares, [f]: e.target.value.replace(/[^0-9.]/g, '') })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {err && <div className="error-text">{err}</div>}
          <button type="button" className="btn block" onClick={save}>Record split</button>
        </div>
      </Sheet>
      <ContactPicker open={pickingContact} onClose={() => setPickingContact(false)} onPick={(p) => { addFriend(p.name); setPickingContact(false) }} title="Add friend from contacts" />
    </>
  )
}

function AddProjectSheet({ open, onClose, selfName, onCreated }: { open: boolean; onClose: () => void; selfName: string; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>New group</>} sub="Start splitting expenses with friends." onClose={onClose} />
      <form className="col" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const p = createProject(name.trim(), selfName); setName(''); onClose(); onCreated(p.id) }}>
        <div className="field"><label>Group name</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trip to Goa, Roommates" /></div>
        <button className="btn block" disabled={!name.trim()}>Create group</button>
      </form>
    </Sheet>
  )
}

function AddPeopleSheet({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const [contacts] = useStored<Person[]>(KEYS.people, [])
  const [picking, setPicking] = useState(false)
  const [names, setNames] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const toast = useToast()
  const add = (n: string) => { const v = n.trim(); if (v && !names.includes(v)) setNames([...names, v]); setDraft('') }
  return (
    <>
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Add people</>} sub="Add one or many — tap return after each name." onClose={onClose} />
      <form onSubmit={(e) => { e.preventDefault(); add(draft) }}><input className="input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Name" /></form>
      {names.length > 0 && <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>{names.map((n) => <button key={n} className="chip on" onClick={() => setNames(names.filter((x) => x !== n))}>{n} <Icon name="close" size={14} /></button>)}</div>}
      <button className="btn block" style={{ marginTop: 12 }} onClick={() => setPicking(true)}><Icon name="users" size={18} />Choose from contacts</button>
      <div className="label" style={{ marginTop: 16 }}>{contacts.length ? 'Your people' : 'Quick add'}</div>
      <div className="chips" style={{ marginTop: 8 }}>{(contacts.length ? contacts.map((c) => c.name).slice(0, 12) : ['Alex', 'Priya', 'Rohan', 'Taylor']).map((n) => <button key={n} className="chip" onClick={() => add(n)}>+ {n}</button>)}</div>
      <button className="btn block" style={{ marginTop: 18 }} disabled={!names.length && !draft.trim()} onClick={() => {
        const all = draft.trim() ? [...names, draft.trim()] : names
        addPeople(projectId, all); toast(`Added ${all.length} ${all.length === 1 ? 'person' : 'people'}`); setNames([]); setDraft(''); onClose()
      }}>Add {names.length + (draft.trim() ? 1 : 0) || ''} {names.length + (draft.trim() ? 1 : 0) === 1 ? 'person' : 'people'}</button>
    </Sheet>
    <ContactPicker open={picking} onClose={() => setPicking(false)} onPick={(p) => { add(p.name); setPicking(false) }} title="Add from contacts" />
    </>
  )
}

function AddExpenseSheet({ open, onClose, project, members, editing, rows, prefill }: {
  open: boolean; onClose: (saved?: SplitTxn) => void; project: SplitProject; members: SplitPerson[]; editing: SplitTxn | null; rows: SplitRow[]; prefill?: SplitPrefill | null
}) {
  const [items, setItems] = useState<SplitItem[]>([])
  const [extras, setExtras] = useState('')
  const [scanning, setScanning] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [repeatDay, setRepeatDay] = useState(String(new Date().getDate()))
  const toast = useToast()
  const self = members.find((m) => m.isCurrentUser)
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [payer, setPayer] = useState('')
  const [withIds, setWithIds] = useState<string[]>([])
  const [mode, setMode] = useState<SplitMode>('EQUAL')
  const [values, setValues] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    if (editing) {
      setDesc(editing.description); setAmount(String(editing.amount)); setPayer(editing.payerId)
      const own = rows.filter((r) => r.transactionId === editing.id)
      setWithIds(own.map((r) => r.personId))
      setMode(editing.splitMode ?? 'EQUAL')
      const v = editing.splitValues ?? Object.fromEntries(own.map((r) => [r.personId, r.splitAmount]))
      setValues(Object.fromEntries(Object.entries(v).map(([k, n]) => [k, String(n)])))
      setItems(editing.items ?? []); setExtras(editing.extras ? String(editing.extras) : '')
    } else {
      setDesc(prefill?.description ?? ''); setAmount(prefill ? String(prefill.amount) : ''); setPayer(self?.id ?? ''); setWithIds(members.map((m) => m.id)); setMode('EQUAL'); setValues({})
      setItems([]); setExtras('')
    }
    setRepeat(false); setRepeatDay(String(new Date().getDate()))
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const numericValues = Object.fromEntries(withIds.map((id) => [id, Number(values[id] || 0)]))
  const itemTotal = Math.round((items.reduce((a, i) => a + (i.price || 0), 0) + (Number(extras) || 0)) * 100) / 100
  const itemSplits = mode === 'ITEMS' ? computeItemSplits(items.filter((i) => i.price), Number(extras) || 0, withIds) : []
  const preview = mode === 'ITEMS' ? { splits: itemSplits } : Number(amount) > 0 ? computeSplits(Number(amount), mode, withIds, numericValues) : null

  // a bill photo: the phone reads it (English or Hindi), each item gets a row, tax and charges are shared in proportion
  async function scanBill(file?: File) {
    if (!file) return
    setScanning(true); setErr('')
    try {
      const ocr = await ocrImage({ file })
      const lines = ocr ? [...ocr.lines].sort((a, b) => a.top - b.top || a.left - b.left).map((l) => l.text) : []
      const b = billItems(lines)
      if (!b.items.length) { setErr(isNativeApp() ? 'Could not find items on that bill. Add them by hand below.' : 'Reading bills works in the Android app. Add the items by hand below.'); return }
      setItems(b.items.map((i) => ({ ...i, who: [] })))
      setExtras(b.extras ? String(b.extras) : '')
      if (!desc.trim()) setDesc('Bill')
    } finally { setScanning(false) }
  }

  function save() {
    const a = mode === 'ITEMS' ? itemTotal : Number(amount)
    if (!desc.trim() || !a || !payer) return setErr('Please fill in all fields')
    if (!(a > 0)) return setErr('Invalid amount')
    if (members.length < 2) return setErr('Add someone to split with')
    if (!withIds.some((id) => id !== self?.id)) return setErr('Pick at least one other person — an expense split only with yourself isn’t tracked.')
    const result = mode === 'ITEMS' ? { splits: itemSplits } : computeSplits(a, mode, withIds, numericValues)
    if ('error' in result) return setErr(result.error)
    if (mode === 'ITEMS' && !result.splits.length) return setErr('Add the items on the bill')
    const modeInfo = mode === 'ITEMS'
      ? { splitMode: mode, splitValues: undefined, items: items.filter((i) => i.price), extras: Number(extras) || 0 }
      : { splitMode: mode, splitValues: mode === 'EQUAL' ? undefined : numericValues, items: undefined, extras: undefined }
    let saved: SplitTxn | undefined
    if (editing) { updateTransaction(editing.id, { amount: a, description: desc.trim(), payerId: payer, ...modeInfo }, result.splits); toast('Expense updated'); saved = { ...editing, amount: a, description: desc.trim(), payerId: payer, ...modeInfo } }
    else { saved = createTransaction(a, desc.trim(), Date.now(), project.id, payer, result.splits, 'DEBIT', modeInfo); toast('Expense added', 'Share it so everyone can pay their part') }
    // the same split again every month (rent on the 5th), added by itself
    if (repeat && !editing) {
      const day = Math.min(31, Math.max(1, Number(repeatDay) || 1))
      addRepeat({ projectId: project.id, description: desc.trim(), amount: a, payerId: payer, splits: result.splits, day }, Date.now())
    }
    onClose(saved)
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Add expense</>} sub="Capture what you spent, who paid, and how to split it." onClose={onClose} />
      <div className="col" style={{ gap: 14 }}>
        <div className="field"><label>Description</label><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Dinner, Taxi" /></div>
        <div className="field"><label>Amount</label><input className="input" inputMode="decimal" value={mode === 'ITEMS' ? (itemTotal ? String(itemTotal) : '') : amount} readOnly={mode === 'ITEMS'} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />{mode === 'ITEMS' && <div className="dim tiny">The items plus tax and charges</div>}</div>
        <div className="field"><label>Paid by</label><div className="chips">{members.map((m) => <button key={m.id} className={`chip${payer === m.id ? ' on' : ''}`} onClick={() => setPayer(m.id)}>{m.name}{m.isCurrentUser ? ' (You)' : ''}</button>)}</div></div>
        <div className="field">
          <label>Split with</label>
          <div className="row wrap" style={{ gap: 8 }}>{members.map((m) => <button key={m.id} className={`chip${withIds.includes(m.id) ? ' on' : ''}`} onClick={() => setWithIds(withIds.includes(m.id) ? withIds.filter((x) => x !== m.id) : [...withIds, m.id])}>{m.name}{m.isCurrentUser ? ' (You)' : ''}</button>)}</div>
        </div>
        <div className="field">
          <label>How to split</label>
          <div className="segmented">
            {([['EQUAL', 'EQUALLY'], ['ITEMS', 'BY ITEM'], ['EXACT', 'EXACT'], ['PERCENT', '%'], ['SHARES', 'SHARES']] as const).map(([m, l]) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setValues({}) }}>{l}</button>
            ))}
          </div>
          {mode === 'ITEMS' ? (
            <ItemsEditor items={items} setItems={setItems} extras={extras} setExtras={setExtras} members={members.filter((m) => withIds.includes(m.id))}
              shares={itemSplits} scanning={scanning} onScan={scanBill} />
          ) : mode === 'EQUAL'
            ? <div className="dim small">{withIds.length === members.length ? 'Splitting equally among everyone by default.' : `Splitting equally among ${withIds.length} people.`}{Number(amount) > 0 && withIds.length > 0 && ` ${formatPrice(Number(amount) / withIds.length)} each.`}</div>
            : (
              <div className="card">
                {members.filter((m) => withIds.includes(m.id)).map((m, i) => {
                  const share = preview && 'splits' in preview ? preview.splits.find((s) => s.personId === m.id)?.amount : undefined
                  return (
                    <div key={m.id} className="list-row" style={{ padding: '8px 12px' }}>
                      <span className="grow">{m.name}{m.isCurrentUser ? ' (You)' : ''}</span>
                      {mode !== 'EXACT' && share !== undefined && <span className="dim small num">{formatPrice(share)}</span>}
                      <input className="input num" inputMode="decimal" aria-label={`${m.name} ${mode.toLowerCase()}`} style={{ width: 90, height: 38, textAlign: 'right' }}
                        placeholder={mode === 'SHARES' ? '1' : mode === 'PERCENT' ? `${Math.round(100 / withIds.length)}` : '0.00'}
                        autoFocus={i === 0} value={values[m.id] ?? ''} onChange={(e) => setValues({ ...values, [m.id]: e.target.value.replace(/[^0-9.]/g, '') })} />
                      <span className="dim small" style={{ width: 14 }}>{mode === 'PERCENT' ? '%' : mode === 'SHARES' ? '×' : ''}</span>
                    </div>
                  )
                })}
              </div>
            )}
          {mode !== 'EQUAL' && preview && 'error' in preview && <div className="small" style={{ color: 'var(--amber)' }}>{preview.error}</div>}
        </div>
        {!editing && (
          <div className="row" style={{ gap: 10 }}>
            <span className="grow small"><b>Repeat every month</b><div className="dim tiny">Rent, Wi-Fi, a maid: added to the group by itself</div></span>
            {repeat && <input className="input num" inputMode="numeric" style={{ width: 64, height: 38, textAlign: 'center' }} value={repeatDay} aria-label="Day of the month" onChange={(e) => setRepeatDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} />}
            <Toggle on={repeat} onChange={setRepeat} label="Repeat every month" />
          </div>
        )}
        {err && <div className="error-text">{err}</div>}
        <button className="btn block" onClick={save}>{editing ? 'Update expense' : 'Save expense'}</button>
      </div>
    </Sheet>
  )
}

function SplitSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [upi, setUpi] = useStored<string>(KEYS.upiId, '')
  const [msg, setMsg] = useStored<string>(KEYS.splitRequestMessage, '')
  const [draft, setDraft] = useState(upi)
  const [draftMsg, setDraftMsg] = useState(msg)
  const [err, setErr] = useState('')
  const toast = useToast()
  useEffect(() => { if (open) { setDraft(upi); setDraftMsg(msg); setErr('') } }, [open, upi, msg])
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="Split settings" onClose={onClose} />
      <div className="col" style={{ gap: 14 }}>
        <div className="field"><label>Your UPI ID</label><input className="input" value={draft} onChange={(e) => { setDraft(e.target.value.trim()); setErr('') }} placeholder="yourname@okhdfcbank" autoCapitalize="none" /></div>
        {err && <div className="error-text">{err}</div>}
        <div className="dim small">Add your UPI ID so friends can pay you back in one tap. UPI is available in India only.</div>
        <div className="field"><label>Request message</label><textarea className="input" value={draftMsg} onChange={(e) => setDraftMsg(e.target.value)} placeholder="e.g. Please send my money back" /></div>
        <div className="dim small">Shown when you share a payment request. The amount and UPI link are added automatically.</div>
        <button className="btn block" onClick={() => {
          if (draft && !UPI_RE.test(draft)) return setErr('That doesn’t look like a valid UPI ID (e.g. name@okhdfcbank).')
          setUpi(draft); setMsg(draftMsg); toast('Saved'); onClose()
        }}>Save</button>
      </div>
    </Sheet>
  )
}

function SettleUpSheet({ projectId, person, amount, owesYou, onClose }: { projectId: string; person: SplitPerson; amount: number; owesYou: boolean; onClose: () => void }) {
  const [upi, setUpi] = useStored<string>(KEYS.upiId, '')
  const [msg] = useStored<string>(KEYS.splitRequestMessage, '')
  const [user] = useStored<User | null>(KEYS.user, null)
  const { people } = useSplitData()
  const toast = useToast()
  const [qr, setQr] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showQr, setShowQr] = useState(true)
  // the money that settled it is usually in the list already (the bank's message): filed as Split, it is not income or spending
  const [linked, setLinked] = useState<string | null>(null)
  // what was actually paid: less is a part payment; "call it even" closes the debt at a rounded amount
  const [paidStr, setPaidStr] = useState(String(amount))
  const paid = Math.min(Math.max(0, Number(paidStr) || 0), amount * 2)
  const even = roundedEven(amount)
  const [hinglish, setHinglish] = useStored<boolean>(KEYS.splitHinglish, false)
  const { projects } = useSplitData()
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''
  // what the reminder asks for: the name it greets, the amount and what it is for. All three can be edited before it goes out.
  const [greetAs, setGreetAs] = useState(() => realNameOf(person.name))
  const [requestStr, setRequestStr] = useState(String(amount))
  const [forWhat, setForWhat] = useState(() => (projectName && !projectName.toLowerCase().includes(realNameOf(person.name).toLowerCase()) ? projectName : ''))
  const typed = Math.min(Number(requestStr) || 0, 9999999)
  const request = typed > 0 ? Math.round(typed * 100) / 100 : amount
  const title = forWhat.trim() || 'our split'
  const nth = (nudgeCount(projectId, person.id)?.n ?? 0) + 1
  const india = getCurrency() === 'INR'
  const myName = user?.name || 'Me'
  const upiUrl = upi && india ? buildUpiUrl(upi, myName, request, 'JustMoney settle up') : undefined
  // the link in the message: the pay page when one is set (tappable in WhatsApp), else the UPI link itself
  const msgLink = upi && india ? payLink(upi, myName, request, title) : undefined

  useEffect(() => {
    if (upiUrl && owesYou) QRCode.toDataURL(upiUrl, { margin: 1, width: 480, color: { dark: '#000000', light: '#ffffff' } }).then(setQr)
    else setQr(null)
  }, [upiUrl, owesYou])

  const self = people.find((p) => p.projectId === projectId && p.isCurrentUser)
  // a reminder that gets firmer each time it is sent (or your own message, if you wrote one in settings)
  const message = owesYou && !msg.trim()
    ? nudgeMessage({ name: greetAs.trim() || person.name, amount: request, title, nth, days: 0, upiUrl: msgLink, hinglish })
    : buildCollectionMessage({ myName, amount: formatPrice(request), upiUrl: msgLink, custom: msg })

  async function share(withQr: boolean) {
    if (owesYou) recordNudge(projectId, person.id)
    try {
      if (withQr && qr && navigator.canShare) {
        const blob = await (await fetch(qr)).blob()
        const file = new File([blob], `justmoney-settle-${person.name.toLowerCase().replace(/\W+/g, '-')}.png`, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: message }); return }
      }
      if (navigator.share) { await navigator.share({ text: message }); return }
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') { await navigator.clipboard?.writeText(message); toast('Copied request to clipboard') }
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader title={<>Settle up</>} onClose={onClose} />
      <div className="col" style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={person.name} />
        <div className="muted">{owesYou ? `${person.name} owes you` : `You owe ${person.name}`}</div>
        <div className="big-amount" style={{ color: owesYou ? 'var(--credit)' : 'var(--up)' }}>{formatPrice(amount)}</div>
      </div>
      <p className="muted small" style={{ textAlign: 'center', lineHeight: 1.5 }}>
        {owesYou ? `Ask ${person.name} to pay you ${formatPrice(amount)}, then mark it settled here to clear the balance.` : `Pay ${person.name} directly, then mark it settled here to clear the balance.`}
      </p>
      {owesYou && india && (upi ? (
        qr && showQr && (
          <div className="col" style={{ alignItems: 'center', gap: 8, margin: '6px 0 14px' }}>
            <img src={qr} alt="UPI payment QR" style={{ width: 200, height: 200, borderRadius: 16, background: '#fff', padding: 8 }} />
            <div className="dim tiny">Ask {person.name} to scan this with any UPI app to pay you · {upi}</div>
          </div>
        )
      ) : (
        <form className="card pad col" style={{ margin: '6px 0 14px' }} onSubmit={(e) => { e.preventDefault(); if (UPI_RE.test(draft)) setUpi(draft); else toast('That doesn’t look like a valid UPI ID', 'e.g. name@okhdfcbank') }}>
          <div className="small">Add your UPI ID so {person.name} can pay you back in one tap.</div>
          <div className="row"><input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value.trim())} placeholder="yourname@okhdfcbank" /><button className="btn sm">Save</button></div>
        </form>
      ))}
      {owesYou && (
        <div className="card pad col" style={{ gap: 10, marginBottom: 12 }}>
          <div className="dim tiny">What the request says</div>
          <label className="row small" style={{ gap: 10 }}>
            <span style={{ width: 96 }}>Greet as</span>
            <input className="input grow" value={greetAs} placeholder={realNameOf(person.name)} aria-label="Name in the request" style={{ height: 40 }} onChange={(e) => setGreetAs(e.target.value)} />
          </label>
          <label className="row small" style={{ gap: 10 }}>
            <span style={{ width: 96 }}>Amount ₹</span>
            <input className="input num" inputMode="decimal" value={requestStr} aria-label="Amount to request" style={{ height: 40, textAlign: 'right' }} onChange={(e) => setRequestStr(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          <label className="row small" style={{ gap: 10 }}>
            <span style={{ width: 96 }}>For</span>
            <input className="input grow" value={forWhat} placeholder="e.g. Dinner at Neo" aria-label="What the payment is for" style={{ height: 40 }} onChange={(e) => setForWhat(e.target.value)} />
          </label>
        </div>
      )}
      <div className="card pad col" style={{ gap: 10, marginBottom: 12 }}>
        <label className="row small" style={{ gap: 10 }}>
          <span className="grow">{owesYou ? `${person.name.split(' ')[0]} paid` : 'You paid'}</span>
          <input className="input num" inputMode="decimal" style={{ width: 120, height: 40, textAlign: 'right' }} value={paidStr} aria-label="Amount paid" onChange={(e) => setPaidStr(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        {paid > 0 && paid < amount - 0.004 && <div className="dim tiny">A part payment: {formatPrice(amount - paid)} stays owed.</div>}
        {Math.abs(even - amount) >= 0.01 && <button className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setPaidStr(String(even))}>Call it even at {formatPrice(even)}</button>}
        {owesYou && <div className="row small" style={{ gap: 10 }}><span className="grow dim">Reminder in Hinglish{nth > 1 ? ` · reminder ${nth}` : ''}</span><Toggle on={hinglish} onChange={setHinglish} label="Reminder in Hinglish" /></div>}
      </div>
      <div style={{ marginBottom: 12 }}>
        <PaymentPick type={owesYou ? 'CREDIT' : 'DEBIT'} amount={paid || amount} value={linked} onChange={setLinked}
          label={owesYou ? `Got it from ${person.name}? Pick the payment` : `Paid ${person.name}? Pick the payment`} />
      </div>
      <div className="col">
        {owesYou && <button className="btn block secondary" onClick={() => share(false)}><Icon name="send" size={18} /> Send payment request</button>}
        {owesYou && qr && <button className="btn block secondary" onClick={() => share(true)}><Icon name="qr" size={18} /> Share QR image</button>}
        <button className="btn block" onClick={() => {
          if (!self || !(paid > 0)) return
          // paying the rounded amount closes the debt; anything else below it is a part payment
          const callEven = Math.abs(paid - even) < 0.01 && Math.abs(even - amount) >= 0.01
          const left = owesYou ? settlePart(projectId, person.id, self.id, paid, amount, callEven) : settlePart(projectId, self.id, person.id, paid, amount, callEven)
          if (!left) clearNudges(projectId, person.id)
          if (linked) updatePayment(linked, { paymentCategory: SPLIT })
          toast(left ? `${formatPrice(paid)} recorded` : callEven ? `Called it even at ${formatPrice(paid)}` : 'Marked as settled', left ? `${formatPrice(left)} still to come` : linked ? (owesYou ? 'Their payment is filed as Split, not income' : 'Your payment is filed as Split, not spending') : undefined); onClose()
        }}>{paid > 0 && paid < amount - 0.004 && Math.abs(paid - even) >= 0.01 ? `Record ${formatPrice(paid)} paid` : 'Mark as settled'}</button>
        {owesYou && qr && <div className="row" style={{ justifyContent: 'center' }}><span className="dim small">Show QR</span><Toggle on={showQr} onChange={setShowQr} /></div>}
      </div>
    </Sheet>
  )
}

/** The items on a bill and who had each; nobody ticked means everyone. Tax, charges and discounts are shared in proportion. */
function ItemsEditor({ items, setItems, extras, setExtras, members, shares, scanning, onScan }: {
  items: SplitItem[]; setItems: (i: SplitItem[]) => void; extras: string; setExtras: (v: string) => void; members: SplitPerson[]
  shares: { personId: string; amount: number }[]; scanning: boolean; onScan: (f?: File) => void
}) {
  const patch = (i: number, p: Partial<SplitItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...p } : it)))
  const short = (m: SplitPerson) => (m.isCurrentUser ? 'You' : m.name.split(' ')[0])
  return (
    <div className="col" style={{ gap: 10 }}>
      <label className="btn block secondary" style={{ cursor: 'pointer' }}>
        <Icon name="image" size={18} />{scanning ? 'Reading the bill…' : items.length ? 'Scan another bill' : 'Scan the bill'}
        <input type="file" accept="image/*" capture="environment" hidden disabled={scanning} onChange={(e) => { onScan(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {items.map((it, i) => (
        <div key={i} className="card pad col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={it.name} placeholder="Item" aria-label={`Item ${i + 1}`} style={{ height: 38, minWidth: 0 }} onChange={(e) => patch(i, { name: e.target.value })} />
            <input className="input num" inputMode="decimal" value={it.price || ''} placeholder="0" aria-label={`Price of item ${i + 1}`} style={{ width: 90, height: 38, textAlign: 'right' }} onChange={(e) => patch(i, { price: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} />
            <button className="dim" aria-label={`Remove item ${i + 1}`} onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
          </div>
          <div className="row wrap" style={{ gap: 6 }} role="group" aria-label={`Who had ${it.name || 'this'}`}>
            {members.map((m) => {
              const on = it.who.includes(m.id)
              return <button key={m.id} className={`chip${on ? ' on' : ''}`} style={{ height: 30 }} onClick={() => patch(i, { who: on ? it.who.filter((x) => x !== m.id) : [...it.who, m.id] })}>{short(m)}</button>
            })}
            {!it.who.length && <span className="dim tiny" style={{ alignSelf: 'center' }}>shared by everyone</span>}
          </div>
        </div>
      ))}
      <button className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setItems([...items, { name: '', price: 0, who: [] }])}>+ Add an item</button>
      <label className="row small" style={{ gap: 10 }}>
        <span className="grow">Tax, service, delivery <span className="dim">(minus a discount)</span></span>
        <input className="input num" inputMode="decimal" value={extras} placeholder="0" aria-label="Tax and charges" style={{ width: 100, height: 38, textAlign: 'right' }} onChange={(e) => setExtras(e.target.value.replace(/[^0-9.-]/g, ''))} />
      </label>
      {shares.length > 0 && (
        <div className="card">{shares.map((s) => {
          const m = members.find((x) => x.id === s.personId)
          return <div key={s.personId} className="list-row small"><span className="grow">{m ? short(m) : '—'}</span><b className="num">{formatPrice(s.amount)}</b></div>
        })}</div>
      )}
    </div>
  )
}

/** Send a split to the group: a card with everyone's share and your UPI QR, and a message with each person's own pay link. */
function ShareSplitSheet({ txn, project, members, rows, onClose }: { txn: SplitTxn; project: SplitProject; members: SplitPerson[]; rows: SplitRow[]; onClose: () => void }) {
  const [upi] = useStored<string>(KEYS.upiId, '')
  const [user] = useStored<User | null>(KEYS.user, null)
  const [hinglish, setHinglish] = useStored<boolean>(KEYS.splitHinglish, false)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const myName = user?.name || 'Me'
  const india = getCurrency() === 'INR'
  const payer = members.find((m) => m.id === txn.payerId)
  const iPaid = !!payer?.isCurrentUser
  // freshly saved splits are not in `rows` yet: read them from storage
  const own = (rows.some((r) => r.transactionId === txn.id) ? rows : read<SplitRow[]>(KEYS.splits, [])).filter((r) => r.transactionId === txn.id)
  const lines = own.map((r) => {
    const m = members.find((x) => x.id === r.personId)
    const isMe = !!m?.isCurrentUser
    return { name: isMe ? `${myName} (you)` : m?.name ?? '—', amount: r.splitAmount, upiUrl: iPaid && !isMe && india ? payLink(upi, myName, r.splitAmount, txn.description) : undefined, isMe }
  })
  const message = splitShareMessage({ title: `${txn.description} · ${project.name}`, total: txn.amount, payer: payer?.isCurrentUser ? myName : payer?.name ?? '—', lines: lines.filter((l) => !l.isMe), hinglish })

  async function send(withCard: boolean) {
    setBusy(true)
    try {
      const blob = withCard ? await splitCardImage({ title: txn.description, total: txn.amount, payer: payer?.isCurrentUser ? myName : payer?.name ?? '—', lines, upiUrl: iPaid && upi && india ? `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(myName)}&cu=INR` : undefined, upi: iPaid ? upi : undefined }) : null
      const file = blob ? new File([blob], `split-${txn.description.toLowerCase().replace(/\W+/g, '-')}.png`, { type: 'image/png' }) : null
      if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: message }); return }
      if (navigator.share) { await navigator.share({ text: message }); return }
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') { await navigator.clipboard?.writeText(message); toast('Copied to clipboard', 'Paste it in your group chat') }
    } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader title={<>Share split</>} sub="Friends pay from the message: no app needed." onClose={onClose} />
      <div className="card">{lines.map((l, i) => (
        <div key={i} className="list-row"><span className="grow">{l.name}</span><b className="num">{formatPrice(l.amount)}</b>{l.upiUrl && <span className="dim tiny" style={{ marginLeft: 8 }}>pay link</span>}</div>
      ))}</div>
      {iPaid && india && !upi && <p className="small" style={{ color: 'var(--amber)' }}>Add your UPI ID in SplitMoney settings (the gear) to put a pay link and QR in the message.</p>}
      <div className="row small" style={{ gap: 10, margin: '12px 0' }}><span className="grow dim">Message in Hinglish</span><Toggle on={hinglish} onChange={setHinglish} label="Message in Hinglish" /></div>
      <div className="col">
        <button className="btn block" disabled={busy} onClick={() => send(true)}><Icon name="share" size={18} />{busy ? 'Making the card…' : 'Share card and pay links'}</button>
        <button className="btn block secondary" disabled={busy} onClick={() => send(false)}><Icon name="send" size={18} />Send the message only</button>
      </div>
    </Sheet>
  )
}
