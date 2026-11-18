import { useMemo, useState } from 'react'
import { Icon, PageHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { getCategories } from '../lib/core/data'
import { formatPrice, monthShort } from '../lib/core/format'
import { committedCategories, isIncome, isPersonalSpend } from '../lib/core/money'
import { addPay, planPurchase, raises, removePay, savingsRateByMonth, type PayEntry } from '../lib/plan/planning'
import { addSavingsRule, removeSavingsRule, toggleSavingsRule, type SavingsRule } from '../lib/plan/savingsRules'
import { uid, useStored, KEYS } from '../lib/core/storage'
import type { Commitment, QuickPreset, SavingsGoal, Transaction } from '../lib/core/types'

const money = (n: number) => formatPrice(n, { round: true })
const num = (s: string) => s.replace(/[^0-9.]/g, '')
const dateInput = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10)

/** Saving up for something big: what to set aside each week, and whether an EMI would cost more. */
export function PurchasePage({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [by, setBy] = useState(dateInput(Date.now() + 90 * 86400000))
  const [down, setDown] = useState('')
  const [months, setMonths] = useState('12')
  const [rate, setRate] = useState('14')
  const p = Number(price)
  const plan = useMemo(() => (p > 0 ? planPurchase({ price: p, downPayment: Number(down) || 0, by: new Date(`${by}T12:00`).getTime(), emiMonths: Number(months) || 0, emiRate: Number(rate) || 0 }) : null), [p, down, by, months, rate])
  return (
    <div className="page">
      <PageHeader title="Big purchase" onBack={onBack} />
      <p className="muted small">Save up by a date, or see what an EMI adds.</p>
      <div className="card pad col" style={{ gap: 10 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="What are you buying? (optional)" />
        <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(num(e.target.value))} placeholder="Price" aria-label="Price" />
        <div className="field"><label>Buy it by</label><input className="input" type="date" value={by} onChange={(e) => setBy(e.target.value)} /></div>
      </div>
      {plan && (
        <>
          <div className="section-label">Pay in full{name ? ` · ${name}` : ''}</div>
          <div className="card pad col" style={{ gap: 6 }}>
            <div className="big-amount" style={{ fontSize: 30 }}>{money(plan.perWeek)}<span className="dim small"> a week</span></div>
            <div className="dim small">or {money(plan.perMonth)} a month, for {plan.weeks} week{plan.weeks === 1 ? '' : 's'}, to have {money(plan.need)} on the day.</div>
          </div>
          <div className="section-label">Or pay by EMI</div>
          <div className="card pad col" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" inputMode="decimal" value={down} onChange={(e) => setDown(num(e.target.value))} placeholder="Down payment" aria-label="Down payment" />
              <input className="input grow" inputMode="numeric" value={months} onChange={(e) => setMonths(num(e.target.value))} placeholder="Months" aria-label="Months" />
              <input className="input grow" inputMode="decimal" value={rate} onChange={(e) => setRate(num(e.target.value))} placeholder="% a year" aria-label="Interest rate" />
            </div>
            {plan.emi > 0 && (
              <>
                <div className="row between"><span className="muted">EMI</span><b className="num">{money(plan.emi)} × {months}</b></div>
                <div className="row between"><span className="muted">You pay in total</span><b className="num">{money(plan.emiTotal)}</b></div>
                <div className="row between"><span className="muted">Extra over the price</span><b className="num" style={{ color: plan.interest > 0 ? 'var(--danger)' : undefined }}>{money(plan.interest)}</b></div>
                {plan.interest > 0 && <div className="dim small">Saving up first avoids {money(plan.interest)} of interest, but you wait {plan.weeks} week{plan.weeks === 1 ? '' : 's'} for it.</div>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Your pay over the years, each raise as a percentage, and the share of income you kept each month. */
export function SalaryPage({ onBack }: { onBack: () => void }) {
  const [log] = useStored<PayEntry[]>(KEYS.salaryLog, [])
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dateInput(Date.now()))
  const [note, setNote] = useState('')
  const sorted = useMemo(() => [...log].sort((a, b) => a.date - b.date), [log])
  const rows = raises(sorted)
  const committed = committedCategories(commitments)
  const rates = useMemo(() => savingsRateByMonth(all, (t) => isPersonalSpend(t, committed), isIncome, 12), [all, commitments]) // eslint-disable-line react-hooks/exhaustive-deps
  const withData = rates.filter((r) => r.rate != null)
  const latest = sorted[sorted.length - 1]
  const first = sorted[0]
  return (
    <div className="page">
      <PageHeader title="Salary & raises" onBack={onBack} />
      {latest && (
        <div className="card pad col" style={{ gap: 4 }}>
          <div className="label">Current pay</div>
          <div className="big-amount" style={{ fontSize: 32 }}>{money(latest.amount)}<span className="dim small"> a month</span></div>
          {first && first.id !== latest.id && <div className="dim small">Up {Math.round(((latest.amount - first.amount) / first.amount) * 100)}% since {new Date(first.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}.</div>}
        </div>
      )}
      <form className="card pad col" style={{ gap: 10, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (Number(amount) > 0) { addPay(new Date(`${date}T12:00`).getTime(), Number(amount), note.trim() || undefined); setAmount(''); setNote(''); toast('Added to your pay history') } }}>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" inputMode="decimal" value={amount} onChange={(e) => setAmount(num(e.target.value))} placeholder="Monthly pay" aria-label="Monthly pay" />
          <input className="input grow" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="From" />
        </div>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. Appraisal, new job (optional)" />
        <button className="btn block" disabled={!(Number(amount) > 0)}>Add</button>
      </form>
      {rows.length > 0 && (
        <>
          <div className="section-label">History</div>
          <div className="card">
            {[...rows].reverse().map((r) => (
              <div key={r.id} className="list-row" style={{ alignItems: 'center' }}>
                <div className="grow"><div className="num">{money(r.amount)}</div><div className="dim small">{new Date(r.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}{r.note ? ` · ${r.note}` : ''}</div></div>
                {r.change !== 0 && <b className="num small" style={{ color: r.change > 0 ? 'var(--credit)' : 'var(--danger)' }}>{r.change > 0 ? '+' : ''}{r.pct.toFixed(1)}%</b>}
                <button className="dim" aria-label="Delete" onClick={() => removePay(r.id)}><Icon name="trash" size={16} /></button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-label">Share of income you kept</div>
      {withData.length < 2 ? <div className="card pad dim small">Needs a couple of months with income recorded.</div> : (
        <div className="card pad">
          <div className="hist" role="img" aria-label="Savings rate by month">
            {rates.map((r, i) => {
              const v = r.rate ?? 0
              return (
                <div key={`${r.year}-${r.month}`} className="hist-col">
                  <div className="hist-bar-wrap"><div className={`hist-bar${i === rates.length - 1 ? ' now' : ''}`} style={{ height: `${r.rate == null ? 0 : Math.max(4, Math.min(100, v))}%`, background: v < 0 ? 'var(--danger)' : undefined }} /></div>
                  <span className="tiny dim">{monthShort(r.month)}</span>
                </div>
              )
            })}
          </div>
          <div className="dim small" style={{ marginTop: 8 }}>Average {Math.round(withData.reduce((a, r) => a + (r.rate ?? 0), 0) / withData.length)}% over {withData.length} months. Higher is better.</div>
        </div>
      )}
    </div>
  )
}

/** "Put 10% of every salary towards my emergency fund": your goal moves forward when pay arrives. */
export function SavingsRulesPage({ onBack }: { onBack: () => void }) {
  const [rules] = useStored<SavingsRule[]>(KEYS.savingsRules, [])
  const [goals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  const [percent, setPercent] = useState('10')
  const [goalId, setGoalId] = useState<string | null>(null)
  const toast = useToast()
  const pick = goalId ?? goals[0]?.id ?? null
  return (
    <div className="page">
      <PageHeader title="Savings rules" onBack={onBack} />
      <p className="muted small">A share of each salary counts towards a goal. No money moves.</p>
      {goals.length === 0 ? <div className="empty"><b>No goals yet</b>Create a savings goal first (Planner, Savings goals), then come back.</div> : (
        <form className="card pad col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); const p = Number(percent); if (pick && p > 0 && p <= 100) { addSavingsRule(p, pick); toast('Rule added', `${p}% of every salary`) } }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input className="input" style={{ width: 90 }} inputMode="decimal" value={percent} onChange={(e) => setPercent(num(e.target.value))} aria-label="Percent" />
            <span className="muted">% of every salary to</span>
          </div>
          <div className="chips">{goals.map((g) => <button type="button" key={g.id} className={`chip${pick === g.id ? ' on' : ''}`} onClick={() => setGoalId(g.id)}>{g.name}</button>)}</div>
          <button className="btn block">Add rule</button>
        </form>
      )}
      {rules.length > 0 && (
        <>
          <div className="section-label">Your rules</div>
          <div className="card">
            {rules.map((r) => {
              const g = goals.find((x) => x.id === r.goalId)
              return (
                <div key={r.id} className="list-row" style={{ alignItems: 'center' }}>
                  <div className="grow"><div>{r.percent}% of salary</div><div className="dim small">to {g?.name ?? 'a goal that was removed'}</div></div>
                  <Toggle on={r.enabled} onChange={() => toggleSavingsRule(r.id)} label="Rule on" />
                  <button className="dim" aria-label="Delete rule" onClick={() => removeSavingsRule(r.id)}><Icon name="trash" size={16} /></button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/** One-tap expenses: chai ₹20, auto ₹100. They show above the quick-add box. */
export function PresetsPage({ onBack }: { onBack: () => void }) {
  const [presets, setPresets] = useStored<QuickPreset[]>(KEYS.quickPresets, [])
  const [asNote, setAsNote] = useStored<boolean>(KEYS.descriptionAsNote, true)
  const confirm = useConfirm()
  const cats = getCategories()
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(cats.includes('Food') ? 'Food' : cats[0])
  return (
    <div className="page">
      <PageHeader title="Quick presets" onBack={onBack} />
      <p className="muted small">Things you pay for all the time. Each shows as a button in quick add, so a chai is one tap.</p>
      <div className="card pad row between" style={{ marginBottom: 12, gap: 12 }}>
        <span className="grow"><b>Keep descriptions as a note</b><div className="dim small" style={{ marginTop: 2 }}>Typing “tea 20” saves tea as the note, since it is what you paid for and not who you paid. Names after “to” or “at”, and known shops, still become the receiver.</div></span>
        <Toggle on={asNote} onChange={setAsNote} label="Keep descriptions as a note" />
      </div>
      <form className="card pad col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (label.trim() && Number(amount) > 0) { setPresets([...presets, { id: uid(), label: label.trim(), amount: Number(amount), category }]); setLabel(''); setAmount('') } }}>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Chai" aria-label="Name" />
          <input className="input" style={{ width: 110 }} inputMode="decimal" value={amount} onChange={(e) => setAmount(num(e.target.value))} placeholder="Amount" aria-label="Amount" />
        </div>
        <div className="chips">{cats.map((c) => <button type="button" key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <button className="btn block" disabled={!label.trim() || !(Number(amount) > 0)}>Add preset</button>
      </form>
      {presets.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          {presets.map((p) => (
            <div key={p.id} className="list-row" style={{ alignItems: 'center' }}>
              <div className="grow"><div>{p.label}</div><div className="dim small">{p.category}</div></div>
              <b className="num">{money(p.amount)}</b>
              <button className="dim" aria-label={`Delete ${p.label}`} onClick={async () => { if (await confirm({ title: `Remove ${p.label}?`, body: 'Payments you already added with it stay.', confirm: 'Remove' })) setPresets(presets.filter((x) => x.id !== p.id)) }}><Icon name="trash" size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
