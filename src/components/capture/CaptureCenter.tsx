import { useCallback, useEffect, useRef, useState } from 'react'
import BrandLogo from '../ui/BrandLogo'
import { merchantLogo } from '../../lib/payees/brands'
import { App as CapApp } from '@capacitor/app'
import { Icon, Sheet, Spinner, useConfirm, useToast } from '../ui/ui'
import { Capture, isNativeApp, type Share } from '../../lib/core/native'
import { importImages, importText, methodLabel, type ImportOutcome } from '../../lib/capture/capture'
import { deleteTransaction } from '../../lib/core/data'
import { formatPrice } from '../../lib/core/format'
import type { NewTransaction, Transaction } from '../../lib/core/types'

type Tab = 'home' | 'insights' | 'planner' | 'settings'

/**
 * Handles everything that arrives from outside the app: screenshots/photos/text
 * shared from other apps, "Add to JustMoney" from the text-selection menu, and
 * justmoney:// links opened by Google Assistant, Gemini, Bixby routines or app shortcuts.
 */
export default function CaptureCenter({ onQuickAdd, onTab, onOpenSplit, onEdit, onManual }: {
  onQuickAdd: (mode: 'text' | 'voice') => void
  onTab: (t: Tab) => void
  onOpenSplit: () => void
  onEdit: (t: Transaction) => void
  onManual: (prefill?: Partial<NewTransaction>) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<ImportOutcome | null>(null)
  const queue = useRef(Promise.resolve())

  const run = useCallback((label: string, job: () => Promise<ImportOutcome>) => {
    queue.current = queue.current.then(async () => {
      setResult(null)
      setBusy(label)
      try {
        setResult(await job())
      } catch (e) {
        toast("Couldn't add that", e instanceof Error ? e.message : 'Please try again.')
      } finally {
        setBusy(null)
      }
    })
  }, [toast])

  const handleShare = useCallback((s: Share) => {
    if (s.kind === 'images' && s.uris.length) run(s.uris.length > 1 ? `Reading ${s.uris.length} screenshots…` : 'Reading screenshot…', () => importImages(s.uris.map((uri) => ({ uri }))))
    else if (s.kind === 'text') run('Reading message…', () => importText(s.text))
    else if (s.kind === 'error') toast("Couldn't open what was shared", s.message)
  }, [run, toast])

  const handleUrl = useCallback((raw: string) => {
    let url: URL
    try { url = new URL(raw) } catch { return }
    if (url.protocol !== 'justmoney:') return
    // justmoney://add?text=... → host "add"; some launchers pass justmoney:add
    const route = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase()
    const text = url.searchParams.get('text') ?? url.searchParams.get('q') ?? ''
    const feature = (url.searchParams.get('feature') ?? '').toLowerCase()
    const target = route === 'feature' ? feature : route
    // any web page or app can open a justmoney:// link, so a payment arriving this way is only added after the user says yes
    if (/^(add|log|expense|new)/.test(target) && text.trim()) { void confirm({ title: 'Add this payment?', body: text.trim().slice(0, 200), confirm: 'Add' }).then((ok) => { if (ok) run('Adding…', () => importText(text)) }) }
    else if (/voice|speak|say|log expense/.test(target)) onQuickAdd('voice')
    else if (/scan|receipt|screenshot/.test(target)) { onQuickAdd('text'); toast('Tap “Receipt” to pick a screenshot or photo') }
    else if (/split/.test(target)) onOpenSplit()
    else if (/insight/.test(target)) onTab('insights')
    else if (/plan|budget|goal/.test(target)) onTab('planner')
    else if (/add|expense|new|transaction/.test(target)) onQuickAdd('text')
  }, [run, onQuickAdd, onTab, onOpenSplit, toast, confirm])

  useEffect(() => {
    if (!isNativeApp()) return
    const subs: Promise<{ remove: () => Promise<void> }>[] = []
    Capture.takePendingShares().then(({ shares }) => shares.forEach(handleShare)).catch(() => {})
    subs.push(Capture.addListener('shareReceived', handleShare))
    CapApp.getLaunchUrl().then((u) => u?.url && handleUrl(u.url)).catch(() => {})
    subs.push(CapApp.addListener('appUrlOpen', (e) => handleUrl(e.url)))
    return () => { subs.forEach((s) => s.then((h) => h.remove())) }
  }, [handleShare, handleUrl])

  const close = () => setResult(null)
  const r = result
  const one = r?.added.length === 1 ? r.added[0] : null

  return (
    <>
      {busy && (
        <div className="toast row" role="status" style={{ gap: 12 }}><Spinner /><b>{busy}</b></div>
      )}
      <Sheet open={!!r} onClose={close}>
        {r && (r.added.length ? (
          <div className="col" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 12 }}>
              <div className="tx-avatar credit" style={{ width: 48, height: 48 }}><Icon name="check" size={24} stroke={2.6} /></div>
              <div className="grow">
                <h2 className="h2">{one ? `${one.paymentType === 'CREDIT' ? 'Received' : 'Saved'} ${formatPrice(one.paymentAmount)}` : `${r.added.length} transactions saved`}</h2>
                <div className="muted small">{r.methods.map((m) => methodLabel[m]).join(' · ')}</div>
              </div>
            </div>
            <div className="card">
              {r.added.map((t) => (
                <button key={t.id} className="list-row" onClick={() => { close(); onEdit(t) }}>
                  <BrandLogo src={merchantLogo(t.paymentReceiver)} size={32} radius={9} />
                  <div className="grow">
                    <div className="ellipsis">{t.paymentReceiver}</div>
                    <div className="dim small">{t.paymentCategory} · {new Date(t.timestamp).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                  </div>
                  <b className="num" style={{ color: t.paymentType === 'CREDIT' ? 'var(--credit)' : undefined }}>{t.paymentType === 'CREDIT' ? '+' : '-'}{formatPrice(t.paymentAmount)}</b>
                  <Icon name="edit" size={16} />
                </button>
              ))}
            </div>
            {r.needsReview && <div className="small" style={{ color: 'var(--amber)' }}>This was a best guess — tap it to check the payee and category.</div>}
            {(r.skipped > 0 || r.failed > 0 || r.notFound > 0 || !!r.held) && (
              <div className="dim small">
                {[r.skipped && `${r.skipped} already in your list`, r.failed && `${r.failed} failed/pending payment${r.failed === 1 ? '' : 's'} ignored`, r.held && `${r.held} IPO / mandate block${r.held === 1 ? '' : 's'} saved`, r.notFound && `${r.notFound} without an expense`].filter(Boolean).join(' · ')}
              </div>
            )}
            <div className="row">
              <button className="btn secondary grow" onClick={() => { r.added.forEach((t) => deleteTransaction(t.id)); toast('Removed'); close() }}>Undo</button>
              <button className="btn grow" onClick={close}>Done</button>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 14 }}>
            <h2 className="h2">{r.failed ? 'Payment not completed' : r.updated ? 'Entry updated' : r.skipped ? 'Already saved' : "Couldn't find an expense"}</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {r.failed ? "That screenshot shows a failed or pending payment, so it wasn't recorded."
                : r.updated ? 'This payment was already in your list from the bank message. It now has the name and reference from your screenshot.'
                : r.skipped ? 'This transaction is already in your list.'
                : 'Nothing that looks like a payment or receipt total was found. You can enter it yourself.'}
            </p>
            <div className="row">
              <button className="btn secondary grow" onClick={close}>Close</button>
              {!r.failed && !r.skipped && !r.updated && <button className="btn grow" onClick={() => { close(); onManual(r.partial) }}>Enter manually</button>}
            </div>
          </div>
        ))}
      </Sheet>
    </>
  )
}
