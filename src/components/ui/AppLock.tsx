import { useCallback, useEffect, useRef, useState } from 'react'
import { read, write, useStored, KEYS } from '../../lib/core/storage'
import { Device, isNativeApp } from '../../lib/core/native'
import { buzz, Icon } from './ui'

const ITER = 150000
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)))
async function pbkdf2(pin: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, 256))
}

/** A salted, slow hash of the passcode: "pbkdf2$iterations$salt$hash". Four digits are few, so this and the wrong-try delays are what protect them. */
export async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITER}$${hex(salt)}$${await pbkdf2(pin, salt, ITER)}`
}

/** Checks a passcode against what is stored. An old unsalted hash still works, and is replaced with the new kind on the first good unlock. */
export async function verifyPin(pin: string, stored: string): Promise<{ ok: boolean; upgrade?: string }> {
  if (stored.startsWith('pbkdf2$')) {
    const [, it, salt, hash] = stored.split('$')
    return { ok: (await pbkdf2(pin, unhex(salt), Number(it))) === hash }
  }
  const legacy = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`justmoney:${pin}`)))
  return legacy === stored ? { ok: true, upgrade: await hashPin(pin) } : { ok: false }
}

/** Wrong tries slow the next one down: 5 wrong = 30 seconds, then longer. Kept across restarts. */
const DELAYS: [number, number][] = [[5, 30000], [6, 60000], [7, 300000], [8, 900000], [9, 3600000]]
export const lockoutFor = (fails: number) => (fails >= 5 ? (DELAYS.find(([n]) => fails <= n)?.[1] ?? 3600000) : 0)
export const getLockFails = () => read<{ n: number; until: number }>(KEYS.lockFails, { n: 0, until: 0 })
export function noteWrongPin(now = Date.now()) {
  const f = getLockFails()
  const n = f.n + 1
  const next = { n, until: lockoutFor(n) ? now + lockoutFor(n) : 0 }
  write(KEYS.lockFails, next)
  return next
}
export const clearWrongPins = () => { if (getLockFails().n) write(KEYS.lockFails, { n: 0, until: 0 }) }

/** Biometric unlock is only offered in the Android app. */
const biometricOn = () => isNativeApp() && read<boolean>(KEYS.appLockBiometric, false)
const lockConfigured = () => !!read<string>(KEYS.appLock, '') || biometricOn()

// The biometric / device-PIN prompt briefly backgrounds the WebView. Without this,
// coming back from it would count as "returned to the app" and lock again at once.
let authInProgress = false
let lastUnlockAt = 0

/** Asks for fingerprint, face or the phone's screen lock. Resolves true when verified. */
export async function verifyWithBiometric(title?: string): Promise<boolean> {
  authInProgress = true
  try {
    const r = await Device.authenticate({ title: title ?? 'Unlock JustMoney', subtitle: "Confirm it's you to see your finances" })
    return r.success
  } catch {
    return false
  } finally {
    // the WebView's "visible again" event can arrive just after the prompt closes
    setTimeout(() => { authInProgress = false }, 800)
  }
}

/** Locks on start and, per the grace setting, after the app has been hidden. */
export function useAppLock() {
  const [pinHash] = useStored<string>(KEYS.appLock, '')
  const [bio] = useStored<boolean>(KEYS.appLockBiometric, false)
  const enabled = !!pinHash || (bio && isNativeApp())
  const [locked, setLocked] = useState(lockConfigured)
  const [covered, setCovered] = useState(false)
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const quiet = () => authInProgress || Date.now() - lastUnlockAt < 1500
    const onVis = () => {
      if (quiet()) return
      const privacy = read<boolean>(KEYS.privacyScreen, false)
      if (document.hidden) {
        hiddenAt.current = Date.now()
        if (privacy) setCovered(true)
      } else {
        setCovered(false)
        const grace = read<number>(KEYS.appLockGrace, 0)
        if (enabled && hiddenAt.current && grace >= 0 && Date.now() - hiddenAt.current >= grace) setLocked(true)
        hiddenAt.current = null
      }
    }
    const onBlur = () => !quiet() && read<boolean>(KEYS.privacyScreen, false) && setCovered(true)
    const onFocus = () => setCovered(false)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled])

  const unlock = useCallback(() => { lastUnlockAt = Date.now(); setLocked(false) }, [])
  return { locked: locked && enabled, unlock, covered }
}

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pinHash] = useStored<string>(KEYS.appLock, '')
  const [bio] = useStored<boolean>(KEYS.appLockBiometric, false)
  const useBio = bio && isNativeApp()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(0)
  const [until, setUntil] = useState(() => getLockFails().until)
  const [fails, setFails] = useState(() => getLockFails().n)
  const [, setTick] = useState(0)
  const [bioMsg, setBioMsg] = useState<string | null>(null)
  // unlock at once, with a short buzz
  const finish = useCallback(() => { buzz([12, 40, 24]); onUnlock() }, [onUnlock])

  const tryBiometric = useCallback(async () => {
    setBioMsg(null)
    if (await verifyWithBiometric()) { clearWrongPins(); finish() }
    else setBioMsg(pinHash ? 'Not verified — try again or use your passcode.' : 'Not verified — tap to try again.')
  }, [finish, pinHash])

  useEffect(() => { if (useBio) tryBiometric() }, [useBio]) // eslint-disable-line react-hooks/exhaustive-deps

  // the page behind must not scroll or move while the lock is up
  useEffect(() => {
    const el = document.documentElement
    const prev = el.style.overflow
    el.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'
    return () => { el.style.overflow = prev; document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (pin.length !== 4) return
    if (until > Date.now()) { setPin(''); return }
    verifyPin(pin, pinHash).then((r) => {
      if (r.ok) { clearWrongPins(); if (r.upgrade) write(KEYS.appLock, r.upgrade); finish() }
      else { const f = noteWrongPin(); setUntil(f.until); setFails(f.n); setError((n) => n + 1); setPin(''); buzz([70, 50, 70, 50, 140]) }
    })
  }, [pin, pinHash, finish]) // eslint-disable-line react-hooks/exhaustive-deps

  // a countdown while the passcode is locked out after too many wrong tries
  useEffect(() => {
    if (until <= Date.now()) return
    const id = setInterval(() => { setTick((t) => t + 1); if (Date.now() >= until) clearInterval(id) }, 500)
    return () => clearInterval(id)
  }, [until])

  useEffect(() => {
    if (!pinHash) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) { buzz(8); setPin((p) => (p.length < 4 ? p + e.key : p)) }
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinHash])

  return (
    <div className="privacy-cover" data-theme="dark" style={{ background: 'radial-gradient(circle at 50% 115%, color-mix(in srgb, var(--accent) 82%, #fff) 0%, color-mix(in srgb, var(--accent-deep) 99%, #000) 14%, color-mix(in srgb, var(--accent-deep) 56%, #000) 34%, color-mix(in srgb, var(--accent-deep) 22%, #000) 58%, #06030d 82%)' }}>
      <div className="col" style={{ alignItems: 'center', gap: 28 }}>
        <div style={{ fontSize: 28 }}><b style={{ fontWeight: 800 }}>Just</b>Money</div>
        {useBio && (
          <div className="col" style={{ alignItems: 'center', gap: 12 }}>
            <button className="btn" style={{ minWidth: 260, height: 56, fontSize: 17 }} onClick={tryBiometric}>
              <Icon name="lock" size={20} /> Unlock with fingerprint
            </button>
            <div className="muted small" style={{ textAlign: 'center' }}>or with your face or phone screen lock</div>
            {bioMsg && <div className="small" style={{ color: 'var(--amber)', textAlign: 'center' }}>{bioMsg}</div>}
            {!pinHash && <div className="dim tiny" style={{ textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>No passcode is set. Add one in Settings → Security so you can still get in if your fingerprint fails.</div>}
          </div>
        )}
        {pinHash && (
          <>
            <div className="muted">{useBio ? 'or enter your passcode' : 'Enter your passcode'}</div>
            {until > Date.now()
              ? <div className="small" style={{ color: 'var(--amber)', textAlign: 'center', lineHeight: 1.5 }}>Too many wrong tries.<br />Try again in {Math.ceil((until - Date.now()) / 1000)} s{useBio ? ', or use your fingerprint or face' : ''}.</div>
              : fails > 0 && <div className="tiny dim">{fails} wrong {fails === 1 ? 'try' : 'tries'}. After 5, there is a wait.</div>}
            <div key={error} className={`pin-dots${error ? ' shake' : ''}`}>{[0, 1, 2, 3].map((i) => <i key={i} className={pin.length > i ? 'on' : ''} />)}</div>
            <div className="keypad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} disabled={until > Date.now()} onClick={() => { buzz(8); setPin((p) => (p.length < 4 ? p + n : p)) }}>{n}</button>)}
              <span />
              <button onClick={() => { buzz(8); setPin((p) => (p.length < 4 ? `${p}0` : p)) }}>0</button>
              <button style={{ background: 'none', fontSize: 16 }} onClick={() => { buzz(6); setPin((p) => p.slice(0, -1)) }}>Delete</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


/* ---------- ask again before something sensitive ---------- */

let askPin: ((reason: string) => Promise<boolean>) | null = null

/**
 * With App Lock on, deleting data, exporting it, restoring a backup or showing the AI key ask for the fingerprint or passcode again,
 * so a phone left unlocked for a moment is not enough. With no lock set, it just goes ahead.
 */
export async function requireAuth(reason: string): Promise<boolean> {
  if (!lockConfigured() || !read<boolean>(KEYS.reauth, true)) return true
  if (biometricOn() && (await verifyWithBiometric(reason))) return true
  if (!read<string>(KEYS.appLock, '')) return false
  return askPin ? askPin(reason) : false
}

/** Mounted once in the app: the passcode box that requireAuth opens. */
export function AuthPrompt() {
  const [reason, setReason] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const done = useRef<((ok: boolean) => void) | null>(null)
  useEffect(() => {
    askPin = (r) => new Promise<boolean>((res) => { done.current = res; setPin(''); setMsg(''); setReason(r) })
    return () => { askPin = null }
  }, [])
  const close = (ok: boolean) => { setReason(null); done.current?.(ok); done.current = null }
  useEffect(() => {
    if (pin.length !== 4 || reason === null) return
    const f = getLockFails()
    if (f.until > Date.now()) { setMsg(`Too many wrong tries. Wait ${Math.ceil((f.until - Date.now()) / 1000)} s.`); setPin(''); return }
    verifyPin(pin, read<string>(KEYS.appLock, '')).then((r) => {
      if (r.ok) { clearWrongPins(); close(true) } else { noteWrongPin(); buzz([70, 50, 70]); setMsg('Wrong passcode'); setPin('') }
    })
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps
  if (reason === null) return null
  return (
    <div className="backdrop" style={{ zIndex: 70, display: 'grid', placeItems: 'center' }} onClick={() => close(false)}>
      <div className="card pad col" style={{ width: 'min(320px, calc(100% - 40px))', gap: 12, alignItems: 'center' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Enter your passcode">
        <b>Enter your passcode</b>
        <div className="dim small" style={{ textAlign: 'center' }}>{reason}</div>
        <input className="input" style={{ textAlign: 'center', fontSize: 28, letterSpacing: '.5em' }} type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => { setMsg(''); setPin(e.target.value.replace(/\D/g, '')) }} aria-label="Passcode" />
        {msg && <div className="error-text">{msg}</div>}
        <button className="btn sm secondary" onClick={() => close(false)}>Cancel</button>
      </div>
    </div>
  )
}
