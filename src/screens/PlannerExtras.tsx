import { ReachBar } from '../components/ui/ReachBar'
import { useMemo, useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { useStored, uid, KEYS } from '../lib/core/storage'
import { addTransaction, categoryColor, withFamily, METHOD_COLORS } from '../lib/core/data'
import { formatPrice, monthRange } from '../lib/core/format'
import type { CategoryBudgets, PaymentMethod, RecurringRule, SavingsGoal, Transaction } from '../lib/core/types'
import { accountBalance, isTransferCategory, tracksBalance } from '../lib/accounts/accounts'
import { DEFAULT_ROUNDUP, type RoundUpSettings } from '../lib/plan/roundup'

/* ---------- Category budgets ---------- */
export function BudgetsPage({ onBack }: { onBack: () => void }) {
  const [budgets, setBudgets] = useStored<CategoryBudgets>(KEYS.categoryBudgets, {})
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const toast = useToast()
  const confirm = useConfirm()
  const cats = withFamily(categories)
  const now = new Date()

  // Average monthly spend per category over the last three full months, as a starting suggestion.
  const avg = useMemo(() => {
    const out: Record<string, number> = {}
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i)
      const { start, end } = monthRange(d.getFullYear(), d.getMonth())
      txns.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= start && t.timestamp < end)
        .forEach((t) => { out[t.paymentCategory] = (out[t.paymentCategory] ?? 0) + t.paymentAmount / 3 })
    }
    return out
  }, [txns]) // eslint-disable-line react-hooks/exhaustive-deps

  const { start } = monthRange(now.getFullYear(), now.getMonth())
  const spent = (c: string) => txns.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === c && t.timestamp >= start).reduce((a, t) => a + t.paymentAmount, 0)
  const total = Object.values(budgets).reduce((a, b) => a + (b || 0), 0)

  return (
    <div className="page">
      <PageHeader title="Budgets" onBack={onBack} />
      <p className="muted small">A heads-up at 80% and when you go over.</p>
      {total > 0 && (
        <div className="card pad row between">
          <span className="col"><span className="muted">Budgeted this month</span><b className="num">{formatPrice(total, { round: true })}</b></span>
          <button className="chip" style={{ height: 32 }} onClick={async () => {
            if (!(await confirm({ title: 'Reset all category budgets?', body: 'Every category goes back to no limit. You can undo it right after.', confirm: 'Reset', danger: true }))) return
            const before = budgets
            setBudgets({})
            toast('Budgets reset', 'All category limits cleared', { label: 'Undo', onClick: () => setBudgets(before) })
          }}><Icon name="refresh" size={14} /> Reset all</button>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        {cats.map((c) => {
          const cap = budgets[c] ?? 0
          const s = spent(c)
          const pct = cap ? Math.round((s / cap) * 100) : 0
          return (
            <div key={c} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row">
                <span style={{ width: 10, height: 10, borderRadius: 5, background: categoryColor(c, cats) }} />
                <span className="grow">{c}</span>
                <input className="input num" inputMode="numeric" aria-label={`${c} budget`} style={{ width: 120, height: 38, textAlign: 'right' }}
                  placeholder={avg[c] ? `~${Math.round(avg[c] / 100) * 100}` : 'No limit'} value={cap || ''}
                  onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '')) || 0; const next = { ...budgets }; if (v) next[c] = v; else delete next[c]; setBudgets(next) }} />
              </div>
              {cap > 0 && (
                <>
                  <div className="bar" style={{ height: 6 }}><i style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--amber)' : categoryColor(c, cats) }} /></div>
                  <div className="row between tiny dim"><span>{formatPrice(s, { round: true })} spent · {pct}%</span><span className="row" style={{ gap: 10 }}>{s > cap ? `${formatPrice(s - cap, { round: true })} over` : `${formatPrice(cap - s, { round: true })} left`}
                    <button className="link tiny" aria-label={`Reset ${c} budget`} onClick={() => { const before = budgets; const next = { ...budgets }; delete next[c]; setBudgets(next); toast(`${c} budget reset`, undefined, { label: 'Undo', onClick: () => setBudgets(before) }) }}>Reset</button></span></div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {Object.keys(avg).length > 0 && (
        <button className="btn block secondary" style={{ marginTop: 14 }} onClick={() => {
          const next: CategoryBudgets = { ...budgets }
          Object.entries(avg).forEach(([c, v]) => { if (!next[c] && cats.includes(c)) next[c] = Math.ceil(v / 500) * 500 })
          setBudgets(next); toast('Budgets suggested', 'Based on your last 3 months. Tweak any of them.')
        }}><Icon name="sparkles" size={18} /> Suggest from my last 3 months</button>
      )}
    </div>
  )
}

/* ---------- Savings goals ---------- */
const monthsBetween = (from: number, to: number) => {
  const a = new Date(from), b = new Date(to)
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth())
}

export function GoalsPage({ onBack }: { onBack: () => void }) {
  const [goals, setGoals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  const [adding, setAdding] = useState(false)
  const [contrib, setContrib] = useState<SavingsGoal | null>(null)
  const confirm = useConfirm()
  const saved = goals.reduce((a, g) => a + g.saved, 0)
  const target = goals.reduce((a, g) => a + g.target, 0)
  return (
    <div className="page">
      <PageHeader title="Savings goals" onBack={onBack} right={<button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Goal</button>} />
      <EmergencyCard />
      <RoundUpCard goals={goals} />
      {goals.length > 0 && (
        <div className="card pad" style={{ marginTop: 12 }}><div className="label">Saved so far</div>
          <div className="row between"><span className="big-amount" style={{ fontSize: 34 }}>{formatPrice(saved, { round: true })}</span><span className="muted small">of {formatPrice(target, { round: true })}</span></div>
        </div>
      )}
      <div className="col" style={{ marginTop: 14 }}>
        {goals.length === 0 && <div className="empty"><b>No goals yet</b>Saving for a trip, a gadget or an emergency fund? Set a target and track every contribution.</div>}
        {goals.map((g) => {
          const pct = Math.min(100, Math.round((g.saved / g.target) * 100))
          const done = g.saved >= g.target
          const perMonth = g.deadline && !done ? (g.target - g.saved) / monthsBetween(Date.now(), g.deadline) : 0
          return (
            <div key={g.id} className="card pad col" style={{ gap: 10 }}>
              <div className="row between">
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: `${g.color}22`, color: g.color }}><Icon name="target" size={20} /></div>
                  <div><div style={{ fontWeight: 700 }}>{g.name}</div><div className="dim small">{g.deadline ? `by ${new Date(g.deadline).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : 'no deadline'}</div></div>
                </div>
                <button className="dim" aria-label="Delete goal" onClick={async () => { if (await confirm({ title: `Delete "${g.name}"?`, body: 'Logged contributions stay in your transactions.', confirm: 'Delete', danger: true })) setGoals(goals.filter((x) => x.id !== g.id)) }}><Icon name="trash" size={18} /></button>
              </div>
              <ReachBar pct={pct} color={g.color} done={done} />
              <div className="row between small">
                <span><b className="num">{formatPrice(g.saved, { round: true })}</b> <span className="dim">of {formatPrice(g.target, { round: true })} · {pct}%</span></span>
                {done ? <span style={{ color: 'var(--toggle)' }}>Reached</span> : <button className="chip on" style={{ height: 30 }} onClick={() => setContrib(g)}>+ Add money</button>}
              </div>
              {perMonth > 0 && <div className="dim small">Save {formatPrice(perMonth, { round: true })}/month to get there on time.</div>}
            </div>
          )
        })}
      </div>
      <GoalSheet open={adding} onClose={() => setAdding(false)} onSave={(g) => setGoals([...goals, g])} usedColors={goals.map((g) => g.color)} />
      <ContributeSheet goal={contrib} onClose={() => setContrib(null)} onSave={(amt) => contrib && setGoals(goals.map((g) => (g.id === contrib.id ? { ...g, saved: Math.round((g.saved + amt) * 100) / 100 } : g)))} />
    </div>
  )
}

/** How many months of spending your bank balance would cover. */
function EmergencyCard() {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [cfg, setCfg] = useStored<{ months: number }>(KEYS.emergency, { months: 6 })
  const target = cfg.months || 6
  const banks = methods.filter(tracksBalance)
  if (!banks.length) return null
  const balance = banks.reduce((a, m) => a + accountBalance(m, txns), 0)
  // average of the last 3 full months of everyday spending (not transfers or investing)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime(), end = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const spent = txns.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= start && t.timestamp < end && !isTransferCategory(t.paymentCategory) && t.paymentCategory !== 'Investments').reduce((a, t) => a + t.paymentAmount, 0)
  const avg = spent / 3
  if (!(avg > 0)) return null
  const months = Math.max(0, balance / avg)
  const pct = Math.min(100, Math.round((months / target) * 100))
  const need = Math.max(0, target * avg - balance)
  return (
    <div className="card pad col" style={{ gap: 10 }}>
      <div className="row between"><b>Emergency fund</b>
        <span className="row" style={{ gap: 6 }}>{[3, 6, 9].map((n) => <button key={n} className={`qchip${target === n ? ' on' : ''}`} style={{ height: 28, padding: '0 10px' }} onClick={() => setCfg({ months: n })} aria-pressed={target === n}>{n} mo</button>)}</span></div>
      <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><b className="num" style={{ fontSize: 30 }}>{months.toFixed(1)}</b><span className="muted small">months of spending covered</span></div>
      <div className="bar" style={{ height: 8 }}><i style={{ width: `${pct}%`, background: months >= target ? 'var(--toggle)' : months >= target / 2 ? 'var(--amber)' : 'var(--danger)' }} /></div>
      <div className="dim small">{need > 0 ? `${formatPrice(need, { round: true })} more reaches ${target} months (you spend about ${formatPrice(avg, { round: true })} a month).` : `You are covered for ${target} months. Nice.`}</div>
    </div>
  )
}

/** Round-up savings: spare change from every spend, parked in a goal with one tap. */
function RoundUpCard({ goals }: { goals: SavingsGoal[] }) {
  const [s, setS] = useStored<RoundUpSettings>(KEYS.roundUp, DEFAULT_ROUNDUP)
  const cfg = { ...DEFAULT_ROUNDUP, ...s }
  const open = goals.filter((g) => g.saved < g.target)
  if (!open.length && !cfg.enabled) return null
  return (
    <div className="card pad col" style={{ gap: 12, marginTop: 12 }}>
      <div className="row between">
        <span className="row" style={{ gap: 10 }}><span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="refresh" size={18} /></span>
          <span><b>Round-up savings</b><span className="dim small" style={{ display: 'block' }}>₹245 spent → ₹5 set aside</span></span></span>
        <Toggle on={cfg.enabled} onChange={(v) => setS({ ...cfg, enabled: v, goalId: cfg.goalId ?? open[0]?.id ?? null })} label="Round-up savings" />
      </div>
      {cfg.enabled && (
        <>
          <div className="row" style={{ gap: 8 }} role="group" aria-label="Round up to">
            {([10, 50, 100] as const).map((n) => <button key={n} className={`chip${cfg.step === n ? ' on' : ''}`} onClick={() => setS({ ...cfg, step: n })}>to next ₹{n}</button>)}
          </div>
          <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Save into goal">
            {open.map((g) => <button key={g.id} className={`chip${cfg.goalId === g.id ? ' on' : ''}`} onClick={() => setS({ ...cfg, goalId: g.id })}>{g.name}</button>)}
          </div>
        </>
      )}
    </div>
  )
}

function GoalSheet({ open, onClose, onSave, usedColors }: { open: boolean; onClose: () => void; onSave: (g: SavingsGoal) => void; usedColors: string[] }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')
  const [deadline, setDeadline] = useState('')
  const color = METHOD_COLORS.find((c) => !usedColors.includes(c)) ?? METHOD_COLORS[0]
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>New goal</>} onClose={onClose} />
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !(Number(target) > 0)) return
        onSave({ id: uid(), name: name.trim(), target: Number(target), saved: Number(saved) || 0, deadline: deadline ? new Date(`${deadline}-28`).getTime() : null, color, createdAt: Date.now() })
        setName(''); setTarget(''); setSaved(''); setDeadline(''); onClose()
      }}>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="What for? (e.g. Goa trip)" />
        <input className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Target amount" />
        <input className="input" inputMode="numeric" value={saved} onChange={(e) => setSaved(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Already saved (optional)" />
        <div className="field"><label>Target month (optional)</label><input className="input" type="month" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
        <button className="btn block">Create goal</button>
      </form>
    </Sheet>
  )
}

function ContributeSheet({ goal, onClose, onSave }: { goal: SavingsGoal | null; onClose: () => void; onSave: (amt: number) => void }) {
  const [amount, setAmount] = useState('')
  const [log, setLog] = useState(true)
  const toast = useToast()
  return (
    <Sheet open={!!goal} onClose={onClose}>
      <SheetHeader title={<>Add to {goal?.name}</>} onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        const a = Number(amount)
        if (!goal || !(a > 0)) return
        onSave(a)
        if (log) addTransaction({ paymentAmount: a, paymentType: 'DEBIT', paymentReceiver: `Savings: ${goal.name}`, paymentCategory: 'Investments', note: '#savings' })
        toast('Added to goal', `${formatPrice(a)} → ${goal.name}`)
        setAmount(''); onClose()
      }}>
        <input className="input" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
        <div className="row between small"><span>Log it as a transaction (Investments)</span><Toggle on={log} onChange={setLog} label="Log it as a transaction" /></div>
        <button className="btn block">Add money</button>
      </form>
    </Sheet>
  )
}

/* ---------- Recurring entries ---------- */
export function RecurringPage({ onBack }: { onBack: () => void }) {
  const [rules, setRules] = useStored<RecurringRule[]>(KEYS.recurringRules, [])
  const confirm = useConfirm()
  const monthly = rules.filter((r) => r.enabled && r.template.paymentType === 'DEBIT')
    .reduce((a, r) => a + r.template.paymentAmount * (r.cadence === 'WEEKLY' ? 52 / 12 : r.cadence === 'YEARLY' ? 1 / 12 : 1), 0)
  return (
    <div className="page">
      <PageHeader title="Recurring" onBack={onBack} />
      <p className="muted small">Added for you on schedule, like rent or a SIP.</p>
      {rules.length > 0 && <div className="card pad row between"><span className="muted">Committed spend / month</span><b className="num">{formatPrice(monthly, { round: true })}</b></div>}
      <div className="card" style={{ marginTop: 12 }}>
        {rules.length === 0 ? <div className="empty small">Nothing recurring yet.</div> : rules.map((r) => (
          <div key={r.id} className="list-row">
            <div className={`tx-avatar ${r.template.paymentType === 'CREDIT' ? 'credit' : 'debit'}`} style={{ width: 36, height: 36 }}><Icon name="repeat" size={16} /></div>
            <div className="grow">
              <div className="ellipsis">{r.template.paymentReceiver}</div>
              <div className="dim small">{formatPrice(r.template.paymentAmount)} · {r.cadence.toLowerCase()}{r.enabled ? ` · next ${new Date(r.nextAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ' · paused'}</div>
            </div>
            <Toggle on={r.enabled} label="Active" onChange={(v) => setRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))} />
            <button className="dim" aria-label="Delete" onClick={async () => { if (await confirm({ title: 'Stop and delete this rule?', body: 'Entries it already added stay in your list.', confirm: 'Delete', danger: true })) setRules(rules.filter((x) => x.id !== r.id)) }}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
