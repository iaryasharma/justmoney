import { ReachBar } from '../ui/ReachBar'
import { useEffect, useMemo, useState } from 'react'
import { Icon, useToast, buzz } from '../ui/ui'
import { NativeDb, isNativeApp } from '../../lib/core/native'
import { openRoute } from '../../lib/notify/notifyRoute'
import { useStored, KEYS } from '../../lib/core/storage'
import { expectedItems, projectBalance } from '../../lib/plan/calendar'
import { getRoundUp, monthRoundUps, moveRoundUps } from '../../lib/plan/roundup'
import { committedCategories, isPersonalSpend } from '../../lib/core/money'
import { safeToSpend } from '../../lib/accounts/cash'
import { formatPrice, monthShort } from '../../lib/core/format'
import { currentPlan, decideCarry, dismissSummary, dismissWindfall, getPlanSettings, incomeMode, monthToReview, putAside, savedThisMonth, windfalls, windfallSplit } from '../../lib/plan/plan'
import { addTransaction } from '../../lib/core/data'
import { useProfession } from '../../lib/plan/profession'
import { IncomePrompt, PotsCard } from '../plan/PotsUI'
import { potsPlan } from '../../lib/plan/pots'
import { isIncome } from '../../lib/core/money'
import { getMerchantSettings, isMerchantApp, payoutQuestion, pendingSummary, saveMerchantSettings, settleSales, snoozeSettlement } from '../../lib/payees/merchant'
import { creditTotals } from '../../lib/payees/udhaar'
import type { CreditSale, PaymentMethod } from '../../lib/core/types'
import type { Commitment, SavingsGoal, Transaction } from '../../lib/core/types'

/** "You'll end the month with about ₹X": today's bank balance, plus/minus what is still scheduled, minus typical daily spending. */
export function ForecastCard({ txns, hidden, onOpen }: { txns: Transaction[]; hidden: boolean; onOpen: () => void }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const now = new Date()
  const f = useMemo(() => {
    const items = expectedItems(now.getFullYear(), now.getMonth())
    const p = projectBalance(items)
    if (!p.tracked) return null
    const committed = committedCategories(commitments)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const spent = txns.filter((t) => t.timestamp >= monthStart && isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)
    const daysIn = Math.max(1, now.getDate())
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate()
    const dailyAvg = spent / daysIn
    const variable = dailyAvg * daysLeft
    return { ...p, variable, daysLeft, end: p.end - variable }
  }, [txns, commitments]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const low = f.end < 0
  return (
    <button className="card mini-card" onClick={onOpen} aria-label={`Forecast: about ${fmt(f.end)} at month end`}>
      <span className="icon-tile" style={{ background: low ? 'rgba(239,68,68,.15)' : 'var(--accent-soft)', color: low ? 'var(--danger)' : 'var(--accent)' }}><Icon name="trend" size={20} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="small muted" style={{ display: 'block' }}>Expected balance on {new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()} {monthShort(now.getMonth())}</span>
        <b className="num" style={{ fontSize: 20, color: low ? 'var(--danger)' : undefined }}>≈ {fmt(f.end)}</b>
        <span className="dim tiny" style={{ display: 'block' }}>
          {f.lowest.value < f.today && f.lowest.date > Date.now() ? `Dips to ${fmt(f.lowest.value)} on ${new Date(f.lowest.date).getDate()} ${monthShort(new Date(f.lowest.date).getMonth())} · ` : ''}
          incl. ~{fmt(f.variable)} everyday spending
        </span>
      </span>
      <span className="chev"><Icon name="chevron" size={18} /></span>
    </button>
  )
}

/** What you can spend each day for the rest of the month: balance minus every bill, EMI and commitment still due. */
export function SafeToSpendCard({ txns, hidden, onOpen }: { txns: Transaction[]; hidden: boolean; onOpen: () => void }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [planCfg] = useStored<Record<string, unknown>>(KEYS.planSettings, {})
  const [planMonthsCfg] = useStored<Record<string, unknown>>(KEYS.planMonths, {})
  const now = new Date()
  const s = useMemo(() => {
    const p = projectBalance(expectedItems(now.getFullYear(), now.getMonth()))
    if (!p.tracked) return null
    const committed = committedCategories(commitments)
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const today = txns.filter((t) => t.timestamp >= dayStart && isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)
    const base = safeToSpend(p.today, p.expectedOut, now)
    // a full bank balance is not permission to spend it: the plan (saving first) caps the day
    if (incomeMode(getPlanSettings(), txns) === 'INCOME') {
      // planned by income: the personal pot, spread over the days until the next income
      const pp = potsPlan(txns, commitments, getPlanSettings().nextIncomeAt)
      if (pp.has && base.free > 0) return { ...base, perDay: Math.min(base.perDay, pp.perDay), balance: p.today, due: p.expectedOut, today, plan: null, pot: pp.personal.left }
    }
    const plan = currentPlan(txns, now.getFullYear(), now.getMonth(), commitments)
    const capped = plan.limit > 0 && base.free > 0
    const perDay = capped ? Math.min(base.perDay, plan.left > 0 ? plan.perDay : 0) : base.perDay
    return { ...base, perDay, balance: p.today, due: p.expectedOut, today, plan: capped ? plan : null, pot: null as number | null }
  }, [txns, commitments, planCfg, planMonthsCfg]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const over = s.over > 0
  const left = s.perDay - s.today
  return (
    <button className="card mini-card" onClick={onOpen} aria-label={`Safe to spend about ${fmt(s.perDay)} a day`}>
      <span className="icon-tile" style={{ background: over ? 'rgba(239,68,68,.15)' : 'var(--accent-soft)', color: over ? 'var(--danger)' : 'var(--accent)' }}><Icon name="wallet" size={20} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="small muted" style={{ display: 'block' }}>{over ? 'Bills due exceed your balance' : 'Safe to spend today'}</span>
        <b className="num" style={{ fontSize: 22, color: over ? 'var(--danger)' : undefined }}>{over ? `${fmt(s.over)} short` : `${fmt(s.perDay)} a day`}</b>
        <span className="dim tiny" style={{ display: 'block' }}>
          {s.pot !== null
            ? `${s.pot > 0 ? `${fmt(s.pot)} left in your personal pot` : 'Your personal pot is used up'} · ${fmt(s.balance)} in accounts`
            : s.plan
            ? `${s.plan.left > 0 ? `${fmt(s.plan.left)} of your plan left this month` : 'This month’s plan is used up'} · ${fmt(s.balance)} in accounts, ${fmt(s.plan.saveTarget)} of it for saving`
            : `${fmt(s.balance)} in accounts − ${fmt(s.due)} due this month · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`}
          {!over && s.today > 0 ? ` · ${left >= 0 ? `${fmt(left)} left today` : `${fmt(-left)} over today`}` : ''}
        </span>
      </span>
      <span className="chev"><Icon name="chevron" size={18} /></span>
    </button>
  )
}

/** The goal closest to done, plus this month's round-up savings with a one-tap "move to goal". */
export function GoalStrip({ txns, hidden, onOpen }: { txns: Transaction[]; hidden: boolean; onOpen: () => void }) {
  const toast = useToast()
  const [goals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  useStored(KEYS.roundUp, {}) // re-render when round-up settings change
  const ru = getRoundUp()
  const now = new Date()
  const open = goals.filter((g) => g.saved < g.target).sort((a, b) => b.saved / b.target - a.saved / a.target)
  const goal = goals.find((g) => g.id === ru.goalId && g.saved < g.target) ?? open[0]
  const r = ru.enabled ? monthRoundUps(txns, ru, now.getFullYear(), now.getMonth()) : null
  if (!goal && !r) return null
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const pct = goal ? Math.min(100, Math.round((goal.saved / goal.target) * 100)) : 0
  const canMove = !!goal && !!r && r.waiting >= 1 && ru.goalId === goal.id
  return (
    <div className="card pad col" style={{ marginTop: 12, gap: 10 }}>
      {goal && (
        <button className="row" style={{ gap: 12, textAlign: 'left', width: '100%' }} onClick={onOpen}>
          <span className="icon-tile" style={{ background: `${goal.color}22`, color: goal.color }}><Icon name="target" size={20} /></span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="row between"><b className="ellipsis">{goal.name}</b><span className="num small">{pct}%</span></span>
            <ReachBar pct={pct} color={goal.color} done={goal.saved >= goal.target} height={6} block style={{ marginTop: 6 }} />
            <span className="dim tiny" style={{ display: 'block', marginTop: 4 }}>{fmt(goal.saved)} of {fmt(goal.target)}</span>
          </span>
        </button>
      )}
      {r && (
        <div className="row between" style={{ gap: 10 }}>
          <span className="small muted">Round-ups this month <b className="num" style={{ color: 'var(--text)' }}>{fmt(r.total)}</b>{r.moved > 0 ? <span className="dim"> · {fmt(r.moved)} moved</span> : null}</span>
          {canMove && (
            <button className="pill-btn" onClick={() => { const n = moveRoundUps(txns, now.getFullYear(), now.getMonth()); if (n > 0) { buzz(12); toast(`Moved ${formatPrice(n, { round: true })} to ${goal!.name}`) } }}>
              Move {fmt(r.waiting)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** "No backup for 9 days" — only once there is enough data to lose. */
export function BackupNudge({ count }: { count: number }) {
  const toast = useToast()
  const [lastExport] = useStored<number>(KEYS.lastExport, 0)
  const [native, setNative] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (isNativeApp()) NativeDb.getBackupStatus().then((s) => setNative(s.lastAt ?? null)).catch(() => setNative(null)) }, [])
  if (count < 10) return null
  const lastAt = isNativeApp() ? native : lastExport || null
  if (isNativeApp() && native === undefined) return null // still checking
  const days = lastAt ? Math.floor((Date.now() - lastAt) / 86400000) : null
  if (days !== null && days < 7) return null
  const backup = async () => {
    if (!isNativeApp()) { openRoute('settings'); return }
    setBusy(true)
    try { const s = await NativeDb.backupNow(); if (s.error) toast('Backup failed', s.error); else { setNative(s.lastAt ?? Date.now()); toast('Backed up') } } finally { setBusy(false) }
  }
  return (
    <div className="card mini-card" role="status">
      <span className="icon-tile" style={{ background: 'rgba(255,149,0,.15)', color: '#FF9500' }}><Icon name="download" size={20} /></span>
      <span className="grow"><b>{days === null ? 'No backup yet' : `No backup for ${days} days`}</b></span>
      <button className="pill-btn" disabled={busy} onClick={backup}>{busy ? 'Backing up…' : 'Back up'}</button>
    </div>
  )
}

const TIPS: [string, string][] = [
  ['up', 'Swipe a row right to delete it'], ['edit', 'Swipe a row left to edit it'],
  ['check', 'Press and hold a row to select several'], ['calendar', 'Swipe the header to change month'],
]

/** One-time reminder of the gestures. */
export function CoachTip({ count }: { count: number }) {
  const [coach, setCoach] = useStored<{ seen: string[] }>(KEYS.coach, { seen: [] })
  const [installed] = useStored<number>(KEYS.installedAt, 0)
  const [latched, setLatched] = useState(false)
  const done = coach.seen.includes('gestures')
  // only a brand-new user (installed in the last few days, still with few entries) ever sees this
  const newUser = installed > 0 && Date.now() - installed < 3 * 86400000 && count < 25
  const show = !done && newUser && count >= 3
  useEffect(() => {
    // show it once: remember it was shown right away, but keep it on screen for this visit
    if (show) { setLatched(true); setCoach({ seen: [...coach.seen, 'gestures'] }) }
    // anyone else (an existing user) never gets it
    else if (!done && !newUser && count >= 3) setCoach({ seen: [...coach.seen, 'gestures'] })
  }, [show, done, newUser, count]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!show && !latched) return null
  return (
    <div className="card pad col" style={{ gap: 10, marginTop: 12 }} role="note">
      <div className="row between"><b>Quick tips</b><button className="link small" onClick={() => setLatched(false)}>Got it</button></div>
      {TIPS.map(([icon, text]) => <div key={text} className="row small muted" style={{ gap: 10 }}><span className="icon-tile" style={{ width: 28, height: 28, borderRadius: 10, background: 'var(--glass)' }}><Icon name={icon} size={14} /></span>{text}</div>)}
    </div>
  )
}

/** The month's spending plan: what is left to spend after saving first, and a one-tap way to save. */
export function PlanCard(p: { txns: Transaction[]; hidden: boolean; onOpen: () => void }) {
  useStored(KEYS.planSettings, {})
  return incomeMode(getPlanSettings(), p.txns) === 'INCOME' ? <><IncomePrompt hidden={p.hidden} /><PotsCard hidden={p.hidden} onOpen={p.onOpen} /></> : <MonthlyPlanCard {...p} />
}

function MonthlyPlanCard({ txns, hidden, onOpen }: { txns: Transaction[]; hidden: boolean; onOpen: () => void }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [settings] = useStored<Record<string, unknown>>(KEYS.planSettings, {})
  const [months] = useStored<Record<string, unknown>>(KEYS.planMonths, {}) // a carried-over overspend changes the limit
  useStored(KEYS.planSaved, {}) // re-render when something is set aside
  const toast = useToast()
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const plan = useMemo(() => currentPlan(txns, y, m, commitments), [txns, commitments, settings, months]) // eslint-disable-line react-hooks/exhaustive-deps
  const saved = savedThisMonth(y, m)
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  if (plan.basis === 'none') {
    return (
      <button className="card mini-card" onClick={onOpen}>
        <span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="target" size={20} /></span>
        <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
          <b style={{ display: 'block' }}>Plan your month</b>
          <span className="dim tiny">Save first, then spend what is left. Tap to set it up.</span>
        </span>
        <span className="chev"><Icon name="chevron" size={18} /></span>
      </button>
    )
  }
  const tone = plan.status === 'over' ? 'var(--danger)' : plan.status === 'ahead' ? 'var(--amber)' : 'var(--credit)'
  const label = plan.status === 'over' ? 'Over plan' : plan.status === 'ahead' ? 'Spending fast' : 'On track'
  const toSave = Math.max(0, plan.saveTarget - saved)
  const pct = plan.limit > 0 ? Math.min(100, (plan.spent / plan.limit) * 100) : plan.spent > 0 ? 100 : 0
  return (
    <div className="card pad col" style={{ gap: 10 }}>
      {/* the whole card opens the plan; Home shows only what you check at a glance (advice lives in the plan) */}
      <button className="col" style={{ gap: 2, width: '100%', textAlign: 'left' }} onClick={onOpen} aria-label="Open your spending plan">
        <span className="row between small"><span className="muted">Plan for {monthShort(m)}</span><span style={{ color: tone, fontWeight: 600 }}>{label}</span></span>
        <b className="num" style={{ fontSize: 22 }}>{plan.limit <= 0 ? 'Nothing free to spend' : plan.left >= 0 ? <>{fmt(plan.left)} <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>left to spend</span></> : `${fmt(-plan.left)} over`}</b>
      </button>
      {plan.limit > 0 && (plan.capped || !plan.student) && <div className="bar" style={{ height: 8 }}><i style={{ width: `${pct}%`, background: plan.status === 'on' ? 'var(--toggle)' : tone }} /></div>}
      <div className="dim tiny">
        {plan.student && !plan.capped
          ? `${fmt(plan.spent)} spent this month${plan.isCurrent && plan.left > 0 ? ` · about ${fmt(plan.perDay)} a day` : ''}`
          : plan.limit > 0 ? `${fmt(plan.spent)} of ${fmt(plan.limit)} spent${plan.isCurrent && plan.left > 0 ? ` · about ${fmt(plan.perDay)} a day` : ''}` : 'Family and bills take your whole income. See the plan.'}
      </div>
      {plan.saveTarget > 0 && (
        <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="small"><span className="muted">Saved this month</span> <b className="num" style={{ color: 'var(--credit)' }}>{fmt(saved)}</b> <span className="muted">of {fmt(plan.saveTarget)}</span></span>
          {toSave >= 1 && <button className="chip on" style={{ height: 30 }} onClick={() => {
            const r = putAside(toSave, y, m, plan.committed + plan.limit)
            if (r) toast(`${formatPrice(toSave, { round: true })} set aside`, `${r.into.map((i) => `${formatPrice(i.amount, { round: true })} to ${i.name}`).join(', ')}. Move the same amount in your bank too.`)
          }}>Set aside {fmt(toSave)}</button>}
        </div>
      )}
    </div>
  )
}

/** Last month's result: unspent money was saved, or an overspend is offered back to this month so the saving stays balanced. */
export function MonthReviewCard({ hidden }: { hidden: boolean }) {
  useStored(KEYS.planMonths, {}) // re-render when a month is closed or answered
  const toast = useToast()
  const r = monthToReview()
  if (!r) return null
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const name = monthShort(r.m)
  const over = r.over >= 1
  return (
    <div className="card pad col" style={{ gap: 8, borderColor: over ? 'var(--amber)' : undefined }}>
      <div className="row between"><b>{name} in review</b><span className="dim tiny">{fmt(r.spent)} of {fmt(r.limit)} spent</span></div>
      {over ? (
        <>
          <div className="small" style={{ lineHeight: 1.5 }}>You went <b className="num">{fmt(r.over)}</b> over your plan in {name}. Take it out of this month’s spending so your saving stays balanced?</div>
          {r.carry === 'ask' ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm grow" onClick={() => { decideCarry(r.key, 'deduct'); toast(`${fmt(r.over)} taken off this month`, 'Your spending limit is lower by that much.') }}>Yes, take it off</button>
              <button className="btn sm secondary grow" onClick={() => decideCarry(r.key, 'skip')}>No, leave it</button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="small" style={{ lineHeight: 1.5 }}>
          {r.leftover >= 1
            ? <>You spent <b className="num">{fmt(r.leftover)}</b> less than planned in {name}, so it went to your savings{r.into.length ? `: ${r.into.map((i) => `${fmt(i.amount)} to ${i.name}`).join(', ')}` : ''}.</>
            : <>You kept to your plan in {name}.</>}
          {r.setAside > 0 ? ` You also set aside ${fmt(r.setAside)}.` : ''}
        </div>
      )}
      {!(over && r.carry === 'ask') && <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => dismissSummary(r.key)}>Got it</button>}
    </div>
  )
}

/** A bonus, a gift or a big transfer: shown once, so most of it is saved instead of spent. */
export function WindfallCard({ txns, hidden }: { txns: Transaction[]; hidden: boolean }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  useStored(KEYS.windfallDone, [])
  const toast = useToast()
  const now = new Date()
  const plan = currentPlan(txns, now.getFullYear(), now.getMonth(), commitments)
  const w = windfalls(txns, plan)[0]
  if (!w) return null
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const split = windfallSplit(w.paymentAmount)
  return (
    <div className="card pad col" style={{ gap: 8 }}>
      <b>{fmt(w.paymentAmount)} came in{w.paymentReceiver ? ` from ${w.paymentReceiver}` : ''}</b>
      <div className="small" style={{ lineHeight: 1.5 }}>This is not your usual pay, so it is not in this month’s plan. A good split: save <b className="num">{fmt(split.save)}</b>, and keep <b className="num">{fmt(split.enjoy)}</b> to enjoy.</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm grow" onClick={() => {
          const r = putAside(split.save, now.getFullYear(), now.getMonth(), plan.committed + plan.limit)
          dismissWindfall(w.id)
          if (r) toast(`${fmt(split.save)} saved`, r.into.map((i) => `${formatPrice(i.amount, { round: true })} to ${i.name}`).join(', '))
        }}>Save {fmt(split.save)}</button>
        <button className="btn sm secondary" onClick={() => dismissWindfall(w.id)}>Not now</button>
      </div>
    </div>
  )
}

/** The shop's day: sales today, a quick way to add cash sales, what is waiting for a payout, and what customers owe. */
export function ShopCard({ txns, hidden, onCredit }: { txns: Transaction[]; hidden: boolean; onCredit: () => void }) {
  const { shop } = useProfession()
  const [credits] = useStored<CreditSale[]>(KEYS.creditSales, [])
  useStored(KEYS.planSettings, {})
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  if (!shop) return null
  const dayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()
  const today = txns.filter((t) => t.timestamp >= dayStart && isIncome(t) && (t.paymentCategory === 'Business' || isMerchantApp(t.paymentApp)))
  const sales = today.reduce((a, t) => a + t.paymentAmount, 0)
  const pending = pendingSummary(txns)
  const owed = creditTotals(credits)
  const aside = Math.round(sales * getPlanSettings().setAside / 100)
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  return (
    <div className="card pad col" style={{ gap: 8 }}>
      <div className="row between"><b>Your shop today</b><b className="num" style={{ fontSize: 20 }}>{fmt(sales)}</b></div>
      <div className="dim small">{today.length} sale{today.length === 1 ? '' : 's'}{aside > 0 ? ` · keep ${fmt(aside)} aside for tax and stock` : ''}</div>
      {(pending.count > 0 || owed.owed > 0) && (
        <div className="row between small" style={{ gap: 10 }}>
          {pending.count > 0 && <span className="muted">{fmt(pending.total)} waiting for the bank payout</span>}
          {owed.owed > 0 && <button className="link small" onClick={onCredit}>{fmt(owed.owed)} owed by customers</button>}
        </div>
      )}
      {adding ? (
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => {
          e.preventDefault()
          const a = Number(amount)
          if (!(a > 0)) return
          addTransaction({ paymentAmount: a, paymentType: 'CREDIT', paymentReceiver: 'Cash sale', paymentCategory: 'Business', paymentSource: 'CASH', manualCategory: true }, { allowDuplicate: true })
          toast(`${formatPrice(a, { round: true })} cash sale added`)
          setAmount(''); setAdding(false)
        }}>
          <input className="input grow" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Cash taken" aria-label="Cash sale amount" />
          <button className="btn sm">Add</button>
        </form>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <button className="chip on" onClick={() => setAdding(true)}>+ Cash sale</button>
          <button className="chip" onClick={onCredit}>Sold on credit</button>
        </div>
      )}
    </div>
  )
}

/** The morning after sales through PhonePe or Paytm: did the money reach the bank? One tap says yes; otherwise it is settled at the set time. */
export function PayoutPrompt({ txns, hidden }: { txns: Transaction[]; hidden: boolean }) {
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  useStored(KEYS.merchantSettings, {})
  useStored(KEYS.settleSnooze, 0)
  const toast = useToast()
  const q = payoutQuestion(txns)
  if (!q) return null
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const banks = methods.filter((m) => m.type === 'BANK')
  const acc = banks.find((m) => m.id === q.accountId)
  const at = q.autoAt && q.autoAt > Date.now() ? new Date(q.autoAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : null
  return (
    <div className="card pad col" style={{ gap: 8, borderColor: 'var(--accent)' }}>
      <b>Did your shop money reach the bank?</b>
      <div className="small" style={{ lineHeight: 1.5 }}>{fmt(q.total)} from {q.due.length} sale{q.due.length === 1 ? '' : 's'} since {new Date(q.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} is still with PhonePe or Paytm, and no bank message told us it was paid out.{at ? ` If you do not answer, it is marked settled at ${at}.` : ''}</div>
      {!acc && banks.length > 0 && (
        <div>
          <div className="tiny dim" style={{ marginBottom: 6 }}>Which account does it land in?</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>{banks.map((m) => <button key={m.id} className="chip" onClick={() => saveMerchantSettings({ accountId: m.id })}>{m.name}</button>)}</div>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm grow" onClick={() => {
          const r = settleSales({ auto: false })
          toast(`${fmt(r.total)} settled`, getMerchantSettings().accountId ? `Added to ${banks.find((m) => m.id === getMerchantSettings().accountId)?.name ?? 'your bank'}.` : 'Pick the account in Settings → Shop payouts so your balance goes up too.')
        }}>Yes, it reached the bank</button>
        <button className="btn sm secondary" onClick={() => { const d = new Date(); snoozeSettlement(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()); toast('Not yet', 'Asking again tomorrow. Nothing is settled for now.') }}>Not yet</button>
      </div>
    </div>
  )
}
