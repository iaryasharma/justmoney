import { useEffect, useRef, useState } from 'react'
import { buzz, Icon } from '../ui/ui'
import { formatBytes, groupSizes } from '../../lib/backup/backupScope'

type Stage = 'confirm' | 'prepare' | 'delete' | 'finish' | 'done' | 'failed'
const CAPTION: Record<string, string> = { prepare: 'Looking through your data…', delete: 'Removing records and settings…', finish: 'This may take a few moments…' }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const Glyph = ({ k }: { k: 'img' | 'person' | 'doc' | 'gear' | 'folder' }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {k === 'img' && <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4 4 3 3-2 4 3" /></>}
    {k === 'person' && <><circle cx="12" cy="9" r="3.2" /><path d="M5.5 19c1-3.4 3.6-5 6.5-5s5.5 1.6 6.5 5" /></>}
    {k === 'doc' && <><path d="M7 4h7l4 4v12H7z" /><path d="M14 4v4h4M10 13h5M10 16h5" /></>}
    {k === 'gear' && <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>}
    {k === 'folder' && <path d="M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" />}
  </svg>
)

const Bin = ({ lid }: { lid?: boolean }) => (
  <svg className="dl-bin" viewBox="0 0 100 120" width="112" height="134">
    <defs><linearGradient id="dlb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="color-mix(in srgb, var(--accent) 70%, #fff)" stopOpacity=".95" /><stop offset="1" stopColor="color-mix(in srgb, var(--accent-deep) 93%, #000)" stopOpacity=".7" /></linearGradient></defs>
    <g className={lid ? 'dl-lid open' : 'dl-lid'}>
      <rect x="14" y="20" width="72" height="10" rx="4" fill="url(#dlb)" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeOpacity=".7" strokeWidth="1.6" />
      <rect x="38" y="12" width="24" height="9" rx="3" fill="url(#dlb)" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeOpacity=".7" strokeWidth="1.6" />
    </g>
    <path d="M20 34h60l-5 74a8 8 0 01-8 7H33a8 8 0 01-8-7z" fill="url(#dlb)" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeOpacity=".7" strokeWidth="1.6" />
    <path d="M40 48v52M50 48v52M60 48v52" stroke="#ede9fe" strokeOpacity=".4" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)

/**
 * Deleting everything, in five stages: what will go (with a clear button), preparing, deleting, finalizing, done. Nothing is removed until
 * "Delete My Data" is pressed. `work` does the real deletion; the last stage waits for it. `onFinished` runs when Done is pressed.
 */
export function DeleteRun({ work, onFinished, onCancel }: { work: () => Promise<void>; onFinished: () => void; onCancel: () => void }) {
  const [stage, setStage] = useState<Stage>('confirm')
  const [p, setP] = useState(0)
  const [error, setError] = useState('')
  const [sizes] = useState(() => groupSizes({}))
  const target = useRef(0)
  const k = reduced() ? 0.25 : 1

  const start = () => {
    buzz(18)
    let live = true
    const started = Date.now()
    let done: 'ok' | string | null = null
    work().then(() => { done = 'ok' }).catch((e) => { done = (e as Error)?.message || 'Something went wrong.' })
    const at = (ms: number, f: () => void) => setTimeout(() => { if (live) f() }, ms * k)
    setStage('prepare'); target.current = 26
    at(1700, () => { setStage('delete'); target.current = 70; buzz(8) })
    at(3600, () => { setStage('finish'); target.current = 95; buzz(8) })
    const wait = setInterval(() => {
      if (!live || done === null || Date.now() - started < 5600 * k) return
      clearInterval(wait)
      if (done === 'ok') { target.current = 100; setTimeout(() => { if (live) { setStage('done'); buzz([16, 50, 30]) } }, 450) }
      else { setError(done); setStage('failed'); buzz([70, 50, 70]) }
    }, 120)
    let last = Date.now() // paced by real time, so a slow or throttled screen still shows true progress
    const glide = setInterval(() => { const now = Date.now(); const dt = Math.min(now - last, 2000); last = now; setP((v) => (v < target.current ? Math.min(target.current, v + (target.current - v) * (1 - Math.exp(-dt / 700)) + dt * 0.004) : v)) }, 60)
    cleanup.current = () => { live = false; clearInterval(wait); clearInterval(glide) }
  }
  const cleanup = useRef<() => void>(() => {})
  useEffect(() => () => cleanup.current(), [])

  const title = { confirm: 'Delete Your Data?', prepare: 'Preparing Deletion', delete: 'Deleting Data', finish: 'Finalizing', done: 'Your Data Has Been Deleted', failed: 'Could Not Finish' }[stage]
  const sub = {
    confirm: 'This will permanently remove all your data from this phone. It cannot be undone.',
    prepare: 'Identifying and collecting your data…', delete: 'Permanently removing your data from this phone…', finish: 'Cleaning up remaining references…',
    done: 'Everything has been permanently removed from this phone.', failed: error,
  }[stage]
  const pct = Math.round(p)
  const closable = stage === 'confirm' || stage === 'done' || stage === 'failed'

  return (
    <div className={`bk-screen dl-screen dl-${stage}`} role="dialog" aria-label="Delete all data">
      <button className="icon-btn bk-close" onClick={stage === 'confirm' ? onCancel : closable ? onFinished : undefined} aria-label={stage === 'confirm' ? 'Back' : 'Close'} style={{ opacity: closable ? 1 : 0.35 }}><Icon name={stage === 'done' || stage === 'failed' ? 'close' : 'back'} size={20} /></button>
      <div className="bk-body">
        <div className="bk-art" aria-hidden="true">
          <div className="bk-glow" />
          {stage === 'confirm' && <>
            <div className="bk-float f1"><Glyph k="img" /></div><div className="bk-float f2"><Glyph k="doc" /></div><div className="bk-float f3"><Glyph k="gear" /></div>
            <Bin />
          </>}
          {stage === 'prepare' && <>
            <span className="bk-orbit o1" /><span className="bk-orbit o2" />
            <div className="bk-ring"><div className="bk-tile t1"><Glyph k="person" /></div><div className="bk-tile t2"><Glyph k="gear" /></div><div className="bk-tile t3"><Glyph k="folder" /></div><div className="bk-tile t4"><Glyph k="img" /></div></div>
            <Bin />
          </>}
          {stage === 'delete' && <>
            <span className="dl-drop d1"><Glyph k="img" /></span><span className="dl-drop d2"><Glyph k="doc" /></span><span className="dl-drop d3"><Glyph k="person" /></span><span className="dl-drop d4"><Glyph k="doc" /></span>
            <span className="bk-beams" />
            <Bin lid />
          </>}
          {stage === 'finish' && <div className="dl-dissolve"><Bin />{Array.from({ length: 14 }, (_, i) => <i key={i} className="dl-shard" style={{ ['--a' as string]: `${(i / 14) * 360}deg`, ['--d' as string]: `${46 + (i % 4) * 18}px`, animationDelay: `${(i % 5) * 120}ms` }} />)}</div>}
          {stage === 'done' && (
            <svg className="bk-check" viewBox="0 0 120 120" width="150" height="150" fill="none">
              <circle cx="60" cy="60" r="46" stroke="color-mix(in srgb, var(--accent) 70%, #fff)" strokeWidth="5" />
              <path className="sa-tick" d="M40 62l15 15 27-30" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {stage === 'failed' && <svg viewBox="0 0 120 120" width="140" height="140" fill="none"><circle cx="60" cy="60" r="46" stroke="#f87171" strokeWidth="5" /><path d="M60 38v28M60 80v1" stroke="#fff" strokeWidth="7" strokeLinecap="round" /></svg>}
        </div>

        <div className="bk-head" key={stage}><h1 className="bk-title">{title}</h1><div className="bk-sub">{sub}</div></div>

        {stage === 'confirm' && (
          <ol className="scan-card bk-card">
            {sizes.slice(0, 5).map((g) => (
              <li key={g.id} className="scan-row"><span className="scan-label">{g.label}</span><span className="bk-size">{formatBytes(g.bytes)}</span></li>
            ))}
            {sizes.length === 0 && <li className="scan-row"><span className="scan-label">Nothing saved yet</span></li>}
          </ol>
        )}
        {(stage === 'prepare' || stage === 'delete' || stage === 'finish') && (
          <>
            <div className="bk-prog"><div className="bk-track"><i style={{ width: `${pct}%` }} /></div><b className="num">{pct}%</b></div>
            <div className="bk-cap">{CAPTION[stage]}</div>
          </>
        )}
        {stage === 'done' && (
          <ol className="scan-card bk-card stagger">
            {['Transactions and accounts', 'Plans, goals and people', 'App settings and lock'].map((r) => (
              <li key={r} className="scan-row ok"><span className="scan-label">{r}</span><span className="scan-state"><Icon name="check" size={14} stroke={3} /></span></li>
            ))}
          </ol>
        )}
      </div>
      <div className="scan-foot">
        {stage === 'confirm' && <button className="scan-btn dl-danger" onClick={start}>Delete My Data</button>}
        {stage === 'confirm' && <button className="scan-btn ghost" style={{ marginTop: 10 }} onClick={onCancel}>Keep my data</button>}
        {(stage === 'done' || stage === 'failed') && <button className="scan-btn" onClick={onFinished}>{stage === 'done' ? 'Done' : 'Close'}</button>}
        {(stage === 'prepare' || stage === 'delete' || stage === 'finish') && <div style={{ height: 54 }} />}
      </div>
    </div>
  )
}
