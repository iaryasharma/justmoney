import { useEffect, useRef, useState } from 'react'
import { Icon, Sheet, SheetHeader } from '../components/ui/ui'
import { formatPrice } from '../lib/core/format'
import { investmentResult } from '../lib/invest/invest'
import { fetchChart, type ChartData, type ChartRange } from '../lib/invest/prices'
import type { Investment } from '../lib/core/types'

const RANGES: ChartRange[] = ['1D', '5D', '1M', '6M', '1Y', '5Y']
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const gain = (n: number) => (n > 0 ? 'var(--credit)' : n < 0 ? 'var(--danger)' : 'var(--text-60)')
const money = (n: number) => formatPrice(n, { round: true })

/** One share: price now, a chart for the range you choose, and how your position is doing. */
export function StockSheet({ inv, onClose, onEditPrice }: { inv: Investment; onClose: () => void; onEditPrice: () => void }) {
  const [range, setRange] = useState<ChartRange>('1D')
  const [data, setData] = useState<ChartData | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const r = investmentResult(inv)
  const avg = inv.units && inv.invested ? inv.invested / inv.units : null

  useEffect(() => {
    let alive = true
    const load = () => fetchChart(inv.symbol!, inv.exchange ?? 'NSE', range).then((d) => { if (!alive) return; if (d) { setData(d); setState('ok') } else setState((s) => (s === 'ok' ? s : 'error')) })
    setState('loading'); setData(null)
    load()
    const id = range === '1D' ? window.setInterval(load, 30_000) : undefined
    return () => { alive = false; if (id) window.clearInterval(id) }
  }, [inv.symbol, inv.exchange, range])

  const first = data?.points[0]?.c
  const base = range === '1D' && data?.prev ? data.prev : first
  const change = data && base ? data.price - base : 0
  const changePct = data && base ? (change / base) * 100 : 0

  return (
    <Sheet open onClose={onClose} full>
      <SheetHeader title={inv.name} sub={`${inv.symbol} · ${inv.exchange ?? 'NSE'}${state === 'ok' && range === '1D' ? ' · updates every 30s' : ''}`} onClose={onClose} />
      <div className="num" style={{ fontSize: 34, fontWeight: 800 }}>{data ? `₹${data.price.toFixed(2)}` : '—'}</div>
      {data && <div className="small" style={{ color: gain(change), marginBottom: 10 }}>{change >= 0 ? '+' : '-'}₹{Math.abs(change).toFixed(2)} ({pct(changePct)}) {range === '1D' ? 'today' : `over ${range}`}</div>}

      <LiveChart data={data} state={state} color={gain(change)} avg={avg} />

      <div className="segmented" style={{ marginTop: 12 }}>
        {RANGES.map((x) => <button key={x} className={range === x ? 'on' : ''} onClick={() => setRange(x)}>{x}</button>)}
      </div>

      <div className="section-label">Your position</div>
      <div className="card">
        {[
          ['Shares', inv.units ? `${+inv.units.toFixed(4)}` : 'Not set'],
          ['Average cost', avg ? `₹${avg.toFixed(2)}` : '—'],
          ['Invested', money(r.put)],
          ['Worth now', money(r.worth)],
          [r.profit >= 0 ? 'Profit' : 'Loss', `${money(Math.abs(r.profit))} (${pct(r.pct)})`],
          ['Held for', `${r.days} day${r.days === 1 ? '' : 's'}${r.perYear != null ? ` · ${pct(r.perYear * 100)}/yr` : ''}`],
        ].map(([k, v]) => (
          <div key={k} className="list-row"><span className="muted small">{k}</span><span className="grow" style={{ textAlign: 'right', fontWeight: 600, color: k === 'Profit' || k === 'Loss' ? gain(r.profit) : undefined }}>{v}</span></div>
        ))}
      </div>
      <button className="btn block" style={{ marginTop: 12 }} onClick={onEditPrice}><Icon name="edit" size={18} />Change ticker or shares</button>
    </Sheet>
  )
}

/** A line chart with an area fill, your average cost as a dashed line, and a finger scrubber. */
function LiveChart({ data, state, color, avg }: { data: ChartData | null; state: 'loading' | 'ok' | 'error'; color: string; avg: number | null }) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const W = 320, H = 170, padX = 4, padT = 10, padB = 14
  if (!data) return <div className="card pad empty small" style={{ height: H }}>{state === 'error' ? 'No chart for this ticker. Check the ticker and exchange.' : 'Loading chart…'}</div>
  const pts = data.points
  const cs = pts.map((p) => p.c)
  const lo = Math.min(...cs, ...(avg ? [avg] : [])), hi = Math.max(...cs, ...(avg ? [avg] : []))
  const span = hi - lo || 1
  const x = (i: number) => padX + (i / (pts.length - 1)) * (W - padX * 2)
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.c).toFixed(1)}`).join(' ')
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`
  const at = hover != null ? pts[hover] : null
  const move = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - box.left) / box.width) * (pts.length - 1)))))
  }
  return (
    <div className="card pad" style={{ padding: 10 }}>
      <div className="small num" style={{ height: 20, color: 'var(--text-60)' }}>
        {at ? `₹${at.c.toFixed(2)} · ${new Date(at.t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : `High ₹${Math.max(...cs).toFixed(2)} · Low ₹${Math.min(...cs).toFixed(2)}`}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }} role="img" aria-label="Price chart"
        onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} onPointerUp={() => setHover(null)}>
        <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path className="lc-area" d={area} fill="url(#chartFill)" />
        <path className="lc-line" pathLength={1} d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {avg != null && <><line x1={padX} x2={W - padX} y1={y(avg)} y2={y(avg)} stroke="var(--text-45)" strokeWidth="1" strokeDasharray="4 4" /><text x={W - padX} y={y(avg) - 4} textAnchor="end" fontSize="9" fill="var(--text-60)">your cost</text></>}
        {hover != null && <><line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--text-45)" strokeWidth="1" /><circle cx={x(hover)} cy={y(pts[hover].c)} r="4" fill={color} /></>}
      </svg>
    </div>
  )
}
