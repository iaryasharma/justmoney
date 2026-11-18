import { useMemo } from 'react'
import { Icon, PageHeader } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { CADENCE_DAYS, detectRecurring } from '../lib/payees/recurring'
import { monthlyTotal } from '../lib/plan/autopay'
import { formatPrice } from '../lib/core/format'
import type { AutoPay, EmiPlan, PaymentReminder, RecurringRule, Transaction } from '../lib/core/types'

export type BillsPart = 'subs' | 'recurring' | 'autopay' | 'reminders' | 'emi'

/** Everything that comes round again, in one place: what the app found, entries it adds, UPI mandates, reminders and EMIs. */
export default function BillsPage({ onBack, open }: { onBack: () => void; open: (p: BillsPart) => void }) {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [rules] = useStored<RecurringRule[]>(KEYS.recurringRules, [])
  const [autopays] = useStored<AutoPay[]>(KEYS.autopays, [])
  const [reminders] = useStored<PaymentReminder[]>(KEYS.reminders, [])
  const [emis] = useStored<EmiPlan[]>(KEYS.emiPlans, [])
  const found = useMemo(() => detectRecurring(txns).filter((r) => !r.ended), [txns])
  const money = (v: number) => formatPrice(v, { round: true })
  const activeEmis = emis.filter((e) => e.paidCount < e.months)
  const mandates = autopays.filter((a) => a.status === 'active')
  const on = rules.filter((r) => r.enabled)
  const alerts = reminders.filter((r) => r.enabled)
  const monthly = found.reduce((a, r) => a + (r.amount * 30) / CADENCE_DAYS[r.cadence], 0) + activeEmis.reduce((a, e) => a + e.monthlyAmount, 0)

  const parts: { id: BillsPart; icon: string; title: string; sub: string; value: string }[] = [
    { id: 'subs', icon: 'repeat', title: 'Subscriptions and rent', sub: 'Found in your payments', value: found.length ? `${found.length} active` : 'None found yet' },
    { id: 'emi', icon: 'calendar', title: 'EMIs', sub: 'Phone, laptop or loan instalments', value: activeEmis.length ? `${money(activeEmis.reduce((a, e) => a + e.monthlyAmount, 0))}/mo · ${activeEmis.length}` : 'None' },
    { id: 'autopay', icon: 'repeat', title: 'AutoPay mandates', sub: 'UPI mandates from your bank', value: mandates.length ? `${mandates.length} · ${money(monthlyTotal(autopays))}/mo` : 'None' },
    { id: 'recurring', icon: 'repeat', title: 'Repeating entries', sub: 'Added for you on schedule', value: on.length ? `${on.length} active` : 'None' },
    { id: 'reminders', icon: 'bell', title: 'Reminders', sub: 'A nudge before a bill is due', value: alerts.length ? `${alerts.length} on` : 'None' },
  ]

  return (
    <div className="page">
      <PageHeader title="Bills & subscriptions" onBack={onBack} />
      <div className="card pad" style={{ marginBottom: 12 }}>
        <div className="label">Every month, about</div>
        <div className="big-amount num" style={{ fontSize: 34 }}>{money(monthly)}</div>
        <div className="dim tiny">Subscriptions, rent and EMIs together.</div>
      </div>
      <div className="card">
        {parts.map((p) => (
          <button key={p.id} className="list-row" onClick={() => open(p.id)}>
            <span className="legend-icon"><Icon name={p.icon} size={15} /></span>
            <div className="grow" style={{ textAlign: 'left' }}><div>{p.title}</div><div className="dim small">{p.sub}</div></div>
            <span className="small muted">{p.value}</span>
            <span className="chev"><Icon name="chevron" size={18} /></span>
          </button>
        ))}
      </div>
    </div>
  )
}
