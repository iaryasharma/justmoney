import { useEffect, useMemo, useRef, useState } from 'react'
import { buzz, Icon, Toggle, useToast } from '../ui/ui'
import { SelectField } from '../ui/SelectField'
import { Glyph } from '../backup/BackupRun'
import { buildExpenseReportPdf, DEFAULT_SECTIONS, reportFilename, savePdfReport, type ReportSections } from '../../lib/reports/report'
import { openPdfBlob, renderPdfPage } from '../../lib/capture/pdf'
import { shareFile } from '../../lib/backup/shareFile'
import { formatBytes } from '../../lib/backup/backupScope'
import { monthRange } from '../../lib/core/format'
import { notifyImmediate } from '../../lib/notify/notify'
import { ROUTES } from '../../lib/notify/notifyRoute'
import { KEYS, useStored } from '../../lib/core/storage'
import type { Transaction } from '../../lib/core/types'

type Stage = 'options' | 'run' | 'done' | 'failed'
interface Made { blob: Blob; filename: string; savedTo?: string; pages: number; preview: string | null }

const STEPS = ['Analyzing data', 'Compiling charts', 'Adding insights', 'Formatting PDF']
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const SECTION_ROWS: { id: keyof ReportSections; label: string; sub: string }[] = [
  { id: 'summary', label: 'Summary', sub: 'Spent, income and net' },
  { id: 'accounts', label: 'Accounts', sub: 'Balances of your accounts' },
  { id: 'categories', label: 'Category breakdown', sub: 'Where the money went' },
  { id: 'transactions', label: 'Transaction list', sub: 'Every entry, with logos' },
  { id: 'trends', label: 'Trends and insights', sub: 'Last 6 months and key findings' },
  { id: 'budgets', label: 'Budgets', sub: 'Budget against what you spent' },
  { id: 'notes', label: 'Notes and tags', sub: 'Your own notes on each entry' },
]

/**
 * Export a report in steps: choose the month and what goes in, watch it being made, then see the first page, the file's details,
 * and view or share it. What it shows (size, pages, preview) is read from the PDF it made.
 */
export function ReportRun({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [stage, setStage] = useState<Stage>('options')
  const now = new Date()
  const months = useMemo(() => Array.from({ length: 18 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [period, setPeriod] = useState<string>(`${now.getFullYear()}-${now.getMonth()}`) // "y-m", "all" or "custom"
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sections, setSections] = useState<ReportSections>(DEFAULT_SECTIONS)
  const [hide, setHide] = useState(false)
  const [p, setP] = useState(0)
  const [step, setStep] = useState(0)
  const [made, setMade] = useState<Made | null>(null)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(false)
  const target = useRef(0)
  const cleanup = useRef<() => void>(() => {})
  useEffect(() => () => cleanup.current(), [])

  const scope = useMemo(() => {
    if (period === 'all') return { rows: txns, title: 'All time', month: null as { year: number; month: number } | null, filename: reportFilename(0, null) }
    if (period === 'custom') {
      const a = from ? new Date(`${from}T00:00:00`).getTime() : 0
      const b = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity
      const label = `${from || 'start'} to ${to || 'today'}`
      return { rows: txns.filter((t) => t.timestamp >= a && t.timestamp <= b), title: label, month: null, filename: `justmoney-report-${from || 'start'}-${to || 'today'}.pdf` }
    }
    const [y, m] = period.split('-').map(Number)
    const { start, end } = monthRange(y, m)
    return { rows: txns.filter((t) => t.timestamp >= start && t.timestamp < end), title: `${new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`, month: { year: y, month: m }, filename: reportFilename(y, m) }
  }, [period, from, to, txns])

  const periodOptions = [
    ...months.map((d) => ({ id: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), icon: <span className="sf-dot"><Icon name="calendar" size={16} /></span> })),
    { id: 'all', label: 'All time', icon: <span className="sf-dot"><Icon name="calendar" size={16} /></span> },
    { id: 'custom', label: 'Custom range', icon: <span className="sf-dot"><Icon name="calendar" size={16} /></span> },
  ]
  const toggle = (id: keyof ReportSections) => { buzz(6); setSections((s) => ({ ...s, [id]: !s[id] })) }
  const canMake = scope.rows.length > 0 && Object.values(sections).some(Boolean)

  const generate = () => {
    buzz(14)
    let live = true
    let elapsed = 0
    let outcome: Made | string | null = null
    setStage('run'); setP(0); setStep(0); target.current = 28; setError('')
    ;(async () => {
      const blob = await buildExpenseReportPdf({ title: scope.title, txns: scope.rows, allTxns: txns, sections, hideAmounts: hide, month: scope.month })
      const { savedTo } = await savePdfReport(blob, scope.filename, { share: false })
      let pages = 1
      let preview: string | null = null
      try { const doc = await openPdfBlob(blob); pages = doc.numPages; preview = await renderPdfPage(doc, 1, 520) } catch { /* the report is saved either way */ }
      notifyImmediate('Report ready', savedTo ? `${scope.filename} saved to ${savedTo}` : `${scope.filename} is ready.`, `report-${Date.now()}`, ROUTES.report(scope.filename))
      return { blob, filename: scope.filename, savedTo, pages, preview } as Made
    })().then((m) => { outcome = m }).catch((e) => { outcome = (e as Error)?.message || 'Something went wrong building the PDF.' })
    const k = reduced() ? 0.25 : 1
    let last = Date.now()
    const tick = setInterval(() => {
      const t = Date.now(); const dt = Math.min(t - last, 2000); last = t
      if (!live) return
      elapsed += dt
      const s = Math.min(3, Math.floor(elapsed / (900 * k)))
      setStep((v) => { if (s > v) buzz(6); return Math.max(v, s) })
      target.current = elapsed > 2700 * k ? 94 : elapsed > 1800 * k ? 70 : elapsed > 900 * k ? 46 : 28
      setP((v) => (v < target.current ? Math.min(target.current, v + (target.current - v) * (1 - Math.exp(-dt / 600)) + dt * 0.004) : v))
      if (outcome === null || elapsed < 3600 * k) return
      live = false
      if (typeof outcome === 'string') { setError(outcome); setStage('failed'); buzz([70, 50, 70]); return }
      const m = outcome
      target.current = 100; setStep(4)
      setTimeout(() => { setMade(m); setStage('done'); buzz([16, 50, 30]) }, 450)
    }, 60)
    cleanup.current = () => { live = false; clearInterval(tick) }
  }

  const share = async () => {
    if (!made) return
    try { await shareFile(made.filename, made.blob, { title: made.filename }) } catch (e) { toast('Could not share the report', String((e as Error)?.message ?? '').slice(0, 80)) }
  }

  const title = { options: 'Export Report', run: 'Generating Report', done: 'Report Exported', failed: 'Could Not Export' }[stage]
  const sub = { options: 'Choose the month and what to include', run: `Preparing your ${scope.title} report…`, done: `Your ${scope.title} report is ready`, failed: error }[stage]
  const busy = stage === 'run'

  return (
    <div className={`bk-screen rp-screen rp-${stage}`} role="dialog" aria-label="Export a report">
      <button className="icon-btn bk-close" onClick={busy ? undefined : onClose} aria-label="Close" style={{ opacity: busy ? 0.35 : 1 }}><Icon name={stage === 'done' || stage === 'failed' ? 'close' : 'back'} size={20} /></button>
      <div className="bk-body" style={{ textAlign: stage === 'options' ? 'left' : 'center' }}>
        {stage === 'options' && (
          <>
            <h1 className="bk-title" style={{ marginBottom: 4 }}>{title}</h1>
            <div className="bk-sub" style={{ marginBottom: 18 }}>{sub}</div>
            <div className="label" style={{ marginBottom: 6 }}>Month</div>
            <SelectField title="Month" value={period} options={periodOptions} onChange={(v) => v && setPeriod(v)} searchAbove={30} />
            {period === 'custom' && (
              <div className="row" style={{ gap: 10, marginTop: 10 }}>
                <input className="input grow" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                <input className="input grow" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              </div>
            )}
            <div className="dim small" style={{ margin: '8px 2px 0' }}>{scope.rows.length ? `${scope.rows.length} transaction${scope.rows.length === 1 ? '' : 's'}` : 'No transactions in this period'}</div>

            <div className="label" style={{ margin: '18px 0 6px' }}>Include in the report</div>
            <div className="scan-card rp-list stagger">
              {SECTION_ROWS.map((r) => {
                const off = r.id === 'budgets' && !scope.month
                return (
                  <div key={r.id} className="scan-row" style={{ height: 'auto', padding: '10px 14px', opacity: off ? 0.45 : 1 }}>
                    <span className="grow"><b style={{ fontWeight: 600, fontSize: 15 }}>{r.label}</b><span className="rs-s">{off ? 'Pick a single month' : r.sub}</span></span>
                    <Toggle on={sections[r.id] && !off} onChange={() => !off && toggle(r.id)} label={r.label} />
                  </div>
                )
              })}
              <div className="scan-row" style={{ height: 'auto', padding: '10px 14px' }}>
                <span className="grow"><b style={{ fontWeight: 600, fontSize: 15 }}>Hide amounts</b><span className="rs-s">Shows ••••• instead of money, for a report you will share</span></span>
                <Toggle on={hide} onChange={setHide} label="Hide amounts" />
              </div>
            </div>
          </>
        )}

        {stage !== 'options' && (
          <>
            <div className="bk-art rp-art" aria-hidden="true">
              <div className="bk-glow" />
              {stage === 'run' && <>
                <span className="bk-orbit o1" /><span className="bk-orbit o2" />
                <div className="bk-ring"><div className="bk-tile t1"><Glyph k="doc" /></div><div className="bk-tile t2"><Glyph k="gear" /></div><div className="bk-tile t3"><Glyph k="img" /></div><div className="bk-tile t4"><Glyph k="person" /></div></div>
                <svg className="rp-doc" viewBox="0 0 80 100" width="86" height="108"><path d="M10 6h40l20 20v68H10z" fill="color-mix(in srgb, var(--accent) 30%, transparent)" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeWidth="3" strokeLinejoin="round" /><path d="M50 6v20h20" fill="none" stroke="color-mix(in srgb, var(--accent) 45%, #fff)" strokeWidth="3" strokeLinejoin="round" /><text x="40" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill="#fff">PDF</text></svg>
              </>}
              {stage === 'done' && (
                <svg className="bk-check" viewBox="0 0 120 120" width="130" height="130" fill="none"><circle cx="60" cy="60" r="46" stroke="color-mix(in srgb, var(--accent) 70%, #fff)" strokeWidth="5" /><path className="sa-tick" d="M40 62l15 15 27-30" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
              {stage === 'failed' && <svg viewBox="0 0 120 120" width="130" height="130" fill="none"><circle cx="60" cy="60" r="46" stroke="#f87171" strokeWidth="5" /><path d="M60 38v28M60 80v1" stroke="#fff" strokeWidth="7" strokeLinecap="round" /></svg>}
            </div>
            <div className="bk-head" key={stage}><h1 className="bk-title">{title}</h1><div className="bk-sub">{sub}</div></div>
          </>
        )}

        {stage === 'run' && (
          <>
            <ol className="scan-card bk-card">
              {STEPS.map((s, i) => (
                <li key={s} className={`scan-row ${i < step ? 'ok' : i === step ? 'active' : 'wait'}`}>
                  <span className="scan-label">{s}…</span>
                  <span className="scan-state">{i < step ? <Icon name="check" size={14} stroke={3} /> : i === step ? <i className="scan-ring" /> : <i className="scan-wait" />}</span>
                </li>
              ))}
            </ol>
            <div className="bk-prog" style={{ marginTop: 14 }}><div className="bk-track"><i style={{ width: `${Math.round(p)}%` }} /></div><b className="num">{Math.round(p)}%</b></div>
          </>
        )}

        {stage === 'done' && made && (
          <>
            {made.preview && <button className="rp-thumb" onClick={() => setViewing(true)} aria-label="Open the report"><img src={made.preview} alt="First page of the report" /></button>}
            <ol className="scan-card bk-card stagger" style={{ marginTop: 14 }}>
              <li className="scan-row"><span className="dim small">File name</span><span className="grow ellipsis" style={{ textAlign: 'right', fontWeight: 600 }}>{made.filename}</span></li>
              <li className="scan-row"><span className="dim small">Size</span><span className="grow" style={{ textAlign: 'right', fontWeight: 600 }}>{formatBytes(made.blob.size)}</span></li>
              <li className="scan-row"><span className="dim small">Pages</span><span className="grow" style={{ textAlign: 'right', fontWeight: 600 }}>{made.pages}</span></li>
              {made.savedTo && <li className="scan-row"><span className="dim small">Saved to</span><span className="grow ellipsis" style={{ textAlign: 'right', fontWeight: 600 }}>{made.savedTo}</span></li>}
            </ol>
          </>
        )}
      </div>

      <div className="scan-foot">
        {stage === 'options' && <button className="scan-btn" disabled={!canMake} style={{ opacity: canMake ? 1 : 0.5 }} onClick={generate}>Generate Report</button>}
        {stage === 'done' && (
          <div className="col" style={{ gap: 10 }}>
            <button className="scan-btn" onClick={() => setViewing(true)}>View Report</button>
            <div className="row" style={{ gap: 10 }}>
              <button className="scan-btn ghost" onClick={share}><Icon name="share" size={18} /> Share</button>
              <button className="scan-btn ghost" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
        {stage === 'failed' && <button className="scan-btn" onClick={() => setStage('options')}>Try again</button>}
        {stage === 'run' && <div style={{ height: 54 }} />}
      </div>
      {viewing && made && <ReportViewer made={made} onClose={() => setViewing(false)} onShare={share} />}
    </div>
  )
}

/** The whole report, page by page, drawn from the PDF itself. */
function ReportViewer({ made, onClose, onShare }: { made: Made; onClose: () => void; onShare: () => void }) {
  const [pages, setPages] = useState<(string | null)[]>(() => Array.from({ length: made.pages }, (_, i) => (i === 0 ? made.preview : null)))
  useEffect(() => {
    let live = true
    ;(async () => {
      const doc = await openPdfBlob(made.blob)
      for (let i = 1; i <= doc.numPages; i++) {
        const url = await renderPdfPage(doc, i, 900)
        if (!live) return
        setPages((arr) => arr.map((x, j) => (j === i - 1 ? url : x)))
      }
    })().catch(() => {})
    return () => { live = false }
  }, [made])
  return (
    <div className="rp-viewer" role="dialog" aria-label="Report preview">
      <div className="rp-vhead">
        <button className="icon-btn" onClick={onClose} aria-label="Close preview"><Icon name="back" size={20} /></button>
        <b className="grow ellipsis">{made.filename}</b>
        <button className="icon-btn" onClick={onShare} aria-label="Share"><Icon name="share" size={18} /></button>
      </div>
      <div className="rp-pages">
        {pages.map((u, i) => (
          <div key={i} className="rp-page">{u ? <img src={u} alt={`Page ${i + 1}`} /> : <div className="skeleton" style={{ aspectRatio: '210 / 297' }} />}<span>{i + 1} / {pages.length}</span></div>
        ))}
      </div>
    </div>
  )
}
