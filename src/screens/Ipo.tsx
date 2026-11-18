import { useMemo } from 'react'
import { PageHeader } from '../components/ui/ui'
import { CountUp } from '../components/ui/CountUp'
import { ipoApplications, type IpoStatus } from '../lib/invest/ipo'
import { activeHoldIds } from '../lib/accounts/holds'
import { formatPrice } from '../lib/core/format'
import { KEYS, useStored } from '../lib/core/storage'
import type { Hold, Investment, PaymentMethod } from '../lib/core/types'

const STATUS: Record<IpoStatus, { label: string; color: string }> = {
  BLOCKED: { label: 'Money held', color: 'var(--amber)' },
  ALLOTTED: { label: 'Allotted', color: 'var(--credit)' },
  REFUNDED: { label: 'Not allotted', color: 'var(--text-60)' },
}
const day = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Money your bank blocked for IPO applications, and what became of each: all read from the bank's messages. */
export default function IpoPage({ onBack }: { onBack: () => void }) {
  const [holds] = useStored<Hold[]>(KEYS.holds, [])
  const [investments] = useStored<Investment[]>(KEYS.investments, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const apps = useMemo(() => ipoApplications(holds, investments), [holds, investments])
  const held = useMemo(() => { const live = activeHoldIds(holds); return holds.filter((h) => live.has(h.id)).reduce((a, h) => a + h.amount, 0) }, [holds])
  const count = (s: IpoStatus) => apps.filter((a) => a.status === s).length
  const money = (v: number) => formatPrice(v, { round: true })
  const accountOf = (h?: Hold) => methods.find((m) => m.id === h?.paymentMethodId)


  return (
    <div className="page">
      <PageHeader title="IPOs" onBack={onBack} />
      <div className="card pad col" style={{ gap: 10 }}>
        <div className="label">Money held for IPOs right now</div>
        <div className="big-amount num" style={{ fontSize: 36 }}><CountUp value={held} format={money} /></div>
        <div className="row" style={{ gap: 8 }}>
          {(['BLOCKED', 'ALLOTTED', 'REFUNDED'] as IpoStatus[]).map((s) => (
            <div key={s} className="grow ipo-stat"><b className="num" style={{ color: STATUS[s].color }}>{count(s)}</b><span>{STATUS[s].label}</span></div>
          ))}
        </div>
        <div className="dim tiny">Taken from the block and unblock messages your bank sends. Blocks come out of your balance until they are released.</div>
      </div>

      <div className="section-label">Your applications</div>
      {apps.length === 0 && <div className="empty small"><b>No IPO applications yet</b>When your bank blocks money for an IPO, it shows here, with what happened to it.</div>}
      <div className="col stagger" style={{ gap: 10 }}>
        {apps.map((a) => {
          const hold = holds.find((h) => h.id === a.id)
          const s = STATUS[a.status]
          return (
            <div key={a.id} className="card pad col" style={{ gap: 6 }}>
              <div className="row between"><b className="ellipsis">{a.name}</b><span className="ipo-chip" style={{ color: s.color, borderColor: s.color }}>{s.label}</span></div>
              <div className="row between small"><span className="num">{money(a.amount)}</span><span className="dim">Applied {day(a.appliedAt)}{accountOf(hold) ? ` · ${accountOf(hold)!.name}` : ''}</span></div>
              {a.status === 'BLOCKED' && <div className="dim tiny">Released after allotment if you did not get shares. Your balance already excludes it.</div>}
              {a.status === 'REFUNDED' && <div className="dim tiny">{a.endedAt ? `Money released on ${day(a.endedAt)}` : 'Money released'}. No shares.</div>}
              {a.status === 'ALLOTTED' && (
                a.gain ? (
                  <div className="row between small"><span className="dim">Worth now {money(a.gain.worth)}</span><b style={{ color: a.gain.worth >= a.gain.put ? 'var(--credit)' : 'var(--danger)' }}>{a.gain.worth >= a.gain.put ? '+' : '−'}{money(Math.abs(a.gain.worth - a.gain.put))} ({a.gain.pct >= 0 ? '+' : ''}{a.gain.pct.toFixed(1)}%)</b></div>
                ) : <div className="dim tiny">Shares taken{a.endedAt ? ` on ${day(a.endedAt)}` : ''}. Add the ticker and share count in Investments to see the listing gain.</div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
