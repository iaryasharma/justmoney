import { useState } from 'react'
import BrandLogo from '../components/ui/BrandLogo'
import { Icon, PageHeader, useConfirm } from '../components/ui/ui'
import { merchantLogo } from '../lib/payees/brands'
import { formatPrice } from '../lib/core/format'
import { monthlyTotal, removeAutoPay } from '../lib/plan/autopay'
import { useStored, KEYS } from '../lib/core/storage'
import type { AutoPay } from '../lib/core/types'

/** Planner page: the UPI AutoPay / recurring mandates your bank told us about. A mandate moves no money by itself; each charge arrives later as a normal debit. */
export default function AutoPayPage({ onBack }: { onBack: () => void }) {
  const [list] = useStored<AutoPay[]>(KEYS.autopays, [])
  const confirm = useConfirm()
  const [showEnded, setShowEnded] = useState(false)
  const live = list.filter((a) => a.status !== 'cancelled').sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity))
  const ended = list.filter((a) => a.status === 'cancelled')
  const fmt = (v: number) => formatPrice(v, { round: true })
  const day = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  const row = (a: AutoPay) => (
    <div key={a.id} className="card pad row" style={{ gap: 12, alignItems: 'center', opacity: a.status === 'cancelled' ? .6 : 1 }}>
      <BrandLogo src={merchantLogo(a.name)} size={40} radius={12} alt={a.name} fallback={<span className="icon-tile" style={{ width: 40, height: 40 }}><Icon name="repeat" size={20} /></span>} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 700 }}>{a.name}</div>
        <div className="dim small">
          {a.amount ? fmt(a.amount) : 'Amount not stated'}{a.frequency ? ` · ${a.frequency}` : ''}
          {a.status === 'active' && a.nextAt ? ` · next ${day(a.nextAt)}` : ''}
        </div>
        <div className="tiny" style={{ marginTop: 2, color: a.status === 'active' ? 'var(--credit)' : a.status === 'paused' ? 'var(--amber)' : 'var(--text-45)' }}>
          {a.status === 'active' ? 'Active' : a.status === 'paused' ? 'Paused' : 'Cancelled'} · set {day(a.createdAt)}
        </div>
      </div>
      <button className="dim" aria-label={`Remove ${a.name}`} onClick={async () => { if (await confirm({ title: 'Remove this from the list?', body: 'This only tidies JustMoney. It does not cancel the AutoPay at your bank or UPI app.', confirm: 'Remove', danger: true })) removeAutoPay(a.id) }}><Icon name="trash" size={18} /></button>
    </div>
  )

  return (
    <div className="page">
      <PageHeader title="AutoPay" onBack={onBack} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="card pad"><div className="label">Active</div><div className="h2 num">{live.filter((a) => a.status === 'active').length}</div></div>
        <div className="card pad"><div className="label">About each month</div><div className="h2 num">{fmt(monthlyTotal(list))}</div></div>
      </div>
      <div className="col" style={{ marginTop: 14, gap: 10 }}>
        {live.length === 0 && <div className="empty"><b>No AutoPay yet</b>When your bank says a UPI AutoPay or recurring mandate was set up, it appears here by itself, with its amount and next charge.</div>}
        {live.map(row)}
      </div>
      {ended.length > 0 && (
        <>
          <button className="link small" style={{ marginTop: 14 }} onClick={() => setShowEnded(!showEnded)}>{showEnded ? 'Hide' : 'Show'} cancelled ({ended.length})</button>
          {showEnded && <div className="col" style={{ marginTop: 10, gap: 10 }}>{ended.map(row)}</div>}
        </>
      )}
      <p className="dim tiny" style={{ marginTop: 14, lineHeight: 1.5 }}>Setting up an AutoPay moves no money, so it is not counted as spending and nothing is frozen. Each charge is added like any other debit when your bank tells you about it. To stop an AutoPay, cancel it in your UPI app.</p>
    </div>
  )
}
