import { useEffect, useState } from 'react'
import { Icon, PageHeader, Toggle, useToast } from '../components/ui/ui'
import { isNativeApp, Updater, type UpdateInfo } from '../lib/core/native'

/** Settings → Updates: looks for a newer release on GitHub, downloads and installs it, and turns the daily check on or off. */
export default function UpdatesPage({ onBack, version }: { onBack: () => void; version: string }) {
  const toast = useToast()
  const native = isNativeApp()
  const [daily, setDaily] = useState(true)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [opened, setOpened] = useState<'none' | 'installer' | 'permission'>('none')

  useEffect(() => {
    if (!native) return
    Updater.status().then((s) => setDaily(s.daily)).catch(() => {})
    const handle = Updater.addListener('progress', (e) => setProgress(e.total > 0 ? Math.round((e.received * 100) / e.total) : null))
    return () => { handle.then((h) => h.remove()).catch(() => {}) }
  }, [native])

  const check = async () => {
    setChecking(true)
    setOpened('none')
    try {
      setInfo(await Updater.check())
    } catch (e) {
      toast("Couldn't check for updates", (e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const install = async () => {
    if (!info) return
    setProgress(0)
    try {
      const r = await Updater.install({ url: info.url, sha256: info.sha256, version: info.version })
      setOpened(r.needsPermission ? 'permission' : 'installer')
    } catch (e) {
      toast("The update didn't start", (e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const toggleDaily = async (on: boolean) => {
    setDaily(on)
    try {
      await Updater.setDaily({ enabled: on })
    } catch {
      toast("Couldn't change the setting")
    }
  }

  return (
    <div className="page">
      <PageHeader title="Updates" onBack={onBack} />
      {!native && <p className="muted small">Updates are installed from the Android app.</p>}

      <div className="card pad col" style={{ gap: 12, marginTop: 12 }}>
        <div className="row between">
          <div>
            <b>JustMoney {version}</b>
            <div className="dim small">Installed on this phone</div>
          </div>
          <button className="btn sm secondary" disabled={!native || checking} onClick={check}>
            <span className={checking ? 'spin' : undefined} style={{ display: 'inline-flex' }}><Icon name="refresh" size={16} /></span>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {info && !info.newer && <div className="small muted rise">You have the latest version.</div>}
      </div>

      {info?.newer && (
        <div className="card pad col rise" style={{ gap: 12, marginTop: 12 }}>
          <div className="row"><Icon name="download" size={20} /><b>Version {info.version} is available</b></div>
          {info.notes && <div className="small muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{info.notes}</div>}
          {progress !== null && <div className="bar" style={{ height: 8 }}><i style={{ width: `${progress}%` }} /></div>}
          {opened === 'installer' && (
            <div className="row pop"><Icon name="check" size={20} /><span className="small">The installer is open. Tap Install to finish.</span></div>
          )}
          {opened === 'permission' && (
            <div className="small">Allow installs from JustMoney on the screen that opened, then tap Download and install again.</div>
          )}
          {opened === 'none' && (
            <button className="btn block" disabled={progress !== null} onClick={install}>
              {progress !== null ? `Downloading… ${progress}%` : 'Download and install'}
            </button>
          )}
        </div>
      )}

      <div className="card pad row" style={{ marginTop: 12 }}>
        <div className="grow">
          <b>Check every day</b>
          <div className="dim small">Once a day JustMoney asks GitHub for the newest version and sends a notification if there is one. No personal data is sent.</div>
        </div>
        <Toggle on={daily} onChange={toggleDaily} label="Check every day" />
      </div>
    </div>
  )
}
