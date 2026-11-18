import { useMemo } from 'react'
import { Icon } from '../ui/ui'
import { bestMonths, explainChange, habits, priceCreep, type Reading } from '../../lib/reports/analysis'
import { formatPrice, monthShort } from '../../lib/core/format'
import { committedCategories } from '../../lib/core/money'
import { useStored, KEYS } from '../../lib/core/storage'
import type { Commitment, Transaction } from '../../lib/core/types'

const tone = (t?: Reading['tone']) => (t === 'up' ? 'var(--danger)' : t === 'down' ? 'var(--credit)' : 'var(--accent)')

function Block({ title, icon, items }: { title: string; icon: string; items: Reading[] }) {
  if (!items.length) return null
  return (
    <>
      <div className="group-label"><Icon name={icon} size={14} /> {title}</div>
      <div className="card">
        {items.map((r, i) => (
          <div key={i} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tone(r.tone), flex: 'none' }} />
            <div className="grow"><div style={{ fontWeight: 600 }}>{r.title}</div><div className="dim small" style={{ marginTop: 2, lineHeight: 1.45 }}>{r.body}</div></div>
          </div>
        ))}
      </div>
    </>
  )
}

/** Why the month changed, how you spend, your best months and price creep, all from your own history. */
export default function AnalysisCards({ all, year, month }: { all: Transaction[]; year: number; month: number }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const committed = useMemo(() => committedCategories(commitments), [commitments])
  const why = useMemo(() => explainChange(all, committed, year, month), [all, committed, year, month])
  const prevMonth = monthShort(new Date(year, month - 1, 1).getMonth())
  const habit = useMemo(() => habits(all, committed, year), [all, committed, year])
  const best = useMemo(() => bestMonths(all, committed, year, month), [all, committed, year, month])
  const creep = useMemo(() => priceCreep(all), [all])
  const money = (n: number) => formatPrice(Math.abs(n), { round: true })

  return (
    <>
      {why.before > 0 && why.now > 0 && (
        <>
          <div className="group-label"><Icon name="sparkles" size={14} /> Why {why.diff >= 0 ? 'more' : 'less'} than {prevMonth}?</div>
          <div className="card pad col" style={{ gap: 8 }}>
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <b className="num" style={{ fontSize: 22, color: why.diff > 0 ? 'var(--danger)' : 'var(--credit)' }}>{why.diff >= 0 ? '+' : '−'}{money(why.diff)}</b>
              <span className="dim small">{money(why.now)} vs {money(why.before)}</span>
            </div>
            {why.reasons.length ? why.reasons.map((r, i) => <div key={i} className="small" style={{ lineHeight: 1.45 }}>• {r}</div>) : <div className="dim small">Spread across many small changes, nothing stands out.</div>}
          </div>
        </>
      )}
      <Block title="Your habits" icon="user" items={habit} />
      <Block title="Best months" icon="star" items={best} />
      <Block title="Price creep" icon="trend" items={creep} />
    </>
  )
}
