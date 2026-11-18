import { useEffect, useRef, useState } from 'react'
import { buzz, Icon } from '../ui/ui'
import { formatBytes, groupSizes } from '../../lib/backup/backupScope'

type Stage = 'prepare' | 'scan' | 'create' | 'finish' | 'done' | 'failed'
const FILES = ['Transactions', 'Accounts and plan', 'People and loans', 'App preferences']
const CAPTION: Record<string, string> = { scan: 'Scanning your data…', create: 'Encrypting and saving…', finish: 'Almost done…' }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A tiny glyph for the floating and orbiting tiles. */
export const Glyph = ({ k }: { k: 'img' | 'person' | 'doc' | 'play' | 'gear' | 'folder' }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {k === 'img' && <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4 4 3 3-2 4 3" /></>}
    {k === 'person' && <><circle cx="12" cy="9" r="3.2" /><path d="M5.5 19c1-3.4 3.6-5 6.5-5s5.5 1.6 6.5 5" /></>}
    {k === 'doc' && <><path d="M7 4h7l4 4v12H7z" /><path d="M14 4v4h4M10 13h5M10 16h5" /></>}
    {k === 'gear' && <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>}
    {k === 'folder' && <path d="M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" />}
    {k === 'play' && <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M10.5 9.5v5l4-2.5z" /></>}
  </svg>
)

export const Folder = () => (
  <svg className="bk-folder" viewBox="0 0 120 100" width="150" height="125">
    <defs><linearGradient id="bkf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="color-mix(in srgb, var(--accent) 70%, #fff)" /><stop offset="1" stopColor="color-mix(in srgb, var(--accent-deep) 93%, #000)" /></linearGradient></defs>
    <path d="M10 26a8 8 0 018-8h24l10 10h42a8 8 0 018 8v46a8 8 0 01-8 8H18a8 8 0 01-8-8z" fill="url(#bkf)" opacity=".55" />
    <path d="M8 40a8 8 0 018-8h88a8 8 0 018 8l-6 44a8 8 0 01-8 7H22a8 8 0 01-8-7z" fill="url(#bkf)" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeWidth="1.6" strokeOpacity=".7" />
  </svg>
)

export const Cloud = ({ shield, down }: { shield?: boolean; down?: boolean }) => (
  <svg className="bk-cloud" viewBox="0 0 140 100" width="170" height="122" fill="none" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M38 80a22 22 0 01-2-43 30 30 0 0158-6 26 26 0 018 49z" fill="color-mix(in srgb, var(--accent) 18%, transparent)" />
    {shield
      ? <><path d="M70 36l16 6v12c0 12-7 20-16 24-9-4-16-12-16-24V42z" strokeWidth="4" /><path d="M63 56l5 5 9-10" strokeWidth="4" /></>
      : <path className="bk-arrow" d={down ? 'M70 44v30M58 63l12 12 12-12' : 'M70 74V44M58 55l12-12 12 12'} />}
  </svg>
)

/**
 * The backup, shown in five stages: preparing, scanning, creating, finalizing, done. `work` does the real backup;
 * the stages play at a steady pace and the last one waits for it to finish.
 */
export function BackupRun({ work, onClose }: { work: () => Promise<{ ok: boolean; message?: string }>; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('prepare')
  const [p, setP] = useState(0)
  const [rows, setRows] = useState(0) // how many of the four preparing rows are ticked
  const [error, setError] = useState('')
  const [sizes] = useState(() => groupSizes())
  const result = useRef<{ ok: boolean; message?: string } | null>(null)
  const target = useRef(0)
  const k = reduced() ? 0.25 : 1

  useEffect(() => {
    let live = true
    const started = Date.now()
    work().then((r) => { result.current = r }).catch((e) => { result.current = { ok: false, message: (e as Error)?.message || 'The backup did not finish.' } })
    const at = (ms: number, f: () => void) => setTimeout(() => { if (live) f() }, ms * k)
    const timers = [
      at(380, () => setRows(1)), at(760, () => setRows(2)), at(1140, () => setRows(3)), at(1520, () => setRows(4)),
      at(1900, () => { setStage('scan'); target.current = 38; buzz(8) }),
      at(3600, () => { setStage('create'); target.current = 74; buzz(8) }),
      at(5300, () => { setStage('finish'); target.current = 96; buzz(8) }),
    ]
    // the last stage waits for the real backup, then completes
    const wait = setInterval(() => {
      if (!live || !result.current) return
      if (Date.now() - started < 6800 * k) return
      clearInterval(wait)
      if (result.current.ok) { target.current = 100; setTimeout(() => { if (live) { setStage('done'); buzz([12, 40, 24]) } }, 450) }
      else { setError(result.current.message ?? 'The backup did not finish.'); setStage('failed'); buzz([70, 50, 70]) }
    }, 120)
    let last = Date.now() // paced by real time, so a slow or throttled screen still shows true progress
    const glide = setInterval(() => { const now = Date.now(); const dt = Math.min(now - last, 2000); last = now; setP((v) => (v < target.current ? Math.min(target.current, v + (target.current - v) * (1 - Math.exp(-dt / 700)) + dt * 0.004) : v)) }, 60)
    return () => { live = false; timers.forEach(clearTimeout); clearInterval(wait); clearInterval(glide) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const title = { prepare: 'Preparing Backup', scan: 'Scanning Your Data', create: 'Creating Backup', finish: 'Finalizing', done: 'Backup Created', failed: 'Backup Failed' }[stage]
  const sub = { prepare: 'Gathering your data…', scan: 'Analyzing and organizing your data…', create: 'Encrypting and saving your backup…', finish: 'Verifying the backup…', done: 'Your data is safe and secure', failed: error }[stage]
  const pct = Math.round(p)
  const closable = stage === 'done' || stage === 'failed'

  return (
    <div className={`bk-screen bk-${stage}`} role="dialog" aria-label="Backup">
      <button className="icon-btn bk-close" onClick={closable ? onClose : undefined} aria-label="Close" style={{ opacity: closable ? 1 : 0.35 }}><Icon name={closable ? 'close' : 'back'} size={20} /></button>
      <div className="bk-body">
        <div className="bk-art" aria-hidden="true">
          <div className="bk-glow" />
          {stage === 'prepare' && <>
            <div className="bk-float f1"><Glyph k="img" /></div><div className="bk-float f2"><Glyph k="person" /></div><div className="bk-float f3"><Glyph k="doc" /></div>
            <Folder />
          </>}
          {stage === 'scan' && <>
            <span className="bk-orbit o1" /><span className="bk-orbit o2" />
            <div className="bk-ring"><div className="bk-tile t1"><Glyph k="img" /></div><div className="bk-tile t2"><Glyph k="doc" /></div><div className="bk-tile t3"><Glyph k="person" /></div><div className="bk-tile t4"><Glyph k="play" /></div></div>
            <Folder />
          </>}
          {stage === 'create' && <><span className="bk-beams" /><Cloud /></>}
          {stage === 'finish' && <>
            <svg className="bk-arc" viewBox="0 0 200 200"><circle cx="100" cy="100" r="92" pathLength="100" strokeDasharray={`${Math.max(6, pct)} 100`} /></svg>
            <span className="bk-orbit o1" /><Cloud shield />
          </>}
          {stage === 'done' && (
            <svg className="bk-check" viewBox="0 0 120 120" width="150" height="150" fill="none">
              <circle cx="60" cy="60" r="46" stroke="color-mix(in srgb, var(--accent) 70%, #fff)" strokeWidth="5" />
              <path className="sa-tick" d="M40 62l15 15 27-30" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {stage === 'failed' && <svg viewBox="0 0 120 120" width="140" height="140" fill="none"><circle cx="60" cy="60" r="46" stroke="#f87171" strokeWidth="5" /><path d="M60 38v28M60 80v1" stroke="#fff" strokeWidth="7" strokeLinecap="round" /></svg>}
        </div>

        <div className="bk-head" key={stage}><h1 className="bk-title">{title}</h1><div className="bk-sub">{sub}</div></div>

        {stage === 'prepare' && (
          <ol className="scan-card bk-card">
            {FILES.map((f, i) => (
              <li key={f} className={`scan-row ${i < rows ? 'ok' : i === rows ? 'active' : 'wait'}`}>
                <span className="scan-label">{f}</span>
                <span className="scan-state">{i < rows ? <Icon name="check" size={14} stroke={3} /> : i === rows ? <i className="scan-ring" /> : <i className="scan-wait" />}</span>
              </li>
            ))}
          </ol>
        )}
        {(stage === 'scan' || stage === 'create' || stage === 'finish') && (
          <>
            <div className="bk-prog"><div className="bk-track"><i style={{ width: `${pct}%` }} /></div><b className="num">{pct}%</b></div>
            <div className="bk-cap">{CAPTION[stage]}</div>
          </>
        )}
        {stage === 'done' && (
          <ol className="scan-card bk-card stagger">
            {sizes.slice(0, 5).map((g) => (
              <li key={g.id} className="scan-row ok"><span className="scan-label">{g.label}</span><span className="bk-size">{formatBytes(g.bytes)}</span><span className="scan-state"><Icon name="check" size={14} stroke={3} /></span></li>
            ))}
          </ol>
        )}
      </div>
      <div className="scan-foot">
        {closable ? <button className="scan-btn" onClick={onClose}>{stage === 'done' ? 'Done' : 'Close'}</button> : <div style={{ height: 54 }} />}
      </div>
    </div>
  )
}
