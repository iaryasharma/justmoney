import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  sparkles: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  split: <><circle cx="12" cy="12" r="9" /><path d="M8 9h4M10 7v4M8 15.5h8" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M16 13.5h2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5 10 17l9-10" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  upload: <path d="M12 21V9M7 14l5-5 5 5M5 3h14" />,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 21 2M17 6l3 3M14 9l2 2" /></>,
  star: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
  bank: <><path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18" /></>,
  calc: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8" /></>,
  percent: <><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M21 14v7h-4M14 21h.01" /></>,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3" /></>,
  refresh: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  filter: <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  pie: <><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  message: <path d="M4 5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  insights: <><path d="M21 12.5A9 9 0 1 1 11.5 3v9.5z" /><path d="M15.5 3.2A9 9 0 0 1 20.8 8.5h-5.3z" /></>,
  planner: <><rect x="4" y="4" width="16" height="17" rx="3" /><path d="M9 3v3M15 3v3M8 11h8M8 15h4" /><path d="M14.5 16.5l1.6 1.6 3-3.2" /></>,
  bars: <path d="M6 20v-6M12 20V6M18 20v-10" />,
  ticket: <><path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z" /><path d="M13 6v12" strokeDasharray="2 2" /></>,
  cookie: <><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" /><path d="M8.5 8.5v.01M16 15.5v.01M12 12v.01M11 17v.01M7 14v.01" /></>,
  fuel: <><path d="M5 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17" /><path d="M3 21h13M5 9h9" /><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3" /></>,
  dumbbell: <><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" /></>,
  gamepad: <><path d="M7 7h10a5 5 0 0 1 5 5v1a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-1a5 5 0 0 1 5-5z" /><path d="M8 10v3M6.5 11.5h3M16 11h.01M18 12.5h.01" /></>,
  bag: <><path d="M5 8h14l-1 13H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  plane: <path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z" />,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6" /></>,
  utensils: <><path d="M5 3v7a3 3 0 0 0 6 0V3M8 3v18" /><path d="M16 21V3c2.5 1 4 4 4 8h-4" /></>,
  dots: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  heart: <path d="M12 20s-7.5-4.6-9-9.3C1.9 7.2 4.3 4 7.6 4c2 0 3.4 1.2 4.4 2.6C13 5.2 14.4 4 16.4 4c3.3 0 5.7 3.2 4.6 6.7C19.5 15.4 12 20 12 20z" />,
  receipt: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  play: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.5v5l4.5-2.5z" /></>,
  sort: <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
}

/** A short vibration on supporting phones (no-op elsewhere). */
export const buzz = (ms: number | number[] = 12) => { try { navigator.vibrate?.(ms) } catch { /* unsupported */ } }

/** A ring chart: one arc per slice, gaps between them, optional content in the hole. */
export function Donut({ slices, size = 168, thickness = 30, highlight, onSelect, label = 'Spending by category', children }: {
  slices: { label: string; value: number; color: string }[]; size?: number; thickness?: number
  highlight?: string | null; onSelect?: (label: string | null) => void; label?: string; children?: ReactNode
}) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const gap = slices.length > 1 ? 2 : 0
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(var(--fg),.06)" strokeWidth={thickness} />
        {total > 0 && slices.map((s) => {
          const len = (s.value / total) * c
          const dash = Math.max(0, len - gap)
          const el = (
            <circle key={s.label} className="donut-seg" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset}
              opacity={highlight && highlight !== s.label ? 0.25 : 1}
              style={{ transition: 'opacity .22s', cursor: 'pointer' }}
              onClick={() => onSelect?.(highlight === s.label ? null : s.label)} />
          )
          offset += len
          return el
        })}
      </svg>
      {children && <div style={{ position: 'absolute', inset: thickness, borderRadius: '50%', display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>{children}</div>}
    </div>
  )
}

export function Icon({ name, size = 22, stroke = 2, fill }: { name: string; size?: number; stroke?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  )
}

/* ---------- Android back button / back gesture ---------- */
// Whatever is open on top (a dialog, a sheet, a sub-page) registers here; the
// system back gesture closes the most recent one first.
const backStack: { current: () => void }[] = []

/** While `active`, the back gesture calls `handler` (the latest registration wins). */
export function useBackHandler(active: boolean, handler?: () => void) {
  const ref = useRef(handler ?? (() => {}))
  ref.current = handler ?? (() => {})
  useEffect(() => {
    if (!active) return
    const entry = { current: () => ref.current() }
    backStack.push(entry)
    return () => { const i = backStack.lastIndexOf(entry); if (i >= 0) backStack.splice(i, 1) }
  }, [active])
}

/** Runs the top back handler. False when nothing is open (the app decides what back means). */
export function handleBack(): boolean {
  const top = backStack[backStack.length - 1]
  if (!top) return false
  top.current()
  return true
}

export function Sheet({ open, onClose, children, full }: { open: boolean; onClose: () => void; children: ReactNode; full?: boolean }) {
  useBackHandler(open, onClose)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-modal>
        <div className="grabber" />
        {children}
      </div>
    </>
  )
}

export function SheetHeader({ title, sub, onClose }: { title: ReactNode; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
      <div className="grow">
        <h2 className="h2">{title}</h2>
        {sub && <div className="muted small" style={{ marginTop: 4 }}>{sub}</div>}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} />
}

export function PageHeader({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  useBackHandler(!!onBack, onBack)
  return (
    <div className="row between" style={{ marginBottom: 18 }}>
      <div className="row">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>}
        <h1 className="h2">{title}</h1>
      </div>
      {right}
    </div>
  )
}

/* ---------- toast ---------- */
type ToastAction = { label: string; onClick: () => void }
type ToastMsg = { title: string; body?: string; action?: ToastAction; id: number }
const ToastCtx = createContext<(title: string, body?: string, action?: ToastAction) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((title: string, body?: string, action?: ToastAction) => {
    window.clearTimeout(timer.current)
    setMsg({ title, body, action, id: Date.now() })
    timer.current = window.setTimeout(() => setMsg(null), action ? 5000 : 2800)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div key={msg.id} className="toast row" role="status" onClick={() => setMsg(null)}>
          <div className="grow"><b>{msg.title}</b>{msg.body && <span>{msg.body}</span>}</div>
          {msg.action && <button className="link" style={{ fontWeight: 700, padding: '4px 2px' }} onClick={(e) => { e.stopPropagation(); msg.action!.onClick(); setMsg(null) }}>{msg.action.label}</button>}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

/* ---------- confirm dialog ---------- */
type ConfirmOpts = { title: string; body?: string; confirm?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), [])
  const done = (v: boolean) => { state?.resolve(v); setState(null) }
  useBackHandler(!!state, () => done(false))
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <>
          <div className="backdrop" style={{ zIndex: 50 }} onClick={() => done(false)} />
          <div className="card pad" role="alertdialog" style={{ position: 'fixed', zIndex: 51, left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(340px, calc(100% - 40px))', background: 'var(--dialog)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{state.title}</h3>
            {state.body && <p className="muted small" style={{ margin: '0 0 18px', lineHeight: 1.5 }}>{state.body}</p>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm secondary" onClick={() => done(false)}>Cancel</button>
              <button className={`btn sm${state.danger ? ' danger' : ''}`} onClick={() => done(true)}>{state.confirm ?? 'OK'}</button>
            </div>
          </div>
        </>
      )}
    </ConfirmCtx.Provider>
  )
}

export const Spinner = () => <div className="spinner" />
