import { useMemo, useState } from 'react'
import BrandLogo from '../components/ui/BrandLogo'
import { CountUp } from '../components/ui/CountUp'
import { buzz, Icon, Sheet } from '../components/ui/ui'
import { merchantLogo } from '../lib/payees/brands'
import { categoryColor, categoryIcon } from '../lib/core/data'
import { formatPrice, formatPriceCompact, monthShort } from '../lib/core/format'
import { categoriesOf, dayInsight, levelOf, monthDays, monthStats, patterns, thresholdsOf, type DayInfo } from '../lib/plan/spendcal'
import type { Transaction } from '../lib/core/types'

type Tab = 'summary' | 'categories' | 'patterns'
const TABS: { id: Tab; label: string }[] = [{ id: 'summary', label: 'Summary' }, { id: 'categories', label: 'Categories' }, { id: 'patterns', label: 'Patterns' }]
const money = (v: number) => formatPrice(v, { round: true })
const time = (ts: number) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/**
 * Where the money went, day by day: each day of the month shaded by how much was spent, a sheet for any day, and the month read three ways:
 * a summary with its top days, the categories (tap one to see only its days), and the week's patterns.
 */
export default function SpendingCalendar({ all }: { all: Transaction[] }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [tab, setTab] = useState<Tab>('summary')
  const [cat, setCat] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<number | null>(null)
  const isNow = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const atEnd = isNow
  const go = (delta: number) => { const d = new Date(ym.y, ym.m + delta); if (d > now && !(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())) { buzz(30); return } setYm({ y: d.getFullYear(), m: d.getMonth() }); setCat(null); setOpenDay(null); buzz(6) }

  const days = useMemo(() => monthDays(all, ym.y, ym.m, cat), [all, ym, cat])
  const th = useMemo(() => thresholdsOf(days), [days])
  const stats = useMemo(() => monthStats(all, ym.y, ym.m, now, cat), [all, ym, cat]) // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useMemo(() => categoriesOf(all, ym.y, ym.m), [all, ym])
  const pats = useMemo(() => patterns(all, ym.y, ym.m, now), [all, ym]) // eslint-disable-line react-hooks/exhaustive-deps
  const lead = new Date(ym.y, ym.m, 1).getDay()
  const hot = cat ? categoryColor(cat) : null
  const monthKey = `${ym.y}-${ym.m}-${cat ?? ''}`
  const day = openDay ? days[openDay - 1] : null

  return (
    <>
      <div className="row between" style={{ margin: '4px 0 12px' }}>
        <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous month"><Icon name="back" size={18} /></button>
        <b className="sc-month">{new Date(ym.y, ym.m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b>
        <button className="icon-btn" onClick={() => go(1)} disabled={atEnd} style={{ opacity: atEnd ? 0.3 : 1 }} aria-label="Next month"><Icon name="chevron" size={18} /></button>
      </div>

      {cat && (
        <button className="qchip on" style={{ marginBottom: 10 }} onClick={() => setCat(null)}><Icon name={categoryIcon(cat)} size={14} />{cat}<Icon name="close" size={13} /></button>
      )}

      <div key={monthKey} className="sc-grid" role="grid" aria-label="Spending by day">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="sc-dow">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {days.map((d) => {
          const lvl = levelOf(d.total, th)
          const future = isNow && d.day > now.getDate()
          const today = isNow && d.day === now.getDate()
          return (
            <button key={d.day} className={`sc-day l${lvl}${today ? ' today' : ''}${openDay === d.day ? ' sel' : ''}${future ? ' future' : ''}`} disabled={future}
              style={{ animationDelay: `${(d.day + lead) * 14}ms`, ['--hot' as string]: hot ?? undefined }}
              onClick={() => { buzz(8); setOpenDay(d.day) }} aria-label={`${d.day} ${monthShort(ym.m)}: ${d.total ? money(d.total) : 'no spending'}`}>
              {d.total > 0 ? <span className="sc-amt num">{formatPriceCompact(d.total)}</span> : <span className="sc-none" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <div className="sc-legend" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`sc-day l${l}`} style={{ ['--hot' as string]: hot ?? undefined }} />)}<span>More</span></div>

      <div className="ins-tabs" role="tablist" aria-label="Calendar views" style={{ ['--i' as string]: TABS.findIndex((x) => x.id === tab), marginTop: 16 }}>
        <i className="ins-ind" />
        {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => { buzz(6); setTab(x.id) }}>{x.label}</button>)}
      </div>

      <div key={tab} className="ins-pane">
        {tab === 'summary' && (
          <>
            <div className="card pad row" style={{ gap: 0 }}>
              <div className="grow"><div className="label">Total spent</div><div className="num sc-big"><CountUp value={stats.total} format={money} /></div>{stats.change !== null && <div className="tiny" style={{ color: stats.change > 0 ? 'var(--up)' : 'var(--down)' }}>{stats.change > 0 ? '▲' : '▼'} {Math.abs(stats.change)}% vs same days last month</div>}</div>
              <div className="grow" style={{ borderLeft: '1px solid var(--divider)', paddingLeft: 16 }}><div className="label">Daily average</div><div className="num sc-big"><CountUp value={stats.avg} format={money} /></div><div className="tiny dim">{stats.noSpend} no-spend day{stats.noSpend === 1 ? '' : 's'}</div></div>
            </div>
            <div className="group-label" style={{ marginTop: 18 }}>Top spending days</div>
            {stats.top.length === 0 ? <div className="card pad empty small">No spending yet this month.</div> : (
              <div className="card pad col stagger" style={{ gap: 14 }}>
                {stats.top.map((d) => (
                  <button key={d.day} className="sc-top" onClick={() => setOpenDay(d.day)}>
                    <span className="sc-badge"><small>{monthShort(ym.m)}</small><b>{d.day}</b></span>
                    <span className="grow col" style={{ gap: 6 }}>
                      <span className="row between"><b>{money(d.total)}</b><span className="dim small">{d.count} transaction{d.count === 1 ? '' : 's'}</span></span>
                      <span className="bar" style={{ height: 6 }}><i style={{ width: `${(d.total / stats.top[0].total) * 100}%`, background: 'var(--accent)' }} /></span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'categories' && (
          <>
            <p className="dim small" style={{ margin: '2px 2px 10px' }}>Tap a category to see only its days on the calendar.</p>
            {cats.length === 0 ? <div className="card pad empty small">No spending yet this month.</div> : (
              <div className="card pad col stagger" style={{ gap: 14 }}>
                {cats.map((c) => {
                  const d = c.prev > 0 ? Math.round(((c.total - c.prev) / c.prev) * 100) : null
                  return (
                    <button key={c.cat} className="col" style={{ gap: 6, textAlign: 'left', opacity: cat && cat !== c.cat ? 0.45 : 1, transition: 'opacity .2s' }} onClick={() => { buzz(8); setCat(cat === c.cat ? null : c.cat); if (cat !== c.cat) window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                      <div className="row between small">
                        <span className="row" style={{ gap: 8 }}><span className="icon-tile" style={{ width: 30, height: 30, borderRadius: 10, background: `${categoryColor(c.cat)}22`, color: categoryColor(c.cat) }}><Icon name={categoryIcon(c.cat)} size={15} /></span>{c.cat}</span>
                        <span className="row" style={{ gap: 8 }}>{d !== null && Math.abs(d) >= 1 && <span className="compare-chip" style={{ color: d > 0 ? 'var(--up)' : 'var(--down)', background: d > 0 ? 'rgba(255,107,107,.14)' : 'rgba(79,235,32,.12)' }}>{d > 0 ? '▲' : '▼'} {Math.min(Math.abs(d), 999)}%</span>}<b className="num">{money(c.total)}</b><span className="dim num" style={{ width: 34, textAlign: 'right' }}>{c.pct}%</span></span>
                      </div>
                      <div className="bar" style={{ height: 6 }}><i style={{ width: `${(c.total / cats[0].total) * 100}%`, background: categoryColor(c.cat) }} /></div>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        {tab === 'patterns' && (
          pats.length === 0 ? (
            <div className="card pad empty small"><b>Not enough days yet</b>Patterns appear once you have a few weeks of spending to compare.</div>
          ) : (
            <div className="col stagger" style={{ gap: 10 }}>
              {pats.map((p) => (
                <div key={p.key} className="card pad row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <span className="icon-tile" style={{ background: p.tone === 'warn' ? 'rgba(255,107,107,.16)' : p.tone === 'good' ? 'rgba(52,211,153,.16)' : 'var(--accent-soft)', color: p.tone === 'warn' ? 'var(--up)' : p.tone === 'good' ? 'var(--credit)' : 'var(--accent)' }}><Icon name={p.icon} size={20} /></span>
                  <div className="grow"><b>{p.title}</b><div className="muted small" style={{ marginTop: 3, lineHeight: 1.45 }}>{p.body}</div></div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <DaySheet day={day} days={days} avg={stats.avg} ym={ym} onClose={() => setOpenDay(null)} onGo={setOpenDay} />
    </>
  )
}

/** One day: the total, a small chart of the days around it, what was spent and a line about it. */
function DaySheet({ day, days, avg, ym, onClose, onGo }: { day: DayInfo | null; days: DayInfo[]; avg: number; ym: { y: number; m: number }; onClose: () => void; onGo: (d: number) => void }) {
  if (!day) return null
  const now = new Date()
  const isNow = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const around = days.slice(Math.max(0, Math.min(day.day - 4, days.length - 7)), Math.max(0, Math.min(day.day - 4, days.length - 7)) + 7)
  const top = Math.max(1, ...around.map((d) => d.total))
  const prevOk = day.day > 1, nextOk = day.day < days.length && !(isNow && day.day >= now.getDate())
  const label = new Date(day.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <Sheet open onClose={onClose}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="icon-btn" onClick={() => prevOk && onGo(day.day - 1)} disabled={!prevOk} style={{ opacity: prevOk ? 1 : 0.3 }} aria-label="Previous day"><Icon name="back" size={18} /></button>
        <b>{label}</b>
        <button className="icon-btn" onClick={() => nextOk && onGo(day.day + 1)} disabled={!nextOk} style={{ opacity: nextOk ? 1 : 0.3 }} aria-label="Next day"><Icon name="chevron" size={18} /></button>
      </div>
      <div className="sc-mini" aria-hidden="true">
        {around.map((d) => <span key={d.day} className={d.day === day.day ? 'on' : ''}><i style={{ height: `${Math.max(6, (d.total / top) * 100)}%` }} /><small>{d.day}</small></span>)}
      </div>
      <div className="card pad col" style={{ gap: 4, alignItems: 'center', marginTop: 10 }}>
        <span className="label">Total spent</span>
        <b className="num sc-big" key={day.day}><CountUp value={day.total} format={money} /></b>
        <span className="dim small">{day.count} transaction{day.count === 1 ? '' : 's'}</span>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        {day.tx.length === 0 && <div className="empty small">Nothing was spent.</div>}
        {day.tx.map((t) => (
          <div key={t.id} className="list-row">
            <BrandLogo src={merchantLogo(t.paymentReceiver)} size={34} radius={17} fallback={<span className="letter-avatar" style={{ background: categoryColor(t.paymentCategory), width: 34, height: 34, fontSize: 15 }}>{(t.paymentReceiver.trim()[0] ?? '?').toUpperCase()}</span>} />
            <div className="grow"><div className="ellipsis" style={{ fontWeight: 600 }}>{t.paymentReceiver}</div><div className="dim small">{t.paymentCategory} · {time(t.timestamp)}</div></div>
            <b className="num">{formatPrice(t.paymentAmount)}</b>
          </div>
        ))}
      </div>
      <div className="card pad row" style={{ gap: 10, marginTop: 10, alignItems: 'flex-start' }}>
        <span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="sparkles" size={18} /></span>
        <div><b>Day insight</b><div className="muted small" style={{ marginTop: 3, lineHeight: 1.45 }}>{dayInsight(day, avg)}</div></div>
      </div>
    </Sheet>
  )
}
