import { ReachBar } from '../components/ui/ReachBar'
import { useMemo, useState } from 'react'
import { Icon, PageHeader } from '../components/ui/ui'
import { formatPrice, monthShort } from '../lib/core/format'
import { useStored, KEYS } from '../lib/core/storage'
import { currentPlan, EMERGENCY_MONTHS, EMERGENCY_SHARES, getPlanSettings, getRecords, incomeMode, saleSplit, SAVE_RATES, SET_ASIDE, savePlanSettings, savedThisMonth, savingsGoals, totalSaved, type IncomeMode, type PlanSettings } from '../lib/plan/plan'
import { isIncome } from '../lib/core/money'
import { AffordCard, GoalPace, RateHint, SavingsCheckNote, SetupFromHistory, ShopSection, SinkingSection } from '../components/plan/PlanExtras'
import { AllocateSheet, PotsSection } from '../components/plan/PotsUI'
import StudentBudget from '../components/plan/StudentBudget'
import AdviceCard from '../components/home/AdviceCard'
import { monthlyEssentials } from '../lib/plan/pots'
import { modesFor, showsLatePay, useProfession } from '../lib/plan/profession'
import type { Commitment, SavingsGoal, Transaction } from '../lib/core/types'

const BASIS = { set: 'Your income', learned: 'Learned from your last months', early: 'Followed from this month so far', none: 'Not known yet' } as const

/** The spending plan: income, what family and bills take, what is saved first, and what is left to spend. */
export default function PlanPage({ onBack }: { onBack: () => void }) {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [stored] = useStored<Partial<PlanSettings>>(KEYS.planSettings, {})
  useStored(KEYS.planSaved, {})
  const [monthsData] = useStored<Record<string, unknown>>(KEYS.planMonths, {})
  const [goals] = useStored<SavingsGoal[]>(KEYS.savingsGoals, [])
  const [chosen, setChosen] = useStored<string[] | null>(KEYS.planGoals, null)
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const settings = useMemo(() => getPlanSettings(), [stored])
  const mode = incomeMode(settings, txns)
  const { profession, shop, student } = useProfession()
  const plan = useMemo(() => currentPlan(txns, y, m, commitments), [txns, commitments, stored, monthsData]) // eslint-disable-line react-hooks/exhaustive-deps
  const saved = savedThisMonth(y, m)
  const fund = goals.find((g) => g.emergency)
  const essentials = mode === 'INCOME' ? monthlyEssentials(txns) : plan.committed + plan.limit
  const openGoals = savingsGoals()
  const closed = Object.entries(getRecords()).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([, r]) => r).slice(0, 6)
  const fmt = (v: number) => formatPrice(v, { round: true })
  const split = saleSplit(settings)
  const history = [3, 2, 1].map((k) => {
    const d = new Date(y, m - k, 1)
    return { label: monthShort(d.getMonth()), total: txns.filter((t) => isIncome(t) && new Date(t.timestamp).getFullYear() === d.getFullYear() && new Date(t.timestamp).getMonth() === d.getMonth()).reduce((a, t) => a + t.paymentAmount, 0) }
  })
  const top = Math.max(...history.map((h) => h.total), 1)
  const pick = (patch: Partial<PlanSettings>) => savePlanSettings(patch)
  const [late, setLate] = useState(false)

  const row = (label: string, value: string, o: { minus?: boolean; strong?: boolean; color?: string } = {}) => (
    <div className="row between" style={{ padding: '9px 0', fontWeight: o.strong ? 700 : 500 }}>
      <span className={o.strong ? '' : 'muted'}>{label}</span>
      <span className="num" style={{ color: o.color }}>{o.minus ? '− ' : ''}{value}</span>
    </div>
  )

  return (
    <div className="page">
      <PageHeader title="Spending plan" onBack={onBack} />
      <p className="muted small" style={{ marginTop: 0 }}>Save first, then spend what is left.</p>

      {!student && <div className="segmented" style={{ marginBottom: 12 }}>
        {([['FIXED', 'Monthly pay'], ['INCOME', 'Per income'], ['VARIABLE', 'My business']] as [IncomeMode, string][]).filter(([k]) => modesFor(profession).includes(k) || k === mode).map(([k, label]) => (
          <button key={k} className={mode === k ? 'on' : ''} onClick={() => pick({ mode: k })}>{label}</button>
        ))}
      </div>}


      {mode === 'INCOME' && <PotsSection />}

      {mode !== 'INCOME' && <div className="card pad" style={{ marginTop: 8 }}>
        <div className="label">{monthShort(m)} {y}</div>
        {plan.basis === 'none'
          ? <div className="small muted" style={{ padding: '10px 0' }}>{mode === 'VARIABLE' ? 'Once your first sales are recorded, the plan builds itself. Nothing needs to be typed in.' : student ? 'Add your monthly allowance in Profile and the plan fills in.' : 'Add your monthly income in Planner → Income and the plan fills in.'}</div>
          : <>
            {row(student && plan.basis === 'set' ? 'Your allowance' : BASIS[plan.basis], fmt(plan.income))}
            {mode === 'VARIABLE' && row(`Tax and stock kept aside (${settings.setAside}%)`, fmt(plan.setAside), { minus: true })}
            {row(plan.committed > 0 ? 'Family and bills' : 'Family and bills (none yet)', fmt(plan.committed), { minus: true })}
            {plan.sinking > 0 && row('Yearly costs set aside', fmt(plan.sinking), { minus: true })}
            <div style={{ height: 1, background: 'var(--glass)' }} />
            {row('Left after bills', fmt(plan.free), { strong: true })}
            {row(student ? 'Saved each month' : `Saved first (${settings.saveRate}%)`, fmt(plan.saveTarget), { minus: true })}
            <div style={{ height: 1, background: 'var(--glass)' }} />
            {row(student && !plan.capped ? 'Left to spend this month' : 'To spend this month', fmt(plan.limit), { strong: true, color: plan.limit <= 0 ? 'var(--danger)' : undefined })}
          </>}
      </div>}

      {plan.student && !plan.capped && plan.basis !== 'none' && (
        <div className="card pad col" style={{ marginTop: 12, gap: 8 }}>
          <div className="row between"><b>Spent so far</b><b className="num">{fmt(plan.spent)}</b></div>
          <div className="dim small">
            {plan.left >= 0 ? `${fmt(plan.left)} of your allowance left` : `${fmt(-plan.left)} more than your allowance after saving`}
            {plan.isCurrent && plan.left > 0 ? ` · about ${fmt(plan.perDay)} a day` : ''}
          </div>
          {plan.saveTarget > 0 && <div className="row between small" style={{ marginTop: 4 }}><span className="muted">Saved this month</span><b className="num" style={{ color: 'var(--credit)' }}>{fmt(saved)} of {fmt(plan.saveTarget)}</b></div>}
        </div>
      )}

      {mode !== 'INCOME' && plan.limit > 0 && (!plan.student || plan.capped) && (
        <div className="card pad col" style={{ marginTop: 12, gap: 8 }}>
          <div className="row between"><b>Spent so far</b><b className="num">{fmt(plan.spent)} of {fmt(plan.limit)}</b></div>
          <div className="bar"><i style={{ width: `${Math.min(100, (plan.spent / plan.limit) * 100)}%`, background: plan.status === 'over' ? 'var(--danger)' : plan.status === 'ahead' ? 'var(--amber)' : 'var(--toggle)' }} /></div>
          <div className="dim small">
            {plan.left >= 0 ? `${fmt(plan.left)} left` : `${fmt(-plan.left)} over`}
            {plan.isCurrent && plan.left > 0 ? ` · about ${fmt(plan.perDay)} a day, ${fmt(plan.perDay * 7)} a week` : ''}
          </div>
          <div className="row between small" style={{ marginTop: 4 }}><span className="muted">Saved this month</span><b className="num" style={{ color: 'var(--credit)' }}>{fmt(saved)} of {fmt(plan.saveTarget)}</b></div>
        </div>
      )}

      <div className="section-label">Your savings</div>
      <div className="card pad col" style={{ gap: 8 }}>
        <div className="row between"><span className="muted">Total saved so far</span><b className="num" style={{ fontSize: 22, color: 'var(--credit)' }}>{fmt(totalSaved())}</b></div>
        <div className="row between small"><span className="muted">{monthShort(m)} so far</span><b className="num">{mode === 'INCOME' ? fmt(saved) : `${fmt(saved)} of ${fmt(plan.saveTarget)}`}</b></div>
        <SavingsCheckNote />
        {fund && (
          <>
            <div style={{ height: 1, background: 'var(--glass)' }} />
            <div className="row between"><b>Emergency fund</b><b className="num">{fmt(fund.saved)} of {fmt(fund.target)}</b></div>
            <ReachBar pct={(fund.saved / fund.target) * 100} color="#FF9F0A" done={fund.saved >= fund.target} height={8} block />
            <div className="dim small">{essentials > 0 ? `Covers about ${(fund.saved / essentials).toFixed(1)} of ${settings.emergencyMonths} months of family, bills and everyday spending.` : 'Fills a little every month.'}</div>
          </>
        )}
      </div>

      <SetupFromHistory />
      <AdviceCard area="plan" limit={5} />

      {showsLatePay(profession) && (
        <>
          <button className="card pad row between" style={{ width: '100%', textAlign: 'left', marginTop: 12 }} onClick={() => setLate(true)}>
            <div><b>Salary came late?</b><div className="dim small">Say which months it covers</div></div>
            <Icon name="chevron" size={18} />
          </button>
          <AllocateSheet delayed open={late} onClose={() => setLate(false)} />
        </>
      )}

      <AffordCard plan={plan} />

      {!student && (
        <>
          <div className="section-label">Emergency fund</div>
          <div className="label" style={{ marginBottom: 8 }}>Share of each month’s saving</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {EMERGENCY_SHARES.map((r) => <button key={r} className={`chip${settings.emergencyShare === r ? ' on' : ''}`} onClick={() => pick({ emergencyShare: r })}>{r === 0 ? 'None' : `${r}%`}</button>)}
          </div>
          <div className="label" style={{ marginTop: 14 }}>Until it covers</div>
          <div className="chips" style={{ marginTop: 8 }}>
            {EMERGENCY_MONTHS.map((r) => <button key={r} className={`chip${settings.emergencyMonths === r ? ' on' : ''}`} onClick={() => pick({ emergencyMonths: r })}>{r} months</button>)}
          </div>
          <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>Once it is full, all saving goes to your goals.</p>
        </>
      )}

      <div className="section-label">The rest goes to your goals</div>
      {openGoals.length === 0
        ? <p className="dim small" style={{ marginTop: 0, lineHeight: 1.5 }}>No goal yet, so saving goes to “Savings”. Add one in Savings goals.</p>
        : (
          <>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {openGoals.map((g) => {
                const on = !chosen || chosen.includes(g.id)
                return <button key={g.id} className={`chip${on ? ' on' : ''}`} onClick={() => {
                  const cur = chosen ?? openGoals.map((x) => x.id)
                  const next = cur.includes(g.id) ? cur.filter((x) => x !== g.id) : [...cur, g.id]
                  setChosen(next.length === 0 ? null : next.length === openGoals.length ? null : next)
                }}>{g.name} · {fmt(g.saved)} of {fmt(g.target)}</button>
              })}
            </div>
            <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>Shared between the goals you pick, by how much each still needs. {chosen ? 'Only the ones highlighted get savings.' : 'All your goals get a share.'}</p>
          </>
        )}

      <GoalPace plan={plan} />

      <SinkingSection />

      {shop && <ShopSection plan={plan} />}

      {mode !== 'INCOME' && closed.length > 0 && (
        <>
          <div className="section-label">Past months</div>
          <div className="card">
            {closed.map((r) => (
              <div key={`${r.y}-${r.m}`} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{monthShort(r.m)} {r.y}</div>
                  <div className="dim small">{fmt(r.spent)} of {fmt(r.limit)} spent{r.setAside > 0 ? ` · ${fmt(r.setAside)} set aside` : ''}</div>
                </div>
                <b className="num" style={{ color: r.over >= 1 ? 'var(--danger)' : 'var(--credit)' }}>{r.over >= 1 ? `${fmt(r.over)} over${r.carry === 'deduct' ? ' · taken off next month' : ''}` : r.leftover >= 1 ? (r.history ? `${fmt(r.leftover)} unspent` : `+${fmt(r.leftover)} saved`) : 'on plan'}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {student ? <StudentBudget settings={settings} /> : (
        <>
          <div className="section-label">{mode === 'INCOME' ? 'How much of each income to save first' : 'How much to save first'}</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {SAVE_RATES.map((r) => <button key={r} className={`chip${settings.saveRate === r ? ' on' : ''}`} onClick={() => pick({ saveRate: r })}>{r}%</button>)}
          </div>
          <RateHint current={settings.saveRate} />
          <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>Of what is left after family and bills.</p>
        </>
      )}

      {mode === 'VARIABLE' && (
        <>
          <div className="section-label">Kept aside from every sale</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {SET_ASIDE.map((r) => <button key={r} className={`chip${settings.setAside === r ? ' on' : ''}`} onClick={() => pick({ setAside: r })}>{r}%</button>)}
          </div>
          <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>For tax, GST and restocking, so it is not spent by mistake.</p>

          <div className="section-label">Out of every ₹1,000 you take</div>
          <div className="card pad">
            {row('Tax and stock', fmt(split.aside))}
            {row('Saved', fmt(split.save), { color: 'var(--credit)' })}
            {row('Yours to use, with family and bills first', fmt(split.yours), { strong: true })}
          </div>

          <div className="section-label">Your last three months</div>
          <div className="card pad col" style={{ gap: 10 }}>
            {history.map((h) => (
              <div key={h.label}>
                <div className="row between small"><span className="muted">{h.label}</span><b className="num">{fmt(h.total)}</b></div>
                <div className="bar" style={{ height: 6, marginTop: 4 }}><i style={{ width: `${(h.total / top) * 100}%`, background: 'var(--accent)' }} /></div>
              </div>
            ))}
            <div className="row between small" style={{ marginTop: 2 }}><span className="muted">This month so far</span><b className="num">{fmt(plan.earned)}</b></div>
          </div>
          <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>Sales change month to month, so the plan counts on 80% of your usual month. A good month does not raise what you spend; the extra builds a cushion for a slow one.</p>
        </>
      )}

      {plan.notes.length > 0 && (
        <div className="card pad col" style={{ marginTop: 12, gap: 8 }}>
          {plan.notes.map((n, i) => <div key={i} className="small row" style={{ gap: 8, alignItems: 'flex-start', lineHeight: 1.45 }}><Icon name="info" size={16} />{n}</div>)}
        </div>
      )}
    </div>
  )
}
