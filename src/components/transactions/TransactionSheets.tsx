import { isDescription } from '../../lib/capture/nlparse'
import { SelectField } from '../ui/SelectField'
import { buzz } from '../ui/ui'
import { accountForHold, parseHold, recordHold } from '../../lib/accounts/holds'
import { useEffect, useMemo, useRef, useState } from 'react'
import BrandLogo from '../ui/BrandLogo'
import AccountLogo from '../ui/AccountLogo'
import AmountIcon from '../ui/AmountIcon'
import { appLogo, bankLogo } from '../../lib/payees/brands'
import { Icon, Sheet, SheetHeader, Spinner, Toggle, useConfirm, useToast } from '../ui/ui'
import { detectAnomalies } from '../../lib/payees/anomaly'
import { parseMany } from '../../lib/capture/quick'
import type { QuickPreset } from '../../lib/core/types'
import { read, useStored, KEYS } from '../../lib/core/storage'
import {
  addTransaction, addTransactionsBulk, advance, createRecurringRule, withFamily, deleteTransaction,
  isBlockEvent, learnPayeeName, processRecurring, SOURCE_LABELS, updateTransaction, categoryColor, categoryIcon,
} from '../../lib/core/data'
import { looksLikeBankSms, parseBankSmsBatch, recordSmsHolds } from '../../lib/capture/sms'
import { getRate } from '../../lib/invest/fx'
import { Device, isNativeApp } from '../../lib/core/native'
import { importImages, methodLabel } from '../../lib/capture/capture'
import { committedCategories, FAMILY, INCOME_CATEGORIES, isPersonalSpend } from '../../lib/core/money'
import { currentPlan, getPlanSettings, incomeMode, overPlan } from '../../lib/plan/plan'
import { potsPlan } from '../../lib/plan/pots'
import { BANKS, detectAccount, detectBank, enrichFromText, getAccounts, LOAN, ON_BEHALF, SELF_TRANSFER, SPLIT, UPI_APPS } from '../../lib/accounts/accounts'
import { newSplitGroup, splitPayment, splitSiblings, unsplitPayment } from '../../lib/split/splitLink'
import { removeTransaction } from '../../lib/core/remove'
import { splitAmountEvenly, type SplitPerson, type SplitProject } from '../../lib/split/split'
import { takeSplitIntent } from '../../lib/split/splitHandoff'
import { behalfBalance, markOnBehalf } from '../../lib/accounts/behalf'
import ContactPicker from '../people/ContactPicker'
import type { Person } from '../../lib/payees/peopleMatch'
import {
  addRepayment, attachRepaymentTransaction, deleteRepayment, forgetRepaymentTransaction, getLoans,
  isSettledLoan, lendFromTransaction, outstanding, syncRepaymentFromTransaction, unlendTransaction,
} from '../../lib/payees/loans'
import { learnRule } from '../../lib/capture/rules'
import {
  AIUnavailableError, aiReady, extractInfo, extractInfoFromImage, extractInfoFromStatementText,
  guessCategory, localParseTransaction, NoTransactionInfoError,
} from '../../lib/capture/ai'
import { extractPdf, PasswordRequiredError } from '../../lib/capture/pdf'
import { analyseStatement, reconcileDirections, type StatementInfo, type StatementRow } from '../../lib/capture/statement'
import { applyClosingBalance, linkStatementAccount, mergeAccount, moveTransactions } from '../../lib/capture/statementImport'
import { CURRENCIES, currencySymbol, formatDateTime, formatPrice, getCurrency, toLocalInput } from '../../lib/core/format'
import type { Commitment, FamilyMember, Loan, NewTransaction, PaymentMethod, RecurringCadence, RecurringRule, Transaction } from '../../lib/core/types'

/* ------------------------------------------------------------------ */
/* Quick add: type / speak / receipt / statement                       */
/* ------------------------------------------------------------------ */

type SpeechRec = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void
  onerror: (e: { error: string }) => void; onend: () => void; start: () => void; stop: () => void
}
const SpeechRecognitionCtor = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec })
const getSpeech = () => SpeechRecognitionCtor.SpeechRecognition ?? SpeechRecognitionCtor.webkitSpeechRecognition

type Confirm = ReturnType<typeof useConfirm>

/** Before an expense that would carry the month past its spending plan: say so, and let the user decide. */
async function planAllows(t: { paymentAmount: number; paymentType: string; paymentCategory: string; timestamp?: number }, confirm: Confirm): Promise<boolean> {
  if (t.paymentType !== 'DEBIT') return true
  const now = new Date()
  const at = new Date(t.timestamp ?? Date.now())
  if (at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) return true
  const commitments = read<Commitment[]>(KEYS.commitments, [])
  if (!isPersonalSpend({ paymentType: 'DEBIT', paymentCategory: t.paymentCategory } as Transaction, committedCategories(commitments))) return true
  const all = read<Transaction[]>(KEYS.transactions, [])
  const fmt = (v: number) => formatPrice(v, { round: true })
  if (incomeMode(getPlanSettings(), all) === 'INCOME') {
    // planned by income: the personal pot is what there is
    const pp = potsPlan(all, commitments, getPlanSettings().nextIncomeAt)
    const fits = !pp.has || t.paymentAmount <= pp.personal.left
    if (fits || t.paymentAmount < pp.personal.allocated * 0.03) return true
    return confirm({
      title: 'More than your personal pot',
      body: `${fmt(t.paymentAmount)} is ${fmt(t.paymentAmount - Math.max(0, pp.personal.left))} more than is left for your own spending. You can move money from another pot or from savings, or spend it anyway. Spend it anyway?`,
      confirm: 'Spend anyway',
    })
  }
  const over = overPlan(currentPlan(all, now.getFullYear(), now.getMonth(), commitments), t.paymentAmount)
  if (!over) return true
  return confirm({
    title: 'This goes past your plan',
    body: `${fmt(t.paymentAmount)} takes you ${fmt(over.over)} over this month's ${fmt(over.limit)} to spend. Going over means dipping into the ${fmt(over.saving)} you planned to save. Spend it anyway?`,
    confirm: 'Spend anyway',
  })
}

export function QuickAddSheet({ open, onClose, onManual, initialMode }: {
  open: boolean; onClose: () => void; onManual: () => void; initialMode?: 'voice' | null
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [presets] = useStored<QuickPreset[]>(KEYS.quickPresets, [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [methodId, setMethodId] = useState<string | null>(null)
  const [voice, setVoice] = useState<'idle' | 'listening' | 'processing'>('idle')
  const [transcript, setTranscript] = useState('')
  const [statement, setStatement] = useState<File | null>(null)
  const [imageState, setImageState] = useState<string | null>(null)
  const [voiceAuto, setVoiceAuto] = useStored<boolean>(KEYS.voiceAuto, false)
  const [review, setReview] = useState<string | null>(null) // what was heard, waiting for "Use this"
  const [done, setDone] = useState<{ title: string; sub: string; rows?: [string, string][]; undo?: () => void } | null>(null)
  const [preview, setPreview] = useState<string | null>(null) // the receipt being read
  const live = useMemo(() => { const s = review ?? transcript; try { return s.trim() ? localParseTransaction(s) : null } catch { return null } }, [transcript, review])
  const sourceName = (x: NewTransaction) => methods.find((m) => m.id === x.paymentMethodId)?.name ?? x.paymentApp ?? (x.paymentSource ? SOURCE_LABELS[x.paymentSource] : null)
  const finish = (title: string, sub: string, extra: { rows?: [string, string][]; undo?: () => void } = {}) => {
    buzz([12, 40, 24]); setText(''); setDone({ title, sub, ...extra })
    if (!extra.rows) setTimeout(() => onClose(), 1300)
  }
  const recRef = useRef<SpeechRec | null>(null)
  const imgInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && initialMode === 'voice') startVoice()
    if (!open) { setText(''); setVoice('idle'); setTranscript(''); recRef.current?.stop(); setReview(null); setDone(null); setPreview(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function save(input: string) {
    const raw = input.trim()
    if (!raw) return
    // #hashtags become the note's tags and are kept out of the parser's input
    const tags = raw.match(/#[\p{L}\p{N}_-]+/gu) ?? []
    // keep line breaks: they separate pasted SMS messages
    const q = raw.replace(/#[\p{L}\p{N}_-]+/gu, ' ').replace(/[ \t]+/g, ' ').trim()
    const note = tags.length ? tags.join(' ') : undefined
    // an IPO / UPI-mandate block or unblock message is a hold, never an expense: "Funds are blocked from A/C" has no debit word, so it is checked first
    const heldN = isBlockEvent(q) ? recordSmsHolds(q) : 0
    if (isBlockEvent(q) && parseBankSmsBatch(q).length === 0) {
      toast(heldN ? `${heldN} IPO / mandate block${heldN === 1 ? '' : 's'} saved` : 'Already saved', heldN ? 'Shown in your list. The money counts as held until it is unblocked.' : 'This block or unblock is already in your list.')
      setText(''); onClose(); return
    }
    if (looksLikeBankSms(q)) {
      const rows = parseBankSmsBatch(q)
      if (rows.length) {
        const r = addTransactionsBulk(rows.map((x) => ({ ...x, note, ...(methodId ? { paymentMethodId: methodId } : {}) })))
        toast(`${r.added} transaction${r.added === 1 ? '' : 's'} from SMS`, r.skipped ? `${r.skipped} duplicate${r.skipped === 1 ? '' : 's'} skipped` : rows.length === 1 ? `${formatPrice(rows[0].paymentAmount)} · ${rows[0].paymentReceiver}` : undefined)
        setText('')
        onClose()
        return
      }
    }
    // "tea 20, auto 100 and lunch 250" is three payments
    const many = parseMany(q)
    if (many) {
      const r = addTransactionsBulk(many.map((x) => ({ ...x, note, ...(methodId ? { paymentMethodId: methodId } : {}) })))
      toast(`${r.added} payments added`, many.map((x) => `${x.paymentReceiver} ${formatPrice(x.paymentAmount)}`).join(' · '))
      setText('')
      onClose()
      return
    }
    setBusy(true)
    try {
      let t: NewTransaction | null
      let offline = false
      if (aiReady()) {
        try {
          t = await extractInfo(q)
        } catch (e) {
          if (e instanceof NoTransactionInfoError) {
            toast('No transaction info found', 'Try something like "₹500 to Swiggy"')
            return
          }
          t = localParseTransaction(q)
          offline = true
        }
      } else {
        t = localParseTransaction(q)
        offline = true
      }
      if (!t) {
        toast('No transaction info found', 'Try something like "₹500 to Swiggy"')
        return
      }
      if (!(await planAllows(t, confirm))) return
      const res = addTransaction({ ...enrichFromText(t, q), note: [t.note, note].filter(Boolean).join(' ') || undefined, ...(methodId ? { paymentMethodId: methodId } : {}) })
      if (res.duplicate) { toast('Looks like a duplicate', 'This expense is already in your list.'); setText(''); onClose() }
      else finish(`${t.paymentType === 'CREDIT' ? 'Income' : 'Expense'} added`, `${formatPrice(t.paymentAmount)} · ${t.paymentReceiver === 'Expense' && t.note ? t.note : t.paymentReceiver} · ${t.paymentCategory}${offline && aiReady() ? ' · saved offline' : ''}`)
    } finally {
      setBusy(false)
    }
  }

  async function pasteSms() {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip.trim()) { toast('Clipboard is empty', 'Copy one or more bank SMS first.'); return }
      if (!looksLikeBankSms(clip)) { setText(clip); toast("That doesn't look like a bank SMS", 'It was pasted into the box so you can edit it.'); return }
      await save(clip)
    } catch {
      toast('Paste the SMS into the box', 'Clipboard access was blocked — long-press the box and paste.')
    }
  }

  /** What was said: saved at once if the user chose that, otherwise shown for a quick "Use this". */
  async function afterVoice(heard: string) {
    if (voiceAuto) await save(heard)
    else { setReview(heard); setVoice('idle') }
  }

  async function startVoice() {
    setReview(null)
    if (isNativeApp()) {
      // Android WebView has no Web Speech API: use the phone's own speech recogniser.
      try {
        setVoice('listening')
        const { text } = await Device.recognizeSpeech({ language: getCurrency() === 'INR' ? 'en-IN' : 'en-US', prompt: 'Say it like: paid 500 to Swiggy' })
        if (!text?.trim()) { setVoice('idle'); return }
        setTranscript(text)
        setVoice('processing')
        await afterVoice(text)
      } catch (e) {
        toast('Voice input unavailable', e instanceof Error ? e.message : 'No speech recogniser on this phone.')
      } finally {
        setVoice('idle')
      }
      return
    }
    const Ctor = getSpeech()
    if (!Ctor) { toast('Voice input unavailable', 'This browser does not support speech recognition. Try Chrome.'); return }
    const rec = new Ctor()
    rec.lang = getCurrency() === 'INR' ? 'en-IN' : 'en-US'
    rec.interimResults = true
    rec.continuous = false
    let final = ''
    rec.onresult = (e) => {
      const parts = Array.from(e.results)
      final = parts.map((r) => r[0].transcript).join(' ')
      setTranscript(final)
    }
    rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice input failed', e.error) }
    rec.onend = async () => {
      if (!final.trim()) { setVoice('idle'); return }
      setVoice('processing')
      await afterVoice(final)
      setVoice('idle')
    }
    recRef.current = rec
    setTranscript('')
    setVoice('listening')
    rec.start()
  }

  async function onImages(files: FileList | null) {
    if (!files?.length) return
    if (isNativeApp()) {
      // On the phone: OCR + parser (and Gemini Nano) run locally; cloud Gemini only as a fallback.
      setImageState(files.length > 1 ? `Reading ${files.length} images…` : 'Reading receipt…')
      setPreview(URL.createObjectURL(files[0]))
      try {
        const r = await importImages(Array.from(files).map((file) => ({ file })), { paymentMethodId: methodId ?? undefined })
        if (r.added.length) {
          const one = r.added.length === 1 ? r.added[0] : null
          if (one) finish('Receipt saved', `${formatPrice(one.paymentAmount)} · ${one.paymentReceiver}`, { rows: [['Merchant', one.paymentReceiver], ['Date', formatDateTime(one.timestamp)], ['Total', formatPrice(one.paymentAmount)], ['Category', one.paymentCategory]], undo: () => deleteTransaction(one.id) })
          else {
            toast(`Done · ${r.added.length} transactions added`,
              [r.methods.map((m) => methodLabel[m]).join(' · '), r.skipped && `${r.skipped} duplicate${r.skipped === 1 ? '' : 's'} skipped`].filter(Boolean).join(' · '))
            onClose()
          }
        } else if (r.failed) toast('Payment not completed', "That screenshot shows a failed or pending payment, so it wasn't recorded.")
        else if (r.updated) toast('Entry updated', 'The name and reference from the screenshot were added to the payment already saved.')
        else if (r.skipped) toast('Already saved', 'This transaction is already in your list.')
        else toast('No transactions found in this image', 'Try a clearer screenshot, or enter it manually.')
      } finally {
        setImageState(null); setPreview(null)
        if (imgInput.current) imgInput.current.value = ''
      }
      return
    }
    if (!aiReady()) { toast('AI extraction is off', 'Enable AI processing and add a Gemini key in Settings to read receipts.'); return }
    let added = 0, skipped = 0, found = 0
    try {
      for (const [i, f] of Array.from(files).entries()) {
        setImageState(`Reading receipt ${files.length > 1 ? `${i + 1}/${files.length}` : ''}…`)
        const rows = await extractInfoFromImage(f)
        found += rows.length
        setImageState('Logging…')
        const r = addTransactionsBulk(rows.map((x) => ({ ...x, paymentMethodId: methodId ?? undefined })))
        added += r.added; skipped += r.skipped
      }
      if (!found) toast('No transactions found in this image')
      else toast(`Done · ${added} transaction${added === 1 ? '' : 's'} added`, skipped ? `${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : undefined)
      if (found) onClose()
    } catch (e) {
      toast('Failed to process the image', e instanceof AIUnavailableError ? e.message : 'Please try again.')
    } finally {
      setImageState(null); setPreview(null)
      if (imgInput.current) imgInput.current.value = ''
    }
  }

  return (
    <>
      <Sheet open={open && !statement} onClose={onClose}>
        <SheetHeader title={<>Add a payment</>} sub="Type it the way you'd say it: the amount, place and category are filled in for you." onClose={onClose} />

        {done ? (
          <div className="qa-done" role="status">
            <svg className="qa-check" viewBox="0 0 120 120" width="96" height="96" fill="none"><circle cx="60" cy="60" r="46" stroke="color-mix(in srgb, var(--accent) 70%, #fff)" strokeWidth="5" /><path className="sa-tick" d="M40 62l15 15 27-30" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <b className="qa-done-t">{done.title}</b>
            <div className="muted small">{done.sub}</div>
            {done.rows && (
              <div className="card qa-rows">
                <div className="row between small"><span className="muted">Extracted details</span></div>
                {done.rows.map(([k, v]) => <div key={k} className="row between"><span className="muted small">{k}</span><b className="small ellipsis" style={{ maxWidth: '60%' }}>{v}</b></div>)}
              </div>
            )}
            {done.rows && (
              <div className="row" style={{ gap: 10, width: '100%', marginTop: 8 }}>
                {done.undo && <button className="btn secondary grow" onClick={() => { done.undo?.(); onClose() }}>Undo</button>}
                <button className="btn grow" onClick={onClose}>Done</button>
              </div>
            )}
          </div>
        ) : voice !== 'idle' ? (
          <div className="vc">
            <div className="vc-orb"><div className="vc-wave l"><i /><i /><i /><i /><i /></div><span className={`vc-mic${voice === 'listening' ? ' live' : ''}`}><Icon name="mic" size={30} /></span><div className="vc-wave r"><i /><i /><i /><i /><i /></div></div>
            <div className="muted small">{voice === 'listening' ? 'Listening…' : 'Working it out…'}</div>
            <div className="vc-text">{transcript ? `“${transcript}”` : 'Say it like: 450 rupees Swiggy dinner'}</div>
            <div className="vc-chips" style={{ flexWrap: "wrap" }}>
              <span className={`vc-chip${live ? ' on' : ''}`}><small>Amount</small><b className="num">{live ? formatPrice(live.paymentAmount) : '—'}</b></span>
              <span className={`vc-chip${live ? ' on' : ''}`}><small>{live?.note ? 'For' : 'Merchant'}</small><b className="ellipsis">{live ? (live.note ?? live.paymentReceiver) : '—'}</b></span>
              {live && sourceName(live) && <span className="vc-chip on"><small>Paid from</small><b className="ellipsis">{sourceName(live)}</b></span>}
            </div>
            {voice === 'listening' && <button className="btn secondary" onClick={() => recRef.current?.stop()}>Done</button>}
          </div>
        ) : review ? (
          <div className="vc">
            <div className="vc-text">“{review}”</div>
            {live ? (
              <div className="vc-chips" style={{ flexWrap: "wrap" }}>
                <span className="vc-chip on"><small>Amount</small><b className="num">{formatPrice(live.paymentAmount)}</b></span>
                <span className="vc-chip on"><small>{live.note ? 'Note' : 'Merchant'}</small><b className="ellipsis">{live.note ?? live.paymentReceiver}</b></span>
                <span className="vc-chip on"><small>Category</small><b className="ellipsis">{live.paymentCategory}</b></span>
                {sourceName(live) && <span className="vc-chip on"><small>Paid from</small><b className="ellipsis">{sourceName(live)}</b></span>}
              </div>
            ) : <div className="small" style={{ color: 'var(--amber)' }}>I could not find an amount in that. Try again, or type it.</div>}
            <button className="btn block" disabled={!live || busy} onClick={async () => { const r = review; setReview(null); await save(r) }}>Use this</button>
            <div className="row between" style={{ width: '100%' }}>
              <button className="link small" onClick={() => startVoice()}>Try again</button>
              <button className="link small" onClick={() => { setText(review); setReview(null) }}>Edit as text</button>
            </div>
            <label className="row small dim" style={{ gap: 8 }}><Toggle on={voiceAuto} onChange={setVoiceAuto} label="Save voice entries without asking" />Save voice entries without asking</label>
          </div>
        ) : imageState ? (
          <div className="rc">
            <div className="rc-frame">
              {preview && <img src={preview} alt="" />}
              <i className="rc-c tl" /><i className="rc-c tr" /><i className="rc-c bl" /><i className="rc-c br" /><span className="rc-line" />
            </div>
            <div className="muted small" style={{ marginTop: 12 }}>{imageState}</div>
          </div>
        ) : (
          <>
            {presets.length > 0 && (
              <div className="qchips" style={{ marginTop: 0, marginBottom: 8 }} role="group" aria-label="Quick presets">
                {presets.map((p) => (
                  <button key={p.id} className="qchip" onClick={() => {
                    addTransaction({ paymentAmount: p.amount, paymentType: 'DEBIT', paymentReceiver: p.payee || p.label, paymentCategory: p.category, manualCategory: true, ...(methodId ? { paymentMethodId: methodId } : {}) }, { allowDuplicate: true })
                    toast(`${p.label} added`, formatPrice(p.amount)); onClose()
                  }}>{p.label} · {formatPrice(p.amount, { round: true })}</button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); save(text) }} className="col">
              <textarea
                className="input" autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={"450 swiggy dinner\ngot salary 50000\nor paste a bank SMS"}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(text) } }}
              />
              {methods.length > 0 && (
                <div className="chips">
                  {methods.map((m) => (
                    <button type="button" key={m.id} className={`chip${methodId === m.id ? ' on' : ''}`} onClick={() => setMethodId(methodId === m.id ? null : m.id)}>
                      <AccountLogo m={m} size={16} />{m.name}{m.last4 ? ` ••${m.last4}` : ''}
                    </button>
                  ))}
                </div>
              )}
              <button className="btn block" disabled={busy || !text.trim()}>{busy ? 'Adding...' : 'Save'}</button>
            </form>
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <button className="card pad grow col" style={{ alignItems: 'center', gap: 6, padding: '14px 6px' }} onClick={startVoice}><Icon name="mic" /><span className="small">Speak</span></button>
              <button className="card pad grow col" style={{ alignItems: 'center', gap: 6, padding: '14px 6px' }} onClick={pasteSms}><Icon name="message" /><span className="small">Paste SMS</span></button>
              <button className="card pad grow col" style={{ alignItems: 'center', gap: 6, padding: '14px 6px' }} onClick={() => imgInput.current?.click()}><Icon name="image" /><span className="small">Receipt</span></button>
              <button className="card pad grow col" style={{ alignItems: 'center', gap: 6, padding: '14px 6px' }} onClick={() => pdfInput.current?.click()}><Icon name="doc" /><span className="small">Statement</span></button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="link small" onClick={onManual}>Enter manually instead</button>
            </div>
          </>
        )}
        <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => onImages(e.target.files)} />
        <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setStatement(f); e.target.value = '' }} />
      </Sheet>
      {statement && <StatementImport file={statement} onClose={() => { setStatement(null); onClose() }} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Statement import: PROCESSING → PASSWORD_REQUIRED → UNLOCK_SUCCESS → PROCESSED / ERROR */
/* ------------------------------------------------------------------ */

const SCAN_MESSAGES = ['Reading your statement.', 'Finding transactions.', 'Spotting the ₹ signs.', 'Who took your money?', 'Sorting it all out.', 'Wrapping up.']

type ImportState =
  | { s: 'PROCESSING' }
  | { s: 'PASSWORD_REQUIRED'; wrong: boolean }
  | ({ s: 'UNLOCK_SUCCESS' } & Reading)
  | ({ s: 'SOURCE' } & Reading)
  | { s: 'PROCESSED'; rows: NewTransaction[]; outcome: ('added' | 'skipped' | 'held')[]; added: number; skipped: number; held: number; linked: Linked | null; app: string | null; ids: string[]; info: StatementInfo }
  | { s: 'ERROR'; message: string }

/** A statement read but not yet saved: the on-device rows, Gemini's rows (if any) and what it says about itself. */
interface Reading { local: StatementRow[]; ai: NewTransaction[] | null; info: StatementInfo }

/** What the user says the statement is: a bank account's, or a UPI app's. */
type StatementSource = { kind: 'bank'; accountId: string | null; bank: string | null } | { kind: 'app'; app: string }

const STATEMENT_APPS = UPI_APPS.filter((a) => a !== 'Bank app' && a !== 'Other')

/**
 * "Which statement is this?" before anything is saved: a bank account's (which one)
 * or a UPI app's (which app). Starts on what the statement itself suggests.
 */
function StatementSourcePicker({ reading, onPick, onCancel }: { reading: Reading; onPick: (s: StatementSource) => void; onCancel: () => void }) {
  const { info } = reading
  const accounts = getAccounts().filter((m) => m.type === 'BANK')
  const [kind, setKind] = useState<'bank' | 'app'>(info.app ? 'app' : 'bank')
  const [accountId, setAccountId] = useState<string | null>(info.accountId ?? (info.bank ? null : accounts.length === 1 ? accounts[0].id : null))
  const [bank, setBank] = useState<string | null>(info.accountId ? null : info.bank)
  const [app, setApp] = useState<string | null>(info.app)
  const count = (reading.ai ?? reading.local).length
  const ready = kind === 'app' ? !!app : !!(accountId || bank)
  const otherBanks = BANKS.slice(0, 16).filter((b) => !accounts.some((m) => (m.bank ?? detectBank(m.name)) === b.short))

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="eyebrow">Found {count} transaction{count === 1 ? '' : 's'}</div>
      <h2 className="h1">Which statement is this?</h2>
      <p className="muted small" style={{ margin: 0 }}>Transactions already in JustMoney (same amount at the same time) are skipped, so nothing is counted twice.</p>
      <div className="segmented">
        <button className={kind === 'bank' ? 'on' : ''} onClick={() => setKind('bank')}>Bank account</button>
        <button className={kind === 'app' ? 'on' : ''} onClick={() => setKind('app')}>UPI app</button>
      </div>
      {kind === 'bank' ? (
        <>
          {accounts.length > 0 && (
            <div className="field">
              <label>Your accounts</label>
              <div className="chips">
                {accounts.map((m) => (
                  <button key={m.id} className={`chip${accountId === m.id ? ' on' : ''}`} onClick={() => { setAccountId(m.id); setBank(null) }}>
                    <AccountLogo m={m} size={16} />
                    {m.name}{m.last4 ? ` ••${m.last4}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>{accounts.length ? 'Another bank (adds the account)' : 'Bank'}</label>
            <div className="chips">
              {otherBanks.map((b) => (
                <button key={b.short} className={`chip${!accountId && bank === b.short ? ' on' : ''}`} onClick={() => { setBank(b.short); setAccountId(null) }}>
                  <BrandLogo src={bankLogo(b.short)} size={16} radius={4} />{b.short}
                </button>
              ))}
            </div>
          </div>
          {info.closing && <div className="dim tiny">The account balance is updated to the statement's closing balance, {formatPrice(info.closing.balance)}.</div>}
        </>
      ) : (
        <div className="field">
          <label>App</label>
          <div className="chips">
            {STATEMENT_APPS.map((a) => (
              <button key={a} className={`chip${app === a ? ' on' : ''}`} onClick={() => setApp(a)}><BrandLogo src={appLogo(a)} size={16} radius={4} />{a}</button>
            ))}
          </div>
          <div className="dim tiny">Each payment is matched to your bank account when the statement names it.</div>
        </div>
      )}
      {info.held > 0 && <div className="dim tiny">{info.held} IPO / mandate block{info.held === 1 ? '' : 's'} will be saved as holds: shown in your list, not counted as spending.</div>}
      <button className="btn block" disabled={!ready} onClick={() => onPick(kind === 'app' ? { kind: 'app', app: app! } : { kind: 'bank', accountId, bank })}>
        Import {count} transaction{count === 1 ? '' : 's'}
      </button>
      <button className="btn block secondary" onClick={onCancel}>Cancel</button>
    </div>
  )
}

/** The account an imported statement was filed under. */
interface Linked { account: PaymentMethod; created: boolean; balance: number | null }

function StatementImport({ file, onClose }: { file: File; onClose: () => void }) {
  const [state, setState] = useState<ImportState>({ s: 'PROCESSING' })
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [msgIdx, setMsgIdx] = useState(0)
  const [shake, setShake] = useState(0)
  const pwRef = useRef<HTMLInputElement>(null)

  async function run(pw?: string) {
    setState({ s: 'PROCESSING' })
    try {
      const { text, lines } = await extractPdf(file, pw)
      const { rows: local, info } = analyseStatement(lines, file.name) // on-device: columns + running balance + bank
      let ai: NewTransaction[] | null = null
      if (aiReady()) {
        try {
          const got = (await extractInfoFromStatementText(text)).filter((t) => !isBlockEvent(`${t.paymentReceiver} ${t.note ?? ''}`))
          if (got.length) ai = got
        } catch { /* keep the on-device reading */ }
      }
      if (!local.length && !ai) {
        setState({ s: 'ERROR', message: 'No transactions found in this document. Make sure this is a digital (not scanned) bank or UPI app statement.' })
        return
      }
      setState({ s: pw ? 'UNLOCK_SUCCESS' : 'SOURCE', local, ai, info })
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        setState({ s: 'PASSWORD_REQUIRED', wrong: e.wrong })
        if (e.wrong) { setShake((n) => n + 1); setPassword(''); navigator.vibrate?.([30, 40, 30]) }
        return
      }
      setState({ s: 'ERROR', message: 'Failed to process the document. Please try again.' })
    }
  }

  /**
   * Saves the statement as the user described it. Rows already in the app (same amount
   * at the same time, from an SMS, a screenshot or another statement) are skipped.
   */
  /** The statement's IPO / mandate block and unblock rows are kept as holds, in the account the statement belongs to. */
  function saveHolds(info: StatementInfo, accountId: string | null) {
    for (const h of info.holds) recordHold(h.text, h.ts, { amount: h.amount, windowMs: 36 * 3600000, paymentMethodId: accountId ?? accountForHold(h.text), kind: /un-?block|release/i.test(h.text) || h.type === 'CREDIT' ? 'UNBLOCKED' : 'BLOCKED', name: parseHold(h.text)?.name })
  }
  function commit({ local, ai, info }: Reading, source: StatementSource) {
    if (source.kind === 'app') {
      // a UPI app's statement: each row may name the bank account it used
      const withAccounts = local.map((r) => ({ ...r, tx: { ...r.tx, paymentMethodId: detectAccount(r.raw) ?? undefined } }))
      const rows = (ai ? reconcileDirections(ai, withAccounts) : withAccounts.map((r) => r.tx)).map((r) => ({ ...r, paymentApp: source.app }))
      const { added, skipped, blocked, rows: saved, outcome } = addTransactionsBulk(rows)
      saveHolds(info, null)
      setState({ s: 'PROCESSED', rows, outcome, added, skipped, held: info.held + blocked, linked: null, app: source.app, ids: saved.map((t) => t.id), info })
      return
    }
    // a bank statement: every row came from that account
    const picked = source.accountId ? getAccounts().find((m) => m.id === source.accountId) : undefined
    const link = picked ? { account: picked, created: false } : linkStatementAccount({ ...info, accountId: null, bank: source.bank ?? info.bank })
    const base = ai ? reconcileDirections(ai, local) : local.map((r) => r.tx)
    const rows = link ? base.map((r) => ({ ...r, paymentMethodId: link.account.id })) : base
    const { added, skipped, blocked, rows: saved, outcome } = addTransactionsBulk(rows)
    const balance = link ? applyClosingBalance(link.account.id, info.closing) : null
    saveHolds(info, link?.account.id ?? null)
    setState({ s: 'PROCESSED', rows, outcome, added, skipped, held: info.held + blocked, linked: link ? { ...link, balance } : null, app: null, ids: saved.map((t) => t.id), info })
  }

  /** "Wrong bank?": file this import under another account instead. */
  function moveTo(account: PaymentMethod) {
    if (state.s !== 'PROCESSED') return
    if (state.linked?.created) mergeAccount(state.linked.account.id, account.id)
    else moveTransactions(state.ids, account.id)
    const balance = applyClosingBalance(account.id, state.info.closing)
    setState({ ...state, rows: state.rows.map((r) => ({ ...r, paymentMethodId: account.id })), linked: { account, created: false, balance } })
  }

  useEffect(() => { run() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (state.s !== 'PROCESSING') return
    const id = setInterval(() => setMsgIdx((i) => Math.min(i + 1, SCAN_MESSAGES.length - 1)), 1600)
    return () => clearInterval(id)
  }, [state.s])
  useEffect(() => {
    if (state.s === 'PASSWORD_REQUIRED') setTimeout(() => pwRef.current?.focus(), 280)
    if (state.s === 'UNLOCK_SUCCESS') { const t = setTimeout(() => setState({ ...state, s: 'SOURCE' }), 1400); return () => clearTimeout(t) }
  }, [state])

  return (
    <Sheet open onClose={onClose} full>
      {state.s === 'PROCESSING' && (
        <div className="col" style={{ alignItems: 'center', justifyContent: 'center', height: '70dvh', gap: 18, textAlign: 'center' }}>
          <div className="float" style={{ color: 'var(--orange)' }}><Icon name="doc" size={56} stroke={1.5} /></div>
          <div className="h2">{SCAN_MESSAGES[msgIdx]}</div>
          <div className="muted small ellipsis" style={{ maxWidth: '80%' }}>{file.name}</div>
          <div className="bar" style={{ width: '70%' }}><i style={{ width: `${((msgIdx + 1) / SCAN_MESSAGES.length) * 100}%`, background: 'var(--orange)' }} /></div>
        </div>
      )}

      {state.s === 'PASSWORD_REQUIRED' && (
        <form className="col" style={{ paddingTop: 40, gap: 16 }} onSubmit={(e) => { e.preventDefault(); if (password) run(password) }}>
          <div className="float" style={{ color: '#fb923c', alignSelf: 'center' }}><Icon name="lock" size={52} stroke={1.5} /></div>
          <div className="eyebrow" style={{ textAlign: 'center', color: '#fb923c' }}>Password protected</div>
          <h2 className="h1" style={{ textAlign: 'center' }}>Document is locked</h2>
          <p className="muted" style={{ textAlign: 'center', margin: 0 }}>Enter the password to unlock and import.</p>
          <div className="field" key={shake}>
            <label>PDF password</label>
            <div className={`row ${shake ? 'shake' : ''}`} style={{ position: 'relative' }}>
              <input ref={pwRef} className="input" type={show ? 'text' : 'password'} placeholder="••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off"
                style={state.wrong ? { borderColor: 'rgba(239,68,68,.7)', background: 'rgba(239,68,68,.08)' } : undefined} />
              <button type="button" onClick={() => setShow(!show)} style={{ position: 'absolute', right: 14 }} aria-label="Toggle visibility"><Icon name={show ? 'eyeOff' : 'eye'} size={20} /></button>
            </div>
            {state.wrong && <div className="error-text">Wrong password. Try again.</div>}
          </div>
          <button className="btn block" disabled={!password}>Unlock</button>
          <button type="button" className="btn block secondary" onClick={onClose}>Skip this file</button>
          <div className="dim tiny" style={{ textAlign: 'center' }}>password never stored · used once to read</div>
        </form>
      )}

      {state.s === 'UNLOCK_SUCCESS' && (
        <div className="col" style={{ alignItems: 'center', justifyContent: 'center', height: '70dvh', gap: 14 }}>
          <div style={{ width: 84, height: 84, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(74,222,128,.15)', color: 'var(--credit)', animation: 'fade-in .4s' }}><Icon name="check" size={44} stroke={2.5} /></div>
          <div className="h2">Unlocked</div>
          <div className="muted">Found {(state.ai ?? state.local).length} transactions</div>
        </div>
      )}

      {state.s === 'SOURCE' && <StatementSourcePicker reading={state} onPick={(src) => commit(state, src)} onCancel={onClose} />}

      {state.s === 'PROCESSED' && <ScanResult rows={state.rows} outcome={state.outcome} added={state.added} skipped={state.skipped} held={state.held} app={state.app} linked={state.linked} onMove={state.linked ? moveTo : undefined} onDone={onClose} />}

      {state.s === 'ERROR' && (
        <div className="col" style={{ paddingTop: 60, gap: 16 }}>
          <h2 className="h1">Sorry.<br />Try again.</h2>
          <p className="muted" style={{ margin: 0 }}>{state.message}</p>
          <button className="btn block" onClick={() => run()}>Try Again</button>
          <button className="btn block secondary" onClick={onClose}>Close</button>
        </div>
      )}
    </Sheet>
  )
}

const bankName = (methods: PaymentMethod[], id?: string | null) => {
  const m = id ? methods.find((x) => x.id === id) : null
  return m ? ` · ${m.bank ?? m.name}${m.last4 ? ` ··${m.last4}` : ''}` : ''
}

function ScanResult({ rows, outcome, added, skipped, held = 0, app, linked, onMove, onDone }: {
  rows: NewTransaction[]; outcome?: ('added' | 'skipped' | 'held')[]; added: number; skipped: number; held?: number; app?: string | null
  linked?: Linked | null; onMove?: (m: PaymentMethod) => void; onDone: () => void
}) {
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [picking, setPicking] = useState(false)
  const others = methods.filter((m) => m.type !== 'CREDIT_CARD' && m.id !== linked?.account.id)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (shown >= rows.length) return
    const t = setTimeout(() => setShown((n) => n + 1), Math.max(25, 1200 / rows.length))
    return () => clearTimeout(t)
  }, [shown, rows.length])
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="eyebrow">Live import</div>
      <div className="row between"><h2 className="h1">{shown} found</h2></div>
      <div className="bar"><i style={{ width: `${(shown / rows.length) * 100}%`, background: 'var(--credit)' }} /></div>
      {app && (
        <div className="card row" style={{ gap: 12, padding: 12 }}>
          <BrandLogo src={appLogo(app)} size={36} alt={app} fallback={<Icon name="wallet" size={20} />} />
          <div className="grow">
            <div className="small">From your <b>{app}</b> statement</div>
            <div className="dim tiny">Payments already saved from your bank or SMS were matched, not added again</div>
          </div>
        </div>
      )}
      {linked && (
        <div className="card row" style={{ gap: 12, padding: 12 }}>
          <BrandLogo src={bankLogo(linked.account.bank)} size={36} alt={linked.account.name} fallback={<Icon name="bank" size={20} />} />
          <div className="grow">
            <div className="small">{linked.created ? 'Added account' : 'Linked to'} <b>{linked.account.name}{linked.account.last4 ? ` ··${linked.account.last4}` : ''}</b></div>
            <div className="dim tiny">{linked.balance != null ? `Balance updated to ${formatPrice(linked.balance)} from the statement` : 'Balance kept as you set it'}</div>
          </div>
          {onMove && others.length > 0 && <button className="link small" onClick={() => setPicking(!picking)}>Wrong bank?</button>}
        </div>
      )}
      {picking && linked && onMove && (
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="small">This statement is from:</div>
          <div className="chips">
            {others.map((m) => (
              <button key={m.id} className="chip" onClick={() => { onMove(m); setPicking(false) }}>
                <AccountLogo m={m} size={16} />
                {m.name}{m.last4 ? ` ••${m.last4}` : ''}
              </button>
            ))}
          </div>
          {linked.created && <div className="dim tiny">The {linked.account.name} account added for this import will be removed.</div>}
        </div>
      )}
      <div className="card" style={{ maxHeight: '50dvh', overflowY: 'auto' }}>
        {rows.slice(0, shown).map((r, i) => (
          <div className="list-row" key={i} style={outcome?.[i] && outcome[i] !== 'added' ? { opacity: 0.45 } : undefined}>
            <div className="grow">
              <div className="ellipsis">{r.paymentReceiver}</div>
              <div className="dim tiny">
                {outcome?.[i] === 'skipped' ? 'Already in JustMoney · ' : outcome?.[i] === 'held' ? 'Block / unblock, ignored · ' : ''}
                {r.paymentType === 'CREDIT' ? 'Received' : 'Paid'}{r.timestamp ? ` · ${formatDateTime(r.timestamp, r.timeUnknown)}` : ''}{bankName(methods, r.paymentMethodId)}{r.paymentApp ? ` · ${r.paymentApp}` : ''}
              </div>
            </div>
            <div className="num" style={{ color: r.paymentType === 'CREDIT' ? 'var(--credit)' : 'var(--up)' }}>{r.paymentType === 'CREDIT' ? '+' : '-'}{formatPrice(r.paymentAmount)}</div>
          </div>
        ))}
      </div>
      {skipped > 0 && <div className="dim small" style={{ textAlign: 'center' }}>{skipped} already in JustMoney (same amount and time), skipped</div>}
      {held > 0 && <div className="dim small" style={{ textAlign: 'center' }}>{held} IPO / mandate block{held === 1 ? '' : 's'} saved as holds: money held, not spent</div>}
      <button className="btn block" onClick={onDone} disabled={shown < rows.length}>Done · {added} transaction{added === 1 ? '' : 's'} added</button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Edit / manual entry                                                 */
/* ------------------------------------------------------------------ */

/** Money received back on a loan; `id` is set once it's saved. */
interface Received { id?: string; amount: number; date: number; accountId: string | null }

/** "Money lent" toggle on an expense: when to expect it back and what has come back so far. */
function LentSection({ on, setOn, due, setDue, received, setReceived, amount, methods }: {
  on: boolean; setOn: (v: boolean) => void; due: string; setDue: (v: string) => void
  received: Received[]; setReceived: (r: Received[]) => void; amount: number; methods: PaymentMethod[]
}) {
  const [adding, setAdding] = useState(false)
  const [amt, setAmt] = useState('')
  const [at, setAt] = useState(toLocalInput(Date.now()))
  const [acc, setAcc] = useState<string | null>(null)
  const back = received.reduce((s, r) => s + r.amount, 0)
  const left = Math.max(0, Math.round((amount - back) * 100) / 100)
  const accName = (id: string | null) => { const m = methods.find((x) => x.id === id); return m ? ` · ${m.bank ?? m.name}${m.last4 ? ` ··${m.last4}` : ''}` : '' }

  function add() {
    const v = Math.round(Math.min(Number(amt), left || Number(amt)) * 100) / 100
    if (!(v > 0)) return
    setReceived([...received, { amount: v, date: new Date(at).getTime() || Date.now(), accountId: acc }].sort((a, b) => a.date - b.date))
    setAdding(false)
  }

  return (
    <div className="card pad col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span style={{ display: 'flex', color: 'var(--orange)' }}><Icon name="users" size={20} /></span>
        <div className="grow">
          <div>Money lent</div>
          <div className="dim tiny">Track it until you get it back · not counted as spending</div>
        </div>
        <Toggle on={on} onChange={setOn} label="Money lent" />
      </div>
      {on && (
        <>
          <div className="field" style={{ margin: 0 }}>
            <label>Expect it back by (optional)</label>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            {due && <div className="dim tiny">You'll get a reminder that morning if it's still pending.</div>}
          </div>
          {amount > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <div className="row between small">
                <span className="muted">Got back {formatPrice(back)} of {formatPrice(amount)}</span>
                <b className="num" style={{ color: left > 0 ? 'var(--amber)' : 'var(--credit)' }}>{left > 0 ? `${formatPrice(left)} to go` : 'Fully received'}</b>
              </div>
              <div className="bar"><i style={{ width: `${Math.min(100, (back / amount) * 100)}%`, background: 'var(--credit)' }} /></div>
            </div>
          )}
          {received.length > 0 && (
            <div className="col" style={{ gap: 0 }}>
              <div className="dim tiny" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Received back</div>
              {received.map((r, i) => (
                <div key={r.id ?? `new${i}`} className="row" style={{ gap: 10, padding: '8px 0', borderTop: i ? '1px solid var(--divider)' : 0 }}>
                  <AmountIcon credit size={20} />
                  <div className="grow">
                    <div className="num" style={{ color: 'var(--credit)' }}>+{formatPrice(r.amount)}</div>
                    <div className="dim tiny">{formatDateTime(r.date)}{accName(r.accountId)}{r.id ? '' : ' · saves with the transaction'}</div>
                  </div>
                  <button className="dim" aria-label="Remove" onClick={() => setReceived(received.filter((x) => x !== r))}><Icon name="close" size={16} /></button>
                </div>
              ))}
            </div>
          )}
          {(left > 0 || !amount) && !adding && (
            <button className="btn sm secondary" onClick={() => { setAmt(left ? String(left) : ''); setAt(toLocalInput(Date.now())); setAcc(null); setAdding(true) }}>
              <Icon name="plus" size={16} /> Add money received back
            </button>
          )}
          {adding && (
            <div className="col" style={{ gap: 10, padding: 12, borderRadius: 14, background: 'rgba(var(--fg),.04)' }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Amount received</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input num grow" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
                  {left > 0 && <button className={`chip${Number(amt) === left ? ' on' : ''}`} onClick={() => setAmt(String(left))}>All {formatPrice(left)}</button>}
                </div>
              </div>
              <div className="field" style={{ margin: 0 }}><label>Received on (date & time)</label><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>
              {methods.length > 0 && (
                <div className="field" style={{ margin: 0 }}>
                  <label>Into account</label>
                  <div className="chips">
                    <button className={`chip${!acc ? ' on' : ''}`} onClick={() => setAcc(null)}>None / cash</button>
                    {methods.filter((m) => m.type !== 'CREDIT_CARD').map((m) => (
                      <button key={m.id} className={`chip${acc === m.id ? ' on' : ''}`} onClick={() => setAcc(m.id)}>
                        <AccountLogo m={m} size={16} />
                        {m.name}{m.last4 ? ` ••${m.last4}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn sm secondary grow" onClick={() => setAdding(false)}>Cancel</button>
                <button className="btn sm grow" disabled={!(Number(amt) > 0)} onClick={add}>Add</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** On income: "this is money I lent, coming back". Pick whose loan it pays off. */
interface SplitChoice { projectId: string | null; who: string[]; newName: string; newFriends: string }

/** Sharing a payment in a SplitMoney group, equally among the people ticked. */
function SplitSection({ on, setOn, value, onChange, amount, tx, onUnsplit }: {
  on: boolean; setOn: (v: boolean) => void; value: SplitChoice; onChange: (v: SplitChoice) => void; amount: number
  tx: Transaction | null; onUnsplit: () => void
}) {
  const [projects] = useStored<SplitProject[]>(KEYS.splitProjects, [])
  const [people] = useStored<SplitPerson[]>(KEYS.splitPeople, [])
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  if (tx?.splitTxnId) {
    const others = splitSiblings(tx, all).reduce((a, x) => a + x.paymentAmount, 0)
    return (
      <div className="card pad row" style={{ gap: 12 }}>
        <span style={{ display: 'flex', color: 'var(--accent)' }}><Icon name="split" size={20} /></span>
        <div className="grow"><div>Split with a group</div><div className="dim tiny">Your share {formatPrice(tx.paymentAmount)} · {formatPrice(others)} for the others</div></div>
        <button type="button" className="chip" onClick={onUnsplit}>Remove split</button>
      </div>
    )
  }
  const members = people.filter((p) => p.projectId === value.projectId)
  const pick = (projectId: string | null) => onChange({ ...value, projectId, who: projectId ? people.filter((p) => p.projectId === projectId).map((p) => p.id) : [] })
  const n = value.projectId ? value.who.length : value.newFriends.split(',').filter((x) => x.trim()).length + 1
  const share = amount > 0 && n > 1 ? splitAmountEvenly(amount, n)[0] : 0
  const toggle = (id: string) => onChange({ ...value, who: value.who.includes(id) ? value.who.filter((x) => x !== id) : [...value.who, id] })
  const youIn = members.some((p) => p.isCurrentUser && value.who.includes(p.id))
  return (
    <div className="card pad col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span style={{ display: 'flex', color: 'var(--accent)' }}><Icon name="split" size={20} /></span>
        <div className="grow">
          <div>Split with a group</div>
          <div className="dim tiny">Only your share counts as your spending · added to SplitMoney</div>
        </div>
        <Toggle on={on} onChange={(v) => { setOn(v); if (v && !value.projectId && projects.length) pick(projects[projects.length - 1].id) }} label="Split with a group" />
      </div>
      {on && (
        <>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {projects.map((p) => <button type="button" key={p.id} className={`chip${value.projectId === p.id ? ' on' : ''}`} onClick={() => pick(p.id)}>{p.name}</button>)}
            <button type="button" className={`chip${!value.projectId ? ' on' : ''}`} onClick={() => pick(null)}>+ New group</button>
          </div>
          {value.projectId ? (
            <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label="Who shares it">
              {members.map((p) => <button type="button" key={p.id} className={`chip${value.who.includes(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)}>{p.isCurrentUser ? 'You' : p.name}</button>)}
            </div>
          ) : (
            <>
              <input className="input" value={value.newName} onChange={(e) => onChange({ ...value, newName: e.target.value })} placeholder="Group name, e.g. Goa trip" aria-label="Group name" />
              <input className="input" value={value.newFriends} onChange={(e) => onChange({ ...value, newFriends: e.target.value })} placeholder="Friends, separated by commas" aria-label="Friends" />
            </>
          )}
          {share > 0 && <div className="small muted">Split equally by {n}: {value.projectId && !youIn ? 'you paid it all for them' : <>your share <b style={{ color: 'var(--text)' }}>{formatPrice(share)}</b></>}</div>}
        </>
      )}
    </div>
  )
}

/** Money handled for someone else: who it was for (or from), and how much of it was theirs. */
function BehalfSection({ credit, on, setOn, personId, setPersonId, part, setPart, people, amount }: {
  credit: boolean; on: boolean; setOn: (v: boolean) => void; personId: string | null; setPersonId: (id: string) => void
  part: string; setPart: (v: string) => void; people: Person[]; amount: number
}) {
  const [picking, setPicking] = useState(false)
  const who = people.find((p) => p.id === personId)
  const theirs = part.trim() ? Number(part) : amount
  return (
    <div className="card pad col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span style={{ display: 'flex', color: 'var(--accent)' }}><Icon name="users" size={20} /></span>
        <div className="grow">
          <div>{credit ? 'Money for someone else' : 'Paid for someone else'}</div>
          <div className="dim tiny">{credit ? 'Their money to spend for them, or paying you back' : 'With their money, or they pay you back'} · not your {credit ? 'income' : 'spending'}</div>
        </div>
        <Toggle on={on} onChange={(v) => { setOn(v); if (v && !personId) setPicking(true) }} label={credit ? 'Money for someone else' : 'Paid for someone else'} />
      </div>
      {on && (
        <>
          <button type="button" className="qchip" style={{ justifyContent: 'center' }} onClick={() => setPicking(true)}>
            {who ? <>{credit ? 'From' : 'For'} <b>{who.name}</b> · change</> : credit ? 'Whose money is this?' : 'Who was it for?'}
          </button>
          <label className="row small muted" style={{ gap: 8 }}>
            <span className="grow">Their part{amount > 0 && theirs < amount ? ` · ${formatPrice(amount - theirs)} stays yours` : ' (the rest stays yours)'}</span>
            <input className="input num" inputMode="decimal" style={{ width: 120, textAlign: 'right' }} value={part} placeholder={amount ? String(amount) : 'All'} aria-label="Their part"
              onChange={(e) => setPart(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
        </>
      )}
      <ContactPicker open={picking} onClose={() => setPicking(false)} onPick={(p) => { setPicking(false); setPersonId(p.id) }} title={credit ? 'Whose money is this?' : 'Who did you pay for?'} />
    </div>
  )
}

function RepaySection({ loans, txId, value, onChange }: { loans: Loan[]; txId?: string; value: string | null; onChange: (id: string | null) => void }) {
  const open = loans.filter((l) => l.direction === 'LENT' && (!isSettledLoan(l) || l.id === value || l.repayments.some((r) => r.txId === txId)))
  if (!open.length) return null
  return (
    <div className="card pad col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span style={{ display: 'flex', color: 'var(--credit)' }}><Icon name="users" size={20} /></span>
        <div className="grow">
          <div>Money I lent, coming back</div>
          <div className="dim tiny">Reduces what they owe · not counted as income</div>
        </div>
        <Toggle on={!!value} onChange={(v) => onChange(v ? open[0].id : null)} label="Money I lent coming back" />
      </div>
      {value && (
        <div className="chips">
          {open.map((l) => (
            <button key={l.id} className={`chip${value === l.id ? ' on' : ''}`} onClick={() => onChange(l.id)}>{l.person} · {formatPrice(outstanding(l))} due</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function EditTransactionSheet({ tx, open, onClose, prefill }: { tx: Transaction | null; open: boolean; onClose: () => void; prefill?: Partial<NewTransaction> }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [family] = useStored<FamilyMember[]>(KEYS.familyMembers, [])
  const cats = withFamily(categories)
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'DEBIT' | 'CREDIT'>('DEBIT')
  const [receiver, setReceiver] = useState('')
  const [category, setCategory] = useState('Others')
  const [methodId, setMethodId] = useState<string | null>(null)
  const [when, setWhen] = useState(toLocalInput(Date.now()))
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const home = getCurrency()
  const [cur, setCur] = useState(home)
  const [rate, setRate] = useState('1')
  const [rateState, setRateState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [repeat, setRepeat] = useState<'NONE' | RecurringCadence>('NONE')
  const [app, setApp] = useState<string | null>(null)
  // money lent: the loan behind an expense, and money received back
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const [behalfPeople] = useStored<Person[]>(KEYS.people, [])
  const [lent, setLent] = useState(false)
  const [due, setDue] = useState('')
  const [received, setReceived] = useState<Received[]>([])
  const [repayOf, setRepayOf] = useState<string | null>(null) // income: which loan is being paid back
  // money handled for someone else: who, and how much of it was theirs (the rest stays yours)
  const [behalfFor, setBehalfFor] = useState<string | null>(null)
  const [behalfOn, setBehalfOn] = useState(false)
  const [behalfPart, setBehalfPart] = useState('')
  // sharing it in a SplitMoney group: only your share stays your spending
  const [splitOn, setSplitOn] = useState(false)
  const [split, setSplit] = useState<SplitChoice>({ projectId: null, who: [], newName: '', newFriends: '' })
  const [rules, setRules] = useStored<RecurringRule[]>(KEYS.recurringRules, [])
  const [txForRecents] = useStored<Transaction[]>(KEYS.transactions, [])
  // the categories you use most, shown first in the list
  const usedCategories = useMemo(() => {
    const n = new Map<string, number>()
    for (const x of txForRecents.slice(0, 300)) if (x.paymentType === (type === 'CREDIT' ? 'CREDIT' : 'DEBIT')) n.set(x.paymentCategory, (n.get(x.paymentCategory) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [txForRecents, type])
  const rule = tx?.recurringId ? rules.find((r) => r.id === tx.recurringId) : undefined

  useEffect(() => {
    if (!open) return
    const foreign = !!(tx?.originalCurrency && tx.originalAmount)
    setCur(foreign ? tx!.originalCurrency! : home)
    setRate(foreign ? String(Math.round((tx!.paymentAmount / tx!.originalAmount!) * 10000) / 10000) : '1')
    setNote(tx?.note ?? '')
    setRepeat('NONE')
    setAmount(tx ? String(foreign ? tx.originalAmount : tx.paymentAmount) : prefill?.paymentAmount ? String(prefill.paymentAmount) : '')
    setType(tx?.paymentType ?? prefill?.paymentType ?? 'DEBIT')
    setReceiver(tx?.paymentReceiver ?? (prefill?.paymentReceiver && !/^(Payment|Money received)$/.test(prefill.paymentReceiver) ? prefill.paymentReceiver : ''))
    const wasBehalf = tx?.paymentCategory === ON_BEHALF
    setCategory(wasBehalf ? tx!.behalfFrom ?? (tx!.paymentType === 'CREDIT' ? 'Other income' : 'Others') : tx?.paymentCategory ?? (prefill?.paymentCategory === ON_BEHALF ? 'Others' : prefill?.paymentCategory) ?? 'Others')
    setBehalfOn(wasBehalf)
    setBehalfFor(wasBehalf ? tx!.contactId ?? null : null)
    setBehalfPart('')
    const wantSplit = !!tx && takeSplitIntent(tx.id)
    setSplitOn(wantSplit && !tx?.splitTxnId)
    // "Split this" starts on your newest group with everyone in it; with no group yet, a new one named after the payee
    const lastGroup = read<SplitProject[]>(KEYS.splitProjects, []).filter((p) => !p.direct).at(-1)
    setSplit(wantSplit && lastGroup
      ? { projectId: lastGroup.id, who: read<SplitPerson[]>(KEYS.splitPeople, []).filter((p) => p.projectId === lastGroup.id).map((p) => p.id), newName: '', newFriends: '' }
      : { projectId: null, who: [], newName: wantSplit ? tx!.paymentReceiver : '', newFriends: '' })
    setMethodId(tx?.paymentMethodId ?? prefill?.paymentMethodId ?? null)
    setApp(tx?.paymentApp ?? prefill?.paymentApp ?? null)
    setWhen(toLocalInput(tx?.timestamp ?? prefill?.timestamp ?? Date.now()))
    setErr('')
    const loan = tx?.loanId ? getLoans().find((l) => l.id === tx.loanId) : undefined
    const isLend = !!loan && loan.direction === 'LENT' && tx?.paymentType === 'DEBIT'
    setLent(isLend)
    setDue(isLend && loan.dueDate ? toLocalInput(loan.dueDate).slice(0, 10) : '')
    setReceived(isLend ? loan.repayments.map((r) => ({ id: r.id, amount: r.amount, date: r.date, accountId: r.accountId ?? null })) : [])
    setRepayOf(loan && tx?.paymentType === 'CREDIT' && loan.repayments.some((r) => r.txId === tx.id) ? loan.id : null)
  }, [open, tx]) // eslint-disable-line react-hooks/exhaustive-deps

  async function pickCurrency(c: string) {
    setCur(c)
    if (c === home) { setRate('1'); return }
    setRateState('loading')
    try {
      setRate(String(Math.round((await getRate(c, home)) * 10000) / 10000))
      setRateState('idle')
    } catch {
      setRateState('error')
    }
  }

  /** Saves an expense that is money lent, or income that is a lent amount coming back. */
  function saveLoanSide(fields: Omit<NewTransaction, 'paymentMethodId'> & { paymentMethodId: string | null }, timestamp: number, lending: boolean, repaying: Loan | undefined, a: number) {
    const { paymentMethodId, ...rest } = fields
    const base = { ...rest, paymentMethodId: paymentMethodId ?? undefined }
    if (repaying) {
      if (tx) {
        updateTransaction(tx.id, { ...base, timestamp, loanId: repaying.id })
        const moved = { id: tx.id, loanId: repaying.id, paymentAmount: a, timestamp, paymentMethodId }
        if (tx.loanId === repaying.id) syncRepaymentFromTransaction(moved)
        else { if (tx.loanId) forgetRepaymentTransaction(tx.id); attachRepaymentTransaction(repaying.id, moved) }
        toast('Repayment updated')
      } else {
        const capped = Math.min(a, outstanding(repaying))
        addRepayment(repaying.id, a, paymentMethodId, timestamp, true)
        const left = outstanding(getLoans().find((l) => l.id === repaying.id)!)
        toast(`${formatPrice(capped)} back from ${repaying.person}`, left > 0 ? `${formatPrice(left)} still to come` : 'All paid back')
      }
      return
    }
    if (!lending) return
    let id = tx?.id
    if (tx) updateTransaction(tx.id, { ...base, timestamp })
    else id = addTransaction({ ...base, timestamp, manualCategory: true }, { allowDuplicate: true }).id
    if (!id) return
    const dueTs = due ? new Date(`${due}T09:00`).getTime() : null
    const loanId = lendFromTransaction({ id, loanId: tx?.loanId }, {
      person: receiver.trim(), amount: a, date: timestamp, accountId: paymentMethodId, dueDate: dueTs, note: note.trim() || null,
    })
    for (const r of getLoans().find((l) => l.id === loanId)?.repayments ?? []) if (!received.some((x) => x.id === r.id)) deleteRepayment(loanId, r.id)
    for (const r of received) if (!r.id) addRepayment(loanId, r.amount, r.accountId, r.date, true)
    const left = outstanding(getLoans().find((l) => l.id === loanId)!)
    toast(tx ? 'Loan updated' : `Lent ${formatPrice(a)} to ${receiver.trim()}`,
      left > 0 ? `${formatPrice(left)} to get back${dueTs ? ` by ${new Date(dueTs).toLocaleDateString()}` : ''}` : 'All paid back')
  }

  async function save() {
    const entered = Number(amount)
    if (!(entered > 0)) { setErr('Enter a valid amount'); return }
    const r = Number(rate)
    if (cur !== home && !(r > 0)) { setErr('Enter the exchange rate'); return }
    const foreign = cur !== home
    const a = foreign ? Math.round(entered * r * 100) / 100 : entered
    const fx = foreign ? { originalAmount: entered, originalCurrency: cur } : { originalAmount: undefined, originalCurrency: undefined }
    const timestamp = new Date(when).getTime() || Date.now()
    const lending = type === 'DEBIT' && lent
    const repaying = type === 'CREDIT' ? loans.find((l) => l.id === repayOf) : undefined
    if (lending && !receiver.trim()) { setErr('Who did you lend it to?'); return }
    const gotBack = received.reduce((s, x) => s + x.amount, 0)
    if (lending && gotBack > a + 0.001) { setErr(`You've already got ${formatPrice(gotBack)} back, more than this amount`); return }
    const behalf = behalfOn && !lending && !repaying
    const part = behalfPart.trim() ? Number(behalfPart) : a
    const splitting = splitOn && type === 'DEBIT' && !lending && !behalfOn && !tx?.splitTxnId
    // your share and the friends' share were worked out from the full amount: changing one alone would make them disagree
    if (tx?.splitTxnId && Math.abs(a - tx.paymentAmount) > 0.004) { setErr('This payment is split. Remove the split first, then change the amount and split it again'); return }
    if (splitting && !split.projectId && !(split.newName.trim() && split.newFriends.trim())) { setErr('Pick a group, or name a new one and the friends in it'); return }
    if (splitting && split.projectId && !split.who.length) { setErr('Pick who shares it'); return }
    if (behalf && !behalfFor) { setErr(type === 'CREDIT' ? 'Whose money is this?' : 'Who did you pay for?'); return }
    if (behalf && !(part > 0 && part <= a + 0.001)) { setErr('Their part must be more than 0 and not more than the amount'); return }
    const cat = lending || repaying ? LOAN : category === LOAN || category === ON_BEHALF ? 'Others' : category
    const fields = { paymentAmount: a, paymentType: type, paymentReceiver: receiver.trim() || (repaying ? `${repaying.person} repaid` : type === 'CREDIT' ? category : 'Expense'), paymentCategory: cat, paymentMethodId: methodId, paymentApp: app, note: note.trim() || undefined, behalfFrom: undefined, ...fx }
    if (lending || repaying) {
      saveLoanSide(fields, new Date(when).getTime() || Date.now(), lending, repaying, a)
      onClose()
      return
    }
    if (tx?.loanId) {
      // no longer a loan entry
      if (tx.paymentType === 'DEBIT' && getLoans().some((l) => l.id === tx.loanId && l.txId === tx.id)) unlendTransaction(tx.loanId)
      else forgetRepaymentTransaction(tx.id)
      updateTransaction(tx.id, { loanId: undefined })
    }
    let recurringId: string | undefined
    if (repeat !== 'NONE') {
      const { paymentMethodId, ...rest } = fields
      recurringId = createRecurringRule({ ...rest, paymentMethodId: paymentMethodId ?? undefined }, repeat, advance(timestamp, repeat), new Date(timestamp).getDate()).id
    }
    // their part goes to On behalf (not your spending or income); the rest, if any, stays in the chosen category
    const markBehalf = (id?: string) => {
      const saved = id ? read<Transaction[]>(KEYS.transactions, []).find((x) => x.id === id) : undefined
      if (!saved || !behalfFor) return
      markOnBehalf(saved, behalfFor, Math.min(part, saved.paymentAmount))
      const who = behalfPeople.find((p) => p.id === behalfFor)?.name ?? 'them'
      const b = behalfBalance(behalfFor)
      toast(type === 'CREDIT' ? `Money from ${who}` : `Paid for ${who}`, Math.abs(b) < 1 ? `All square with ${who}` : b > 0 ? `${formatPrice(b, { round: true })} of ${who}’s money still with you` : `${who} still owes you ${formatPrice(-b, { round: true })}`)
    }
    // share it in the group: your share stays here, the friends' share moves to a Split entry
    const applySplit = (id?: string) => {
      const saved = id ? read<Transaction[]>(KEYS.transactions, []).find((x) => x.id === id) : undefined
      if (!saved) return
      let projectId = split.projectId
      let who = split.who
      if (!projectId) {
        const friends = split.newFriends.split(',').map((x) => x.trim()).filter(Boolean)
        projectId = newSplitGroup(split.newName, read<{ name?: string } | null>(KEYS.user, null)?.name ?? 'You', friends)
        who = read<SplitPerson[]>(KEYS.splitPeople, []).filter((x) => x.projectId === projectId).map((x) => x.id)
      }
      const mine = splitPayment(saved, projectId, who)
      if (mine !== null) toast('Split with the group', `Your share ${formatPrice(mine)} · ${formatPrice(saved.paymentAmount - mine)} for the others, not your spending`)
    }
    if (tx && splitting) {
      updateTransaction(tx.id, { ...fields, timestamp, ...(recurringId ? { recurringId } : {}) })
      applySplit(tx.id)
    } else if (tx && behalf) {
      updateTransaction(tx.id, { ...fields, timestamp, ...(recurringId ? { recurringId } : {}) })
      markBehalf(tx.id)
    } else if (tx) {
      updateTransaction(tx.id, { ...fields, timestamp, ...(recurringId ? { recurringId } : {}) })
      const payee = fields.paymentReceiver
      // a payee you renamed keeps its new name on every other payment written the old way
      if (payee !== tx.paymentReceiver && !tx.contactId && !tx.loanId && !/^(Expense|Payment|Money received)$/.test(payee) && !INCOME_CATEGORIES.includes(payee)) {
        const n = learnPayeeName(tx.rawReceiver ?? tx.paymentReceiver, payee)
        if (n > 1) toast(`Renamed ${n} payments to “${payee}”`, 'Future ones will use this name too.')
      }
      if (category !== tx.paymentCategory && payee && !/^(Expense|Payment|Money received)$/.test(payee) && !INCOME_CATEGORIES.includes(payee)) {
        toast(`Category set to ${category}`, `Always use ${category} for “${payee}”?`, { label: 'Always', onClick: () => { learnRule(payee, category, type); toast('Rule saved', `${payee} → ${category}`) } })
      } else toast('Transaction updated', recurringId ? `Repeats ${repeat.toLowerCase()}` : undefined)
    } else {
      // a second look before saving a payment that looks off (a twin of one just saved, or far above the usual)
      const draft: Transaction = { id: 'draft', timestamp, paymentAmount: a, paymentType: type, paymentReceiver: fields.paymentReceiver, paymentCategory: cat, createdAt: Date.now(), updatedAt: Date.now() }
      const odd = detectAnomalies(read<Transaction[]>(KEYS.transactions, []), [draft])[0]
      if (odd && !(await confirm({ title: odd.title, body: `${odd.body} Save it anyway?`, confirm: 'Save anyway' }))) return
      // only your own part counts against the plan
      if (!(await planAllows({ paymentAmount: behalf ? a - part : a, paymentType: type, paymentCategory: cat, timestamp }, confirm))) return
      const res = addTransaction({ ...fields, timestamp, recurringId, manualCategory: true })
      if (behalf && res.id) markBehalf(res.id)
      else if (splitting && res.id) applySplit(res.id)
      else toast(res.duplicate ? 'Looks like a duplicate' : type === 'CREDIT' ? 'Income added' : 'Expense added', res.duplicate ? 'This expense is already in your list.' : recurringId ? `Repeats ${repeat.toLowerCase()}` : undefined)
    }
    if (recurringId) processRecurring()
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="row between" style={{ marginBottom: 18 }}>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        <h2 className="h2" style={{ fontSize: 18 }}>{tx ? 'Edit Transaction' : 'New Transaction'}</h2>
        <button className="icon-btn" style={{ background: 'var(--btn-bg)', color: 'var(--btn-fg)' }} onClick={save} aria-label="Save"><Icon name="check" size={18} stroke={2.5} /></button>
      </div>
      <div className="col" style={{ gap: 16 }}>
        <div className="segmented">
          <button className={type === 'DEBIT' ? 'on' : ''} onClick={() => { setType('DEBIT'); if (INCOME_CATEGORIES.includes(category) && category !== FAMILY) setCategory('Others') }}>Expense</button>
          <button className={type === 'CREDIT' ? 'on' : ''} onClick={() => { setType('CREDIT'); if (!INCOME_CATEGORIES.includes(category)) setCategory('Salary') }}>Income</button>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
          <span className="big-amount dim">{currencySymbol(cur)}</span>
          <input className="big-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setErr('') }} placeholder="0"
            style={{ background: 'none', border: 0, outline: 'none', width: `${Math.max(amount.length, 1) + 1}ch`, maxWidth: '70%' }} autoFocus={!tx} />
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <span className="dim" style={{ display: 'flex' }}><Icon name="globe" size={16} /></span>
          <select className="input" aria-label="Currency" style={{ width: 'auto', height: 36, padding: '0 12px', fontSize: 14 }} value={cur} onChange={(e) => pickCurrency(e.target.value)}>
            {CURRENCIES.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
          </select>
        </div>
        {cur !== home && (
          <div className="card pad col" style={{ gap: 8 }}>
            <div className="row small" style={{ gap: 8 }}>
              <span className="muted">1 {cur} =</span>
              <input className="input num" inputMode="decimal" style={{ height: 36, width: 110 }} value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Exchange rate" />
              <span className="muted">{home}</span>
              {rateState === 'loading' && <Spinner />}
            </div>
            {rateState === 'error' && <div className="small" style={{ color: 'var(--amber)' }}>Couldn't fetch today's rate — enter it manually.</div>}
            {Number(amount) > 0 && Number(rate) > 0 && <div className="small">≈ <b className="num">{formatPrice(Number(amount) * Number(rate), { currency: home })}</b> will be recorded</div>}
          </div>
        )}
        {err && <div className="error-text" style={{ textAlign: 'center' }}>{err}</div>}
        {type === 'DEBIT' && (
          <LentSection on={lent} setOn={setLent} due={due} setDue={setDue} received={received} setReceived={setReceived} methods={methods}
            amount={Number(amount) > 0 ? (cur !== home ? Number(amount) * (Number(rate) || 0) : Number(amount)) : 0} />
        )}
        {type === 'CREDIT' && (
          <RepaySection loans={loans} txId={tx?.id} value={repayOf} onChange={(id) => {
            setRepayOf(id)
            const l = loans.find((x) => x.id === id)
            if (l && !receiver.trim()) setReceiver(`${l.person} repaid`)
            if (l && !amount) setAmount(String(outstanding(l)))
          }} />
        )}
        {!(type === 'DEBIT' && lent) && !(type === 'CREDIT' && repayOf) && !(type === 'DEBIT' && splitOn) && !tx?.splitTxnId && (
          <BehalfSection credit={type === 'CREDIT'} on={behalfOn} setOn={(v) => { setBehalfOn(v); setErr('') }} personId={behalfFor} setPersonId={setBehalfFor}
            part={behalfPart} setPart={setBehalfPart} people={behalfPeople}
            amount={Number(amount) > 0 ? (cur !== home ? Number(amount) * (Number(rate) || 0) : Number(amount)) : 0} />
        )}
        {type === 'DEBIT' && !lent && !behalfOn && (
          <SplitSection on={splitOn} setOn={(v) => { setSplitOn(v); setErr('') }} value={split} onChange={setSplit} tx={tx}
            amount={Number(amount) > 0 ? (cur !== home ? Number(amount) * (Number(rate) || 0) : Number(amount)) : 0}
            onUnsplit={() => { if (tx) { unsplitPayment(tx); toast('Split removed', 'The full amount is yours again'); onClose() } }} />
        )}
        {!(type === 'DEBIT' && lent) && !(type === 'CREDIT' && repayOf) && (
          <div className="field">
            <label>{behalfOn ? (type === 'CREDIT' ? 'Source (for any part that is yours)' : 'Category (what it was)') : type === 'CREDIT' ? 'Source' : 'Select Category'}</label>
            <SelectField title={type === 'CREDIT' ? 'Source' : 'Category'} value={category} onChange={(c) => c && setCategory(c)} recent={usedCategories}
              options={[...(type === 'CREDIT' ? INCOME_CATEGORIES : cats), SELF_TRANSFER, ...(type === 'CREDIT' ? [SPLIT] : [])].map((c) => ({ id: c, label: c, icon: <span className="sf-dot" style={{ color: categoryColor(c), background: `${categoryColor(c)}22` }}><Icon name={categoryIcon(c)} size={16} /></span> }))} />
          </div>
        )}
        <div className="field">
          <label>{type === 'CREDIT' ? 'From (optional)' : lent ? 'Lent to' : category === FAMILY ? 'Sent to' : 'Receiver'}</label>
          <input className="input" value={receiver} onChange={(e) => setReceiver(e.target.value)}
            placeholder={type === 'DEBIT' && lent ? 'e.g. Rohan' : type === 'CREDIT' ? (category === FAMILY ? 'e.g. Dad' : category === 'Stocks & IPO' ? 'e.g. Zerodha, Tata Tech IPO' : category === 'Salary' ? 'e.g. Employer name' : 'Who or where it came from') : category === FAMILY ? 'e.g. Mom' : 'e.g. Swiggy'} />
          {type === 'DEBIT' && !lent && category !== FAMILY && isDescription(receiver, guessCategory) && !note.toLowerCase().includes(receiver.trim().toLowerCase()) && (
            <button type="button" className="nl-hint" onClick={() => { setNote(note.trim() ? `${note.trim()} ${receiver.trim()}` : receiver.trim()); setReceiver(''); buzz(8) }}>
              <Icon name="edit" size={14} /> “{receiver.trim()}” sounds like what you bought. <b>Save it as a note instead</b>
            </button>
          )}
          {category === FAMILY && family.length > 0 && (
            <div className="chips">{family.map((m) => (
              <button key={m.id} className={`chip${receiver === m.name ? ' on' : ''}`} onClick={() => setReceiver(m.name)}>{m.name}{m.relation && m.relation !== m.name ? ` · ${m.relation}` : ''}</button>
            ))}</div>
          )}
        </div>
        {methods.length > 0 && (
          <div className="field">
            <label>{type === 'CREDIT' ? 'Into account' : 'From account / card'}</label>
            <SelectField title={type === 'CREDIT' ? 'Into account' : 'From account or card'} value={methodId} none="None" onChange={setMethodId}
              options={methods.map((m) => ({ id: m.id, label: `${m.name}${m.last4 ? ` ••${m.last4}` : ''}`, icon: <AccountLogo m={m} size={26} /> }))} />
          </div>
        )}
        <div className="field">
          <label>{type === 'CREDIT' ? 'Received via (optional)' : 'Paid via (optional)'}</label>
          <SelectField title="Paid with" value={app} none="None" onChange={setApp} searchAbove={12}
            options={UPI_APPS.map((a) => ({ id: a, label: a, icon: <BrandLogo src={appLogo(a)} size={26} radius={7} fallback={<span className="sf-dot"><Icon name="card" size={15} /></span>} /> }))} />
        </div>
        {tx?.paymentSource && !methodId && <div className="dim small">Detected source: {SOURCE_LABELS[tx.paymentSource]}</div>}
        <div className="field"><label>Note</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note — use #tags like #goa #work" /></div>
        <div className="field"><label>{type === 'DEBIT' && lent ? 'Lent on (date & time)' : 'Date & Time'}</label><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        {rule ? (
          <div className="card pad row small">
            <Icon name="repeat" size={18} />
            <span className="grow">{rule.enabled ? `Repeats ${rule.cadence.toLowerCase()} · next on ${new Date(rule.nextAt).toLocaleDateString()}` : 'Repeating is stopped'}</span>
            {rule.enabled && <button className="link" onClick={() => { setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: false } : r))); toast('Stopped repeating') }}>Stop</button>}
          </div>
        ) : (
          <div className="field">
            <label>Repeat</label>
            <div className="segmented">
              {(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((r) => <button key={r} className={repeat === r ? 'on' : ''} onClick={() => setRepeat(r)}>{r === 'NONE' ? 'NEVER' : r}</button>)}
            </div>
            {repeat !== 'NONE' && <div className="dim small">A copy is added automatically every {repeat === 'WEEKLY' ? 'week' : repeat === 'MONTHLY' ? 'month' : 'year'} from this date.</div>}
          </div>
        )}
        {tx && (
          <button className="btn block danger" onClick={() => {
            const r = removeTransaction(tx)
            toast('Transaction deleted', r.count > 1 ? `With ${r.count - 1} linked entr${r.count === 2 ? 'y' : 'ies'}` : undefined, { label: 'Undo', onClick: r.undo })
            onClose()
          }}>
            <Icon name="trash" size={18} /> Delete transaction
          </button>
        )}
      </div>
    </Sheet>
  )
}
