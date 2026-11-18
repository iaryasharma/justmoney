import { useMemo, useState } from 'react'
import { Icon, useConfirm, useToast } from '../ui/ui'
import AdviceCard from '../home/AdviceCard'
import { formatPrice, monthShort } from '../../lib/core/format'
import { useStored, KEYS } from '../../lib/core/storage'
import { committedCategories } from '../../lib/core/money'
import { creditTotals } from '../../lib/payees/udhaar'
import {
  addSinking, afford, getPlanSettings, historySummary, planSetupDone, setUpFromHistory, goalPace, goalShares, payFromSinking, removeSinking, savePlanSettings, savingsCheck, shopSummary, sinkingNeed, suggestRate,
  type MonthPlan,
} from '../../lib/plan/plan'
import type { Commitment, CreditSale, PaymentMethod, SavingsGoal, SinkingFund, Transaction } from '../../lib/core/types'

const fmt = (v: number) => formatPrice(v, { round: true })

/** Starting point for the saving rate: what the user really kept over the last months. */
export function RateHint({ current }: { current: number }) {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [user] = useStored<{ monthly_income?: number } | null>(KEYS.user, null)
  const toast = useToast()
  const s = useMemo(() => suggestRate(txns, committedCategories(commitments), user?.monthly_income ?? 0, commitments.reduce((a, c) => a + c.amount, 0)), [txns, commitments, user])
  if (!s || s.suggested === current) return null
  return (
    <div className="card pad row" style={{ gap: 10, marginTop: 10 }}>
      <span className="small grow" style={{ lineHeight: 1.45 }}>Over the last {s.months} month{s.months === 1 ? '' : 's'} you kept about <b>{s.usual}%</b> of what was left after bills. {s.suggested > current ? `Start at ${s.suggested}%: a little more than you manage now, which is easy to keep up.` : `${s.suggested}% is a steadier start than ${current}%.`}</span>
      <button className="chip on" onClick={() => { savePlanSettings({ saveRate: s.suggested }); toast(`Saving ${s.suggested}% first`) }}>Use {s.suggested}%</button>
    </div>
  )
}

/** Says so when the plan's saved total is more than the bank balance actually grew. */
export function SavingsCheckNote() {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const c = useMemo(() => savingsCheck(txns, methods), [txns, methods])
  if (!c) return null
  const since = new Date(c.since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  if (c.gap < 500) return <div className="dim tiny" style={{ lineHeight: 1.45 }}>Checked against your bank: it grew by {fmt(c.growth)} since {since}, so the saving is there.</div>
  return (
    <div className="small row" style={{ gap: 8, alignItems: 'flex-start', lineHeight: 1.45, color: 'var(--amber)' }}>
      <Icon name="info" size={16} />
      <span>The plan says {fmt(c.saved)} is saved since {since}, but your bank grew by only {fmt(c.growth)}. About {fmt(c.gap)} of it is on paper only: move it to your savings account.</span>
    </div>
  )
}

/** For goals with a date: what each month has to bring, against what the plan puts in. */
export function GoalPace({ plan }: { plan: MonthPlan }) {
  const [goals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  const shares = useMemo(() => goalShares(plan, goals), [plan, goals])
  const rows = goals.filter((g) => !g.emergency && g.deadline && g.saved < g.target).map((g) => ({ g, p: goalPace(g, shares.get(g.id) ?? 0) })).filter((r) => r.p)
  if (!rows.length) return null
  return (
    <div className="card pad col" style={{ gap: 10, marginTop: 10 }}>
      {rows.map(({ g, p }) => (
        <div key={g.id}>
          <div className="row between small"><b>{g.name}</b><span className="dim">{new Date(g.deadline!).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span></div>
          <div className="small" style={{ marginTop: 2, color: p!.ok ? 'var(--credit)' : 'var(--amber)', lineHeight: 1.45 }}>
            {p!.ok ? `On track: needs ${fmt(p!.need)} a month, the plan gives about ${fmt(p!.gets)}.` : `Needs ${fmt(p!.need)} a month for ${p!.months} month${p!.months === 1 ? '' : 's'}, but the plan gives about ${fmt(p!.gets)}. Save more, or move the date.`}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Yearly costs (insurance, fees, festivals) saved for a little each month, so one month never takes the hit. */
export function SinkingSection() {
  const [funds] = useStored<SinkingFund[]>(KEYS.sinking, [])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const confirm = useConfirm()
  const toast = useToast()
  const now = new Date()
  return (
    <>
      <div className="section-label">Yearly costs</div>
      <p className="dim small" style={{ marginTop: 0, lineHeight: 1.5 }}>Insurance, school fees, festivals: a little is set aside each month.</p>
      {funds.length > 0 && (
        <div className="card">
          {funds.map((f) => (
            <div key={f.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row between"><b>{f.name}</b><span className="num small">{fmt(f.saved)} of {fmt(f.amount)}</span></div>
                <div className="bar" style={{ height: 6, margin: '6px 0' }}><i style={{ width: `${Math.min(100, (f.saved / f.amount) * 100)}%`, background: '#5E5CE6' }} /></div>
                <div className="dim small">{fmt(sinkingNeed(f, now))} a month · due {new Date(f.dueAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button className="chip" style={{ height: 28 }} onClick={() => { payFromSinking(f.id); toast(`${f.name} paid`, 'What was saved covers it, so it is not counted as spending. Next year’s starts now.') }}>Mark paid</button>
                  <button className="dim" aria-label="Remove" onClick={async () => { if (await confirm({ title: `Remove ${f.name}?`, body: 'The monthly set-aside stops.', confirm: 'Remove', danger: true })) removeSinking(f.id) }}><Icon name="trash" size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <form className="col" style={{ gap: 8, marginTop: 10 }} onSubmit={(e) => {
          e.preventDefault()
          const a = Number(amount)
          if (!name.trim() || !(a > 0) || !due) return
          addSinking(name.trim(), a, new Date(`${due}-28T09:00`).getTime())
          toast(`${name.trim()} added`, `About ${fmt(a / Math.max(1, (new Date(`${due}-28`).getFullYear() - now.getFullYear()) * 12 + new Date(`${due}-28`).getMonth() - now.getMonth()))} a month`)
          setName(''); setAmount(''); setDue(''); setAdding(false)
        }}>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it (e.g. Car insurance)" />
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
            <input className="input grow" type="month" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due month" />
          </div>
          <div className="row" style={{ gap: 8 }}><button className="btn sm grow">Add</button><button type="button" className="btn sm secondary" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      ) : <button className="btn block secondary" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><Icon name="plus" size={18} />Add a yearly cost</button>}
    </>
  )
}

/** The shop's month: sales, what it cost to run, what is left, and what customers still owe. */
export function ShopSection({ plan }: { plan: MonthPlan }) {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [credits] = useStored<CreditSale[]>(KEYS.creditSales, [])
  const now = new Date()
  const s = useMemo(() => shopSummary(txns, now.getFullYear(), now.getMonth()), [txns]) // eslint-disable-line react-hooks/exhaustive-deps
  const owed = creditTotals(credits)
  const settings = getPlanSettings()
  return (
    <>
      <AdviceCard area="shop" limit={4} title="For your shop" />
      <div className="section-label">Your shop, {monthShort(now.getMonth())}</div>
      <div className="card pad col" style={{ gap: 6 }}>
        <div className="row between"><span className="muted">Sales</span><b className="num">{fmt(s.sales)}</b></div>
        <div className="row between"><span className="muted">Costs of running it</span><b className="num">− {fmt(s.costs)}</b></div>
        <div style={{ height: 1, background: 'var(--glass)' }} />
        <div className="row between"><b>Kept after costs</b><b className="num" style={{ color: s.profit < 0 ? 'var(--danger)' : 'var(--credit)' }}>{fmt(s.profit)}</b></div>
        {owed.owed > 0 && <div className="dim small">{fmt(owed.owed)} more is owed by customers and not counted until they pay.</div>}
        <div className="dim tiny" style={{ lineHeight: 1.45 }}>Open any payment and turn on “Shop cost” for stock, rent and wages. Those stay out of your own spending plan, and the plan works from what the shop keeps.{settings.setAside > 0 ? ` ${fmt(plan.setAside)} of this month’s plan is kept aside for tax.` : ''}</div>
      </div>
    </>
  )
}

/** "Can I afford this?" against the month's plan, with what it would do to saving. */
export function AffordCard({ plan }: { plan: MonthPlan }) {
  const [amount, setAmount] = useState('')
  const a = Number(amount)
  const r = a > 0 ? afford(plan, a) : null
  return (
    <>
      <div className="section-label">Can I afford it?</div>
      <div className="card pad col" style={{ gap: 8 }}>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Price of what you want to buy" aria-label="Price" />
        {r && plan.limit > 0 && (
          <div className="small" style={{ lineHeight: 1.5 }}>
            {r.verdict === 'fits' && <><b style={{ color: 'var(--credit)' }}>Yes, it fits.</b> You would still have {fmt(r.afterLeft)} to spend this month.</>}
            {r.verdict === 'dips' && <><b style={{ color: 'var(--amber)' }}>Only by dipping into your saving.</b> It is {fmt(r.short)} more than you have left to spend. That delays your goals by about {r.delayMonths} month{r.delayMonths === 1 ? '' : 's'} of saving. Waiting a few weeks or paying part of it avoids that.</>}
            {r.verdict === 'wait' && <><b style={{ color: 'var(--danger)' }}>Not this month.</b> It is {fmt(r.short)} more than you have left to spend, and more than a month of saving.{r.monthsToSave ? ` Saving for it would take about ${r.monthsToSave} month${r.monthsToSave === 1 ? '' : 's'}.` : ''}</>}
          </div>
        )}
        {r && plan.limit <= 0 && <div className="small muted">Set up the plan first, then this can tell you what a purchase does to your month.</div>}
      </div>
    </>
  )
}

/** One time: set the plan up from the last months instead of from nothing. */
export function SetupFromHistory() {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [done, setDone] = useStored<boolean>(KEYS.planSetup, false)
  const toast = useToast()
  const [user] = useStored<{ monthly_income?: number } | null>(KEYS.user, null)
  // only for a plan that has not been filled in yet: someone who typed in their income and family support already has a start
  const filledIn = (user?.monthly_income ?? 0) > 0 && commitments.length > 0
  const h = useMemo(() => (done || filledIn || planSetupDone() ? null : historySummary(txns, committedCategories(commitments))), [txns, commitments, done, filledIn])
  if (!h) return null
  return (
    <div className="card pad col" style={{ gap: 8, borderColor: 'var(--accent)', marginBottom: 12 }}>
      <b>Start from your last {h.months} month{h.months === 1 ? '' : 's'}</b>
      <div className="small" style={{ lineHeight: 1.5 }}>On average {fmt(h.income)} came in, {fmt(h.family)} went to family and {fmt(h.spend)} was spent on you. You kept about {h.keptPct}% of what was left. JustMoney can fill in the plan from this, so you do not start from zero.</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm grow" onClick={() => { setUpFromHistory(txns, commitments); toast('Plan set up', 'Income, family support and a saving rate are filled in. Change any of them below.') }}>Use these</button>
        <button className="btn sm secondary" onClick={() => setDone(true)}>Not now</button>
      </div>
    </div>
  )
}
