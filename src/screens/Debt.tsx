import { useMemo } from 'react'
import { Icon, PageHeader } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { formatPrice, monthShort } from '../lib/core/format'
import { outstanding } from '../lib/payees/loans'
import { payoffDate, simulate, type Debt, type Strategy } from '../lib/plan/debt'
import type { EmiPlan, Loan } from '../lib/core/types'

interface Plan { extra: number; strategy: Strategy; rates: Record<string, number> }
const DEFAULT: Plan = { extra: 0, strategy: 'avalanche', rates: {} }

/** Planner page: EMIs and money you borrowed, with the quickest way to be debt-free. */
export default function DebtPage({ onBack }: { onBack: () => void }) {
  const [emis] = useStored<EmiPlan[]>(KEYS.emiPlans, [])
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const [stored, setPlan] = useStored<Plan>(KEYS.debtPlan, DEFAULT)
  const plan = { ...DEFAULT, ...stored }

  const debts: Debt[] = useMemo(() => {
    const rate = (id: string) => plan.rates[id] ?? 0
    const fromEmi = emis.filter((e) => e.paidCount < e.months).map((e) => ({ id: `emi-${e.id}`, name: e.name, balance: e.monthlyAmount * (e.months - e.paidCount), minimum: e.monthlyAmount, rate: rate(`emi-${e.id}`) }))
    const fromLoans = loans.filter((l) => l.direction === 'BORROWED' && outstanding(l) > 0).map((l) => ({ id: `loan-${l.id}`, name: `Owed to ${l.person}`, balance: outstanding(l), minimum: Math.max(500, Math.ceil(outstanding(l) / 12)), rate: rate(`loan-${l.id}`) }))
    return [...fromEmi, ...fromLoans]
  }, [emis, loans, plan.rates]) // eslint-disable-line react-hooks/exhaustive-deps

  const av = useMemo(() => simulate(debts, plan.extra, 'avalanche'), [debts, plan.extra])
  const sn = useMemo(() => simulate(debts, plan.extra, 'snowball'), [debts, plan.extra])
  const cur = plan.strategy === 'avalanche' ? av : sn
  const other = plan.strategy === 'avalanche' ? sn : av
  const total = debts.reduce((a, d) => a + d.balance, 0)
  const monthly = debts.reduce((a, d) => a + d.minimum, 0) + plan.extra
  const when = (months: number) => { const d = payoffDate(months); return `${monthShort(d.getMonth())} ${d.getFullYear()}` }
  const setRate = (id: string, v: string) => setPlan({ ...plan, rates: { ...plan.rates, [id]: Math.min(60, Number(v.replace(/[^0-9.]/g, '')) || 0) } })

  return (
    <div className="page">
      <PageHeader title="Debt payoff" onBack={onBack} />
      {debts.length === 0 ? (
        <div className="empty"><b>No debts to plan</b>Add an EMI in the EMI tracker, or a loan you borrowed in Loans & IOUs, and your payoff plan appears here.</div>
      ) : (
        <>
          <div className="card pad col" style={{ gap: 10 }}>
            <div className="row between"><div><div className="label">Total owed</div><div className="num" style={{ fontSize: 28, fontWeight: 800 }}>{formatPrice(total, { round: true })}</div></div>
              <div style={{ textAlign: 'right' }}><div className="label">Paying / month</div><b className="num" style={{ fontSize: 18 }}>{formatPrice(monthly, { round: true })}</b></div></div>
            {cur.never
              ? <div className="small" style={{ color: 'var(--danger)' }} role="alert">At this payment the debt never clears — raise the extra amount or check the interest rates.</div>
              : <div className="row between small"><span className="muted">Debt-free by</span><b>{when(cur.months)} <span className="dim">· {cur.months} months</span></b></div>}
            {!cur.never && <div className="row between small"><span className="muted">Interest you will pay</span><b className="num">{formatPrice(cur.interest, { round: true })}</b></div>}
          </div>

          <div className="field" style={{ marginTop: 14 }}><label>Extra you can pay each month</label>
            <input className="input num" inputMode="numeric" value={plan.extra || ''} onChange={(e) => setPlan({ ...plan, extra: Number(e.target.value.replace(/\D/g, '')) || 0 })} placeholder="e.g. 2000" /></div>

          <div className="segmented" style={{ marginTop: 14 }} role="group" aria-label="Payoff strategy">
            <button className={plan.strategy === 'avalanche' ? 'on' : ''} onClick={() => setPlan({ ...plan, strategy: 'avalanche' })}>Highest rate</button>
            <button className={plan.strategy === 'snowball' ? 'on' : ''} onClick={() => setPlan({ ...plan, strategy: 'snowball' })}>Smallest first</button>
          </div>
          {!cur.never && !other.never && cur.interest !== other.interest && (
            <p className="dim small" style={{ marginTop: 8 }}>
              {cur.interest < other.interest ? `Saves ${formatPrice(other.interest - cur.interest, { round: true })} in interest compared with ` : `Costs ${formatPrice(cur.interest - other.interest, { round: true })} more interest than `}
              {plan.strategy === 'avalanche' ? 'smallest-first' : 'highest-rate'}{cur.months !== other.months ? `, and finishes ${Math.abs(cur.months - other.months)} month${Math.abs(cur.months - other.months) === 1 ? '' : 's'} ${cur.months < other.months ? 'sooner' : 'later'}` : ''}.
            </p>
          )}

          <div className="group-label">Your debts</div>
          <div className="card">
            {debts.map((d) => (
              <div key={d.id} className="list-row" style={{ alignItems: 'center' }}>
                <span className="icon-tile"><Icon name="card" size={16} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{d.name}</div>
                  <div className="dim tiny">{formatPrice(d.balance, { round: true })} left · {formatPrice(d.minimum, { round: true })}/mo</div>
                </div>
                <label className="row" style={{ gap: 4 }}><input className="input num" style={{ width: 62, height: 36, padding: '0 8px', textAlign: 'right' }} inputMode="decimal" value={plan.rates[d.id] ?? ''} placeholder="0" onChange={(e) => setRate(d.id, e.target.value)} aria-label={`Interest rate for ${d.name}`} /><span className="dim small">%</span></label>
              </div>
            ))}
          </div>
          <div className="dim tiny" style={{ margin: '6px 4px' }}>Enter each debt’s yearly interest rate. Leave 0 for interest-free.</div>

          {cur.order.length > 0 && (
            <>
              <div className="group-label">Payoff order</div>
              <div className="card">
                {cur.order.map((o, i) => (
                  <div key={o.name} className="list-row"><span className="icon-tile" style={{ fontWeight: 800 }}>{i + 1}</span><span className="grow ellipsis">{o.name}</span><span className="dim small">{when(o.month)}</span></div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
