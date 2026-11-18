import { useEffect, useMemo, useState } from 'react'
import { Icon, Sheet, SheetHeader, useToast } from '../ui/ui'
import { formatPrice } from '../../lib/core/format'
import AdviceCard from '../home/AdviceCard'
import { useStored, KEYS } from '../../lib/core/storage'
import { addPay } from '../../lib/plan/planning'
import { getPlanSettings, savePlanSettings, savingsGoals } from '../../lib/plan/plan'
import {
  familyBreakdown, familyNames, monthlyEssentials, splitRemainder, addPot, allocateIncome, getAllocations, getMoves, getPots, lastIncome, movePot, potBalances, runway, skipAllocation, suggestAllocation, unallocatedIncome, takeFromSavings,
  type Allocation, type Pot, type PotMove,
} from '../../lib/plan/pots'
import type { Commitment, FamilyMember, SavingsGoal, Transaction } from '../../lib/core/types'
import type { Person } from '../../lib/payees/peopleMatch'

const fmt = (v: number) => formatPrice(v, { round: true })
const num = (s: string) => Number(s.replace(/[^0-9.]/g, '')) || 0
const when = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Everything the pots views need, kept in step with storage. */
export function usePots() {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [pots] = useStored<Pot[]>(KEYS.pots, [])
  const [allocations] = useStored<Allocation[]>(KEYS.allocations, [])
  const [moves] = useStored<PotMove[]>(KEYS.potMoves, [])
  const [goals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  useStored(KEYS.planSettings, {})
  const balances = useMemo(() => potBalances(pots, allocations, moves, txns, commitments), [pots, allocations, moves, txns, commitments])
  return { txns, commitments, pots, allocations, moves, goals, balances }
}

/** Splits an income into pots. Family and bills first, then saving, and what is left is for spending. */
export function AllocateSheet({ open, onClose, amount: amount0, source: source0, txId, delayed: startDelayed }: { open: boolean; onClose: () => void; delayed?: boolean; amount?: number; source?: string; txId?: string | null }) {
  const { txns, commitments, pots, allocations } = usePots()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('Salary')
  const [v, setV] = useState({ family: '', bills: '', saving: '', emergency: '' })
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [members] = useStored<FamilyMember[]>(KEYS.familyMembers, [])
  const [people] = useStored<Person[]>(KEYS.people, [])
  const [who, setWho] = useState<Record<string, string>>({})
  /** Saving and emergency follow family and bills until the user types them. */
  const [typed, setTyped] = useState(false)
  /** What kind of money this is; "delayed" asks how many months it covers and for the details. */
  const [kind, setKind] = useState<'salary' | 'delayed' | 'freelance' | 'family' | 'other'>('salary')
  const today = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const [months, setMonths] = useState('3')
  const [fromMonth, setFromMonth] = useState('')
  const [paidOn, setPaidOn] = useState(iso(today))
  const [unpaid, setUnpaid] = useState('0')
  const [repay, setRepay] = useState('')
  const cfg = getPlanSettings()
  const suggest = (a: number) => {
    const s = suggestAllocation(a, { last: allocations[0], commitments, saveRate: cfg.saveRate, emergencyShare: cfg.emergencyShare })
    setV({ family: String(s.family || ''), bills: String(s.bills || ''), saving: String(s.saving || ''), emergency: String(s.emergency || '') })
  }
  useEffect(() => {
    if (!open) return
    setAmount(amount0 ? String(amount0) : '')
    setSource(startDelayed ? 'Delayed salary' : source0 || 'Salary')
    setCustom({}); setTyped(false); setWho({}); setKind(startDelayed ? 'delayed' : 'salary'); setMonths('3'); setUnpaid('0'); setRepay(''); setPaidOn(iso(new Date()))
    { const d = new Date(); d.setMonth(d.getMonth() - 3); setFromMonth(iso(d).slice(0, 7)) }
    if (amount0) suggest(amount0); else setV({ family: '', bills: '', saving: '', emergency: '' })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const a = num(amount)
  const extra = pots.filter((p) => p.kind === 'custom')
  const names = familyNames(members, people)
  const delayed = kind === 'delayed'
  const nMonths = Math.max(1, Math.floor(num(months)) || 1)
  const given = num(repay) + num(v.family) + num(v.bills) + num(v.saving) + num(v.emergency) + extra.reduce((s, p) => s + num(custom[p.id] ?? ''), 0)
  const personal = a - given
  const field = (key: keyof typeof v, label: string, hint?: string) => (
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      <div className="grow"><div style={{ fontWeight: 600 }}>{label}</div>{hint && <div className="dim tiny">{hint}</div>}</div>
      <input className="input" style={{ width: 130, textAlign: 'right' }} inputMode="decimal" value={v[key]} placeholder="0" onChange={(e) => {
        const next = { ...v, [key]: e.target.value.replace(/[^0-9.]/g, '') }
        if (key === 'saving' || key === 'emergency') setTyped(true)
        else if (!typed) {
          // family and bills decide what is left, so saving follows them until it is typed in by hand
          const s = splitRemainder(a, num(next.family), num(next.bills), cfg.saveRate, cfg.emergencyShare)
          next.saving = String(s.saving || ''); next.emergency = String(s.emergency || '')
        }
        setV(next)
      }} aria-label={label} />
    </div>
  )
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Where does it go?</>} sub="Decide as soon as money comes in, however late it is" onClose={onClose} />
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); if (!typed) { const s = splitRemainder(num(e.target.value), num(v.family), num(v.bills), cfg.saveRate, cfg.emergencyShare); setV({ ...v, saving: String(s.saving || ''), emergency: String(s.emergency || '') }) } }} placeholder="Amount received" aria-label="Amount received" />
        </div>
        {kind === 'other' && <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Who or what is it from?" aria-label="From" />}
        <div className="col" style={{ gap: 6 }}>
          <div className="tiny dim">What is this money?</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {([['salary', 'Salary'], ['delayed', 'Delayed salary'], ['freelance', 'Freelance'], ['family', 'Family help'], ['other', 'Other']] as const).map(([k, l]) => (
              <button key={k} type="button" className={`chip ${kind === k ? 'active' : ''}`} onClick={() => { setKind(k); setSource(k === 'other' ? '' : l) }}>{l}</button>
            ))}
          </div>
        </div>
        {delayed && (
          <div className="card pad col" style={{ gap: 10 }}>
            <div className="small" style={{ lineHeight: 1.5 }}>Your pay came late. Tell the app what it covers so your pay history and plan stay right.</div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>Months this covers</div><div className="dim tiny">{a > 0 ? `About ${fmt(a / nMonths)} a month` : 'Counted from the first month below'}</div></div>
              <input className="input" style={{ width: 80, textAlign: 'right' }} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Months covered" />
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>First month it is for</div></div>
              <input className="input" type="month" style={{ width: 160 }} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} aria-label="First month" />
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>Received on</div></div>
              <input className="input" type="date" style={{ width: 160 }} max={iso(new Date())} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Received on" />
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>Months still unpaid</div><div className="dim tiny">0 if you are fully caught up</div></div>
              <input className="input" style={{ width: 80, textAlign: 'right' }} inputMode="numeric" value={unpaid} onChange={(e) => setUnpaid(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Months still unpaid" />
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div className="grow"><div style={{ fontWeight: 600 }}>Pay back what you borrowed</div><div className="dim tiny">Family or friends who helped meanwhile</div></div>
              <input className="input" style={{ width: 120, textAlign: 'right' }} inputMode="decimal" value={repay} placeholder="0" onChange={(e) => setRepay(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Pay back borrowed" />
            </div>
          </div>
        )}
        {a > 0 && (
          <>
            {field('family', 'Family', 'Sent to family from this')}
            {num(v.family) > 0 && names.length > 0 && (
              <div className="card pad col" style={{ gap: 8 }}>
                <div className="tiny dim">Who is the family money for? (optional)</div>
                {names.map((n) => (
                  <div key={n} className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <div className="grow">{n}</div>
                    <input className="input" style={{ width: 110, textAlign: 'right' }} inputMode="decimal" value={who[n] ?? ''} placeholder="0" onChange={(e) => setWho({ ...who, [n]: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={`For ${n}`} />
                  </div>
                ))}
                {names.length > 1 && <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setWho(Object.fromEntries(names.map((n) => [n, String(Math.floor(num(v.family) / names.length))])))}>Split evenly</button>}
                {Object.values(who).reduce((s, x) => s + num(x), 0) > num(v.family) && <div className="tiny" style={{ color: 'var(--danger)' }}>That is more than the family amount.</div>}
              </div>
            )}
            {field('bills', 'Bills', 'Rent, EMIs, subscriptions')}
            {field('saving', 'Savings', 'Into your goals')}
            {field('emergency', 'Emergency fund', 'A cushion for a late month')}
            {extra.map((p) => (
              <div key={p.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <div className="grow" style={{ fontWeight: 600 }}>{p.name}</div>
                <input className="input" style={{ width: 130, textAlign: 'right' }} inputMode="decimal" value={custom[p.id] ?? ''} placeholder="0" onChange={(e) => setCustom({ ...custom, [p.id]: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={p.name} />
              </div>
            ))}
            <div className="card pad row between" style={{ background: 'var(--accent-soft)', borderColor: personal < 0 ? 'var(--danger)' : undefined }}>
              <div><b>Left for your own spending</b><div className="dim tiny">Whatever is not given to the rest</div></div>
              <b className="num" style={{ fontSize: 20, color: personal < 0 ? 'var(--danger)' : undefined }}>{fmt(personal)}</b>
            </div>
            {personal < 0 && <div className="small" style={{ color: 'var(--danger)' }}>That is {fmt(-personal)} more than came in. Lower something above.</div>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn secondary sm" onClick={() => { setTyped(false); suggest(a) }}>Suggest a split</button>
              <button className="btn grow" disabled={personal < 0} onClick={() => {
                const fromD = fromMonth ? new Date(`${fromMonth}-01T12:00`) : new Date()
                const paidAt = new Date(`${paidOn}T12:00`).getTime() || Date.now()
                const al = allocateIncome({
                  delayed: delayed ? { months: nMonths, from: fromMonth, paidOn: paidAt, stillUnpaid: Math.floor(num(unpaid)) } : undefined,
                  amount: a, source: (source.trim() || 'Income') + (delayed ? ` (${nMonths} month${nMonths === 1 ? '' : 's'})` : ''), txId, family: num(v.family), bills: num(v.bills) + num(repay), saving: num(v.saving), emergency: num(v.emergency),
                  custom: Object.fromEntries(extra.map((p) => [p.id, num(custom[p.id] ?? '')]).filter(([, x]) => (x as number) > 0)), essentials: Math.max(monthlyEssentials(txns), 0) || num(v.family) + num(v.bills) + personal,
                  familySplit: Object.entries(who).map(([w, x]) => ({ who: w, amount: num(x) })).filter((f) => f.amount > 0),
                })
                if (delayed) {
                  // one pay entry per month it covers, so the pay history shows each month as paid
                  for (let i = 0; i < nMonths; i++) { const d = new Date(fromD.getFullYear(), fromD.getMonth() + i, 1, 12); addPay(d.getTime(), Math.round(a / nMonths), `Delayed pay, received ${new Date(paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`) }
                }
                const name = (id: string) => ({ family: 'Family', bills: 'Bills', personal: 'Personal' } as Record<string, string>)[id] ?? pots.find((p) => p.id === id)?.name ?? 'pot'
                toast('Money placed', `${fmt(a)}: ${al.splits.map((s) => `${fmt(s.amount)} ${name(s.pot)}`).join(', ')}${al.saving + al.emergency > 0 ? `, ${fmt(al.saving + al.emergency)} saved` : ''}`)
                onClose()
              }}>Place it</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** Moves money between pots, or covers a pot from savings when income is late. */
export function MoveSheet({ open, onClose, mode: first }: { open: boolean; onClose: () => void; mode: 'pots' | 'savings' }) {
  const { balances, goals } = usePots()
  const toast = useToast()
  const [mode, setMode] = useState(first)
  const [from, setFrom] = useState('personal')
  const [to, setTo] = useState('personal')
  const [goal, setGoal] = useState('')
  const [amount, setAmount] = useState('')
  const saved = goals.filter((g) => g.saved > 0)
  useEffect(() => {
    if (!open) return
    setMode(first); setAmount(''); setTo('personal')
    setFrom(balances.find((b) => b.pot.id !== 'personal' && b.left > 0)?.pot.id ?? 'family')
    setGoal(saved.find((g) => !g.emergency)?.id ?? saved[0]?.id ?? '')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const a = num(amount)
  const src = balances.find((b) => b.pot.id === from)
  const g = goals.find((x) => x.id === goal)
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={mode === 'savings' ? <>Use your savings</> : <>Move money</>} sub={mode === 'savings' ? 'Cover a pot while income is late' : 'When something unexpected comes up'} onClose={onClose} />
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={mode === 'pots' ? 'on' : ''} onClick={() => setMode('pots')}>Between pots</button>
        <button className={mode === 'savings' ? 'on' : ''} onClick={() => setMode('savings')}>From savings</button>
      </div>
      <div className="col" style={{ gap: 12 }}>
        {mode === 'pots' ? (
          <div className="field"><label>From</label>
            <div className="chips" style={{ flexWrap: 'wrap' }}>{balances.map((b) => <button key={b.pot.id} className={`chip${from === b.pot.id ? ' on' : ''}`} onClick={() => setFrom(b.pot.id)}>{b.pot.name} · {fmt(b.left)}</button>)}</div>
          </div>
        ) : (
          <div className="field"><label>Take from</label>
            {saved.length === 0 ? <div className="dim small">No savings yet.</div> : <div className="chips" style={{ flexWrap: 'wrap' }}>{saved.map((x) => <button key={x.id} className={`chip${goal === x.id ? ' on' : ''}`} onClick={() => setGoal(x.id)}>{x.name} · {fmt(x.saved)}</button>)}</div>}
          </div>
        )}
        <div className="field"><label>Into</label>
          <div className="chips" style={{ flexWrap: 'wrap' }}>{balances.filter((b) => mode === 'savings' || b.pot.id !== from).map((b) => <button key={b.pot.id} className={`chip${to === b.pot.id ? ' on' : ''}`} onClick={() => setTo(b.pot.id)}>{b.pot.name}</button>)}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" aria-label="Amount to move" />
          <button className="btn sm secondary" onClick={() => setAmount(String(Math.max(0, Math.floor(mode === 'savings' ? g?.saved ?? 0 : src?.left ?? 0))))}>All</button>
        </div>
        {mode === 'savings' && g?.emergency && <div className="dim small">This is your emergency fund. It is there for moments like this.</div>}
        <button className="btn block" disabled={!(a > 0) || (mode === 'savings' ? !g : !src || from === to)} onClick={() => {
          if (mode === 'savings') { const took = takeFromSavings(goal, to, a); toast(`${fmt(took)} taken from ${g?.name}`, 'It is now in your pot to spend.') }
          else { movePot(from, to, a); toast(`${fmt(a)} moved`, `${src?.pot.name} → ${balances.find((b) => b.pot.id === to)?.pot.name}`) }
          onClose()
        }}>{mode === 'savings' ? 'Use savings' : 'Move it'}</button>
      </div>
    </Sheet>
  )
}

function AddPotSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [cats, setCats] = useState<string[]>([])
  const [list] = useStored<string[] | null>(KEYS.categories, null)
  const options = (list ?? ['Food', 'Snacks', 'Shopping', 'Travel', 'Health', 'Entertainment', 'Grocery', 'Fuel']).filter((c) => !['Family', 'Others', 'EMI/Bill', 'Rent'].includes(c))
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>New pot</>} sub="For something you want to watch separately, like medical or travel" onClose={onClose} />
      <div className="col" style={{ gap: 12 }}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Medical)" />
        <div className="field"><label>Spending in these categories comes out of it</label>
          <div className="chips" style={{ flexWrap: 'wrap' }}>{options.map((c) => <button key={c} className={`chip${cats.includes(c) ? ' on' : ''}`} onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])}>{c}</button>)}</div>
        </div>
        <button className="btn block" disabled={!name.trim() || !cats.length} onClick={() => { addPot(name, cats); onClose(); setName(''); setCats([]) }}>Add pot</button>
      </div>
    </Sheet>
  )
}

/** Where the money is: what each pot got, what was spent, what is left. Plus the late-income picture. */
export function PotsSection() {
  const { txns, goals, balances, allocations } = usePots()
  const [members] = useStored<FamilyMember[]>(KEYS.familyMembers, [])
  const [people] = useStored<Person[]>(KEYS.people, [])
  const fam = useMemo(() => familyBreakdown(allocations, txns, balances.find((b) => b.pot.id === 'family')?.pot.startAt ?? 0, members, people), [allocations, txns, balances, members, people])
  const [alloc, setAlloc] = useState(false)
  const [move, setMove] = useState<null | 'pots' | 'savings'>(null)
  const [adding, setAdding] = useState(false)
  const cfg = getPlanSettings()
  const li = lastIncome(txns, allocations)
  const r = runway(balances, goals, txns)
  const late = li.days === null || li.days >= 35
  return (
    <>
      {late && balances.length > 0 && (
        <div className="card pad col" style={{ gap: 6, borderColor: 'var(--amber)' }}>
          <b>{li.days === null ? 'No income recorded yet' : `No income for ${li.days} days`}</b>
          <div className="small" style={{ lineHeight: 1.5 }}>
            {r.days !== null
              ? <>At your usual pace, what is left in your pots lasts about <b>{r.days} day{r.days === 1 ? '' : 's'}</b>. With your savings of {fmt(r.savings)} it lasts about <b>{r.withSavings} days</b>.</>
              : 'Nothing spent lately, so there is no pace to go by.'}
          </div>
          {r.savings > 0 && <button className="btn sm secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setMove('savings')}>Use savings to cover essentials</button>}
        </div>
      )}
      <AdviceCard area="pots" limit={3} title="What to do next" />
      <div className="section-label">Your pots</div>
      {balances.length === 0 ? (
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="small muted" style={{ lineHeight: 1.5 }}>Money is planned when it comes in, not by the month. Tell the app what arrived and where it should go: family, bills, savings, your own spending.</div>
          <button className="btn" onClick={() => setAlloc(true)}>Place an income</button>
        </div>
      ) : (
        <div className="card">
          {balances.map((b) => (
            <div key={b.pot.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row between"><b>{b.pot.name}</b><b className="num" style={{ color: b.left < 0 ? 'var(--danger)' : undefined }}>{fmt(b.left)} left</b></div>
                <div className="bar" style={{ height: 6, margin: '6px 0' }}><i style={{ width: `${b.allocated > 0 ? Math.min(100, (b.spent / b.allocated) * 100) : b.spent > 0 ? 100 : 0}%`, background: b.left < 0 ? 'var(--danger)' : b.allocated > 0 && b.spent / b.allocated > 0.8 ? 'var(--amber)' : 'var(--toggle)' }} /></div>
                <div className="dim small">{fmt(b.allocated)} given · {fmt(b.spent)} spent</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {fam.length > 0 && fam.some((r) => r.given > 0) && (
        <>
          <div className="section-label">Family money, person by person</div>
          <div className="card">
            {fam.map((r) => (
              <div key={r.who} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><div className="row between"><b>{r.who}</b><b className="num" style={{ color: r.left < 0 ? 'var(--amber)' : undefined }}>{r.left >= 0 ? `${fmt(r.left)} left` : `${fmt(-r.left)} extra`}</b></div><div className="dim small">{fmt(r.given)} set aside · {fmt(r.sent)} sent</div></div>
              </div>
            ))}
          </div>
        </>
      )}
      {balances.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="chip on" onClick={() => setAlloc(true)}>+ New income</button>
          <button className="chip" onClick={() => setMove('pots')}>Move money</button>
          <button className="chip" onClick={() => setMove('savings')}>Use savings</button>
          <button className="chip" onClick={() => setAdding(true)}>+ Pot</button>
        </div>
      )}

      <div className="section-label">When is the next income due?</div>
      <input className="input" type="date" value={cfg.nextIncomeAt ? new Date(cfg.nextIncomeAt).toISOString().slice(0, 10) : ''} onChange={(e) => savePlanSettings({ nextIncomeAt: e.target.value ? new Date(`${e.target.value}T09:00`).getTime() : null })} aria-label="Next income date" />
      <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>Optional. Your own spending is spread over the days until then. If you do not know, it is spread over two weeks, and moves on as time passes.</p>

      {allocations.length > 0 && (
        <>
          <div className="section-label">Money that came in</div>
          <div className="card">
            {allocations.slice(0, 6).map((a) => (
              <div key={a.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="row between"><b>{a.source}</b><b className="num">{fmt(a.amount)}</b></div>
                  <div className="dim small">{when(a.at)} · {a.splits.map((s) => `${fmt(s.amount)} ${balances.find((b) => b.pot.id === s.pot)?.pot.name ?? ''}`).join(' · ')}{a.saving + a.emergency > 0 ? ` · ${fmt(a.saving + a.emergency)} saved` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <AllocateSheet open={alloc} onClose={() => setAlloc(false)} />
      <MoveSheet open={!!move} onClose={() => setMove(null)} mode={move ?? 'pots'} />
      <AddPotSheet open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/** Home: income that came in and has not been split yet. */
export function IncomePrompt({ hidden }: { hidden: boolean }) {
  const { txns, allocations } = usePots()
  useStored(KEYS.allocSkipped, [])
  const [open, setOpen] = useState(false)
  const t = unallocatedIncome(txns, allocations)[0]
  if (!t) return null
  return (
    <>
      <div className="card pad col" style={{ gap: 8, borderColor: 'var(--accent)' }}>
        <b>{hidden ? '••••' : fmt(t.paymentAmount)} came in{t.paymentReceiver ? ` from ${t.paymentReceiver}` : ''}</b>
        <div className="small muted" style={{ lineHeight: 1.5 }}>Decide where it goes: family, bills, savings, your own spending.</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm grow" onClick={() => setOpen(true)}>Split it now</button>
          <button className="btn sm secondary" onClick={() => skipAllocation(t.id)}>Not this one</button>
        </div>
      </div>
      <AllocateSheet open={open} onClose={() => setOpen(false)} amount={t.paymentAmount} source={t.paymentReceiver} txId={t.id} />
    </>
  )
}

/** Home: the pots at a glance, with the personal pot as a daily allowance. */
export function PotsCard({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { txns, goals, balances, allocations } = usePots()
  const cfg = getPlanSettings()
  const [alloc, setAlloc] = useState(false)
  const [move, setMove] = useState(false)
  const f = (v: number) => (hidden ? '••••' : fmt(v))
  const personal = balances.find((b) => b.pot.id === 'personal')
  if (!personal) {
    return (
      <>
        <button className="card mini-card" onClick={() => setAlloc(true)}>
          <span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="target" size={20} /></span>
          <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}><b style={{ display: 'block' }}>Plan by income, not by month</b><span className="dim tiny">When money comes in, decide where it goes. Tap to start.</span></span>
          <span className="chev"><Icon name="chevron" size={18} /></span>
        </button>
        <AllocateSheet open={alloc} onClose={() => setAlloc(false)} />
      </>
    )
  }
  const until = cfg.nextIncomeAt && cfg.nextIncomeAt > Date.now() ? Math.ceil((cfg.nextIncomeAt - Date.now()) / 86400000) : 14
  const perDay = Math.max(0, personal.left) / Math.max(1, until)
  const li = lastIncome(txns, allocations)
  const r = runway(balances, goals, txns)
  const low = personal.allocated > 0 && personal.left <= personal.allocated * 0.2
  return (
    <div className="card pad col" style={{ gap: 10 }}>
      <button className="row" style={{ gap: 10, width: '100%', textAlign: 'left' }} onClick={onOpen} aria-label="Open your pots">
        <span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="target" size={20} /></span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="small muted" style={{ display: 'block' }}>Your own spending</span>
          <b className="num" style={{ fontSize: 22, color: personal.left < 0 ? 'var(--danger)' : undefined }}>{personal.left < 0 ? `${f(-personal.left)} over` : `${f(personal.left)} left`}</b>
        </span>
        <span className="pill" style={{ background: 'var(--glass)', color: personal.left < 0 ? 'var(--danger)' : low ? 'var(--amber)' : 'var(--credit)' }}>{personal.left < 0 ? 'Used up' : low ? 'Running low' : 'On track'}</span>
      </button>
      <div className="bar" style={{ height: 8 }}><i style={{ width: `${personal.allocated > 0 ? Math.min(100, (personal.spent / personal.allocated) * 100) : 100}%`, background: personal.left < 0 ? 'var(--danger)' : low ? 'var(--amber)' : 'var(--toggle)' }} /></div>
      <div className="dim tiny">{f(personal.spent)} of {f(personal.allocated)} spent · about {f(perDay)} a day for {until} day{until === 1 ? '' : 's'}</div>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        {balances.filter((b) => b.pot.id !== 'personal').map((b) => <span key={b.pot.id} className="tiny"><span className="muted">{b.pot.name}</span> <b className="num" style={{ color: b.left < 0 ? 'var(--danger)' : undefined }}>{f(b.left)}</b></span>)}
      </div>
      {li.days !== null && li.days >= 35 && (
        <div className="small" style={{ color: 'var(--amber)', lineHeight: 1.45 }}>No income for {li.days} days. {r.days !== null ? `Your pots last about ${r.days} days, about ${r.withSavings} with savings.` : ''}</div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="chip on" onClick={() => setAlloc(true)}>+ New income</button>
        <button className="chip" onClick={() => setMove(true)}>Move / use savings</button>
      </div>
      <AllocateSheet open={alloc} onClose={() => setAlloc(false)} />
      <MoveSheet open={move} onClose={() => setMove(false)} mode="pots" />
    </div>
  )
}

export { getPots, getMoves, getAllocations, savingsGoals }
