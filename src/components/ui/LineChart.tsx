import { useRef, useState } from 'react'

export interface LinePoint { label: string; value: number; /** worked out from what happened since, not recorded at the time */ est?: boolean }

const W = 320
const H = 170
const PAD = { l: 8, r: 8, t: 14, b: 22 }

/** A line chart that draws itself in, then lets a finger or the pointer read any point. */
export function LineChart({ points, color = 'var(--accent)', format, height = H }: { points: LinePoint[]; color?: string; format: (v: number) => string; height?: number }) {
  const [at, setAt] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  if (points.length < 2) return null
  const vals = points.map((p) => p.value)
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || Math.max(1, Math.abs(hi))
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (height - PAD.t - PAD.b)
  // a smooth line through the points
  const d = points.map((p, i) => {
    if (i === 0) return `M${x(0)} ${y(p.value)}`
    const cx = (x(i - 1) + x(i)) / 2
    return `C${cx} ${y(points[i - 1].value)} ${cx} ${y(p.value)} ${x(i)} ${y(p.value)}`
  }).join(' ')
  const area = `${d} L${x(points.length - 1)} ${height - PAD.b} L${x(0)} ${height - PAD.b} Z`
  const zero = lo < 0 && hi > 0 ? y(0) : null
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    setAt(Math.round(f * (points.length - 1)))
  }
  const cur = at ?? points.length - 1
  const tipLeft = Math.min(78, Math.max(22, (x(cur) / W) * 100))
  return (
    <div className="lc" style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }} role="img" aria-label={`Line chart, latest ${format(points[points.length - 1].value)}`}
        onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') pick(e.clientX) }} onPointerLeave={() => setAt(null)} onPointerUp={() => setAt(null)}>
        <defs>
          <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".32" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
        </defs>
        {zero != null && <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="currentColor" strokeOpacity=".2" strokeDasharray="3 4" />}
        <path className="lc-area" d={area} fill="url(#lc-fill)" />
        <path className="lc-line" d={d} pathLength={1} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} className="lc-dot" cx={x(i)} cy={y(p.value)} r={i === cur ? 5 : 3} fill={p.est ? 'var(--bg)' : color} stroke={color} strokeWidth="1.8" style={{ animationDelay: `${600 + i * 60}ms` }} />
        ))}
        {at != null && <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={height - PAD.b} stroke={color} strokeOpacity=".4" />}
        <text x={PAD.l} y={height - 6} className="lc-axis">{points[0].label}</text>
        <text x={W - PAD.r} y={height - 6} className="lc-axis" textAnchor="end">{points[points.length - 1].label}</text>
      </svg>
      <div className="lc-tip" style={{ left: `${tipLeft}%` }}>
        <b className="num">{format(points[cur].value)}</b><span>{points[cur].label}{points[cur].est ? ' · estimated' : ''}</span>
      </div>
    </div>
  )
}
