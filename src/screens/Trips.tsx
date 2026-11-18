import { useMemo, useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { categoryColor, categoryIcon, tagsOf } from '../lib/core/data'
import { formatPrice, monthShort } from '../lib/core/format'
import { setPendingSplit } from '../lib/split/splitHandoff'
import type { Transaction } from '../lib/core/types'
import type { PlannerPage } from './Planner'

/** A trip or event is simply a #tag: its budget (optional) is the only thing stored. */
type TripMeta = Record<string, { budget?: number }>

const dateRange = (a: number, b: number) => {
  const x = new Date(a), y = new Date(b)
  const f = (d: Date) => `${d.getDate()} ${monthShort(d.getMonth())}`
  return x.toDateString() === y.toDateString() ? f(x) : `${f(x)} – ${f(y)}`
}

/** Planner page: everything tagged with the same #tag (a trip, an event) added up. */
export default function TripsPage({ onBack, open }: { onBack: () => void; open: (p: PlannerPage) => void }) {
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  const [meta, setMeta] = useStored<TripMeta>(KEYS.trips, {})
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const trips = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    all.forEach((t) => tagsOf(t.note).forEach((tag) => m.set(tag, [...(m.get(tag) ?? []), t])))
    Object.keys(meta).forEach((tag) => { if (!m.has(tag)) m.set(tag, []) })
    return [...m.entries()].map(([tag, list]) => {
      const spend = list.filter((t) => t.paymentType === 'DEBIT')
      const total = spend.reduce((a, t) => a + t.paymentAmount, 0)
      const first = list.length ? Math.min(...list.map((t) => t.timestamp)) : 0
      const last = list.length ? Math.max(...list.map((t) => t.timestamp)) : 0
      const days = list.length ? Math.max(1, Math.round((last - first) / 86400000) + 1) : 0
      return { tag, list: list.sort((a, b) => b.timestamp - a.timestamp), total, first, last, days, budget: meta[tag]?.budget ?? 0 }
    }).sort((a, b) => b.last - a.last)
  }, [all, meta])

  const trip = trips.find((t) => t.tag === sel) ?? null

  return (
    <div className="page">
      <PageHeader title="Trips & events" onBack={onBack} right={<button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Trip</button>} />
      <p className="screen-sub" style={{ marginTop: -6 }}>Tag an expense <b>#goa-trip</b> and its total shows here.</p>

      {trips.length === 0 ? (
        <div className="empty"><b>No trips yet</b>Tag an expense with a #hashtag in its note — or start one with the Trip button.</div>
      ) : (
        <div className="col" style={{ marginTop: 14 }}>
          {trips.map((t) => {
            const pct = t.budget > 0 ? Math.min(100, Math.round((t.total / t.budget) * 100)) : 0
            const over = t.budget > 0 && t.total > t.budget
            return (
              <button key={t.tag} className="card pad col" style={{ gap: 8, textAlign: 'left' }} onClick={() => setSel(t.tag)}>
                <div className="row between">
                  <span className="row" style={{ gap: 10 }}>
                    <span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="plane" size={20} /></span>
                    <span><b>{t.tag}</b><span className="dim small" style={{ display: 'block' }}>{t.list.length ? `${t.list.length} entries · ${dateRange(t.first, t.last)}` : 'No entries yet'}</span></span>
                  </span>
                  <b className="num" style={{ fontSize: 18 }}>{formatPrice(t.total, { round: true })}</b>
                </div>
                {t.budget > 0 && (
                  <>
                    <div className="bar" style={{ height: 6 }}><i style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--accent)' }} /></div>
                    <div className="dim tiny">{over ? `${formatPrice(t.total - t.budget, { round: true })} over` : `${formatPrice(t.budget - t.total, { round: true })} left`} of {formatPrice(t.budget, { round: true })}</div>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)}>
        <SheetHeader title="Start a trip" sub="Pick a tag, then add it to expenses as #tag" onClose={() => setAdding(false)} />
        <form className="row" onSubmit={(e) => {
          e.preventDefault()
          const tag = `#${name.trim().replace(/^#+/, '').replace(/\s+/g, '-')}`
          if (tag.length < 2) return
          setMeta({ ...meta, [tag]: meta[tag] ?? {} }); setName(''); setAdding(false); setSel(tag)
        }}>
          <input className="input grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. goa trip" aria-label="Trip name" />
          <button className="btn sm" disabled={!name.trim()}>Start</button>
        </form>
      </Sheet>

      <Sheet open={!!trip} onClose={() => setSel(null)} full>
        {trip && <TripDetail trip={trip} budget={trip.budget} onBudget={(b) => setMeta({ ...meta, [trip.tag]: { ...meta[trip.tag], budget: b || undefined } })}
          onClose={() => setSel(null)} onSplit={() => { setPendingSplit({ description: trip.tag.replace(/^#/, ''), amount: Math.round(trip.total) }); setSel(null); open('split') }} />}
      </Sheet>
    </div>
  )
}

function TripDetail({ trip, budget, onBudget, onClose, onSplit }: {
  trip: { tag: string; list: Transaction[]; total: number; days: number }
  budget: number; onBudget: (b: number) => void; onClose: () => void; onSplit: () => void
}) {
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(String(budget || ''))
  const spend = trip.list.filter((t) => t.paymentType === 'DEBIT')
  const byCat = useMemo(() => {
    const m = new Map<string, number>()
    spend.forEach((t) => m.set(t.paymentCategory, (m.get(t.paymentCategory) ?? 0) + t.paymentAmount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [spend])
  const perDay = trip.days ? trip.total / trip.days : 0
  return (
    <>
      <SheetHeader title={trip.tag} sub={`${trip.days} day${trip.days === 1 ? '' : 's'} · ${formatPrice(perDay, { round: true })}/day`} onClose={onClose} />
      <div className="card pad row between"><div><div className="label">Total spent</div><div className="num" style={{ fontSize: 30, fontWeight: 800 }}>{formatPrice(trip.total, { round: true })}</div></div>
        <button className="pill-btn" onClick={() => setEdit((v) => !v)}><Icon name="target" size={15} />{budget ? 'Budget' : 'Set budget'}</button></div>
      {edit && (
        <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); onBudget(Number(draft) || 0); setEdit(false) }}>
          <input className="input grow num" inputMode="numeric" autoFocus placeholder="Trip budget" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} />
          <button className="btn sm">Save</button>
        </form>
      )}
      {byCat.length > 0 && (
        <div className="card pad col" style={{ marginTop: 12, gap: 10 }}>
          {byCat.map(([c, v]) => (
            <div key={c}>
              <div className="row between small"><span className="row" style={{ gap: 6 }}><Icon name={categoryIcon(c)} size={14} />{c}</span><span className="num">{formatPrice(v, { round: true })}</span></div>
              <div className="bar" style={{ height: 5, marginTop: 4 }}><i style={{ width: `${(v / byCat[0][1]) * 100}%`, background: categoryColor(c) }} /></div>
            </div>
          ))}
        </div>
      )}
      {spend.length > 0 && <button className="btn block secondary" style={{ marginTop: 12 }} onClick={onSplit}><Icon name="split" size={18} /> Split {formatPrice(trip.total, { round: true })} with friends</button>}
      <div className="card" style={{ marginTop: 12 }}>
        {trip.list.length === 0 && <div className="empty small">Add {trip.tag} to an expense’s note to see it here.</div>}
        {trip.list.map((t) => (
          <div key={t.id} className="list-row">
            <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis">{t.paymentReceiver}</div><div className="dim tiny">{new Date(t.timestamp).getDate()} {monthShort(new Date(t.timestamp).getMonth())} · {t.paymentCategory}</div></div>
            <b className="num" style={{ color: t.paymentType === 'CREDIT' ? 'var(--credit)' : 'var(--up)' }}>{t.paymentType === 'CREDIT' ? '+' : '-'} {formatPrice(t.paymentAmount, { round: true })}</b>
          </div>
        ))}
      </div>
    </>
  )
}
