import { useCallback, useEffect, useMemo, useState } from 'react'
import { buzz, Donut, Icon, Spinner } from '../components/ui/ui'
import { CountUp } from '../components/ui/CountUp'
import { useStored, KEYS } from '../lib/core/storage'
import { aiReady, ensureMinSuggestions, generateInsights, localInsights } from '../lib/capture/ai'
import { formatPrice, getCurrency, monthKey, monthShort } from '../lib/core/format'
import { categoryColor, categoryIcon, getCategories } from '../lib/core/data'
import { MonthPicker, monthTxns } from './Home'
import Trends from '../components/ui/Trends'
import ShoppingApps from '../components/home/ShoppingApps'
import AnalysisCards from '../components/reports/AnalysisCards'
import AskSheet from '../components/capture/AskSheet'
import { SaveTips, StreakCard } from '../components/plan/InsightCards'
import { committedCategories, isCommittedOutflow, isIncome, isPersonalSpend } from '../lib/core/money'
import type { Commitment } from '../lib/core/types'
import type { IncomeSource, Insight, InsightsCacheEntry, Transaction, User } from '../lib/core/types'

const DAY = 86400000

export default function Insights() {
  // always opens on the current month; pick another one to look back
  const [sel, setSel] = useState(() => ({ year: new Date().getFullYear(), month: new Date().getMonth() }))
  const [picker, setPicker] = useState(false)
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  const [user] = useStored<User | null>(KEYS.user, null)
  const [income] = useStored<IncomeSource[]>(KEYS.incomeSources, [])
  const [asking, setAsking] = useState(false)
  const [cache, setCache] = useStored<InsightsCacheEntry[]>(KEYS.insightsCache, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const txns = useMemo(() => monthTxns(all, sel.year, sel.month), [all, sel])
  const prev = useMemo(() => { const d = new Date(sel.year, sel.month - 1); return monthTxns(all, d.getFullYear(), d.getMonth()) }, [all, sel])
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const committed = committedCategories(commitments)
  const debits = txns.filter((t) => isPersonalSpend(t, committed))
  const committedTotal = txns.filter((t) => isCommittedOutflow(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)
  const salary = (user?.monthly_income ?? 0) + income.reduce((a, s) => a + s.amount, 0)
  const key = monthKey(sel.year, sel.month)
  const currency = getCurrency()
  const cats = getCategories()
  const catOf = (t: Transaction) => (cats.includes(t.paymentCategory) ? t.paymentCategory : 'Others')
  const cached = cache.find((c) => c.monthKey === key)
  const ai = aiReady()

  const fetchInsights = useCallback(async () => {
    if (!debits.length || !ai) return
    setLoading(true); setError(null)
    try {
      const s = await generateInsights(txns, `${monthShort(sel.month)} ${sel.year}`, salary)
      setCache((c) => [...c.filter((x) => x.monthKey !== key), { monthKey: key, suggestions: s, fetchedAt: Date.now(), currency }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate insights.')
    } finally {
      setLoading(false)
    }
  }, [debits.length, ai, txns, sel, salary, key, currency, setCache])

  useEffect(() => {
    const stale = !cached || Date.now() - cached.fetchedAt > DAY || cached.currency !== currency
    if (ai && stale && debits.length && !loading) fetchInsights()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ai])

  const suggestions: Insight[] = ai && cached
    ? ensureMinSuggestions(cached.suggestions)
    // same basis as the Home header: personal spending only, categories as shown elsewhere
    : ensureMinSuggestions(localInsights(
      txns.filter((t) => isPersonalSpend(t, committed)).map((t) => ({ ...t, paymentCategory: catOf(t) })),
      prev.filter((t) => isPersonalSpend(t, committed)).map((t) => ({ ...t, paymentCategory: catOf(t) })),
      salary, (n) => formatPrice(n, { round: true })))

  const total = debits.reduce((a, t) => a + t.paymentAmount, 0)
  const credits = txns.filter(isIncome).reduce((a, t) => a + t.paymentAmount, 0)
  const dayOfMonth = sel.year === new Date().getFullYear() && sel.month === new Date().getMonth() ? new Date().getDate() : new Date(sel.year, sel.month + 1, 0).getDate()
  const daily = total / dayOfMonth
  const topMerchants = useMemo(() => {
    const m = new Map<string, number>()
    debits.forEach((t) => m.set(t.paymentReceiver, (m.get(t.paymentReceiver) ?? 0) + t.paymentAmount))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [debits])
  const byCat = useMemo(() => {
    const m = new Map<string, number>()
    debits.forEach((t) => m.set(catOf(t), (m.get(catOf(t)) ?? 0) + t.paymentAmount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debits])
  const prevByCat = useMemo(() => {
    const m = new Map<string, number>()
    prev.filter((t) => isPersonalSpend(t, committed)).forEach((t) => m.set(catOf(t), (m.get(catOf(t)) ?? 0) + t.paymentAmount))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev, committed])
  const prevTotal = [...prevByCat.values()].reduce((a, v) => a + v, 0)
  const slices = byCat.map(([label, value]) => ({ label, value, color: categoryColor(label) }))
  const [hl, setHl] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview')
  const [allCats, setAllCats] = useState(false)
  const [moreInsights, setMoreInsights] = useState(false)

  return (
    <div className="page glow-page">
      <button className="month-pill" style={{ marginBottom: 6 }} onClick={() => setPicker(true)}>
        <span className="cal-icon"><Icon name="calendar" size={18} /></span>{monthShort(sel.month)} {sel.year}<Icon name="chevronDown" size={16} />
      </button>
      <MonthPicker open={picker} value={sel} onClose={() => setPicker(false)} onConfirm={(v) => { setSel(v); setPicker(false) }} />
      <h1 className="screen-title">Where it went</h1>

      <div className="card pad ins-hero">
        <div className="row between"><span className="label">Spent in {monthShort(sel.month)}</span>{deltaOf(total, prevTotal) && <Delta d={deltaOf(total, prevTotal)!} />}</div>
        <div className="ins-hero-amt num"><CountUp value={total} format={fmt} /></div>
        <div className="ins-mini">
          <div><span>Received</span><b className="num" style={{ color: 'var(--credit)' }}><CountUp value={credits} format={fmt} /></b></div>
          <div><span>Family and bills</span><b className="num"><CountUp value={committedTotal} format={fmt} /></b></div>
          <div><span>Per day</span><b className="num"><CountUp value={daily} format={fmt} /></b></div>
        </div>
      </div>

      <div className="ins-tabs" role="tablist" aria-label="Insights sections" style={{ ['--i' as string]: TABS.findIndex((x) => x.id === tab) }}>
        <i className="ins-ind" />
        {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => { buzz(6); setTab(x.id) }}>{x.label}</button>)}
      </div>

      <div key={tab} className="ins-pane">
        {tab === 'overview' && (
          <>
            <button className="card pad row ins-ask" style={{ width: '100%', textAlign: 'left' }} onClick={() => setAsking(true)}>
              <div className="icon-tile" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="sparkles" size={20} /></div>
              <div className="grow"><b>Ask your money</b><div className="dim small">“How much did I send Mom this year?”</div></div>
              <Icon name="chevron" size={18} />
            </button>

            {byCat.length > 0 ? (
              <div className="card pad col" style={{ gap: 16, marginTop: 14 }}>
                <div className="row between"><b>By category</b><span className="dim tiny">vs {monthShort(new Date(sel.year, sel.month - 1).getMonth())}</span></div>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <Donut slices={slices} highlight={hl} onSelect={setHl} size={160} thickness={32}
                    label={`Spending by category: ${slices.map((x) => `${x.label} ${formatPrice(x.value, { round: true })}`).join('; ')}`}>
                    {(() => { const h = slices.find((x) => x.label === hl); return h && ( // the total is already the hero figure
                      <div><div className="num" style={{ fontWeight: 800, fontSize: 17 }}>{formatPrice(h.value, { round: true })}</div><div className="tiny muted">{h.label}</div></div>
                    ) })()}
                  </Donut>
                </div>
                <div className="col stagger" style={{ gap: 14 }}>
                  {(allCats ? byCat : byCat.slice(0, 5)).map(([c, v]) => {
                    const d = deltaOf(v, prevByCat.get(c) ?? 0)
                    return (
                      <button key={c} className="col" style={{ gap: 6, textAlign: 'left', opacity: hl && hl !== c ? 0.4 : 1, transition: 'opacity .2s' }} onClick={() => setHl(hl === c ? null : c)}>
                        <div className="row between small">
                          <span className="row" style={{ gap: 8 }}>
                            <span className="icon-tile" style={{ width: 28, height: 28, borderRadius: 10, background: `${categoryColor(c)}22`, color: categoryColor(c) }}><Icon name={categoryIcon(c)} size={14} /></span>
                            {c}
                          </span>
                          <span className="row" style={{ gap: 8 }}>
                            {d && <Delta d={d} />}
                            <span className="num" style={{ fontWeight: 600 }}>{formatPrice(v, { round: true })}</span>
                          </span>
                        </div>
                        <div className="bar" style={{ height: 6 }}><i style={{ width: `${(v / byCat[0][1]) * 100}%`, background: categoryColor(c) }} /></div>
                      </button>
                    )
                  })}
                </div>
                {byCat.length > 5 && <button className="link small ins-more" onClick={() => setAllCats((v) => !v)} aria-expanded={allCats}>{allCats ? 'Show fewer' : `Show all ${byCat.length}`}<span style={{ display: 'inline-flex', transform: allCats ? 'rotate(180deg)' : undefined, transition: 'transform .25s' }}><Icon name="chevronDown" size={14} /></span></button>}
              </div>
            ) : <div className="card pad empty" style={{ marginTop: 14 }}><b>No spending yet</b>Add a few expenses this month to see where it went.</div>}

            {topMerchants.length > 0 && (
              <div className="card pad col" style={{ marginTop: 14, gap: 4 }}>
                <b style={{ marginBottom: 6 }}>Top places</b>
                {topMerchants.map(([m, v], i) => (
                  <div key={m} className="ins-place"><span className="ins-rank">{i + 1}</span><span className="grow ellipsis">{m}</span><span className="num">{formatPrice(v, { round: true })}</span>
                    <i className="ins-place-bar" style={{ width: `${(v / topMerchants[0][1]) * 100}%` }} /></div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'insights' && (
          <>
            <div className="row between" style={{ margin: '4px 4px 10px' }}>
              <div className="group-label" style={{ margin: 0, flex: 1 }}><Icon name="sparkles" size={14} /> {ai ? 'AI insights' : 'Insights'}</div>
              {ai && debits.length > 0 && <button className="link small row" style={{ gap: 4 }} onClick={fetchInsights} disabled={loading}><Icon name="refresh" size={14} /> Refresh</button>}
            </div>
            {!debits.length ? (
              <div className="card pad empty"><b>No spending yet</b>Add a few expenses this month to see insights.</div>
            ) : loading && !cached ? (
              <div className="col">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 86 }} />)}</div>
            ) : (
              <div className="col">
                {error && <div className="card pad error-text">{error}</div>}
                {!ai && <div className="card pad small muted">These insights are worked out on your phone. Turn on <b>AI processing</b> in Settings for personalised suggestions.</div>}
                {loading && <div className="row small muted"><Spinner /> Refreshing…</div>}
                {suggestions[0] && (
                  <div className="ins-feature">
                    <span className="ins-spark"><Icon name="sparkles" size={18} /></span>
                    <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3 }}>{suggestions[0].suggestion}</div>
                    <div className="small" style={{ opacity: 0.8, marginTop: 6, lineHeight: 1.5 }}>{suggestions[0].tip}</div>
                  </div>
                )}
                {suggestions.length > 1 && (
                  <>
                    <div className={`ins-collapse${moreInsights ? ' open' : ''}`}><div>
                      <div className="col stagger" style={{ gap: 10 }}>
                        {suggestions.slice(1).map((s, i) => (
                          <div key={i} className="card pad">
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{s.suggestion}</div>
                            <div className="muted small" style={{ marginTop: 6, lineHeight: 1.5 }}>{s.tip}</div>
                          </div>
                        ))}
                      </div>
                    </div></div>
                    <button className="link small ins-more" onClick={() => setMoreInsights((v) => !v)} aria-expanded={moreInsights}>{moreInsights ? 'Show fewer' : `${suggestions.length - 1} more insight${suggestions.length === 2 ? '' : 's'}`}<span style={{ display: 'inline-flex', transform: moreInsights ? 'rotate(180deg)' : undefined, transition: 'transform .25s' }}><Icon name="chevronDown" size={14} /></span></button>
                  </>
                )}
              </div>
            )}
            <SaveTips all={all} />
            <StreakCard all={all} />
          </>
        )}

        {tab === 'trends' && (
          <>
            <Trends all={all} endYear={sel.year} endMonth={sel.month} salary={salary} />
            <ShoppingApps all={all} year={sel.year} month={sel.month} />
            <AnalysisCards all={all} year={sel.year} month={sel.month} />
          </>
        )}
      </div>
      <AskSheet open={asking} onClose={() => setAsking(false)} />
    </div>
  )
}

const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'insights', label: 'Insights' }, { id: 'trends', label: 'Trends' }] as const
const fmt = (v: number) => formatPrice(v, { round: true })

type DeltaT = { pct: number; up: boolean } | null
/** Change vs last month; null when there is nothing to compare with. */
function deltaOf(now: number, before: number): DeltaT {
  if (before <= 0 || now <= 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  return { pct, up: pct >= 0 }
}

/** More spending is bad (red), less is good (green). */
function Delta({ d }: { d: NonNullable<DeltaT> }) {
  const color = d.up ? 'var(--up)' : 'var(--down)'
  return (
    <span className="compare-chip" style={{ color, background: d.up ? 'rgba(255,107,107,.14)' : 'rgba(79,235,32,.12)' }} aria-label={`${Math.abs(d.pct)} percent ${d.up ? 'more' : 'less'} than last month`}>
      <Icon name={d.up ? 'up' : 'down'} size={10} stroke={3} />{Math.min(Math.abs(d.pct), 999)}%
    </span>
  )
}
