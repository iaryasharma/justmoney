import { useEffect, useRef, useState } from 'react'
import { buzz, Sheet, SheetHeader, useToast } from '../ui/ui'
import { NativeDb } from '../../lib/core/native'
import { setCloudPassword } from '../../lib/backup/backup'

type Ask = (reason: string, opts?: { confirm?: boolean }) => Promise<string | null>
let ask: Ask | null = null

/**
 * Asks for a password in a proper box (the browser's own prompt does not work well in the app). With `confirm` it is typed twice, for a
 * new password. Resolves with the password, or null if cancelled.
 */
export function askPassword(reason: string, opts: { confirm?: boolean } = {}): Promise<string | null> {
  return ask ? ask(reason, opts) : Promise.resolve(null)
}

/** Mounted once: the box askPassword opens. */
export function PasswordPromptHost() {
  const [state, setState] = useState<{ reason: string; confirm: boolean } | null>(null)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const done = useRef<((v: string | null) => void) | null>(null)
  useEffect(() => {
    ask = (reason, opts) => new Promise<string | null>((res) => { done.current = res; setPw(''); setAgain(''); setErr(''); setState({ reason, confirm: !!opts?.confirm }) })
    return () => { ask = null }
  }, [])
  const close = (v: string | null) => { setState(null); done.current?.(v); done.current = null }
  if (!state) return null
  return (
    <div className="backdrop" style={{ zIndex: 80, display: 'grid', placeItems: 'center' }} onClick={() => close(null)}>
      <form className="card pad col" style={{ width: 'min(340px, calc(100% - 40px))', gap: 12 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Backup password"
        onSubmit={(e) => {
          e.preventDefault()
          if (state.confirm) {
            if (pw.length < 6) return setErr('Use at least 6 characters')
            if (pw !== again) return setErr('The two passwords do not match')
          } else if (!pw) return setErr('Enter the password')
          close(pw)
        }}>
        <b>Backup password</b>
        <div className="dim small" style={{ lineHeight: 1.5 }}>{state.reason}</div>
        <input className="input" type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} placeholder={state.confirm ? 'New password (6+ characters)' : 'Password'} aria-label="Password" autoComplete="off" />
        {state.confirm && <input className="input" type="password" value={again} onChange={(e) => { setAgain(e.target.value); setErr('') }} placeholder="Type it again" aria-label="Repeat password" autoComplete="off" />}
        {err && <div className="error-text">{err}</div>}
        {state.confirm && <div className="dim tiny" style={{ lineHeight: 1.5 }}>Write it down. If you forget it, the backup cannot be opened.</div>}
        <div className="row" style={{ gap: 8 }}><button type="button" className="btn sm secondary grow" onClick={() => close(null)}>Cancel</button><button className="btn sm grow">OK</button></div>
      </form>
    </div>
  )
}

/** Sets the backup password on the phone: every backup (on the phone and in the cloud) is then encrypted with it. */
export function BackupPasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [old, setOld] = useState('')
  const [hasOld, setHasOld] = useState(false)
  const toast = useToast()
  const reset = () => { setPw(''); setAgain(''); setOld(''); setErr('') }
  // changing a password that is already set asks for the current one first
  useEffect(() => { if (open) NativeDb.getBackupStatus().then((s) => setHasOld(!!s.localEncrypted)).catch(() => setHasOld(false)) }, [open])
  return (
    <Sheet open={open} onClose={() => { reset(); onClose() }}>
      <SheetHeader title={<>Backup password</>} sub="Every backup is encrypted with it" onClose={() => { reset(); onClose() }} />
      <form className="col" style={{ gap: 12 }} onSubmit={async (e) => {
        e.preventDefault()
        if (hasOld && !old) return setErr('Enter your current password first')
        if (pw.length < 6) return setErr('Use at least 6 characters')
        if (pw !== again) return setErr('The two passwords do not match')
        setBusy(true)
        if (hasOld) {
          const v = await NativeDb.verifyBackupPassword({ password: old }).catch(() => ({ ok: false }))
          if (!v.ok) { setBusy(false); buzz([70, 50, 70]); return setErr('That is not the current backup password') }
        }
        try { await setCloudPassword(pw); toast('Backups are protected', 'Write the password down. It cannot be recovered.'); reset(); onClose() } catch (x) { setErr((x as Error)?.message || 'Could not set the password') } finally { setBusy(false) }
      }}>
        {hasOld && <input className="input" type="password" autoFocus value={old} onChange={(e) => { setOld(e.target.value); setErr('') }} placeholder="Current password" aria-label="Current password" autoComplete="off" />}
        <input className="input" type="password" autoFocus={!hasOld} value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} placeholder="New password (6+ characters)" aria-label="New password" />
        <input className="input" type="password" value={again} onChange={(e) => { setAgain(e.target.value); setErr('') }} placeholder="Type it again" aria-label="Repeat password" />
        {err && <div className="error-text">{err}</div>}
        <p className="dim small" style={{ margin: 0, lineHeight: 1.5 }}>You enter this password when you restore a backup on a new phone. If you forget it, the backup cannot be opened, so keep it somewhere safe. Changing it protects new backups with the new password.</p>
        <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Protect my backups'}</button>
      </form>
    </Sheet>
  )
}
