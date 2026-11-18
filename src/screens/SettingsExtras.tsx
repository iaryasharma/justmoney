import { useEffect, useState } from 'react'
import BrandLogo from '../components/ui/BrandLogo'
import { appLogo } from '../lib/payees/brands'
import { App as CapApp } from '@capacitor/app'
import { Icon, PageHeader, Toggle, useToast } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { Capture, isNativeApp } from '../lib/core/native'
import { PKG_APPS, syncCapturedPayments, type CaptureLogEntry } from '../lib/capture/autocapture'
import { deleteRule, learnRule } from '../lib/capture/rules'
import { withFamily } from '../lib/core/data'
import { INCOME_CATEGORIES } from '../lib/core/money'
import type { CategoryRule } from '../lib/core/types'

/** Auto-capture from payment notifications: permission, on/off, and what is (not) read. */
export function AutoCapturePage({ onBack }: { onBack: () => void }) {
  const [enabled, setEnabled] = useStored<boolean>(KEYS.autoCapture, true)
  const [access, setAccess] = useState<boolean | null>(null)
  const [sms, setSms] = useState<boolean | null>(null)
  const [readLog] = useStored<CaptureLogEntry[]>(KEYS.captureLog, [])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<string | null>(null)
  const toast = useToast()
  const native = isNativeApp()
  useEffect(() => {
    if (!native) return
    const check = () => {
      Capture.notificationAccessStatus().then((s) => setAccess(s.enabled)).catch(() => setAccess(false))
      Capture.smsStatus().then((s) => setSms(s.granted)).catch(() => setSms(false))
    }
    check()
    const sub = CapApp.addListener('resume', check) // coming back from the system settings screen
    return () => { sub.then((h) => h.remove()) }
  }, [native])

  return (
    <div className="page">
      <PageHeader title="Auto-capture payments" onBack={onBack} />
      {!native ? <p className="muted">This works in the Android app: it reads payment notifications from GPay, PhonePe, Paytm and your bank, and adds them for you.</p> : (
        <>
          <div className="card pad col" style={{ gap: 12 }}>
            <div className="row">
              <Icon name="bell" />
              <div className="grow">
                <b>{access ? 'Notification access is on' : 'Notification access needed'}</b>
                <div className="dim small">{access ? 'Payments from your notifications are added automatically.' : 'Android asks you to allow JustMoney to read notifications.'}</div>
              </div>
              {access ? <Icon name="check" size={20} /> : null}
            </div>
            {!access && <button className="btn block" onClick={() => Capture.openNotificationAccessSettings()}>Allow notification access</button>}
            {access && <div className="row between"><span>Add payments automatically</span><Toggle on={enabled} onChange={setEnabled} label="Add payments automatically" /></div>}
          </div>
          <div className="card pad col" style={{ gap: 12, marginTop: 12 }}>
            <div className="row">
              <Icon name="message" />
              <div className="grow">
                <b>{sms ? 'Reading bank messages is on' : 'Read bank messages (SMS)'}</b>
                <div className="dim small">{sms ? 'A new bank message is added the moment it arrives, even when your messaging app mutes or filters it.' : 'Lets JustMoney read bank messages directly, so a payment is caught even when your messaging app hides the notification.'}</div>
              </div>
              {sms ? <Icon name="check" size={20} /> : null}
            </div>
            {!sms && <button className="btn block" onClick={async () => { const r = await Capture.requestSms().catch(() => ({ granted: false })); setSms(r.granted); if (!r.granted) toast('Permission not given', 'You can allow it later in the app settings on your phone.') }}>Allow reading bank messages</button>}
            {sms && (
              <>
                <button className="btn block secondary" disabled={scanning} onClick={async () => {
                  setScanning(true); setScanned(null)
                  try {
                    const r = await Capture.scanSms({ days: 30 })
                    await syncCapturedPayments()
                    setScanned(r.added ? `Found ${r.added} payment message${r.added === 1 ? '' : 's'}. New ones were added; ones already in JustMoney were skipped.` : 'No new payment messages in the last 30 days.')
                  } catch (e) { setScanned((e as Error)?.message || 'Could not read messages.') } finally { setScanning(false) }
                }}>{scanning ? 'Reading…' : 'Scan the last 30 days'}</button>
                {scanned && <div className="small" role="status">{scanned}</div>}
              </>
            )}
            <div className="dim tiny" style={{ lineHeight: 1.5 }}>Only messages from bank-style senders that read like a completed payment are kept. OTPs, offers, personal chats and everything else are ignored and never stored. Nothing leaves your phone.</div>
          </div>
          <div className="card pad col" style={{ gap: 8, marginTop: 12 }}>
            <div className="row"><Icon name="image" /><div className="grow"><b>Name a payment from its screenshot</b>
              <div className="dim small" style={{ lineHeight: 1.5 }}>After you pay, take a screenshot of the success screen, tap Share and choose JustMoney. It reads who you paid and the reference, and adds the name to the entry the bank message created. The picture stays on your phone and is not kept.</div></div></div>
          </div>
          <div className="section-label">What JustMoney read</div>
          <div className="card">
            {readLog.length === 0 ? <div className="empty small">Nothing yet. Each bank message or payment notification it reads shows up here.</div> : readLog.slice(0, 15).map((c, i) => (
              <div key={`${c.at}-${i}`} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="small" style={{ fontWeight: 600 }}>{c.what ?? (c.ok ? 'Payment read' : 'Not a payment, nothing saved')}</div>
                  <div className="dim tiny">{c.pkg.startsWith('sms:') ? 'Bank SMS' : c.pkg.startsWith('screen:') ? 'Payment screen' : (PKG_APPS[c.pkg] ?? 'Notification')} · {new Date(c.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
                </div>
                <span className="small" style={{ color: c.outcome === 'added' ? 'var(--credit)' : 'var(--dim)' }}>{c.outcome === 'added' ? 'Added' : c.outcome === 'matched' ? 'Matched' : c.outcome === 'hold' ? 'IPO hold' : 'Ignored'}</span>
              </div>
            ))}
          </div>
          <p className="dim tiny" style={{ marginTop: 6, lineHeight: 1.5 }}>This list shows only what was made of each message, such as “₹86 paid to Zepto”. The message text itself is never kept, and OTPs, offers and personal chats are not read at all.</p>
          <div className="section-label">How it works</div>
          <div className="card pad col small" style={{ gap: 8, lineHeight: 1.5 }}>
            <div>• When GPay, PhonePe, Paytm, BHIM, CRED, your bank app or a bank SMS shows a <b>completed payment</b>, JustMoney records it — amount, payee, app and account.</div>
            <div>• If the same payment shows up twice (the app's notification and the bank SMS), it's saved once with both details.</div>
            <div>• OTPs, offers, bill reminders, failed payments and every other notification are ignored and never stored.</div>
            <div>• Nothing leaves your phone. You can undo any auto-added entry from the toast, or swipe it away.</div>
          </div>
          <div className="section-label">Recognised apps</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>{[...new Set(Object.values(PKG_APPS)), 'Bank apps', 'Bank SMS'].map((a) => <span key={a} className="chip"><BrandLogo src={appLogo(a)} size={16} radius={4} />{a}</span>)}</div>
        </>
      )}
    </div>
  )
}

/** Auto-categorise rules: "if a payment mentions X → category Y". */
export function RulesPage({ onBack }: { onBack: () => void }) {
  const [rules] = useStored<CategoryRule[]>(KEYS.categoryRules, [])
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const toast = useToast()
  const [match, setMatch] = useState('')
  const [type, setType] = useState<'DEBIT' | 'CREDIT'>('DEBIT')
  const [category, setCategory] = useState('Food')
  const cats = type === 'CREDIT' ? INCOME_CATEGORIES : withFamily(categories)
  return (
    <div className="page">
      <PageHeader title="Category rules" onBack={onBack} />
      <p className="muted small">When a payment mentions the text, it gets that category — for typed entries, SMS, screenshots and auto-captured payments. Correcting a category also offers to save a rule.</p>
      <form className="card pad col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        if (!match.trim()) return
        learnRule(match, category, type)
        toast('Rule saved', `“${match.trim()}” → ${category}`)
        setMatch('')
      }}>
        <div className="segmented">
          <button type="button" className={type === 'DEBIT' ? 'on' : ''} onClick={() => { setType('DEBIT'); setCategory('Food') }}>Money out</button>
          <button type="button" className={type === 'CREDIT' ? 'on' : ''} onClick={() => { setType('CREDIT'); setCategory('Salary') }}>Money in</button>
        </div>
        <input className="input" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="If it mentions… (e.g. Zomato, 98765, rohan@okaxis)" />
        <div className="chips">{cats.map((c) => <button type="button" key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <button className="btn block" disabled={!match.trim()}>Add rule</button>
      </form>
      <div className="section-label">Your rules</div>
      <div className="card">
        {rules.length === 0 ? <div className="empty small">No rules yet.</div> : rules.map((r) => (
          <div key={r.id} className="list-row">
            <div className="grow">
              <div><b>{r.match}</b> → {r.category}</div>
              <div className="dim small">{r.type === 'CREDIT' ? 'Money in' : r.type === 'DEBIT' ? 'Money out' : 'Any'}{r.hits ? ` · used ${r.hits}×` : ''}</div>
            </div>
            <button className="dim" aria-label="Delete rule" onClick={() => deleteRule(r.id)}><Icon name="trash" size={18} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

