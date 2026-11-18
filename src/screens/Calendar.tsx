import { useMemo, useState } from 'react'
import BrandLogo from '../components/ui/BrandLogo'
import AmountIcon from '../components/ui/AmountIcon'
import { merchantLogo } from '../lib/payees/brands'
import { Icon, PageHeader } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { formatPrice, formatPriceCompact, monthShort } from '../lib/core/format'
import { expectedItems, projectBalance, type CalKind } from '../lib/plan/calendar'
import { isTransferCategory } from '../lib/accounts/accounts'
import SpendingCalendar from './SpendingCalendar'
import type { Transaction } from '../lib/core/types'

const KIND: Record<CalKind, { label: string; color: string }> = {
  income: { label: 'Salary / income', color: '#34C759' },
  commitment: { label: 'Family & commitments', color: '#F4A261' },
  emi: { label: 'EMI', color: '#FF9500' },
  subscription: { label: 'Subscription / auto-debit', color: '#5856D6' },
  recurring: { label: 'Recurring', color: '#0A84FF' },
  loan: { label: 'Loan due', color: '#FF375F' },
  reminder: { label: 'Reminder', color: '#8E8E93' },
}

/** "What if I cut Food by 30%?" — what that frees up before the month ends. */
function WhatIf({ all, year, month, end }: { all: Transaction[]; year: number; month: number; end: number }) {
  const [cat, setCat] = useState<string | null>(null)
  const [pct, setPct] = useState(30)
  const now = new Date()
  const elapsed = Math.max(1, now.getDate()), daysIn = new Date(year, month + 1, 0).getDate()
  const byCat = useMemo(() => {
    const a = new Date(year, month, 1).getTime(), b = new Date(year, month + 1, 1).getTime()
    const m = new Map<string, number>()
    all.filter((t) => t.paymentType === 'DEBIT' && t.timestamp >= a && t.timestamp < b && !isTransferCategory(t.paymentCategory) && t.paymentCategory !== 'Rent' && t.paymentCategory !== 'Investments')
      .forEach((t) => m.set(t.paymentCategory, (m.get(t.paymentCategory) ?? 0) + t.paymentAmount))
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
  }, [all, year, month])
  if (!byCat.length) return null
  const chosen = cat && byCat.some(([c]) => c === cat) ? cat : byCat[0][0]
  const spent = byCat.find(([c]) => c === chosen)![1]
  const remaining = Math.max(0, (spent / elapsed) * daysIn - spent) // what is still likely to be spent here this month
  const freed = Math.round(remaining * (pct / 100))
  return (
    <div className="card pad col" style={{ gap: 10, marginTop: 12 }}>
      <b>What if…</b>
      <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Category">{byCat.map(([c]) => <button key={c} className={`qchip${c === chosen ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <label className="row between small"><span>Spend <b>{pct}%</b> less on {chosen}</span><span className="dim">{formatPrice(remaining, { round: true })} still expected</span></label>
      <input type="range" min={0} max={60} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Percent to cut" style={{ width: '100%', accentColor: 'var(--accent)' }} />
      <div className="row between"><span className="muted small">Month-end balance becomes</span><b className="num" style={{ color: freed > 0 ? 'var(--credit)' : undefined }}>{formatPrice(end + freed, { round: true })} <span className="small">(+{formatPrice(freed, { round: true })})</span></b></div>
    </div>
  )
}

/** Month view of expected money in/out with a projected balance. */
export default function CalendarPage({ onBack }: { onBack: () => void }) {
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  // re-render when anything the calendar reads changes
  useStored(KEYS.recurringRules, []); useStored(KEYS.emiPlans, []); useStored(KEYS.loans, []); useStored(KEYS.commitments, []); useStored(KEYS.salary, null)
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [view, setView] = useState<'bills' | 'spending'>('bills')
  const [sel, setSel] = useState<number | null>(ym.m === now.getMonth() && ym.y === now.getFullYear() ? now.getDate() : 1)
  const items = useMemo(() => expectedItems(ym.y, ym.m), [ym, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const proj = isThisMonth ? projectBalance(items) : null
  const daysIn = new Date(ym.y, ym.m + 1, 0).getDate()
  const lead = new Date(ym.y, ym.m, 1).getDay()
  const spentByDay = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of all) {
      const d = new Date(t.timestamp)
      if (d.getFullYear() !== ym.y || d.getMonth() !== ym.m || t.paymentType !== 'DEBIT' || isTransferCategory(t.paymentCategory)) continue
      m.set(d.getDate(), (m.get(d.getDate()) ?? 0) + t.paymentAmount)
    }
    return m
  }, [all, ym])
  const dayItems = (d: number) => items.filter((i) => new Date(i.date).getDate() === d)
  const selTx = sel ? all.filter((t) => { const d = new Date(t.timestamp); return d.getFullYear() === ym.y && d.getMonth() === ym.m && d.getDate() === sel }) : []
  const go = (delta: number) => { const d = new Date(ym.y, ym.m + delta); setYm({ y: d.getFullYear(), m: d.getMonth() }); setSel(null) }

  return (
    <div className="page">
      <PageHeader title="Calendar" onBack={onBack} />
      <div className="ins-tabs" role="tablist" aria-label="Calendar view" style={{ ['--i' as string]: view === 'bills' ? 0 : 1, gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 0 }}>
        <i className="ins-ind" style={{ width: 'calc((100% - 8px) / 2)' }} />
        <button role="tab" aria-selected={view === 'bills'} className={view === 'bills' ? 'on' : ''} onClick={() => setView('bills')}>Bills</button>
        <button role="tab" aria-selected={view === 'spending'} className={view === 'spending' ? 'on' : ''} onClick={() => setView('spending')}>Spending</button>
      </div>
      {view === 'spending' ? <SpendingCalendar all={all} /> : <>

      {proj && proj.tracked && (
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="row between"><span className="label">Bank balance today</span><b className="num">{formatPrice(proj.today, { round: true })}</b></div>
          <div className="row between small"><span className="muted">Still expected in</span><span className="num" style={{ color: 'var(--credit)' }}>+{formatPrice(proj.expectedIn, { round: true })}</span></div>
          <div className="row between small"><span className="muted">Still expected out</span><span className="num">−{formatPrice(proj.expectedOut, { round: true })}</span></div>
          <div className="row between" style={{ borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
            <span>Projected on {daysIn} {monthShort(ym.m)}</span>
            <b className="h2 num" style={{ color: proj.end < 0 ? 'var(--danger)' : undefined }}>{formatPrice(proj.end, { round: true })}</b>
          </div>
          {proj.lowest.value < 0 && <div className="small" style={{ color: 'var(--danger)' }}>Balance may go below zero around {new Date(proj.lowest.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} — move money or delay a payment.</div>}
          {proj.lowest.value >= 0 && proj.lowest.value < proj.today && proj.lowest.date > Date.now() && <div className="small" style={{ color: 'var(--accent)' }}>Lowest point ahead: {formatPrice(proj.lowest.value, { round: true })} on {new Date(proj.lowest.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.</div>}
          <div className="dim tiny">Excludes day-to-day spending you haven't made yet.</div>
        </div>
      )}

      {proj && proj.tracked && <WhatIf all={all} year={ym.y} month={ym.m} end={proj.end} />}

      <div className="row between" style={{ margin: '16px 0 10px' }}>
        <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous month"><Icon name="back" size={18} /></button>
        <b>{monthShort(ym.m)} {ym.y}</b>
        <button className="icon-btn" onClick={() => go(1)} aria-label="Next month"><Icon name="chevron" size={18} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="tiny dim" style={{ textAlign: 'center' }}>{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = i + 1
          const its = dayItems(d)
          const spent = spentByDay.get(d)
          const today = isThisMonth && d === now.getDate()
          return (
            <button key={d} onClick={() => setSel(d)} aria-label={`${d} ${monthShort(ym.m)}`}
              style={{ minHeight: 54, borderRadius: 12, padding: '4px 2px', background: sel === d ? 'rgba(var(--fg), .12)' : 'rgba(var(--fg), .04)', border: today ? '1px solid var(--blue)' : '1px solid transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span className="small" style={{ fontWeight: today ? 800 : 500 }}>{d}</span>
              <span className="row" style={{ gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                {its.slice(0, 3).map((it) => <i key={it.key} style={{ width: 6, height: 6, borderRadius: 3, background: KIND[it.kind].color, opacity: it.done ? 0.4 : 1 }} />)}
              </span>
              {spent ? <span className="num" style={{ fontSize: 9, color: 'var(--text-45)' }}>{formatPriceCompact(spent).replace(/\.\d+/, '')}</span> : null}
            </button>
          )
        })}
      </div>
      <div className="row wrap tiny dim" style={{ gap: '4px 12px', marginTop: 10 }}>
        {(Object.keys(KIND) as CalKind[]).filter((k) => items.some((i) => i.kind === k)).map((k) => <span key={k} className="row" style={{ gap: 4 }}><i style={{ width: 6, height: 6, borderRadius: 3, background: KIND[k].color }} />{KIND[k].label}</span>)}
      </div>

      {sel && (
        <>
          <div className="section-label">{sel} {monthShort(ym.m)}</div>
          <div className="card">
            {dayItems(sel).length === 0 && selTx.length === 0 && <div className="empty small">Nothing planned or spent.</div>}
            {dayItems(sel).map((it) => (
              <div key={it.key} className="list-row">
                <i style={{ width: 10, height: 10, borderRadius: 5, background: KIND[it.kind].color, flex: 'none' }} />
                <div className="grow"><div style={{ textDecoration: it.done ? 'line-through' : undefined, opacity: it.done ? 0.6 : 1 }}>{it.title}</div><div className="dim small">{KIND[it.kind].label}{it.done ? ' · done' : ''}</div></div>
                {it.amount > 0 && <b className="num" style={{ color: it.flow === 'in' ? 'var(--credit)' : undefined }}>{it.flow === 'in' ? '+' : '−'}{formatPrice(it.amount, { round: true })}</b>}
              </div>
            ))}
            {selTx.map((t) => (
              <div key={t.id} className="list-row">
                <BrandLogo src={merchantLogo(t.paymentReceiver)} size={22} radius={6} fallback={<AmountIcon credit={t.paymentType === 'CREDIT'} size={22} />} />
                <div className="grow"><div>{t.paymentReceiver}</div><div className="dim small">{t.paymentCategory} · actual</div></div>
                <span className="num" style={{ color: t.paymentType === 'CREDIT' ? 'var(--credit)' : undefined }}>{t.paymentType === 'CREDIT' ? '+' : '−'}{formatPrice(t.paymentAmount)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      </>}
    </div>
  )
}
