import { useMemo, useState } from 'react'
import { Icon, buzz } from '../ui/ui'
import { useStored, KEYS } from '../../lib/core/storage'
import { categoryIcon, withFamily } from '../../lib/core/data'
import { formatPrice } from '../../lib/core/format'
import { badgeFor, challengeProgress, noSpendStreak, saveTips, weekStartOf, type Challenge } from '../../lib/plan/savings'
import type { Commitment, Transaction } from '../../lib/core/types'

/** "Where can I save?" — suggestions with a rupee figure. */
export function SaveTips({ all }: { all: Transaction[] }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const tips = useMemo(() => saveTips(all, commitments), [all, commitments])
  if (!tips.length) return null
  const total = tips.reduce((a, t) => a + t.yearly, 0)
  return (
    <>
      <div className="row between" style={{ margin: '26px 4px 10px' }}>
        <div className="group-label" style={{ margin: 0, flex: 1 }}><Icon name="trend" size={14} /> Where you can save</div>
      </div>
      <div className="card pad row between" style={{ marginBottom: 10 }}>
        <span className="muted small">Potential, if you act on these</span>
        <b className="num" style={{ color: 'var(--credit)', fontSize: 18 }}>≈ {formatPrice(total, { round: true })}/yr</b>
      </div>
      <div className="col">
        {tips.map((t) => (
          <div key={t.key} className="card pad row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <span className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={t.icon} size={18} /></span>
            <div className="grow"><b>{t.title}</b><div className="muted small" style={{ marginTop: 4, lineHeight: 1.45 }}>{t.body}</div></div>
          </div>
        ))}
      </div>
    </>
  )
}

/** No-spend streak, badges, and a weekly cap on one category. */
export function StreakCard({ all }: { all: Transaction[] }) {
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [challenge, setChallenge] = useStored<Challenge | null>(KEYS.challenge, null)
  const [setting, setSetting] = useState(false)
  const [cat, setCat] = useState('Food')
  const [cap, setCap] = useState('')
  const { current, best } = useMemo(() => noSpendStreak(all, commitments), [all, commitments])
  const badge = badgeFor(best)
  // a challenge belongs to one week; roll it over to the current week once it has ended
  const active = challenge && challenge.weekStart < weekStartOf() ? { ...challenge, weekStart: weekStartOf() } : challenge
  const prog = active ? challengeProgress(all, active) : null
  const cats = withFamily(categories).filter((c) => c !== 'Investments' && c !== 'Rent')
  const pct = active && prog ? Math.min(100, Math.round((prog.spent / active.cap) * 100)) : 0

  return (
    <div className="card pad col" style={{ gap: 14, marginTop: 14 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="icon-tile" style={{ background: 'rgba(255,149,0,.15)', color: '#FF9500', width: 46, height: 46, borderRadius: 16 }}><Icon name="sparkles" size={22} /></span>
        <div className="grow">
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}><b className="num" style={{ fontSize: 26 }}>{current}</b><span className="muted small">day{current === 1 ? '' : 's'} without spending</span></div>
          <div className="dim tiny">Best this year: {best} day{best === 1 ? '' : 's'}{badge ? ` · ${badge}-day badge` : ''}</div>
        </div>
        {badge > 0 && <span className="pill" style={{ background: 'rgba(255,149,0,.15)', color: '#FF9500' }}>{badge}d</span>}
      </div>

      {active && prog ? (
        <div className="col" style={{ gap: 8, borderTop: '1px solid var(--divider)', paddingTop: 12 }}>
          <div className="row between"><b className="small"><Icon name={categoryIcon(active.category)} size={14} /> {active.category} this week</b>
            <button className="link small" onClick={() => setChallenge(null)}>Stop</button></div>
          <div className="bar" style={{ height: 8 }}><i style={{ width: `${pct}%`, background: prog.over ? 'var(--danger)' : pct >= 80 ? 'var(--amber)' : 'var(--toggle)' }} /></div>
          <div className="row between small"><span className="num">{formatPrice(prog.spent, { round: true })} of {formatPrice(active.cap, { round: true })}</span>
            <span style={{ color: prog.over ? 'var(--danger)' : 'var(--credit)' }}>{prog.over ? `${formatPrice(-prog.left, { round: true })} over` : `${formatPrice(prog.left, { round: true })} left`} · {prog.daysLeft}d to go</span></div>
        </div>
      ) : setting ? (
        <form className="col" style={{ gap: 10, borderTop: '1px solid var(--divider)', paddingTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (!(Number(cap) > 0)) return; buzz(12); setChallenge({ category: cat, cap: Number(cap), weekStart: weekStartOf() }); setSetting(false); setCap('') }}>
          <div className="row wrap" style={{ gap: 6 }}>{cats.slice(0, 8).map((c) => <button type="button" key={c} className={`qchip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
          <div className="row"><input className="input grow num" inputMode="numeric" autoFocus placeholder={`Weekly cap for ${cat}`} value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} aria-label="Weekly cap" /><button className="btn sm" disabled={!(Number(cap) > 0)}>Start</button></div>
        </form>
      ) : (
        <button className="pill-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setSetting(true)}><Icon name="target" size={15} /> Start a weekly challenge</button>
      )}
    </div>
  )
}
