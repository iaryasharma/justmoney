import { CountUp } from './CountUp'
import { useMemo, useState, type ReactNode } from 'react'
import { categoryColor, getCategories } from '../../lib/core/data'
import { isTransferCategory } from '../../lib/accounts/accounts'
import { formatPrice, formatPriceCompact, monthRange, monthShort } from '../../lib/core/format'
import type { Transaction } from '../../lib/core/types'

interface MonthRow { key: string; label: string; spend: number; income: number; byCat: Record<string, number> }

function buildMonths(all: Transaction[], endYear: number, endMonth: number, count: number): MonthRow[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(endYear, endMonth - (count - 1 - i))
    const { start, end } = monthRange(d.getFullYear(), d.getMonth())
    const cats = getCategories()
    const row: MonthRow = { key: `${d.getFullYear()}-${d.getMonth()}`, label: monthShort(d.getMonth()), spend: 0, income: 0, byCat: {} }
    for (const t of all) {
      if (t.timestamp < start || t.timestamp >= end) continue
      if (isTransferCategory(t.paymentCategory)) continue // own-account moves and loans aren't spending or income
      if (t.paymentType === 'DEBIT') { row.spend += t.paymentAmount; const c = cats.includes(t.paymentCategory) ? t.paymentCategory : 'Others'; row.byCat[c] = (row.byCat[c] ?? 0) + t.paymentAmount }
      else row.income += t.paymentAmount
    }
    return row
  })
}

/** Rounds an axis max up to 1/2/2.5/5 × 10^n so gridlines land on clean values. */
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

const savingsRate = (r: MonthRow) => (r.income > 0 ? Math.max(-100, Math.round(((r.income - r.spend) / r.income) * 100)) : null)

export default function Trends({ all, endYear, endMonth, salary }: { all: Transaction[]; endYear: number; endMonth: number; salary: number }) {
  const [range, setRange] = useState<6 | 12>(6)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [cat, setCat] = useState<string | null>(null)
  const months = useMemo(() => buildMonths(all, endYear, endMonth, range), [all, endYear, endMonth, range])
  // Months with no recorded income fall back to the profile's monthly income for the savings rate.
  const withSalary = months.map((m) => ({ ...m, income: m.income || salary }))
  const cats = useMemo(() => {
    const tot: Record<string, number> = {}
    months.forEach((m) => Object.entries(m.byCat).forEach(([c, v]) => { tot[c] = (tot[c] ?? 0) + v }))
    return Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [months])
  const rates = withSalary.map(savingsRate).filter((r): r is number => r !== null)
  const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null
  const avgSpend = months.reduce((a, m) => a + m.spend, 0) / months.length

  if (!months.some((m) => m.spend || m.income)) return null

  return (
    <>
      <div className="row between" style={{ margin: '26px 4px 10px' }}>
        <div className="section-label" style={{ margin: 0 }}>Trends</div>
        <div className="row" style={{ gap: 6 }}>
          {([6, 12] as const).map((n) => <button key={n} className={`chip${range === n ? ' on' : ''}`} style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setRange(n)}>{n}M</button>)}
          <button className="chip" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>{view === 'chart' ? 'Table' : 'Chart'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="card pad"><div className="label">Avg monthly spend</div><div className="num" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}><CountUp value={avgSpend} format={(v) => formatPrice(v, { round: true })} /></div></div>
        <div className="card pad"><div className="label">Avg savings rate</div><div className="num" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{avgRate === null ? '—' : <><CountUp value={avgRate} />%</>}</div></div>
      </div>

      <div className="card pad" style={{ marginTop: 10 }}>
        <div className="row small" style={{ gap: 14, marginBottom: 8 }}>
          <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--series-1)' }} />Spent</span>
          <span className="row" style={{ gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--series-2)' }} />Income</span>
        </div>
        {view === 'chart'
          ? <BarChart rows={months.map((m) => ({ label: m.label, values: [m.spend, m.income] }))} colors={['var(--series-1)', 'var(--series-2)']}
              tooltip={(i) => {
                const m = withSalary[i]; const r = savingsRate(m)
                return <><b>{months[i].label}</b><div>Spent {formatPrice(months[i].spend, { round: true })}</div><div>Income {formatPrice(months[i].income, { round: true })}</div>{r !== null && <div className="dim">Saved {r}%</div>}</>
              }} />
          : (
            <table className="small num" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr className="dim" style={{ textAlign: 'right' }}><th style={{ textAlign: 'left', fontWeight: 600 }}>Month</th><th style={{ fontWeight: 600 }}>Spent</th><th style={{ fontWeight: 600 }}>Income</th><th style={{ fontWeight: 600 }}>Saved</th></tr></thead>
              <tbody>{months.map((m, i) => { const r = savingsRate(withSalary[i]); return (
                <tr key={m.key} style={{ textAlign: 'right', borderTop: '1px solid var(--divider)' }}>
                  <td style={{ textAlign: 'left', padding: '6px 0' }}>{m.label}</td><td>{formatPriceCompact(m.spend)}</td><td>{formatPriceCompact(m.income)}</td><td>{r === null ? '—' : `${r}%`}</td>
                </tr>) })}</tbody>
            </table>
          )}
      </div>

      {cats.length > 0 && (
        <div className="card pad" style={{ marginTop: 10 }}>
          <div className="label" style={{ marginBottom: 8 }}>Category trend</div>
          <div className="chips" style={{ marginBottom: 10 }}>
            {cats.map((c) => <button key={c} className={`chip${(cat ?? cats[0]) === c ? ' on' : ''}`} style={{ height: 30 }} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          {(() => {
            const c = cat && cats.includes(cat) ? cat : cats[0]
            return <BarChart rows={months.map((m) => ({ label: m.label, values: [m.byCat[c] ?? 0] }))} colors={[categoryColor(c)]} height={130}
              tooltip={(i) => <><b>{months[i].label}</b><div>{c}: {formatPrice(months[i].byCat[c] ?? 0, { round: true })}</div></>} />
          })()}
        </div>
      )}
    </>
  )
}

/** Grouped bars on one shared y-axis; tap or hover a month for its values. */
function BarChart({ rows, colors, height = 170, tooltip }: {
  rows: { label: string; values: number[] }[]; colors: string[]; height?: number; tooltip: (i: number) => ReactNode
}) {
  const [active, setActive] = useState<number | null>(null)
  // a new set of numbers (another range or category) redraws the bars from the baseline
  const animKey = `${colors.join()}|${rows.map((r) => r.values.join(',')).join(';')}`
  const W = 340, padL = 34, padB = 20, padT = 6
  const plotH = height - padB - padT
  const max = niceMax(Math.max(...rows.flatMap((r) => r.values)))
  const slot = (W - padL) / rows.length
  const n = rows[0]?.values.length ?? 1
  const barW = Math.max(4, Math.min(16, (slot - 10 - (n - 1) * 2) / n))
  const groupW = n * barW + (n - 1) * 2
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const ticks = [0, max / 2, max]

  return (
    <div style={{ position: 'relative' }} onPointerLeave={() => setActive(null)}>
      <svg key={animKey} viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="Monthly bar chart" style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, ti) => (
          <g key={t}>
            <line className="bc-grid" style={{ animationDelay: `${ti * 90}ms` }} x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--divider)" strokeWidth={1} />
            <text className="bc-tick" style={{ animationDelay: `${ti * 90 + 150}ms` }} x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-45)">{formatPriceCompact(t).replace(/\.00$/, '')}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x0 = padL + i * slot + (slot - groupW) / 2
          return (
            <g key={i}>
              {active === i && <rect className="bc-hl" x={padL + i * slot + 2} y={padT} width={slot - 4} height={plotH} rx={6} fill="rgba(var(--fg), .05)" />}
              {r.values.map((v, j) => {
                const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH)
                const x = x0 + j * (barW + 2)
                const top = padT + plotH - h
                const rr = Math.min(4, barW / 2, h)
                // rounded data-end, square baseline
                return h > 0 && <path key={j} className={`bc-bar${active === i ? ' on' : ''}`} style={{ animationDelay: `${300 + i * 55 + j * 35}ms` }} fill={colors[j]} opacity={active === null || active === i ? 1 : 0.45}
                  d={`M${x},${padT + plotH} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${padT + plotH} Z`} />
              })}
              <text x={padL + i * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize={10} fill={active === i ? 'var(--text)' : 'var(--text-45)'}>{r.label}</text>
              <rect x={padL + i * slot} y={0} width={slot} height={height} fill="transparent"
                onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
            </g>
          )
        })}
      </svg>
      {active !== null && (
        <div className="small bc-tip" style={{
          position: 'absolute', top: 0, pointerEvents: 'none', zIndex: 2, minWidth: 130,
          left: `${Math.min(68, Math.max(0, ((padL + active * slot + slot / 2) / W) * 100 - 20))}%`,
          background: 'var(--dialog)', border: '1px solid var(--card-border)', borderRadius: 12, padding: '8px 10px', boxShadow: '0 6px 24px rgba(0,0,0,.25)', lineHeight: 1.5,
        }}>{tooltip(active)}</div>
      )}
    </div>
  )
}
