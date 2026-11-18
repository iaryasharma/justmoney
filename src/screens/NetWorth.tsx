import { useEffect, useMemo } from 'react'
import { PageHeader, useToast } from '../components/ui/ui'
import { CountUp } from '../components/ui/CountUp'
import { LineChart } from '../components/ui/LineChart'
import { netWorth, recordNetWorth } from '../lib/invest/invest'
import { isTransferCategory } from '../lib/accounts/accounts'
import { formatPrice, formatPriceCompact, monthShort } from '../lib/core/format'
import { KEYS, read, useStored, write } from '../lib/core/storage'
import { milestones } from '../lib/reports/analysis'
import type { EmiPlan, Investment, Loan, NetWorthPoint, PaymentMethod, Transaction } from '../lib/core/types'

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * One value per month. A month the app recorded keeps its recorded value; an earlier month is worked out from today's net worth by taking back
 * what moved in and out of your accounts since then (money moved into an investment is not income or spending, so it is left out).
 */
export function networthSeries(total: number, txns: Transaction[], history: NetWorthPoint[], now = new Date(), months = 12) {
  const first = txns.reduce((m, t) => Math.min(m, t.timestamp), Date.now())
  const out: { key: string; label: string; value: number; est: boolean }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    const key = monthKey(d)
    const label = `${monthShort(d.getMonth())}${d.getFullYear() !== now.getFullYear() ? ` ${String(d.getFullYear()).slice(2)}` : ''}`
    if (i === 0) { out.push({ key, label, value: Math.round(total), est: false }); continue }
    if (end < first) continue
    const saved = history.find((p) => p.month === key)
    if (saved) { out.push({ key, label, value: saved.value, est: false }); continue }
    const since = txns.filter((t) => t.timestamp >= end && !isTransferCategory(t.paymentCategory) && !t.investmentId)
      .reduce((a, t) => a + (t.paymentType === 'CREDIT' ? t.paymentAmount : -t.paymentAmount), 0)
    out.push({ key, label, value: Math.round(total - since), est: true })
  }
  return out
}

export default function NetWorthPage({ onBack }: { onBack: () => void }) {
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [investments] = useStored<Investment[]>(KEYS.investments, [])
  const [emis] = useStored<EmiPlan[]>(KEYS.emiPlans, [])
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const [history] = useStored<NetWorthPoint[]>(KEYS.netWorthHistory, [])
  const nw = useMemo(() => netWorth(methods, txns, investments, emis, loans), [methods, txns, investments, emis, loans])
  useEffect(() => { recordNetWorth(nw.total) }, [nw.total])
  const toast = useToast()
  const ms = milestones(nw.total)
  // a milestone crossed for the first time is worth a word
  useEffect(() => {
    if (ms.last && ms.last > read<number>(KEYS.lastMilestone, 0)) {
      write(KEYS.lastMilestone, ms.last)
      toast(`Milestone: ${formatPrice(ms.last, { round: true })} net worth`, 'Well done. Keep going.')
    }
  }, [ms.last]) // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => networthSeries(nw.total, txns, history), [nw.total, txns, history])
  const prev = series.length > 1 ? series[series.length - 2] : null
  const change = prev ? nw.total - prev.value : 0
  const money = (v: number) => formatPrice(v, { round: true })

  const assets = [
    { label: 'Bank and cash', value: nw.accounts, color: '#0A84FF' },
    { label: 'Investments', value: nw.invest, color: '#30D158' },
    { label: 'Owed to you', value: nw.owedToYou, color: '#64D2FF' },
  ].filter((r) => r.value > 0)
  const debts = [
    { label: 'EMIs left', value: nw.emiDue, color: '#FF9F0A' },
    { label: 'Credit card this month', value: nw.cardDue, color: '#FF6B6B' },
    { label: 'You owe', value: nw.youOwe, color: '#BF5AF2' },
  ].filter((r) => r.value > 0)

  const Stack = ({ rows, total }: { rows: { label: string; value: number; color: string }[]; total: number }) => (
    <div className="col" style={{ gap: 8 }}>
      <div className="row nw-stack" style={{ gap: 2, height: 10, borderRadius: 5, overflow: 'hidden' }}>
        {rows.map((r) => <i key={r.label} style={{ flex: r.value, background: r.color }} />)}
      </div>
      {rows.map((r) => (
        <div key={r.label} className="row between small"><span className="row" style={{ gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: 4, background: r.color }} />{r.label}</span><span className="num">{money(r.value)} <span className="dim">· {Math.round((r.value / Math.max(1, total)) * 100)}%</span></span></div>
      ))}
    </div>
  )

  return (
    <div className="page">
      <PageHeader title="Net worth" onBack={onBack} />
      <div className="card pad col" style={{ gap: 6 }}>
        <div className="label">What you are worth today</div>
        <div className="big-amount num" style={{ fontSize: 38, color: nw.total < 0 ? 'var(--danger)' : undefined }}><CountUp value={nw.total} format={money} /></div>
        {prev && <div className="small" style={{ color: change >= 0 ? 'var(--credit)' : 'var(--danger)' }}>{change >= 0 ? '▲' : '▼'} {money(Math.abs(change))} since {prev.label}</div>}
        {nw.assets > 0 || nw.liabilities > 0 ? (
          <>
            {series.length < 2 && <div className="dim small">The timeline fills in from next month.</div>}
            <LineChart points={series} format={formatPriceCompact} color={nw.total >= 0 ? 'var(--accent)' : 'var(--danger)'} />
            {series.some((p) => p.est) && <div className="dim tiny">Hollow points are worked out from your payments; filled ones were recorded.</div>}
          </>
        ) : <div className="dim small">Add your accounts with balances (Planner → Accounts & cards) and the timeline fills in.</div>}
      </div>

      {ms.next && nw.total > 0 && (
        <div className="card pad col" style={{ gap: 6, marginTop: 12 }}>
          <div className="row between small"><span className="muted">Next milestone</span><b className="num">{money(ms.next)}</b></div>
          <div className="bar"><i style={{ width: `${ms.progress * 100}%`, background: 'var(--accent)' }} /></div>
          <div className="dim tiny">{money(ms.toNext)} to go{ms.last ? ` · last reached ${money(ms.last)}` : ''}</div>
        </div>
      )}

      <div className="section-label">What you own</div>
      <div className="card pad col">{assets.length ? <Stack rows={assets} total={nw.assets} /> : <div className="dim small">Add accounts with balances in Planner → Accounts & cards.</div>}</div>
      {debts.length > 0 && (
        <>
          <div className="section-label">What you owe</div>
          <div className="card pad col"><Stack rows={debts} total={nw.liabilities} /></div>
        </>
      )}
    </div>
  )
}
