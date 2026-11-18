import { useEffect, useRef, useState } from 'react'
import { Icon, Sheet, SheetHeader, Spinner } from '../ui/ui'
import { ask, type Answer } from '../../lib/capture/ask'
import { Device, isNativeApp } from '../../lib/core/native'
import { getCurrency } from '../../lib/core/format'
import { useStored, KEYS } from '../../lib/core/storage'

const SUGGESTIONS = [
  'How much did I spend this month?',
  'How much did I send Mom this year?',
  'Food spend last month',
  'Can I afford ₹30,000 this month?',
  'Who owes me money?',
  'What is my bank balance?',
  'Biggest expenses this month',
  'How much did I pay via PhonePe this month?',
]
const SOURCE: Record<Answer['source'], string> = { 'on-device': 'Calculated on your phone', 'gemini-nano': 'Gemini Nano · on-device', gemini: 'Gemini', none: '' }

interface Msg { role: 'user' | 'bot'; text: string; source?: Answer['source'] }

const FOLLOW_UPS = [
  'How much did I spend last month?', 'Biggest expenses this month', 'Who owes me money?', 'What is my bank balance?',
  'Can I afford ₹10,000 this month?', 'How much did I spend this year?', 'Food spend this month', 'Compare this month with last month',
]
/** Up to three next questions that haven't been asked yet in this chat. */
const followUps = (asked: string[]) => FOLLOW_UPS.filter((q) => !asked.some((a) => a.toLowerCase() === q.toLowerCase())).slice(0, 3)

/** "Ask your money" chat. */
export default function AskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [saved, setSaved] = useStored<Msg[]>(KEYS.askHistory, [])
  const msgs = saved
  const setMsgs = (f: (m: Msg[]) => Msg[]) => setSaved((cur) => f(cur).slice(-40))
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(text: string) {
    const t = text.trim()
    if (!t || busy) return
    setQ('')
    setMsgs((m) => [...m, { role: 'user', text: t }])
    setBusy(true)
    try {
      const a = await ask(t)
      setMsgs((m) => [...m, { role: 'bot', text: a.text, source: a.source }])
    } finally {
      setBusy(false)
    }
  }

  async function voice() {
    try {
      const { text } = await Device.recognizeSpeech({ language: getCurrency() === 'INR' ? 'en-IN' : 'en-US', prompt: 'Ask about your money' })
      if (text) send(text)
    } catch { /* cancelled or unavailable */ }
  }

  return (
    <Sheet open={open} onClose={onClose} full>
      <div className="chat-shell">
      <SheetHeader title={<>Ask your money</>} sub="Questions about your spending, income, balances and plans." onClose={onClose} />
      {msgs.length > 0 && <button className="link small" style={{ marginBottom: 8 }} onClick={() => setSaved([])}>Start a new chat</button>}
      <div className="col chat-scroll" style={{ gap: 10 }}>
        {msgs.length === 0 && (
          <div className="row wrap" style={{ gap: 8 }}>
            {SUGGESTIONS.map((s) => <button key={s} className="chip" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%' }}>
            <div style={{
              padding: '10px 14px', borderRadius: 18, lineHeight: 1.45, fontSize: 15,
              background: m.role === 'user' ? 'var(--blue)' : 'var(--card)', color: m.role === 'user' ? '#fff' : 'var(--text)',
              border: m.role === 'user' ? 'none' : '1px solid var(--card-border)',
              borderBottomRightRadius: m.role === 'user' ? 6 : 18, borderBottomLeftRadius: m.role === 'bot' ? 6 : 18,
            }}>{m.text}</div>
            {m.source && SOURCE[m.source] && <div className="tiny dim" style={{ marginTop: 4, marginLeft: 6 }}>{SOURCE[m.source]}</div>}
          </div>
        ))}
        {busy && <div className="row small muted" style={{ gap: 8 }}><Spinner /> Thinking…</div>}
        {!busy && msgs.length > 0 && msgs[msgs.length - 1].role === 'bot' && (
          <div className="row wrap" style={{ gap: 8 }} role="group" aria-label="Ask next">
            {followUps(msgs.filter((m) => m.role === 'user').map((m) => m.text)).map((s) => <button key={s} className="qchip" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="row chat-dock" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(q) }}>
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about your money…" aria-label="Question" />
        {isNativeApp() && <button type="button" className="icon-btn" onClick={voice} aria-label="Ask by voice"><Icon name="mic" size={18} /></button>}
        <button className="icon-btn" style={{ background: 'var(--btn-bg)', color: 'var(--btn-fg)' }} disabled={!q.trim() || busy} aria-label="Send"><Icon name="send" size={18} /></button>
      </form>
      </div>
    </Sheet>
  )
}
