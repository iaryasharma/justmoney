import { useEffect, useRef, useState } from 'react'
import { isEncryptedBackup, readOwnBackup, restoreFromText } from '../lib/backup/backup'
import { askPassword, PasswordPromptHost } from '../components/backup/BackupPassword'
import { uid, write, KEYS } from '../lib/core/storage'
import { FAMILY } from '../lib/core/money'
import { planFor, PROFESSIONS, type Profession } from '../lib/plan/profession'
import { useBackHandler, useToast } from '../components/ui/ui'
import { Icon, Toggle } from '../components/ui/ui'
import { CURRENCIES } from '../lib/core/format'
import { DEFAULT_PREFS, requestNotificationPermission } from '../lib/notify/notify'
import { CurrencyPicker } from './Settings'

type Step = 'boot' | 'welcome' | 'profile' | 'permissions'
const STEPS: Step[] = ['welcome', 'profile', 'permissions']

const BACKDROPS: Record<Step, string> = {
  boot: 'radial-gradient(circle at 50% 110%, var(--accent) 0%, #06030d 62%)',
  welcome: 'radial-gradient(circle at 50% 115%, color-mix(in srgb, var(--accent) 45%, #fff) 0%, var(--accent) 20%, color-mix(in srgb, var(--accent-deep) 56%, #000) 46%, color-mix(in srgb, var(--accent-deep) 18%, #000) 68%, #06030d 85%)',
  profile: 'radial-gradient(circle at 50% 115%, color-mix(in srgb, var(--accent) 55%, #fff) 0%, var(--accent) 20%, color-mix(in srgb, var(--accent-deep) 56%, #000) 48%, color-mix(in srgb, var(--accent-deep) 19%, #000) 70%, #06030d 85%)',
  permissions: 'radial-gradient(circle at 50% 115%, #e9d5ff 0%, var(--accent) 20%, color-mix(in srgb, var(--accent-deep) 66%, #000) 48%, color-mix(in srgb, var(--accent-deep) 20%, #000) 70%, #06030d 85%)',
}

const SALARY_CHIPS = [25000, 50000, 80000, 150000]
const ALLOWANCE_CHIPS = [2000, 5000, 10000, 15000]

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('boot')
  const PREV: Partial<Record<Step, Step>> = { profile: 'welcome', permissions: 'profile' }
  useBackHandler(!!PREV[step], () => { const p = PREV[step]; if (p) setStep(p) })
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [income, setIncome] = useState('')
  const [noIncome, setNoIncome] = useState(false)
  // a shop has no fixed income to type in: the plan learns it from the sales
  const [prof, setProf] = useState<Profession>('EMPLOYEE')
  const earn = prof === 'BUSINESS' ? 'BUSINESS' : prof === 'STUDENT' ? 'STUDENT' : 'SALARY'
  const [familyAmt, setFamilyAmt] = useState('')
  const [familyTo, setFamilyTo] = useState('')
  const [picker, setPicker] = useState(false)
  const [notif, setNotif] = useState(false)
  const [err, setErr] = useState('')
  const restoreInput = useRef<HTMLInputElement>(null)
  // a backup this install can see (from before a reinstall): offered straight away
  const [found, setFound] = useState<{ text: string; at: string; count: number; locked: boolean } | null>(null)
  const toast = useToast()

  async function restoreFrom(file: File) {
    try {
      const { added, restoredProfile } = await restoreFromText(await file.text(), () => askPassword('This backup is password protected. Enter its backup password.'))
      toast('Welcome back', `${added} item${added === 1 ? '' : 's'} restored`)
      if (restoredProfile) onDone()
    } catch (e) {
      if ((e as Error)?.message !== 'cancelled') toast('Restore failed', (e as Error)?.message?.startsWith('Wrong') ? (e as Error).message : 'That file is not a valid JustMoney backup.')
    }
  }

  useEffect(() => {
    if (step !== 'welcome') return
    readOwnBackup().then((text) => {
      if (!text) return
      try {
        if (isEncryptedBackup(text)) { setFound({ text, at: '', count: 0, locked: true }); return }
      } catch { /* not a backup */ }
    }).catch(() => {})
  }, [step])

  useEffect(() => {
    if (step !== 'boot') return
    const t = setTimeout(() => setStep('welcome'), 2200)
    return () => clearTimeout(t)
  }, [step])

  const fmtIncome = (v: string) => (v ? Number(v).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US') : '')

  function finish() {
    write(KEYS.user, { id: 'local', name: name.trim(), age: age ? Number(age) : null, currency, monthly_income: noIncome || earn === 'BUSINESS' ? 0 : Number(income) || 0, profession: prof })
    // a student's saving is a fixed amount and nothing is set aside automatically, so the emergency fund starts off
    write(KEYS.planSettings, { ...planFor(prof), saveRate: 20, setAside: 10, emergencyShare: prof === 'STUDENT' ? 0 : 40, emergencyMonths: 3 })
    write(KEYS.notificationPrefs, DEFAULT_PREFS)
    if (earn === 'SALARY' && Number(familyAmt) > 0) {
      const member = familyTo.trim() ? { id: uid(), name: familyTo.trim(), relation: null } : null
      if (member) write(KEYS.familyMembers, [member])
      write(KEYS.commitments, [{ id: uid(), name: 'Family support', amount: Number(familyAmt), category: FAMILY, memberId: member?.id ?? null, createdAt: Date.now() }])
    }
    write(KEYS.onboardingCompleted, true)
    onDone()
  }

  const idx = STEPS.indexOf(step)
  return (
    <div data-theme="dark" style={{ background: '#000', color: '#fff', minHeight: '100dvh' }}>
      <div className="onboard-bg" style={{ background: BACKDROPS[step] }} />
      <div className="onboard">
        {step === 'boot' ? (
          <button className="col grow" style={{ alignItems: 'center', justifyContent: 'center', gap: 14 }} onClick={() => setStep('welcome')}>
            <div style={{ fontSize: 44, animation: 'boot 1.4s cubic-bezier(.2,.9,.3,1) both' }}><b style={{ fontWeight: 800 }}>Just</b>Money</div>
            <div style={{ color: 'rgba(255,255,255,.55)', animation: 'fade-in .6s .8s both' }}>Track Expenses in Seconds</div>
            <div className="pulse-dot" style={{ marginTop: 30 }} />
            <style>{'@keyframes boot { from { letter-spacing: .4em; opacity: 0; transform: scale(.9) } }'}</style>
          </button>
        ) : (
          <>
            <div className="step-dots">{STEPS.map((s, i) => <i key={s} className={i === idx ? 'on' : i < idx ? 'done' : ''} />)}</div>
            <div key={step} className="col grow" style={{ justifyContent: 'flex-end', gap: 16, animation: 'slide-in .35s ease' }}>
              <style>{'@keyframes slide-in { from { opacity: 0; transform: translateX(30px) } }'}</style>

              {step === 'welcome' && (
                <>
                  <div className="eyebrow">01 · Welcome</div>
                  <h1 style={{ fontSize: 56, fontWeight: 800, lineHeight: .95, margin: 0, letterSpacing: '-.03em' }}>track<br />expense<br />easy.</h1>
                  <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>In just 3 seconds.</div>
                  <p className="muted" style={{ margin: 0 }}>Type it, say it, or snap the receipt. One tap. No setup. No spam.</p>
                  {found && (
                    <div className="card pad col" style={{ gap: 8, background: 'rgba(255,255,255,.1)', borderColor: 'rgba(255,255,255,.35)', marginTop: 10 }}>
                      <b>We found a backup</b>
                      <div className="small" style={{ opacity: 0.85 }}>{found.locked ? 'An encrypted backup of your data.' : `${found.count} transaction${found.count === 1 ? '' : 's'}${found.at ? `, saved ${new Date(found.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.`} Restore it to get everything back: payments, accounts, plan, savings and more.</div>
                      <button className="btn" onClick={async () => {
                        try {
                          const { added, restoredProfile } = await restoreFromText(found.text, () => askPassword('This backup is password protected. Enter its backup password.'))
                          toast('Welcome back', `${added} item${added === 1 ? '' : 's'} restored`)
                          if (restoredProfile) onDone()
                        } catch (e) { if ((e as Error)?.message !== 'cancelled') toast('Restore failed', (e as Error)?.message?.startsWith('Wrong') ? (e as Error).message : 'That backup could not be read.') }
                      }}>Restore my data</button>
                    </div>
                  )}
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>What should we call you?</label>
                    <input className="input" value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder="Your name" autoFocus />
                  </div>
                  {err && <div className="error-text">{err}</div>}
                  <button className="btn block" onClick={() => (name.trim() ? setStep('profile') : setErr('Enter your name'))}>Continue</button>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn secondary grow" style={{ padding: '0 12px', fontSize: 14 }} onClick={() => { toast('Choose Drive in the picker', 'Then tap your justmoney-backup file'); restoreInput.current?.click() }}><Icon name="share" size={16} /> From Google Drive</button>
                    <button className="btn secondary grow" style={{ padding: '0 12px', fontSize: 14 }} onClick={() => { toast('Choose your local backup', 'Usually Documents/JustMoney'); restoreInput.current?.click() }}><Icon name="doc" size={16} /> From local backup</button>
                  </div>
                  <input ref={restoreInput} type="file" accept="application/json,.json,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restoreFrom(f); e.target.value = '' }} />
                  <p className="dim tiny" style={{ textAlign: 'center' }}>Reinstalled? Restore your backup above. Your money stays yours — everything is stored on this device.</p>
                </>
              )}

              {step === 'profile' && (
                <>
                  <div className="eyebrow">02 · You</div>
                  <h1 style={{ fontSize: 46, fontWeight: 800, lineHeight: .95, margin: 0 }}>tell us<br />a little about you.</h1>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="field" style={{ width: 90 }}><label>Age</label><input className="input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="24" /></div>
                    <div className="field grow"><label>Currency</label><button className="input row between" onClick={() => setPicker(true)}>{currency} <span className="dim small ellipsis">{CURRENCIES.find((c) => c[0] === currency)?.[1]}</span><Icon name="chevronDown" size={18} /></button></div>
                  </div>
                  <div className="field">
                    <label>What do you do?</label>
                    <div style={{ position: 'relative' }}>
                      <select className="input" value={prof} aria-label="What do you do?" style={{ paddingRight: 44 }} onChange={(e) => { setProf(e.target.value as Profession); setErr('') }}>
                        {PROFESSIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                      <span style={{ position: 'absolute', right: 14, top: 16, pointerEvents: 'none' }}><Icon name="chevronDown" size={18} /></span>
                    </div>
                    <div className="dim small">{PROFESSIONS.find((x) => x[0] === prof)?.[2]}. The app shows the tools that fit.</div>
                  </div>
                  {earn === 'BUSINESS' ? (
                    <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>No income to type in. Sales change every month, so JustMoney learns from what comes in through PhonePe or Paytm Business and plans a steady amount for you to spend, with saving and tax kept aside first.</p>
                  ) : <>
                  <div className="field">
                    <label>{earn === 'STUDENT' ? 'Monthly allowance' : 'Monthly income'}</label>
                    <input className="input" inputMode="numeric" disabled={noIncome} value={fmtIncome(income)} onChange={(e) => { setIncome(e.target.value.replace(/\D/g, '')); setErr('') }} placeholder={earn === 'STUDENT' ? '5,000' : '80,000'} />
                    <div className="chips">
                      {(earn === 'STUDENT' ? ALLOWANCE_CHIPS : SALARY_CHIPS).map((s) => <button key={s} className={`chip${!noIncome && Number(income) === s ? ' on' : ''}`} onClick={() => { setIncome(String(s)); setNoIncome(false) }}>{fmtIncome(String(s))}</button>)}
                      <button className={`chip${noIncome ? ' on' : ''}`} onClick={() => setNoIncome(!noIncome)}>{earn === 'STUDENT' ? 'varies' : 'prefer not'}</button>
                    </div>
                  </div>
                  {earn === 'STUDENT'
                    ? <p className="dim small" style={{ margin: 0 }}>What you get each month from family, a scholarship or a part-time job. Pick “varies” if it changes, and set a budget or a monthly saving goal later in the plan, if you want one.</p>
                    : <p className="dim small" style={{ margin: 0 }}>Without your income, we can't tell if you're spending too much or staying within a safe limit.</p>}
                  {!noIncome && earn === 'SALARY' && (
                    <div className="field">
                      <label>Money you send to family each month (optional)</label>
                      <div className="row">
                        <input className="input" inputMode="numeric" value={fmtIncome(familyAmt)} onChange={(e) => setFamilyAmt(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 15,000" />
                        <input className="input" value={familyTo} onChange={(e) => setFamilyTo(e.target.value)} placeholder="To (e.g. Mom)" />
                      </div>
                      {Number(familyAmt) > 0 && Number(income) > 0 && <div className="dim small">That leaves {fmtIncome(String(Math.max(0, Number(income) - Number(familyAmt))))}. A fifth of it is saved first, so about {fmtIncome(String(Math.round(Math.max(0, Number(income) - Number(familyAmt)) * 0.8)))} a month is yours to spend.</div>}
                    </div>
                  )}
                  </>}
                  {err && <div className="error-text">{err}</div>}
                  <button className="btn block" onClick={() => (earn === 'BUSINESS' || earn === 'STUDENT' || noIncome || Number(income) > 0 ? setStep('permissions') : setErr('Enter a valid monthly income'))}>Continue</button>
                </>
              )}

              {step === 'permissions' && (
                <>
                  <div className="eyebrow">03 · Access</div>
                  <h1 style={{ fontSize: 46, fontWeight: 800, lineHeight: .95, margin: 0 }}>one quick<br />permission, that's all.</h1>
                  <div className="eyebrow" style={{ color: 'rgba(255,255,255,.7)' }}>So we can actually help.</div>
                  <div className="card pad row">
                    <Icon name="bell" /><div className="grow"><b>Notifications</b><div className="dim small">Only when it actually matters.</div></div>
                    <Toggle on={notif} label="Turn on reminders" onChange={async (v) => setNotif(v ? await requestNotificationPermission() : false)} />
                  </div>
                  <button className="btn block" onClick={finish}>Start tracking</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <CurrencyPicker open={picker} value={currency} onClose={() => setPicker(false)} onPick={setCurrency} />
      <PasswordPromptHost />
    </div>
  )
}
