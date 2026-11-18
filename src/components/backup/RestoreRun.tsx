import { useEffect, useRef, useState } from 'react'
import { buzz, Icon } from '../ui/ui'
import { Cloud, Folder, Glyph } from './BackupRun'
import { askPassword } from './BackupPassword'
import { restoreFromText } from '../../lib/backup/backup'
import { formatBytes, groupSizes } from '../../lib/backup/backupScope'

type Stage = 'select' | 'prepare' | 'process' | 'restore' | 'done' | 'failed'
type Choice = 'latest' | 'file'
const CAPTION: Record<string, string> = { prepare: 'Reading your backup…', process: 'Decrypting and organizing…', restore: 'Adding your data back…' }
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const when = (ts?: number | null) => (ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null)

/**
 * Restoring from a backup, in five stages: choose the backup, preparing, processing, restoring, done. A restore only adds what is missing.
 * The stages play at a steady pace but stand still while the password box is open, and the last one waits for the real restore.
 */
export function RestoreRun({ latest, latestAt, requireAuth, onClose }: {
  latest: string | null; latestAt?: number | null; requireAuth: () => Promise<boolean>; onClose: () => void
}) {
  const [stage, setStage] = useState<Stage>('select')
  const [choice, setChoice] = useState<Choice>(latest ? 'latest' : 'file')
  const [p, setP] = useState(0)
  const [error, setError] = useState('')
  const [added, setAdded] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const target = useRef(0)
  const paused = useRef(false)
  const cleanup = useRef<() => void>(() => {})
  const k = reduced() ? 0.25 : 1
  useEffect(() => () => cleanup.current(), [])

  const run = (read: () => Promise<string>) => {
    buzz(14)
    let live = true
    let elapsed = 0
    let outcome: { added: number } | string | null = null
    setStage('prepare'); target.current = 30; setError('')
    read()
      .then((text) => restoreFromText(text, async () => { paused.current = true; try { return await askPassword('This backup is password protected. Enter its backup password.') } finally { paused.current = false } }))
      .then((r) => { outcome = { added: r.added } })
      .catch((e) => { outcome = (e as Error)?.message || 'That file is not a valid JustMoney backup.' })
    let last = Date.now()
    const tick = setInterval(() => {
      const now = Date.now(); const dt = Math.min(now - last, 2000); last = now
      if (!live) return
      if (!paused.current) elapsed += dt
      setP((v) => (v < target.current ? Math.min(target.current, v + (target.current - v) * (1 - Math.exp(-dt / 700)) + dt * 0.004) : v))
      if (elapsed > 1700 * k && target.current < 68) { setStage('process'); target.current = 68; buzz(8) }
      if (elapsed > 3600 * k && target.current < 95) { setStage('restore'); target.current = 95; buzz(8) }
      if (outcome === null || elapsed < 5400 * k) return
      live = false
      if (typeof outcome === 'string') {
        if (outcome === 'cancelled') { setStage('select'); setP(0); target.current = 0 } else { setError(outcome); setStage('failed'); buzz([70, 50, 70]) }
      } else {
        const r = outcome
        target.current = 100
        setTimeout(() => { setAdded(r.added); setStage('done'); buzz([16, 50, 30]) }, 450)
      }
    }, 60)
    cleanup.current = () => { live = false; clearInterval(tick) }
  }

  const next = async () => {
    if (!(await requireAuth())) return
    if (choice === 'latest' && latest) run(async () => latest)
    else fileRef.current?.click()
  }

  const title = { select: 'Restore from Backup', prepare: 'Preparing Restore', process: 'Processing Data', restore: 'Restoring Data', done: 'Restore Completed', failed: 'Could Not Restore' }[stage]
  const sub = {
    select: 'Select a backup to restore your data…', prepare: 'Reading your backup…', process: 'Verifying and preparing your data…', restore: 'Applying your data and settings…',
    done: added > 0 ? 'Your data has been successfully restored' : 'Everything in this backup was already here', failed: error,
  }[stage]
  const pct = Math.round(p)
  const busy = stage === 'prepare' || stage === 'process' || stage === 'restore'

  return (
    <div className={`bk-screen rs-screen rs-${stage}`} role="dialog" aria-label="Restore from a backup">
      <button className="icon-btn bk-close" onClick={busy ? undefined : onClose} aria-label={stage === 'done' || stage === 'failed' ? 'Close' : 'Back'} style={{ opacity: busy ? 0.35 : 1 }}><Icon name={stage === 'done' || stage === 'failed' ? 'close' : 'back'} size={20} /></button>
      <div className="bk-body">
        <div className="bk-art" aria-hidden="true">
          <div className="bk-glow" />
          {stage === 'select' && <Cloud down />}
          {stage === 'prepare' && <>
            <div className="bk-float f1"><Glyph k="doc" /></div><div className="bk-float f3"><Glyph k="doc" /></div>
            <span className="bk-beams" /><div className="rs-cloud-top"><Cloud down /></div><div className="rs-folder"><Folder /></div>
          </>}
          {stage === 'process' && <>
            <span className="bk-orbit o1" /><span className="bk-orbit o2" />
            <div className="bk-ring"><div className="bk-tile t1"><Glyph k="doc" /></div><div className="bk-tile t2"><Glyph k="gear" /></div><div className="bk-tile t3"><Glyph k="person" /></div><div className="bk-tile t4"><Glyph k="img" /></div></div>
            <Folder />
          </>}
          {stage === 'restore' && <>
            <div className="bk-float f1"><Glyph k="img" /></div><div className="bk-float f2"><Glyph k="doc" /></div><div className="bk-float f3"><Glyph k="gear" /></div>
            <span className="bk-beams" /><Folder />
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

        {stage === 'select' && (
          <>
            <div className="scan-card bk-card">
              {latest && (
                <button className={`rs-opt${choice === 'latest' ? ' on' : ''}`} onClick={() => setChoice('latest')}>
                  <span className="rs-ic"><Glyph k="doc" /></span>
                  <span className="grow"><b>Latest backup on this phone</b><span className="rs-s">{when(latestAt) ?? 'Saved by JustMoney'} · {formatBytes(latest.length)}</span></span>
                  <i className="rs-radio" />
                </button>
              )}
              <button className={`rs-opt${choice === 'file' ? ' on' : ''}`} onClick={() => setChoice('file')}>
                <span className="rs-ic"><Glyph k="folder" /></span>
                <span className="grow"><b>Choose a backup file</b><span className="rs-s">A JustMoney backup (.json) from your files or Drive</span></span>
                <i className="rs-radio" />
              </button>
            </div>
            <p className="bk-cap" style={{ lineHeight: 1.5 }}>Anything already on this phone is kept. A restore only adds what is missing, and nothing is overwritten.</p>
            <input ref={fileRef} type="file" accept="application/json,.json,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(() => f.text()) }} />
          </>
        )}
        {busy && (
          <>
            <div className="bk-prog"><div className="bk-track"><i style={{ width: `${pct}%` }} /></div><b className="num">{pct}%</b></div>
            <div className="bk-cap">{CAPTION[stage]}</div>
          </>
        )}
        {stage === 'done' && (
          <ol className="scan-card bk-card stagger">
            {groupSizes().slice(0, 5).map((g) => (
              <li key={g.id} className="scan-row ok"><span className="scan-label">{g.label}</span><span className="bk-size">Restored</span><span className="scan-state"><Icon name="check" size={14} stroke={3} /></span></li>
            ))}
            <li className="scan-row"><span className="scan-label dim">{added} new item{added === 1 ? '' : 's'} added</span></li>
          </ol>
        )}
      </div>
      <div className="scan-foot">
        {stage === 'select' && <button className="scan-btn" onClick={next}>Next</button>}
        {stage === 'done' && <button className="scan-btn" onClick={onClose}>Done</button>}
        {stage === 'failed' && <button className="scan-btn" onClick={() => { setStage('select'); setP(0); target.current = 0 }}>Try again</button>}
        {busy && <div style={{ height: 54 }} />}
      </div>
    </div>
  )
}
