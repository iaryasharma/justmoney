import { useRef, useState } from 'react'
import { Sheet, SheetHeader } from '../ui/ui'
import { bottleTarget, pickSeat } from '../../lib/split/bottle'

/** Bottle looks: glass, label and cap colours. */
const BOTTLES = {
  classic: { name: 'Classic', glass: '#2E7D32', label: '#F3E9D2', cap: '#C9A227' },
  cola: { name: 'Cola', glass: '#4A2418', label: '#E53935', cap: '#E53935' },
  water: { name: 'Water', glass: '#7FB8E6', label: '#FFFFFF', cap: '#1565C0' },
  wine: { name: 'Wine', glass: '#5B0F1E', label: '#EFE6D8', cap: '#3B0A14' },
  soju: { name: 'Soju', glass: '#5DBB63', label: '#FFFFFF', cap: '#2E7D32' },
} as const
type BottleKind = keyof typeof BOTTLES

function Bottle({ kind }: { kind: BottleKind }) {
  const b = BOTTLES[kind]
  return (
    <svg viewBox="0 0 40 120" width="40" height="120" aria-hidden>
      <rect x="14" y="0" width="12" height="9" rx="2" fill={b.cap} />
      <path d="M15 8 L25 8 L25 34 C25 42 34 46 34 56 L34 112 Q34 118 28 118 L12 118 Q6 118 6 112 L6 56 C6 46 15 42 15 34 Z" fill={b.glass} />
      <rect x="6" y="68" width="28" height="26" fill={b.label} />
      <rect x="10" y="50" width="3" height="60" rx="1.5" fill="#fff" opacity=".25" />
    </svg>
  )
}

const TABLE = 280, RADIUS = 116
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Spin the bottle: the people at the table sit in a circle, and the bottle's neck picks who pays. */
export default function BottleSpin({ open, onClose, names }: { open: boolean; onClose: () => void; names: string[] }) {
  const [table, setTable] = useState<string[]>(() => names.slice(0, 10))
  const [kind, setKind] = useState<BottleKind>('classic')
  const [rot, setRot] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState<number | null>(null)
  const [extra, setExtra] = useState('')
  const target = useRef(0)
  const everyone = [...new Set([...names, ...table])]
  const n = table.length

  const toggle = (name: string) => {
    if (spinning) return
    setWinner(null)
    setTable((t) => (t.includes(name) ? t.filter((x) => x !== name) : t.length >= 10 ? t : [...t, name]))
  }
  const add = () => {
    const name = extra.trim()
    if (!name || table.includes(name) || table.length >= 10) return
    setTable([...table, name]); setExtra(''); setWinner(null)
  }
  const spin = () => {
    if (spinning || n < 2) return
    const seat = pickSeat(n)
    target.current = seat
    setWinner(null)
    setSpinning(true)
    setRot((r) => bottleTarget(r, seat, n, reduceMotion() ? 1 : 5, Math.random() - 0.5))
  }
  const done = () => {
    if (!spinning) return
    setSpinning(false)
    setWinner(target.current)
    navigator.vibrate?.(30)
  }
  const who = winner === null ? null : table[winner]

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="Who pays?" sub="Spin the bottle. Whoever the neck points at pays this round." onClose={onClose} />

      <div className="label" style={{ marginBottom: 8 }}>Who's at the table?</div>
      <div className="row wrap" style={{ gap: 8 }}>
        {everyone.map((name) => <button key={name} className={`chip${table.includes(name) ? ' on' : ''}`} onClick={() => toggle(name)}>{name}</button>)}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input className="input grow" placeholder="Add a name" value={extra} maxLength={24} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <button className="btn sm secondary" disabled={!extra.trim()} onClick={add}>Add</button>
      </div>

      <div style={{ position: 'relative', width: TABLE, height: TABLE, margin: '20px auto 8px' }}>
        <div style={{ position: 'absolute', inset: 28, borderRadius: '50%', background: 'rgba(var(--fg), .05)', border: '1px solid rgba(var(--fg), .08)' }} />
        {table.map((name, i) => {
          const a = (i * 2 * Math.PI) / n
          const on = winner === i
          return (
            <span key={name} className="ellipsis" style={{
              position: 'absolute', left: TABLE / 2 + RADIUS * Math.sin(a), top: TABLE / 2 - RADIUS * Math.cos(a), transform: 'translate(-50%, -50%)',
              maxWidth: 84, padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              background: on ? 'var(--accent)' : 'var(--card)', color: on ? '#fff' : 'var(--text)', border: '1px solid var(--card-border)',
              transition: 'background .2s, color .2s',
            }}>{name.split(" ")[0]}</span>
          )
        })}
        <button aria-label="Spin the bottle" onClick={spin} onTransitionEnd={done} disabled={n < 2}
          style={{
            position: 'absolute', left: TABLE / 2 - 20, top: TABLE / 2 - 60, width: 40, height: 120,
            transform: `rotate(${rot}deg)`, transformOrigin: '50% 50%',
            transition: spinning ? `transform ${reduceMotion() ? 0.3 : 3.4}s cubic-bezier(.15, .7, .15, 1)` : 'none',
          }}>
          <Bottle kind={kind} />
        </button>
      </div>

      <div style={{ textAlign: 'center', minHeight: 28, fontSize: 17, fontWeight: 700 }} aria-live="polite">
        {spinning ? <span className="dim">Spinning…</span> : who ? (who === 'You' ? 'You pay this round' : `${who} pays this round`) : n < 2 ? <span className="dim small">Pick at least two people</span> : null}
      </div>

      <div className="chips" style={{ justifyContent: 'center', margin: '12px 0 16px' }}>
        {(Object.keys(BOTTLES) as BottleKind[]).map((k) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} disabled={spinning} onClick={() => setKind(k)}>{BOTTLES[k].name}</button>)}
      </div>

      <button className="btn block" disabled={spinning || n < 2} onClick={spin}>{who ? 'Spin again' : 'Spin'}</button>
    </Sheet>
  )
}
