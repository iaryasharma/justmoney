import { useEffect, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Icon, useToast } from '../ui/ui'
import { Capture, isNativeApp } from '../../lib/core/native'

/**
 * Tracking payments needs two permissions Android only lets the user give: notification access (Paytm, GPay, PhonePe, bank apps)
 * and reading bank SMS. Until both are on, Home asks for them right at the top, and the card goes away by itself once they are.
 */
export default function CaptureSetup() {
  const [access, setAccess] = useState<boolean | null>(null)
  const [sms, setSms] = useState<boolean | null>(null)
  const toast = useToast()
  const native = isNativeApp()
  useEffect(() => {
    if (!native) return
    const check = () => {
      Capture.notificationAccessStatus().then((s) => setAccess(s.enabled)).catch(() => setAccess(false))
      Capture.smsStatus().then((s) => setSms(s.granted)).catch(() => setSms(false))
    }
    check()
    const sub = CapApp.addListener('resume', check) // back from the system settings screen
    return () => { sub.then((h) => h.remove()) }
  }, [native])
  if (!native || access === null || sms === null || (access && sms)) return null
  return (
    <div className="card pad col" style={{ gap: 10, marginBottom: 12 }} role="region" aria-label="Turn on payment tracking">
      <div className="row" style={{ gap: 10 }}>
        <span className="legend-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="bell" size={16} /></span>
        <div className="grow"><b>Turn on automatic tracking</b>
          <div className="dim small">Payments are added from your UPI apps and bank messages. Cashback, coins and wallet credits are left out.</div></div>
      </div>
      {!access && <button className="btn block" onClick={() => Capture.openNotificationAccessSettings()}><Icon name="bell" size={18} />Allow payment notifications</button>}
      {!sms && <button className={`btn block${access ? '' : ' secondary'}`} onClick={async () => {
        const r = await Capture.requestSms().catch(() => ({ granted: false }))
        setSms(r.granted)
        if (!r.granted) toast('Permission not given', 'You can allow it later in Settings → Auto-capture payments.')
      }}><Icon name="message" size={18} />Allow bank messages</button>}
    </div>
  )
}
