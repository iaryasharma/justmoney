import { useMemo, useState } from 'react'
import BrandLogo from '../ui/BrandLogo'
import { Icon } from '../ui/ui'
import { ECOMMERCE, QUICK_COMMERCE, brandLogo, merchantBrand } from '../../lib/payees/brands'
import { isTransferCategory } from '../../lib/accounts/accounts'
import { formatPrice, monthShort } from '../../lib/core/format'
import type { Transaction } from '../../lib/core/types'

type Tab = 'QUICK' | 'ECOM'
const KEYS_OF: Record<Tab, string[]> = { QUICK: QUICK_COMMERCE, ECOM: ECOMMERCE }

/** Monthly spending on quick-commerce apps (Zepto, Blinkit…) and online shops (Amazon, Myntra…), app by app. */
export default function ShoppingApps({ all, year, month }: { all: Transaction[]; year: number; month: number }) {
  const [tab, setTab] = useState<Tab>('QUICK')
  // the bar you tapped; going to another month in Insights goes back to that month
  const [picked, setPicked] = useState<{ y: number; m: number; from: string } | null>(null)
  const focus = picked && picked.from === `${year}-${month}` ? picked : { y: year, m: month }

  const data = useMemo(() => {
    const keys = KEYS_OF[tab]
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(year, month - (5 - i), 1); return { y: d.getFullYear(), m: d.getMonth(), total: 0 } })
    const apps = new Map<string, { key: string; label: string; total: number; count: number }>()
    for (const t of all) {
      if (t.paymentType !== 'DEBIT' || isTransferCategory(t.paymentCategory)) continue
      const b = merchantBrand(t.paymentReceiver)
      if (!b || !keys.includes(b.key)) continue
      const d = new Date(t.timestamp)
      const slot = months.find((x) => x.y === d.getFullYear() && x.m === d.getMonth())
      if (!slot) continue
      slot.total += t.paymentAmount
      if (slot.y === focus.y && slot.m === focus.m) {
        const a = apps.get(b.key) ?? { key: b.key, label: b.label, total: 0, count: 0 }
        a.total += t.paymentAmount; a.count++
        apps.set(b.key, a)
      }
    }
    const list = [...apps.values()].sort((a, b) => b.total - a.total)
    return { months, list, total: list.reduce((a, x) => a + x.total, 0), max: Math.max(...months.map((x) => x.total), 1) }
  }, [all, tab, year, month, focus.y, focus.m])

  const at = data.months.findIndex((x) => x.y === focus.y && x.m === focus.m)
  const prev = data.months[at - 1]?.total ?? 0
  return (
    <>
      <div className="group-label"><Icon name="bag" size={14} /> Shopping apps</div>
      <div className="card pad">
        <div className="segmented" style={{ marginBottom: 14 }}>
          <button className={tab === 'QUICK' ? 'on' : ''} onClick={() => setTab('QUICK')}>Quick commerce</button>
          <button className={tab === 'ECOM' ? 'on' : ''} onClick={() => setTab('ECOM')}>E-COMMERCE</button>
        </div>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <b className="num" style={{ fontSize: 26 }}>{formatPrice(data.total, { round: true })}</b>
          <span className="dim small">{monthShort(focus.m)} {focus.y}{prev > 0 ? ` · ${data.total >= prev ? '+' : '−'}${Math.round(Math.abs(data.total - prev) / prev * 100)}% vs last month` : ''}</span>
        </div>
        <div className="hist" style={{ marginTop: 12 }} role="group" aria-label="Last 6 months, tap a bar to see that month">
          {data.months.map((h, i) => (
            <button key={`${h.y}-${h.m}`} className="hist-col" aria-pressed={i === at} aria-label={`${monthShort(h.m)} ${h.y}`} onClick={() => setPicked({ y: h.y, m: h.m, from: `${year}-${month}` })} style={{ opacity: i === at ? 1 : 0.55 }}>
              <div className="hist-bar-wrap"><div className={`hist-bar${i === at ? ' now' : ''}`} style={{ height: `${h.total ? Math.max(6, (h.total / data.max) * 100) : 0}%` }} /></div>
              <span className="tiny dim" style={{ fontWeight: i === at ? 700 : undefined }}>{monthShort(h.m)}</span>
            </button>
          ))}
        </div>
        {data.list.length === 0 ? <div className="empty small" style={{ marginTop: 10 }}>Nothing spent on these apps in {monthShort(focus.m)}.</div> : (
          <div style={{ marginTop: 14 }}>
            {data.list.map((a) => (
              <div key={a.key} className="list-row" style={{ alignItems: 'center', padding: '8px 0' }}>
                <BrandLogo src={brandLogo(a.key)} size={34} radius={17} alt={a.label} fallback={<span className="letter-avatar" style={{ width: 34, height: 34 }}>{a.label[0]}</span>} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between"><span>{a.label}</span><b className="num">{formatPrice(a.total, { round: true })}</b></div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--glass)', marginTop: 5 }}><div style={{ height: '100%', width: `${(a.total / data.total) * 100}%`, borderRadius: 3, background: 'var(--accent)' }} /></div>
                  <div className="dim tiny" style={{ marginTop: 3 }}>{a.count} order{a.count === 1 ? '' : 's'} · avg {formatPrice(a.total / a.count, { round: true })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
