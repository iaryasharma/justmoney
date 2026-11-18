import { useMemo, useRef, useState, type ReactNode } from 'react'
import BrandLogo from '../components/ui/BrandLogo'
import { merchantLogo } from '../lib/payees/brands'
import { Icon, PageHeader, Sheet, SheetHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { useStored, uid, KEYS } from '../lib/core/storage'
import { createRecurringRule, effectiveSource } from '../lib/core/data'
import { BudgetsPage, GoalsPage, RecurringPage } from './PlannerExtras'
import MoneyPlanPage from './MoneyPlan'
import AccountsPage from './Accounts'
import InvestmentsPage from './Investments'
import PlanPage from './Plan'
import UdhaarPage from './Udhaar'
import StoryPage from './Story'
import { hiddenPlannerPages, useProfession } from '../lib/plan/profession'
import { PurchasePage, SalaryPage, SavingsRulesPage } from './PlannerMore'
import CalendarPage from './Calendar'
import LoansPage from './Loans'
import SplitPage from './Split'
import RecapPage from './Recap'
import EnvelopesPage, { type Envelope } from './Envelopes'
import TripsPage from './Trips'
import DebtPage from './Debt'
import NetWorthPage from './NetWorth'
import IpoPage from './Ipo'
import AutoPayPage from './AutoPay'
import BillsPage from './Bills'
import { PeoplePage } from './People'
import { cycleOf, type CardCycle } from '../lib/accounts/card'
import { taxSaverUsage } from '../lib/plan/taxsaver'
import { friendBalances, isSettled, type SplitPerson, type SplitProject, type SplitRow, type SplitTxn } from '../lib/split/split'
import { loanTotals } from '../lib/payees/loans'
import { netWorth } from '../lib/invest/invest'
import { activeHoldIds } from '../lib/accounts/holds'
import { accountBalance, tracksBalance } from '../lib/accounts/accounts'
import { spendable as spendableOf } from '../lib/core/money'
import { formatPrice, formatPriceCompact, getCurrency, monthShort } from '../lib/core/format'
import { compareRegimes, STANDARD_DEDUCTION, TAX_YEAR, TAX_YEAR_LONG, WAYS_TO_SAVE, type TaxResult } from '../lib/plan/tax'
import { detectRecurring, priceChanges, type RecurringDebit } from '../lib/payees/recurring'
import { reminderSubtitle, WEEKDAYS, notificationsGranted, requestNotificationPermission } from '../lib/notify/notify'
import type { Commitment, Hold, Investment, Loan, CategoryBudgets, EmiPlan, IncomeSource, PaymentMethod, PaymentReminder, RecurringRule, SavingsGoal, Transaction, User } from '../lib/core/types'

export type PlannerPage = 'income' | 'emi' | 'card' | 'tax' | 'subs' | 'fd' | 'reminders' | 'methods' | 'budgets' | 'goals' | 'recurring' | 'money' | 'invest' | 'portfolio' | 'plan' | 'udhaar' | 'story' | 'purchase' | 'salarylog' | 'saverules' | 'calendar' | 'loans' | 'split' | 'recap' | 'envelopes' | 'trips' | 'debt' | 'networth' | 'ipo' | 'autopay' | 'bills' | 'people'

// pages that live inside a hub go back to it instead of the Planner home
const PARENT: Partial<Record<PlannerPage, PlannerPage>> = {
  subs: 'bills', recurring: 'bills', autopay: 'bills', reminders: 'bills', emi: 'bills', udhaar: 'people',
}

export default function Planner({ page, setPage }: { page: PlannerPage | null; setPage: (p: PlannerPage | null) => void }) {
  // Loans and Split groups have their own tiles and are also linked from People: back goes where you came from
  const cameFrom = useRef<PlannerPage | null>(null)
  const back = () => { const to = (page && PARENT[page]) ?? cameFrom.current; cameFrom.current = null; setPage(to) }
  const openFromPeople = (p: PlannerPage) => { cameFrom.current = 'people'; setPage(p) }
  switch (page) {
    case 'income': return <IncomePage onBack={back} />
    case 'emi': return <EmiPage onBack={back} />
    case 'card': return <CreditCardPage onBack={back} />
    case 'tax': return <TaxPage onBack={back} />
    case 'subs': return <SubscriptionsPage onBack={back} />
    case 'fd': return <FdPage onBack={back} />
    case 'reminders': return <RemindersPage onBack={back} />
    case 'methods': return <AccountsPage onBack={back} />
    case 'budgets': return <BudgetsPage onBack={back} />
    case 'goals': return <GoalsPage onBack={back} />
    case 'recurring': return <RecurringPage onBack={back} />
    case 'money': return <MoneyPlanPage onBack={back} />
    case 'invest': return <NetWorthPage onBack={back} /> // old route: Net worth now lives on one page
    case 'portfolio': return <InvestmentsPage onBack={back} />
    case 'plan': return <PlanPage onBack={back} />
    case 'udhaar': return <UdhaarPage onBack={back} />
    case 'story': return <ShareCardPage onBack={back} year />
    case 'purchase': return <PurchasePage onBack={back} />
    case 'salarylog': return <SalaryPage onBack={back} />
    case 'saverules': return <SavingsRulesPage onBack={back} />
    case 'calendar': return <CalendarPage onBack={back} />
    case 'loans': return <LoansPage onBack={back} />
    case 'split': return <SplitPage onBack={back} />
    case 'recap': return <ShareCardPage onBack={back} />
    case 'envelopes': return <EnvelopesPage onBack={back} />
    case 'trips': return <TripsPage onBack={back} open={setPage} />
    case 'debt': return <DebtPage onBack={back} />
    case 'networth': return <NetWorthPage onBack={back} />
    case 'ipo': return <IpoPage onBack={back} />
    case 'autopay': return <AutoPayPage onBack={back} />
    case 'bills': return <BillsPage onBack={back} open={setPage} />
    case 'people': return <PeoplePage onBack={back} open={openFromPeople} />
  }
  return <PlannerHome open={setPage} />
}

/** The month or the year as a card to share: one page, a switch between the two. */
function ShareCardPage({ onBack, year = false }: { onBack: () => void; year?: boolean }) {
  const [isYear, setIsYear] = useState(year)
  const toggle = (
    <div className="segmented" style={{ marginBottom: 14 }}>
      <button className={!isYear ? 'on' : ''} onClick={() => setIsYear(false)}>Month</button>
      <button className={isYear ? 'on' : ''} onClick={() => setIsYear(true)}>Year</button>
    </div>
  )
  return isYear ? <StoryPage onBack={onBack} toggle={toggle} /> : <RecapPage onBack={onBack} toggle={toggle} />
}

function PlannerHome({ open }: { open: (p: PlannerPage) => void }) {
  const prof = useProfession()
  const [user] = useStored<User | null>(KEYS.user, null)
  const [income] = useStored<IncomeSource[]>(KEYS.incomeSources, [])
  const [emis] = useStored<EmiPlan[]>(KEYS.emiPlans, [])
  const [limit] = useStored<number>(KEYS.creditCardLimit, 0)
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const totalIncome = (user?.monthly_income ?? 0) + income.reduce((a, s) => a + s.amount, 0)
  const activeEmis = emis.filter((e) => e.paidCount < e.months)
  const recurring = useMemo(() => detectRecurring(txns), [txns])
  const ccSpend = useCreditCardSpend()
  const [budgets] = useStored<CategoryBudgets>(KEYS.categoryBudgets, {})
  const [goals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  const budgetCount = Object.values(budgets).filter((v) => v > 0).length
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [investments] = useStored<Investment[]>(KEYS.investments, [])
  const worth = netWorth(methods, txns, investments, emis).total
  const [holdsForTile] = useStored<Hold[]>(KEYS.holds, [])
  const ipoHeld = (() => { const live = activeHoldIds(holdsForTile); return holdsForTile.filter((h) => live.has(h.id)).reduce((a, h) => a + h.amount, 0) })()
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const lt = loanTotals(loans)
  const goalSaved = goals.reduce((a, g) => a + g.saved, 0)
  const [envelopes] = useStored<Envelope[]>(KEYS.envelopes, [])
  const [tripMeta] = useStored<Record<string, unknown>>(KEYS.trips, {})
  const [splitProjects] = useStored<SplitProject[]>(KEYS.splitProjects, [])
  const [splitPeople] = useStored<SplitPerson[]>(KEYS.splitPeople, [])
  const [splitTxns] = useStored<SplitTxn[]>(KEYS.splitTransactions, [])
  const [splitRows] = useStored<SplitRow[]>(KEYS.splits, [])
  const splitBalances = useMemo(() => friendBalances(splitProjects, splitPeople, splitTxns, splitRows), [splitProjects, splitPeople, splitTxns, splitRows])
  const splitNet = splitBalances.filter((b) => b.direction === 'owes-you').reduce((a, b) => a + b.amount, 0) - splitBalances.filter((b) => b.direction === 'you-owe').reduce((a, b) => a + b.amount, 0)

  const tiles: { id: PlannerPage; icon: string; title: string; value: string; color: string }[] = [
    { id: 'split', icon: 'split', title: 'SplitMoney', value: !splitProjects.length ? 'Split a trip or bill' : isSettled(splitNet) ? 'Settled up' : splitNet > 0 ? `+${formatPriceCompact(splitNet)} to you` : `−${formatPriceCompact(-splitNet)} you owe`, color: '#00C7BE' },
    { id: 'loans', icon: 'repeat', title: 'Loans & IOUs', value: lt.owedToYou || lt.youOwe ? `+${formatPriceCompact(lt.owedToYou)} / −${formatPriceCompact(lt.youOwe)}` : 'Bank or personal loans', color: '#FF375F' },
    { id: 'people', icon: 'users', title: 'People', value: 'Who owes whom, family', color: '#64D2FF' },
    { id: 'bills', icon: 'repeat', title: 'Bills & subscriptions', value: recurring.filter((r) => !r.ended).length || activeEmis.length ? `${recurring.filter((r) => !r.ended).length + activeEmis.length} active` : 'Subscriptions, EMIs, AutoPay', color: '#5856D6' },
    { id: 'calendar', icon: 'calendar', title: 'Calendar', value: 'Bills & spending', color: '#30D158' },
    { id: 'money', icon: 'users', title: 'Money plan', value: commitments.length ? `${formatPriceCompact(spendableOf(totalIncome, commitments))} spendable` : 'Family & income', color: '#F4A261' },
    { id: 'portfolio', icon: 'bars', title: 'Investments', value: investments.filter((i) => !i.closedAt).length ? `${investments.filter((i) => !i.closedAt).length} holding${investments.filter((i) => !i.closedAt).length === 1 ? '' : 's'} · live` : 'Stocks, IPOs, live prices', color: '#5E5CE6' },
    { id: 'plan', icon: 'target', title: 'Spending plan', value: 'Save first, then spend', color: '#30D158' },
    { id: 'purchase', icon: 'bag', title: 'Big purchase', value: 'Save up or EMI?', color: '#FF9F0A' },
    { id: 'salarylog', icon: 'bars', title: 'Salary & raises', value: 'Pay history, savings rate', color: '#30D158' },
    { id: 'saverules', icon: 'target', title: 'Savings rules', value: 'Auto-set aside from salary', color: '#64D2FF' },
    { id: 'ipo', icon: 'target', title: 'IPOs', value: ipoHeld > 0 ? `${formatPriceCompact(ipoHeld)} held` : 'Money blocked, allotments', color: '#FF375F' },
    { id: 'networth', icon: 'trend', title: 'Net worth', value: investments.length || methods.length ? formatPriceCompact(worth) : 'What you own and owe', color: '#5E5CE6' },
    { id: 'budgets', icon: 'pie', title: 'Budgets', value: budgetCount ? `${budgetCount} categor${budgetCount === 1 ? 'y' : 'ies'}` : 'Set limits', color: '#FF2D55' },
    { id: 'goals', icon: 'target', title: 'Savings goals', value: goals.length ? `${formatPriceCompact(goalSaved)} saved` : 'Start saving', color: '#30B0C7' },
    { id: 'income', icon: 'trend', title: 'Income', value: totalIncome ? `${formatPriceCompact(totalIncome)}/mo` : 'Add income', color: '#34C759' },
    { id: 'card', icon: 'card', title: 'Credit card', value: limit ? `${Math.round((ccSpend / limit) * 1000) / 10}% used` : 'Set limit', color: '#0088FF' },
    { id: 'tax', icon: 'percent', title: 'Tax estimator', value: TAX_YEAR, color: '#FFD60A' },
    { id: 'fd', icon: 'calc', title: 'FD & RD', value: 'Calculator', color: '#00C7BE' },
    { id: 'recap', icon: 'sparkles', title: 'Share your money', value: 'Month or year card', color: 'accent' },
    { id: 'envelopes', icon: 'wallet', title: 'Envelopes', value: envelopes.length ? `${envelopes.length} envelope${envelopes.length === 1 ? '' : 's'}` : '50/30/20 budgets', color: '#00C7BE' },
    { id: 'trips', icon: 'plane', title: 'Trips & events', value: Object.keys(tripMeta).length ? `${Object.keys(tripMeta).length} started` : 'Track by #tag', color: '#5AC8FA' },
    { id: 'debt', icon: 'trend', title: 'Debt payoff', value: activeEmis.length || lt.youOwe ? 'Plan to debt-free' : 'EMIs & loans', color: '#FF375F' },
    { id: 'methods', icon: 'bank', title: 'Accounts & cards', value: methods.some(tracksBalance) ? `${formatPriceCompact(methods.filter(tracksBalance).reduce((a, m) => a + accountBalance(m, txns), 0))} in bank` : methods.length ? `${methods.length} saved` : 'Add Kotak, UCO…', color: '#BF5AF2' },
  ]
  // a shop owner has no salary tools (customer credit lives under People, shown only for a shop)
  const hidden = new Set<PlannerPage>(hiddenPlannerPages(prof.profession) as PlannerPage[])
  const byId = (ids: PlannerPage[]) => ids.filter((id) => !hidden.has(id)).map((id) => tiles.find((t) => t.id === id)!).filter(Boolean)
  const groups: { title: string; ids: PlannerPage[]; compact?: boolean }[] = [
    { title: 'Most used', ids: ['plan', 'budgets', 'goals'], compact: true },
    { title: 'Plan', ids: ['bills', 'calendar', 'envelopes', 'money', 'income', 'salarylog', 'purchase', 'saverules'] },
    { title: 'Track', ids: ['people', 'loans', 'split', 'trips', 'card', 'recap'] },
    { title: 'Money', ids: ['methods', 'portfolio', 'networth', 'ipo', 'debt'] },
    { title: 'Tools', ids: ['tax', 'fd'] },
  ]
  return (
    <div className="page glow-page">
      <h1 className="screen-title">Planner</h1>

      {/* grouped rows, the same as Settings: one icon colour, the status as a grey line, no rainbow of tiles */}
      {groups.map((g) => (
        <div key={g.title}>
          <div className="group-label">{g.title}</div>
          <div className="card">
            {byId(g.ids).map((t) => (
              <button key={t.id} className="list-row" onClick={() => open(t.id)}>
                <span className="icon-tile" style={{ background: 'var(--glass)' }}><Icon name={t.icon} size={18} /></span>
                <div className="grow" style={{ minWidth: 0 }}><div>{t.title}</div><div className="dim small ellipsis">{t.value}</div></div>
                <span className="chev"><Icon name="chevron" size={18} /></span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Income ---------- */
function IncomePage({ onBack }: { onBack: () => void }) {
  const [user, setUser] = useStored<User | null>(KEYS.user, null)
  const [list, setList] = useStored<IncomeSource[]>(KEYS.incomeSources, [])
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const total = (user?.monthly_income ?? 0) + list.reduce((a, s) => a + s.amount, 0)
  return (
    <div className="page">
      <PageHeader title="Income" onBack={onBack} />
      <div className="card pad"><div className="label">Total monthly income</div><div className="big-amount" style={{ fontSize: 36 }}>{formatPrice(total, { round: true })}</div></div>
      <div className="section-label">Sources</div>
      <div className="card">
        <div className="list-row">
          <div className="grow">Salary</div>
          <input className="input num" style={{ width: 140, height: 40, textAlign: 'right' }} inputMode="numeric" value={user?.monthly_income || ''} placeholder="0"
            onChange={(e) => user && setUser({ ...user, monthly_income: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </div>
        {list.map((s) => (
          <div className="list-row" key={s.id}>
            <div className="grow">{s.name}</div><div className="num">{formatPrice(s.amount)}</div>
            <button className="dim" aria-label="Remove" onClick={() => setList(list.filter((x) => x.id !== s.id))}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
      <div className="section-label">Add a source</div>
      <form className="col" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !(Number(amount) > 0)) return; setList([...list, { id: uid(), name: name.trim(), amount: Number(amount) }]); setName(''); setAmount('') }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Source (e.g. Freelance)" />
        <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Monthly amount" />
        <button className="btn block">Add source</button>
      </form>
    </div>
  )
}

/* ---------- EMI ---------- */
function EmiPage({ onBack }: { onBack: () => void }) {
  const [emis, setEmis] = useStored<EmiPlan[]>(KEYS.emiPlans, [])
  const [open, setOpen] = useState(false)
  const confirm = useConfirm()
  const active = emis.filter((e) => e.paidCount < e.months)
  const remaining = active.reduce((a, e) => a + (e.months - e.paidCount) * e.monthlyAmount, 0)
  const patch = (id: string, p: Partial<EmiPlan>) => setEmis(emis.map((e) => (e.id === id ? { ...e, ...p } : e)))
  return (
    <div className="page">
      <PageHeader title="EMI tracker" onBack={onBack} right={<button className="btn sm" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Add</button>} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="card pad"><div className="label">Monthly</div><div className="h2 num">{formatPrice(active.reduce((a, e) => a + e.monthlyAmount, 0), { round: true })}</div></div>
        <div className="card pad"><div className="label">Left to pay</div><div className="h2 num">{formatPrice(remaining, { round: true })}</div></div>
      </div>
      <div className="col" style={{ marginTop: 16 }}>
        {emis.length === 0 && <div className="empty"><b>No EMIs yet</b>Track phone, laptop or loan EMIs and get a nudge on each due day.</div>}
        {emis.map((e) => {
          const paid = Math.min(e.paidCount, e.months)
          const done = paid >= e.months
          return (
            <div key={e.id} className="card pad col" style={{ gap: 10 }}>
              <div className="row between">
                <div><div style={{ fontWeight: 700 }}>{e.name}</div><div className="dim small">{formatPrice(e.monthlyAmount)}/mo · due day {e.dueDay}</div></div>
                <button className="dim" aria-label="Remove EMI" onClick={async () => { if (await confirm({ title: 'Remove EMI', body: 'Stop tracking this EMI?', confirm: 'Remove', danger: true })) setEmis(emis.filter((x) => x.id !== e.id)) }}><Icon name="trash" size={18} /></button>
              </div>
              <div className="bar"><i style={{ width: `${(paid / e.months) * 100}%`, background: done ? 'var(--toggle)' : '#FF9500' }} /></div>
              <div className="row between small">
                <span className="muted">{done ? 'Done' : `${paid} / ${e.months} paid · ${formatPrice((e.months - paid) * e.monthlyAmount, { round: true })} left`}</span>
                <div className="row" style={{ gap: 6 }}>
                  {paid > 0 && <button className="chip" style={{ height: 30 }} onClick={() => patch(e.id, { paidCount: paid - 1 })}>Undo</button>}
                  {!done && <button className="chip on" style={{ height: 30 }} onClick={() => patch(e.id, { paidCount: paid + 1 })}>Mark paid</button>}
                </div>
              </div>
              <div className="row between small"><span className="dim">Remind me on due day</span><Toggle on={e.reminderEnabled} label={`Remind me on the due day of ${e.name}`} onChange={(v) => patch(e.id, { reminderEnabled: v })} /></div>
            </div>
          )
        })}
      </div>
      <EmiSheet open={open} onClose={() => setOpen(false)} onSave={(e) => setEmis([...emis, e])} />
    </div>
  )
}

function EmiSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (e: EmiPlan) => void }) {
  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const [months, setMonths] = useState('')
  const [due, setDue] = useState('5')
  const t = Number(total), m = Number(months)
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Add an EMI</>} onClose={onClose} />
      <form className="col" onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !(t > 0) || !(m > 0)) return
        onSave({ id: uid(), name: name.trim(), totalAmount: t, months: Math.round(m), monthlyAmount: Math.round((t / m) * 100) / 100, dueDay: Math.min(28, Math.max(1, Number(due) || 1)), paidCount: 0, createdAt: Date.now(), reminderEnabled: true })
        setName(''); setTotal(''); setMonths(''); onClose()
      }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="What did you buy? (e.g. iPhone)" autoFocus />
        <div className="row"><input className="input" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Total" /><input className="input" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} placeholder="Months" /></div>
        <input className="input" inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value.replace(/\D/g, ''))} placeholder="Due day (1–28)" />
        {t > 0 && m > 0 && <div className="muted small">{formatPrice(t / m)} per month for {m} months</div>}
        <button className="btn block">Save EMI</button>
      </form>
    </Sheet>
  )
}

/* ---------- Credit card ---------- */
function useCreditCardSpend() {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return txns.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= start && effectiveSource(t, methods) === 'CREDIT_CARD').reduce((a, t) => a + t.paymentAmount, 0)
}

function CreditCardPage({ onBack }: { onBack: () => void }) {
  const [limit, setLimit] = useStored<number>(KEYS.creditCardLimit, 0)
  const [cycle, setCycle] = useStored<CardCycle | null>(KEYS.cardCycle, null)
  const [txnsAll] = useStored<Transaction[]>(KEYS.transactions, [])
  const [methodsAll] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const cyc = cycle && cycle.statementDay && cycle.dueDay ? cycleOf(cycle) : null
  const cycleSpend = cyc ? txnsAll.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= cyc.start && t.timestamp < cyc.statement + 86400000 && effectiveSource(t, methodsAll) === 'CREDIT_CARD').reduce((a, t) => a + t.paymentAmount, 0) : 0
  const daysTo = (ts: number) => Math.ceil((ts - Date.now()) / 86400000)
  const spend = useCreditCardSpend()
  const pct = limit ? Math.round((spend / limit) * 1000) / 10 : 0
  const healthy = pct < 30
  return (
    <div className="page">
      <PageHeader title="Credit card" onBack={onBack} />
      <div className="field"><label>Total credit limit</label><input className="input num" inputMode="numeric" value={limit || ''} onChange={(e) => setLimit(Number(e.target.value.replace(/\D/g, '')) || 0)} placeholder="e.g. 200000" /></div>
      {limit > 0 && (
        <div className="card pad col" style={{ marginTop: 16, gap: 12 }}>
          <div className="label">This month</div>
          <div className="row between"><span className="big-amount" style={{ fontSize: 36 }}>{pct}%</span><span className="muted">{formatPrice(spend, { round: true })} of {formatPrice(limit, { round: true })}</span></div>
          <div className="bar" style={{ height: 12 }}>
            <i style={{ width: `${Math.min(pct, 100)}%`, background: healthy ? 'var(--toggle)' : 'var(--danger)' }} />
            <span style={{ position: 'absolute', left: '30%', top: -2, bottom: -2, width: 2, background: 'var(--text)' }} />
          </div>
          <div className="small" style={{ color: healthy ? 'var(--toggle)' : 'var(--danger)' }}>
            {healthy ? 'Under 30% of your limit this month — a healthy range.' : 'Over 30% of your limit this month — keeping card spend lower helps your score.'}
          </div>
        </div>
      )}
      <div className="card pad col" style={{ marginTop: 16, gap: 12 }}>
        <div><b>Billing cycle</b><div className="dim small">Get a reminder 2 days before your payment is due.</div></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow"><label>Statement day</label><input className="input num" inputMode="numeric" value={cycle?.statementDay || ''} onChange={(e) => { const v = Math.min(31, Number(e.target.value.replace(/\D/g, '')) || 0); setCycle({ statementDay: v, dueDay: cycle?.dueDay ?? 0 }) }} placeholder="e.g. 12" /></div>
          <div className="field grow"><label>Due day</label><input className="input num" inputMode="numeric" value={cycle?.dueDay || ''} onChange={(e) => { const v = Math.min(31, Number(e.target.value.replace(/\D/g, '')) || 0); setCycle({ statementDay: cycle?.statementDay ?? 0, dueDay: v }) }} placeholder="e.g. 2" /></div>
        </div>
        {cyc && (
          <div className="col" style={{ gap: 8 }}>
            <div className="row between"><span className="muted small">This cycle ({new Date(cyc.start).getDate()} {monthShort(new Date(cyc.start).getMonth())} – {new Date(cyc.statement).getDate()} {monthShort(new Date(cyc.statement).getMonth())})</span><b className="num">{formatPrice(cycleSpend, { round: true })}</b></div>
            <div className="row between small"><span className="muted">Statement in</span><b>{Math.max(0, daysTo(cyc.statement))} day{daysTo(cyc.statement) === 1 ? '' : 's'}</b></div>
            <div className="row between small"><span className="muted">Pay by {new Date(cyc.due).getDate()} {monthShort(new Date(cyc.due).getMonth())}</span><b style={{ color: daysTo(cyc.due) <= 3 ? 'var(--danger)' : undefined }}>{daysTo(cyc.due)} day{daysTo(cyc.due) === 1 ? '' : 's'} left</b></div>
          </div>
        )}
      </div>
      {spend === 0 && <p className="muted small" style={{ marginTop: 16 }}>No credit-card spend tagged yet. Add a Credit Card in Payment methods and tag transactions with it, or mention “card” when adding.</p>}
    </div>
  )
}

/** Payments that usually qualify for a deduction this financial year, against each section's limit. */
function TaxSaver() {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const u = useMemo(() => taxSaverUsage(txns), [txns])
  return (
    <div className="card pad col" style={{ marginTop: 14, gap: 12 }}>
      <div className="row between"><b>Tax-saving so far</b><span className="dim small">{u.label} · {u.daysLeft} days to 31 Mar</span></div>
      {u.sections.map((s) => (
        <div key={s.key} className="col" style={{ gap: 5 }}>
          <div className="row between small"><span>{s.label}</span><span className="num"><b>{formatPrice(s.used, { round: true })}</b> <span className="dim">/ {formatPrice(s.limit, { round: true })}</span></span></div>
          <div className="bar" style={{ height: 7 }}><i style={{ width: `${s.pct}%`, background: s.pct >= 100 ? 'var(--toggle)' : 'var(--accent)' }} /></div>
          <div className="dim tiny">{s.left > 0 ? `${formatPrice(s.left, { round: true })} of room left` : 'Limit reached'} · {s.count ? `${s.count} matching payment${s.count === 1 ? '' : 's'}` : s.hint}</div>
        </div>
      ))}
      <div className="dim tiny">Found by payee and note (LIC, PPF, ELSS, health insurance, NPS…). Add a note like “PPF” to count a payment.</div>
    </div>
  )
}

/* ---------- Tax ---------- */
function TaxPage({ onBack }: { onBack: () => void }) {
  const [user] = useStored<User | null>(KEYS.user, null)
  const [gross, setGross] = useStored<number>(KEYS.taxIncome, (user?.monthly_income ?? 0) * 12)
  const [ded, setDed] = useStored<number>(KEYS.taxDeductions, 150000)
  if (getCurrency() !== 'INR') {
    return <div className="page"><PageHeader title="Tax estimator" onBack={onBack} /><p className="muted">This estimator covers Indian income tax ({TAX_YEAR}) and doesn’t apply to your selected currency.</p></div>
  }
  const c = compareRegimes(gross, ded)
  return (
    <div className="page">
      <PageHeader title="Tax estimator" onBack={onBack} />
      <div className="col">
        <div className="field"><label>Annual income</label><input className="input num" aria-label="Annual income" inputMode="numeric" value={gross || ''} onChange={(e) => setGross(Number(e.target.value.replace(/\D/g, '')) || 0)} /></div>
        <div className="field"><label>Deductions (old regime: 80C, 80D, HRA…)</label><input className="input num" aria-label="Deductions" inputMode="numeric" value={ded || ''} onChange={(e) => setDed(Number(e.target.value.replace(/\D/g, '')) || 0)} /></div>
      </div>
      <div className="row" style={{ marginTop: 16, alignItems: 'stretch' }}><RegimeCol r={c.new} cheaper={c.cheaper} /><RegimeCol r={c.old} cheaper={c.cheaper} /></div>
      <TaxSaver />
      <div className="card pad" style={{ marginTop: 12 }}>
        {c.cheaper === 'tie' ? 'Both regimes cost the same here.' : <><b>{c.cheaper === 'new' ? 'New' : 'Old'} regime saves {inr(c.saving)}</b>{c.cheaper === 'old' ? ' — your deductions are large enough to beat the new regime.' : ' — your deductions aren’t large enough to beat the wider new-regime slabs.'}</>}
      </div>
      <div className="section-label">Ways to save (old regime)</div>
      <div className="card">{WAYS_TO_SAVE.map((w) => (
        <div key={w.section} className="list-row"><div className="grow"><div style={{ fontWeight: 600 }}>{w.section}</div><div className="dim small">{w.what}</div></div><div className="small muted" style={{ textAlign: 'right', maxWidth: 140 }}>{w.limit}</div></div>
      ))}</div>
      <p className="dim tiny" style={{ marginTop: 14, lineHeight: 1.5 }}>Estimate for {TAX_YEAR_LONG} using published slabs, the standard deduction, and the 87A rebate. Surcharge and special-rate income aren’t modelled. Not tax advice.</p>
    </div>
  )
}

const inr = (n: number) => formatPrice(n, { round: true, currency: 'INR' })

function RegimeCol({ r, cheaper }: { r: TaxResult; cheaper: string }) {
  return (
    <div className="card pad col grow" style={{ gap: 6, borderColor: cheaper === r.regime ? 'rgba(30,203,72,.6)' : undefined }}>
      <div className="row between"><div className="label">{r.regime === 'new' ? 'New regime' : 'Old regime'}</div>{cheaper === r.regime && <span className="pill" style={{ background: 'rgba(30,203,72,.15)', color: 'var(--toggle)' }}>Cheaper</span>}</div>
      <div className="h2 num">{inr(r.totalTax)}</div>
      <div className="dim tiny">Taxable {inr(r.taxableIncome)}</div>
      <div className="dim tiny">Std. deduction {inr(STANDARD_DEDUCTION[r.regime])}</div>
      {r.rebate > 0 && <div className="dim tiny">87A rebate −{inr(r.rebate)}</div>}
      <div className="dim tiny">Cess {inr(r.cess)}</div>
    </div>
  )
}

/* ---------- Subscriptions / auto-debits ---------- */
function SubscriptionsPage({ onBack }: { onBack: () => void }) {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [prefs, setPrefs] = useStored<{ enabledKeys: string[]; leadDays: number }>(KEYS.autoDebit, { enabledKeys: [], leadDays: 3 })
  const [rules] = useStored<RecurringRule[]>(KEYS.recurringRules, [])
  const toast = useToast()
  const tracked = (receiver: string) => rules.some((r) => r.enabled && r.template.paymentReceiver.toLowerCase() === receiver.toLowerCase())
  const track = (r: RecurringDebit) => {
    if (r.cadence === 'QUARTERLY') return
    createRecurringRule({ paymentAmount: r.amount, paymentType: 'DEBIT', paymentReceiver: r.receiver, paymentCategory: r.category }, r.cadence, r.nextDueAt)
    toast('Tracking automatically', `${r.receiver} will be added every ${r.cadence === 'WEEKLY' ? 'week' : r.cadence === 'MONTHLY' ? 'month' : 'year'}.`)
  }
  const list = useMemo(() => detectRecurring(txns), [txns])
  const live = list.filter((r) => !r.ended)
  const subs = live.filter((r) => r.kind === 'subscription')
  const other = live.filter((r) => r.kind === 'rent')
  const stopped = list.filter((r) => r.ended)
  const monthly = live.reduce((a, r) => a + r.amount * (30 / ({ WEEKLY: 7, MONTHLY: 30, QUARTERLY: 91, YEARLY: 365 }[r.cadence])), 0)
  const subsMonthly = subs.reduce((a, r) => a + r.amount * (30 / ({ WEEKLY: 7, MONTHLY: 30, QUARTERLY: 91, YEARLY: 365 }[r.cadence])), 0)
  const changes = useMemo(() => priceChanges(txns, live), [txns, live])
  const dueSoon = live.filter((r) => r.nextDueAt - Date.now() < 7 * 86400000 && r.nextDueAt > Date.now() - 86400000)

  const toggle = async (key: string, on: boolean, daysLeft: number) => {
    if (on && !notificationsGranted()) await requestNotificationPermission()
    if (on && daysLeft < prefs.leadDays) toast('Too close for an early reminder', `This payment is due in under ${prefs.leadDays} day(s) — you’ll be reminded next time.`)
    setPrefs({ ...prefs, enabledKeys: on ? [...prefs.enabledKeys, key] : prefs.enabledKeys.filter((k) => k !== key) })
  }


  return (
    <div className="page">
      <PageHeader title="Subscriptions" onBack={onBack} />
      <div className="card pad">
        <div className="label">Streaming, apps and rent, per month (approx.)</div>
        <div className="big-amount" style={{ fontSize: 36 }}>{formatPrice(monthly, { round: true })}</div>
        <div className="row wrap small muted" style={{ gap: 12, marginTop: 6 }}>
          <span>≈ <b className="num" style={{ color: 'var(--text)' }}>{formatPrice(monthly * 12, { round: true })}</b> a year</span>
          {subs.length > 0 && <span>Subscriptions <b className="num" style={{ color: 'var(--text)' }}>{formatPrice(subsMonthly, { round: true })}</b>/mo</span>}
        </div>
      </div>
      {dueSoon.length > 0 && (
        <div className="card pad col" style={{ marginTop: 12, gap: 8 }}>
          <div className="label">Due in the next 7 days</div>
          {dueSoon.map((r) => (
            <div key={r.key} className="row between small"><span>{r.receiver}</span><span className="num"><b>{formatPrice(r.amount, { round: true })}</b> <span className="dim">· {Math.max(0, Math.ceil((r.nextDueAt - Date.now()) / 86400000))}d</span></span></div>
          ))}
        </div>
      )}
      {changes.length > 0 && (
        <div className="card pad col" style={{ marginTop: 12, gap: 8 }} role="status">
          <div className="label">Price changes</div>
          {changes.map((c) => (
            <div key={c.receiver} className="row between small">
              <span>{c.receiver}</span>
              <span className="num"><span className="dim">{formatPrice(c.from, { round: true })} → </span><b>{formatPrice(c.to, { round: true })}</b>{' '}
                <span className="compare-chip" style={{ color: c.pct > 0 ? 'var(--up)' : 'var(--down)', background: c.pct > 0 ? 'rgba(255,107,107,.14)' : 'rgba(79,235,32,.12)' }}>{c.pct > 0 ? '▲' : '▼'} {Math.abs(c.pct)}%</span></span>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}><span className="muted small grow">Remind me before</span>
        <div className="row" style={{ gap: 6 }}>{[1, 2, 3, 5].map((d) => <button key={d} className={`chip${prefs.leadDays === d ? ' on' : ''}`} style={{ height: 30 }} onClick={() => setPrefs({ ...prefs, leadDays: d })}>{d}d</button>)}</div>
      </div>
      {!list.length && <div className="empty"><b>Nothing here yet</b>Streaming and app subscriptions (Netflix, Spotify, Hotstar and the like) and your rent show up here once they are charged on a regular cycle. Groceries, food and shopping are left out.</div>}
      <RecurringGroup title="Streaming and apps" items={subs} prefs={prefs} onToggle={toggle} tracked={tracked} onTrack={track} />
      <RecurringGroup title="Rent" items={other} prefs={prefs} onToggle={toggle} tracked={tracked} onTrack={track} />
      {stopped.length > 0 && (
        <>
          <div className="section-label">Looks cancelled</div>
          <div className="card pad col" style={{ gap: 8 }}>
            {stopped.map((r) => (
              <div key={r.key} className="row between small"><span>{r.receiver}</span><span className="dim">last charged {Math.round((Date.now() - r.lastChargedAt) / 86400000)} days ago · {formatPrice(r.amount, { round: true })}</span></div>
            ))}
            <div className="dim tiny">No charge on the usual date, so these are not counted or reminded. They come back if the charge returns.</div>
          </div>
        </>
      )}
    </div>
  )
}

function RecurringGroup({ title, items, prefs, onToggle, tracked, onTrack }: {
  title: string; items: RecurringDebit[]; prefs: { enabledKeys: string[]; leadDays: number }
  onToggle: (key: string, on: boolean, daysLeft: number) => void
  tracked: (receiver: string) => boolean; onTrack: (r: RecurringDebit) => void
}) {
  if (!items.length) return null
  return (
    <>
      <div className="section-label">{title}</div>
      <div className="col">{items.map((r) => {
        const daysLeft = Math.ceil((r.nextDueAt - Date.now()) / 86400000)
        return (
          <div key={r.key} className="card pad col" style={{ gap: 8 }}>
            <div className="row between">
              <div className="row" style={{ gap: 10 }}><BrandLogo src={merchantLogo(r.receiver)} size={36} radius={10} /><div><div style={{ fontWeight: 700 }}>{r.receiver}</div><div className="dim small">{r.cadence.toLowerCase()} · Seen {r.occurrences}× — detected as recurring</div></div></div>
              <div style={{ textAlign: 'right' }}><div className="num" style={{ fontWeight: 700 }}>{formatPrice(r.amount)}</div><div className="tiny" style={{ color: daysLeft <= 3 ? 'var(--amber)' : 'var(--text-45)' }}>{daysLeft < 0 ? 'Overdue?' : daysLeft <= 3 ? 'Due soon' : `in ${daysLeft} days`}</div></div>
            </div>
            <div className="row between small"><span className="muted">Notify me {prefs.leadDays}d before</span><Toggle on={prefs.enabledKeys.includes(r.key)} label={`Notify me before ${r.receiver}`} onChange={(v) => onToggle(r.key, v, daysLeft)} /></div>
            {r.cadence !== 'QUARTERLY' && (tracked(r.receiver)
              ? <div className="dim small row" style={{ gap: 6 }}><Icon name="repeat" size={14} /> Added automatically each {r.cadence === 'WEEKLY' ? 'week' : r.cadence === 'MONTHLY' ? 'month' : 'year'}</div>
              : <button className="link small" style={{ textAlign: 'left' }} onClick={() => onTrack(r)}>Track automatically →</button>)}
          </div>
        )
      })}</div>
    </>
  )
}

/* ---------- FD & RD calculator ---------- */
function FdPage({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'FD' | 'RD'>('FD')
  const [amount, setAmount] = useState(100000)
  const [rate, setRate] = useState(7)
  const [years, setYears] = useState(3)
  const r = rate / 100
  let invested: number, maturity: number
  if (mode === 'FD') {
    invested = amount
    maturity = amount * Math.pow(1 + r / 4, 4 * years) // quarterly compounding
  } else {
    const n = Math.round(years * 12)
    invested = amount * n
    // RD: each monthly instalment compounds quarterly for its remaining tenure
    maturity = Array.from({ length: n }, (_, i) => amount * Math.pow(1 + r / 4, (4 * (n - i)) / 12)).reduce((a, b) => a + b, 0)
  }
  return (
    <div className="page">
      <PageHeader title="FD & RD" onBack={onBack} />
      <div className="segmented"><button className={mode === 'FD' ? 'on' : ''} onClick={() => { setMode('FD'); setAmount(100000) }}>Fixed deposit</button><button className={mode === 'RD' ? 'on' : ''} onClick={() => { setMode('RD'); setAmount(5000) }}>Recurring deposit</button></div>
      <div className="col" style={{ marginTop: 18, gap: 18 }}>
        <Slider label={mode === 'FD' ? 'Deposit' : 'Monthly deposit'} value={amount} min={mode === 'FD' ? 1000 : 500} max={mode === 'FD' ? 5000000 : 200000} step={mode === 'FD' ? 1000 : 500} onChange={setAmount} fmt={(v) => formatPrice(v)} />
        <Slider label="Interest rate (p.a.)" value={rate} min={3} max={10} step={0.05} onChange={setRate} fmt={(v) => `${v.toFixed(2)}%`} />
        <Slider label="Tenure" value={years} min={0.5} max={10} step={0.5} onChange={setYears} fmt={(v) => `${v} yr${v === 1 ? '' : 's'}`} />
      </div>
      <div className="card pad col" style={{ marginTop: 20, gap: 8 }}>
        <div className="row between"><span className="muted">Invested</span><b className="num">{formatPrice(invested, { round: true })}</b></div>
        <div className="row between"><span className="muted">Interest earned</span><b className="num" style={{ color: 'var(--credit)' }}>{formatPrice(maturity - invested, { round: true })}</b></div>
        <div className="row between" style={{ borderTop: '1px solid var(--divider)', paddingTop: 10 }}><span>Maturity value</span><span className="h2 num">{formatPrice(maturity, { round: true })}</span></div>
      </div>
      <p className="dim tiny">Uses quarterly compounding, as most Indian banks do. TDS isn’t deducted.</p>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => ReactNode }) {
  return (
    <div className="field"><div className="row between"><label>{label}</label><b className="num">{fmt(value)}</b></div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} /></div>
  )
}

/* ---------- Payment reminders ---------- */
function RemindersPage({ onBack }: { onBack: () => void }) {
  const [list, setList] = useStored<PaymentReminder[]>(KEYS.reminders, [])
  const [editing, setEditing] = useState<PaymentReminder | 'new' | null>(null)
  const toast = useToast()
  const granted = notificationsGranted()
  return (
    <div className="page">
      <PageHeader title="Reminders" onBack={onBack} />
      {!granted && (
        <button className="card pad row" style={{ width: '100%', textAlign: 'left', marginBottom: 12 }} onClick={async () => { if (await requestNotificationPermission()) toast('Notifications enabled') }}>
          <Icon name="bell" /><div className="grow"><b>Enable Notifications</b><div className="dim small">Allow notifications to receive payment reminders on time</div></div>
        </button>
      )}
      <button className="btn block secondary" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> ADD NEW REMINDER</button>
      <div className="card" style={{ marginTop: 14 }}>
        {list.length === 0 ? <div className="empty">No reminders yet</div> : list.map((r) => (
          <div key={r.id} className="list-row">
            <button className="grow" style={{ textAlign: 'left' }} onClick={() => setEditing(r)}><div>{r.title}</div><div className="dim small">{reminderSubtitle(r)}</div></button>
            <Toggle on={r.enabled} label={`Reminder: ${r.title}`} onChange={(v) => { setList(list.map((x) => (x.id === r.id ? { ...x, enabled: v } : x))); toast('Reminder updated') }} />
            <button className="dim" aria-label="Delete" onClick={() => { setList(list.filter((x) => x.id !== r.id)); toast('Reminder deleted') }}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
      <p className="dim tiny" style={{ marginTop: 12 }}>Reminders fire while JustMoney is open or installed and running in the background.</p>
      <ReminderSheet value={editing} onClose={() => setEditing(null)} onSave={(r) => {
        const exists = list.some((x) => x.id === r.id)
        setList(exists ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r])
        toast(exists ? 'Reminder updated' : 'Reminder added')
        if (!granted) requestNotificationPermission()
      }} />
    </div>
  )
}

function ReminderSheet({ value, onClose, onSave }: { value: PaymentReminder | 'new' | null; onClose: () => void; onSave: (r: PaymentReminder) => void }) {
  const init = value && value !== 'new' ? value : null
  const [title, setTitle] = useState('')
  const [type, setType] = useState<PaymentReminder['type']>('MONTHLY')
  const [time, setTime] = useState('09:00')
  const [dow, setDow] = useState(1)
  const [dom, setDom] = useState(1)
  const [lastKey, setLastKey] = useState<unknown>(null)
  if (value !== lastKey) {
    setLastKey(value)
    setTitle(init?.title ?? ''); setType(init?.type ?? 'MONTHLY'); setTime(init?.time ?? '09:00'); setDow(init?.dayOfWeek ?? 1); setDom(init?.dayOfMonth ?? 1)
  }
  return (
    <Sheet open={!!value} onClose={onClose}>
      <SheetHeader title={init ? 'Edit Reminder' : 'Add Reminder'} onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onSave({ id: init?.id ?? uid(), title: title.trim(), type, time, dayOfWeek: type === 'WEEKLY' ? dow : undefined, dayOfMonth: type === 'MONTHLY' ? dom : undefined, enabled: init?.enabled ?? true, createdAt: init?.createdAt ?? Date.now() })
        onClose()
      }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reminder title (e.g. Pay electricity bill)" autoFocus />
        <div className="field"><label>Frequency</label><div className="segmented">{(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((t) => <button type="button" key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t[0] + t.slice(1).toLowerCase()}</button>)}</div></div>
        {type === 'WEEKLY' && <div className="field"><label>Day of Week</label><div className="chips">{WEEKDAYS.map((d, i) => <button type="button" key={d} className={`chip${dow === i ? ' on' : ''}`} onClick={() => setDow(i)}>{d.slice(0, 3)}</button>)}</div></div>}
        {type === 'MONTHLY' && <div className="field"><label>Day of Month</label><div className="chips">{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button type="button" key={d} className={`chip${dom === d ? ' on' : ''}`} style={{ minWidth: 44, justifyContent: 'center' }} onClick={() => setDom(d)}>{d}</button>)}</div></div>}
        <div className="field"><label>Time</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <button className="btn block">{init ? 'Update reminder' : 'Add reminder'}</button>
      </form>
    </Sheet>
  )
}
