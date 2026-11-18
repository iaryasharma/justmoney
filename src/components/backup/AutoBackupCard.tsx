import { askPassword } from './BackupPassword'
import { useEffect, useRef, useState } from 'react'
import { Icon, Spinner, Toggle, useConfirm, useToast } from '../ui/ui'
import BrandLogo from '../ui/BrandLogo'
import { driveLogo } from '../../lib/payees/brands'
import { useStored, KEYS } from '../../lib/core/storage'
import {
  BACKUP_DIR, DEFAULT_AUTO_BACKUP, disableCloudBackup, dismissOlderBackup, exportBackupTo, isNativeApp, pickCloudLocation,
  readOwnBackup, refreshBackupStatus, restoreFromText, runAutoBackup, setAutoBackupEnabled, 
  setCloudFrequency, setCloudPassword, setLocalBackupEnabled, type AutoBackupState,
} from '../../lib/backup/backup'

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const askPw = () => askPassword('This backup is password protected. Enter its backup password.')
const providerName = (p?: string | null) =>
  !p ? '' : /google\.android\.apps\.docs/.test(p) ? 'Google Drive' : /onedrive|microsoft/.test(p) ? 'OneDrive' : /dropbox/.test(p) ? 'Dropbox' : /externalstorage|media|downloads/.test(p) ? 'this phone' : p

/**
 * Backup, with two independent destinations:
 *  - On this phone: Documents/JustMoney (survives uninstalling the app)
 *  - Google Drive: a file picked once through the system picker, updated daily (password optional)
 * plus "Back up now", a one-off "Save a copy to…", and restore from any file (Drive shows in the picker).
 */
export default function AutoBackupCard() {
  const [state] = useStored<AutoBackupState>(KEYS.autoBackup, DEFAULT_AUTO_BACKUP)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { refreshBackupStatus().catch(() => {}) }, [])

  if (!isNativeApp()) {
    return (
      <div className="card pad row small" style={{ alignItems: 'flex-start' }}>
        <Icon name="info" size={18} />
        <span className="muted">Automatic daily backup to your phone and Google Drive works in the Android app. In the browser, use Back up now above, choose a password, and keep the file somewhere safe.</span>
      </div>
    )
  }

  const local = state.localEnabled !== false
  const drive = !!state.cloud?.configured
  const nothingOn = !local && !drive

  async function backupNow() {
    if (nothingOn) { toast('Turn on a backup place first', 'This phone or Google Drive.'); return }
    setBusy(true)
    const before = { local: state.lastAt, drive: state.cloud?.lastAt }
    const s = await runAutoBackup(true)
    setBusy(false)
    if (s.foundOlder) { toast('Older backup found', 'Restore or ignore it first.'); return }
    const done = [local && s.lastAt !== before.local && 'this phone', drive && s.cloud?.lastAt !== before.drive && providerName(s.cloud?.provider)].filter(Boolean)
    const failed = [local && s.lastAt === before.local && (s.lastError ?? 'phone'), drive && s.cloud?.lastAt === before.drive && (s.cloud?.error ?? 'Drive')].filter(Boolean)
    if (done.length) toast('Backed up', `Saved to ${done.join(' and ')}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`)
    else toast('Backup failed', failed.join(' · ') || 'Nothing to back up yet.')
  }

  async function restore(text: string) {
    if (!(await confirm({ title: 'Restore from this backup?', body: "Anything already on this phone is kept — a restore only adds what's missing.", confirm: 'Restore' }))) return
    try {
      const { added } = await restoreFromText(text, askPw)
      toast('Backup restored', `${added} item${added === 1 ? '' : 's'} added`)
    } catch (e) {
      if ((e as Error)?.message !== 'cancelled') toast('Restore failed', (e as Error)?.message?.startsWith('Wrong') ? (e as Error).message : 'That file is not a valid JustMoney backup.')
    }
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      {state.foundOlder && (
        <div className="card pad col" style={{ gap: 10, background: 'rgba(251,191,36,.08)' }}>
          <div className="small"><b>Found a backup from {when(new Date(state.foundOlder.exportedAt).getTime())}</b> with {state.foundOlder.transactions} transactions. It won't be overwritten until you restore it or choose to ignore it.</div>
          <div className="row">
            <button className="btn sm grow" onClick={async () => { const t = await readOwnBackup(); if (t) restore(t); else toast("Couldn't open that file", 'Use Restore below and pick it from Documents/JustMoney.') }}>Restore it</button>
            <button className="btn sm secondary grow" onClick={async () => {
              if (!(await confirm({ title: 'Ignore the older backup?', body: 'The next daily backup will replace it with what is on this phone now.', confirm: 'Ignore', danger: true }))) return
              await dismissOlderBackup()
              await runAutoBackup(true)
            }}>Ignore</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="list-row">
          <Icon name="refresh" size={20} />
          <div className="grow"><div>Back up automatically every day</div><div className="dim small">Runs in the background, even when the app is closed.</div></div>
          <Toggle on={state.enabled} label="Daily backup" onChange={(v) => { setAutoBackupEnabled(v) }} />
        </div>

        {/* destination 1: this phone */}
        <div className="list-row" style={{ alignItems: 'flex-start' }}>
          <Icon name="doc" size={20} />
          <div className="grow small">
            <div style={{ fontSize: 15 }}>On this phone</div>
            <div className="dim">{local ? <>Documents/{BACKUP_DIR}/{state.file}{state.lastAt ? ` · ${when(state.lastAt)}` : ' · not yet'}</> : 'Off'}</div>
            {local && <div className="dim tiny">Stays on the phone if you uninstall the app.</div>}
            {local && state.lastError && <div style={{ color: 'var(--amber)' }}>Last attempt failed: {state.lastError}</div>}
          </div>
          <Toggle on={local} label="Backup on this phone" onChange={async (v) => {
            if (!v && !drive && !(await confirm({ title: 'Turn off the phone backup?', body: 'With Google Drive also off, nothing will be backed up.', confirm: 'Turn off', danger: true }))) return
            await setLocalBackupEnabled(v)
          }} />
        </div>

        {/* destination 2: Google Drive */}
        <DriveRow state={state} />
      </div>

      <div className="card">
        <button className="list-row" onClick={backupNow} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="upload" size={20} />}
          <div className="grow" style={{ textAlign: 'left' }}><div>Back up now</div><div className="dim small">{nothingOn ? 'Turn on a place above first' : `To ${[local && 'this phone', drive && providerName(state.cloud?.provider)].filter(Boolean).join(' and ')}`}</div></div>
        </button>
        <button className="list-row" onClick={async () => { try { await exportBackupTo(); toast('Copy saved') } catch (e) { if (!/No location/.test((e as Error)?.message ?? '')) toast("Couldn't save the copy", (e as Error)?.message) } }}>
          <Icon name="download" size={20} />
          <div className="grow" style={{ textAlign: 'left' }}><div>Save a copy to…</div><div className="dim small">One-off copy to Downloads, an SD card, Drive or any folder</div></div>
        </button>
        <button className="list-row" onClick={() => { toast('Choose Drive in the picker', 'Then open justmoney-backup… and tap it'); fileRef.current?.click() }}>
          <BrandLogo src={driveLogo} size={20} radius={5} alt="Google Drive" />
          <div className="grow" style={{ textAlign: 'left' }}><div>Restore from Google Drive</div><div className="dim small">Pick your backup file in Drive — merge-only, nothing is overwritten</div></div>
        </button>
        <button className="list-row" onClick={() => { toast('Choose your local backup', `Usually Documents/${BACKUP_DIR}`); fileRef.current?.click() }}>
          <Icon name="doc" size={20} />
          <div className="grow" style={{ textAlign: 'left' }}><div>Restore from local backup</div><div className="dim small">Pick a backup file on this phone (Documents/{BACKUP_DIR}, Downloads, SD card…)</div></div>
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) restore(await f.text()); e.target.value = '' }} />
      </div>
    </div>
  )
}

/** Google Drive destination: not set up → choose file → password or not → on. */
function DriveRow({ state }: { state: AutoBackupState }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const c = state.cloud
  const where = providerName(c?.provider) || 'Google Drive'

  if (c?.configured) {
    const freq = c.frequency ?? 'daily'
    return (
      <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ position: 'relative', flex: 'none' }}>
            <BrandLogo src={driveLogo} size={20} radius={5} alt={where} />
            {c.encrypted && <span style={{ position: 'absolute', right: -4, bottom: -4, width: 12, height: 12, borderRadius: '50%', background: 'var(--bg)', display: 'grid', placeItems: 'center' }}><Icon name="lock" size={9} stroke={3} /></span>}
          </div>
          <div className="grow small">
            <div style={{ fontSize: 15 }}>{where}</div>
            <div className="dim">{c.name ?? 'backup file'}</div>
            <div className="dim">{c.lastAt ? `Last backup ${when(c.lastAt)}` : 'Not backed up yet — tap Back up now'}</div>
            <div className="dim tiny">{c.encrypted ? 'Password-protected (AES-256)' : 'Not password-protected'}</div>
            {c.error && <div style={{ color: 'var(--amber)' }}>Last backup failed: {c.error}</div>}
            {where !== 'Google Drive' && <div className="dim tiny">Tip: choose “Drive” in the picker to keep it off this phone.</div>}
          </div>
          <button className="link small" onClick={async () => { if (await confirm({ title: `Stop backing up to ${where}?`, body: 'The backup file already there is kept — you can still restore from it.', confirm: 'Stop', danger: true })) { await disableCloudBackup(); toast('Google Drive backup stopped') } }}>Stop</button>
        </div>
        <div className="field">
          <label>Back up to {where}</label>
          <div className="chips">
            {([['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['manual', 'Only when I tap “Back up”']] as const).map(([v, l]) => (
              <button key={v} className={`chip${freq === v ? ' on' : ''}`} onClick={() => setCloudFrequency(v)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (c?.hasLocation) {
    return (
      <form className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }} onSubmit={async (e) => {
        e.preventDefault()
        if (pw.length < 6) { toast('Use at least 6 characters'); return }
        if (pw !== pw2) { toast("Passwords don't match"); return }
        setBusy(true)
        try { await setCloudPassword(pw); toast(`Backing up to ${where}`, 'Keep this password safe — you need it to restore, and it cannot be recovered.') } catch (err) { toast("Couldn't set it up", (err as Error)?.message) } finally { setBusy(false); setPw(''); setPw2('') }
      }}>
        <div className="small"><b>{where}: set a backup password</b><div className="dim">Required — backups are always encrypted, so nobody who gets into your Drive can read your finances. You'll need the password to restore on a new phone.</div></div>
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Backup password (6+ characters)" autoComplete="new-password" />
        <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat password" autoComplete="new-password" />
        <button className="btn sm block" disabled={busy}>{busy ? <Spinner /> : 'Set password and start backing up'}</button>
        <button type="button" className="link small" onClick={() => disableCloudBackup()}>Cancel</button>
      </form>
    )
  }

  return (
    <button className="list-row" onClick={async () => { try { await pickCloudLocation() } catch { /* cancelled */ } }}>
      <BrandLogo src={driveLogo} size={20} radius={5} alt="Google Drive" />
      <div className="grow small" style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 15 }}>Google Drive</div>
        <div className="dim">Off · tap Set up, then in the picker choose <b>Drive</b> → a folder → Save. Backups then go there automatically.</div>
      </div>
      <Icon name="chevron" size={18} />
    </button>
  )
}
