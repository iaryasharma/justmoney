import { ReportRun } from '../components/reports/ReportRun'
import { DeleteRun } from '../components/transactions/DeleteRun'
import { BackupRun } from '../components/backup/BackupRun'
import { RestoreRun } from '../components/backup/RestoreRun'
import { useScrollRestore } from '../lib/core/useScrollRestore'
import { useEffect, useState, type ReactNode } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, Spinner, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { planFor, PROFESSIONS, professionLabel, professionOf, useProfession, type Profession } from '../lib/plan/profession'
import { getPlanSettings, savePlanSettings } from '../lib/plan/plan'
import { clearAllQuietly, flushStorage, read, useStored, write, KEYS } from '../lib/core/storage'
import { withFamily } from '../lib/core/data'
import { buildBackup, encryptBackup, isNativeApp, readOwnBackup, runAutoBackup } from '../lib/backup/backup'
import { askPassword, BackupPasswordSheet } from '../components/backup/BackupPassword'
import AutoBackupCard from '../components/backup/AutoBackupCard'
import Watermark from '../components/ui/Watermark'
import { CustomizeHomePage, DiagnosticsPage, PartnerPage, TrashPage } from './SettingsMore'
import { syncNativeNotifications } from '../lib/notify/nativeNotify'
import { getTrash } from '../lib/core/trash'
import { shareFile } from '../lib/backup/shareFile'
import { AutoCapturePage, RulesPage } from './SettingsExtras'
import { PeoplePage } from './People'
import { PresetsPage } from './PlannerMore'
import ShopPayoutPage from './ShopSettings'
import { CURRENCIES, formatPrice, monthRange, monthShort } from '../lib/core/format'
import { DEFAULT_PREFS, notificationsGranted, requestNotificationPermission } from '../lib/notify/notify'
import { hashPin, requireAuth, verifyWithBiometric } from '../components/ui/AppLock'
import { applyScope, BACKUP_GROUPS, groupOn, type BackupGroup, type Scope } from '../lib/backup/backupScope'
import { updateWidget } from '../lib/notify/widget'
import { Capture, Device, NativeDb } from '../lib/core/native'
import { nanoStatus } from '../lib/capture/capture'
import type { Commitment, NotificationPrefs, Transaction, User } from '../lib/core/types'
import { committedCategories, isPersonalSpend } from '../lib/core/money'
import { DEFAULT_ALERTS, SOUNDS, type AlertPrefs } from '../lib/notify/alerts'
import type { PlannerPage } from './Planner'

export const APP_VERSION = '3.6.0'
type Sub = null | 'backup' | 'backupscope' | 'security' | 'profile' | 'categories' | 'notifications' | 'lock' | 'ai' | 'capture' | 'rules' | 'trash' | 'diag' | 'home' | 'partner' | 'people' | 'presets' | 'shoppay'

export default function Settings({ openPlanner, onWhatsNew }: { openPlanner: (p: PlannerPage) => void; onWhatsNew: () => void }) {
  const [user] = useStored<User | null>(KEYS.user, null)
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const { shop } = useProfession()
  const [aiConsent] = useStored<boolean>(KEYS.aiConsent, false)
  const [apiKey] = useStored<string>(KEYS.geminiKey, '')
  const [sub, setSub] = useState<Sub>(null)
  const [wiping, setWiping] = useState(false)
  useScrollRestore(sub)
  const [autoRep, setAutoRep] = useStored<{ enabled: boolean; lastKey: string }>(KEYS.autoReport, { enabled: false, lastKey: '' })
  const [reportSheet, setReportSheet] = useState(false)
  const toast = useToast()

  if (sub === 'profile') return <ProfilePage onBack={() => setSub(null)} />
  if (sub === 'categories') return <CategoriesPage onBack={() => setSub(null)} />
  if (sub === 'notifications') return <NotificationsPage onBack={() => setSub(null)} />
  if (sub === 'backup' || sub === 'backupscope') return <BackupPage onBack={() => setSub(null)} />
  if (sub === 'security' || sub === 'lock') return <SecurityPage onBack={() => setSub(null)} />
  if (sub === 'ai') return <AIPage onBack={() => setSub(null)} />
  if (sub === 'capture') return <AutoCapturePage onBack={() => setSub(null)} />
  if (sub === 'rules') return <RulesPage onBack={() => setSub(null)} />
  if (sub === 'trash') return <TrashPage onBack={() => setSub(null)} />
  if (sub === 'diag') return <DiagnosticsPage onBack={() => setSub(null)} version={APP_VERSION} />
  if (sub === 'home') return <CustomizeHomePage onBack={() => setSub(null)} />
  if (sub === 'shoppay') return <ShopPayoutPage onBack={() => setSub(null)} />
  if (sub === 'presets') return <PresetsPage onBack={() => setSub(null)} />
  if (sub === 'people') return <PeoplePage onBack={() => setSub(null)} />
  if (sub === 'partner') return <PartnerPage onBack={() => setSub(null)} />

  // the same "spent" as Home: transfers, loans, splits and planned commitments are not spending
  const committed = committedCategories(read<Commitment[]>(KEYS.commitments, []))
  const total = txns.filter((t) => isPersonalSpend(t, committed)).reduce((a, t) => a + t.paymentAmount, 0)

  async function exportCsv() {
    if (!(await requireAuth('Export this month'))) return
    const now = new Date()
    const { start, end } = monthRange(now.getFullYear(), now.getMonth())
    const rows = txns.filter((t) => t.timestamp >= start && t.timestamp < end).sort((a, b) => a.timestamp - b.timestamp)
    if (!rows.length) { toast('Nothing to export', 'There are no transactions in this month yet.'); return }
    const methods = read<{ id: string; name: string }[]>(KEYS.paymentMethods, [])
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const csv = ['Date,Receiver,Category,Type,Source,Payment Method,Amount,Note,Original Amount,Original Currency', ...rows.map((t) => [
      new Date(t.timestamp).toISOString().slice(0, 16).replace('T', ' '), t.paymentReceiver, t.paymentCategory, t.paymentType,
      t.paymentSource ?? '', methods.find((m) => m.id === t.paymentMethodId)?.name ?? '', String(t.paymentAmount),
      t.note ?? '', t.originalAmount ? String(t.originalAmount) : '', t.originalCurrency ?? '',
    ].map(esc).join(','))].join('\n')
    const name = `justmoney-${monthShort(now.getMonth()).toLowerCase()}-${now.getFullYear()}.csv`
    if (isNativeApp()) {
      shareFile(name, new Blob([csv], { type: 'text/csv' }), { title: 'JustMoney export', keep: true })
        .then((r) => { if (r.savedTo && !r.shared) toast('CSV saved', r.savedTo) })
        .catch((e) => toast('Could not export the CSV', String(e?.message ?? '').slice(0, 80)))
    } else download(name, csv, 'text/csv')
  }

  return (
    <div className="page glow-page">

      <h1 className="screen-title">Settings</h1>


      <button className="card profile-card" style={{ marginTop: 16 }} onClick={() => setSub('profile')}>
        <span className="profile-avatar" aria-hidden>{(user?.name?.trim()[0] ?? 'J').toUpperCase()}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: 'block', fontSize: 18 }}>{user?.name || 'Add your name'}</b>
          <span className="muted small">{user?.monthly_income ? `${formatPrice(user.monthly_income, { round: true })}/mo` : 'Add your income'} · {user?.currency ?? 'INR'}</span>
          <span className="dim tiny" style={{ display: 'block', marginTop: 2 }}>{formatPrice(total, { round: true })} spent across {txns.length} transaction{txns.length === 1 ? '' : 's'}</span>
        </span>
        <span className="chev"><Icon name="chevron" size={18} /></span>
      </button>

      <div className="group-label">Money setup</div>
      <div className="card">
        <Row icon="bank" label="Accounts & cards" sub="Kotak, UCO, cards, balances, salary" onClick={() => openPlanner('methods')} />
        <Row icon="tag" label="Edit Categories" onClick={() => setSub('categories')} />
        {shop && <Row icon="bank" label="Shop payouts" sub="PhonePe / Paytm business: account and auto-settle" onClick={() => setSub('shoppay')} />}
        <Row icon="plus" label="Quick presets" sub="One-tap expenses like chai or auto" onClick={() => setSub('presets')} />
        <Row icon="users" label="Contacts & family" sub="Link payments to people, mark family" onClick={() => setSub('people')} />
        <Row icon="filter" label="Category rules" sub="Auto-categorise by payee" onClick={() => setSub('rules')} />
        <Row icon="bell" label="Auto-capture payments" sub="From GPay, PhonePe, bank notifications" onClick={() => setSub('capture')} />
      </div>

      <div className="group-label">Make it yours</div>
      <div className="card">
        <Row icon="home" label="Appearance" sub="Theme, accent colour, Home cards, hide amounts on launch" onClick={() => setSub('home')} />
        <Row icon="users" label="Share setup with partner" sub="Envelopes, budgets, categories and goals" onClick={() => setSub('partner')} />
      </div>

      <div className="group-label">Alerts & security</div>
      <div className="card">
        <Row icon="bell" label="Payment Reminders" onClick={() => openPlanner('reminders')} />
        <Row icon="bell" label="Notifications" onClick={() => setSub('notifications')} />
        <Row icon="lock" label="Security" sub="App Lock, screen privacy, encryption and backups" onClick={() => setSub('security')} />
      </div>

      <div className="group-label">AI</div>
      <div className="card">
        <Row icon="sparkles" label={isNativeApp() ? 'AI & assistants' : 'AI processing'} sub={isNativeApp() ? `On-device reader ready${aiConsent && apiKey ? ' · Gemini cloud on' : ''}` : aiConsent && apiKey ? 'On · Google Gemini' : aiConsent ? 'On · add an API key' : 'Off · on-device parsing only'} onClick={() => setSub('ai')} />
      </div>

      <div className="group-label">Backup</div>
      <div className="card">
        <Row icon="download" label="Backup & restore" sub="Automatic backups, password, what to include, restore" onClick={() => setSub('backup')} />
      </div>

      <div className="group-label">Export</div>
      <div className="card">
        <Row icon="doc" label="Export report (PDF)" sub="Pick the month and what goes in. Printable, with a preview" onClick={async () => { if (await requireAuth('Export a report')) setReportSheet(true) }} />
        <Row icon="download" label="Export this month (CSV)" onClick={exportCsv} />
        {isNativeApp() && <div className="list-row"><span className="icon-tile" style={{ background: 'var(--glass)' }}><Icon name="calendar" size={18} /></span><div className="grow"><div>Auto-save monthly report</div><div className="dim small">On the 1st, last month’s PDF is saved and you’re notified</div></div><Toggle on={autoRep.enabled} onChange={(v) => setAutoRep({ ...autoRep, enabled: v })} label="Auto-save monthly report" /></div>}
      </div>

      <div className="group-label">Safety</div>
      <div className="card">
        <Row icon="trash" label="Trash & activity" sub={`${getTrash().length} deleted · restore within 30 days`} onClick={() => setSub('trash')} />
        <Row icon="info" label="Diagnostics" sub="Error log you can share when asking for help" onClick={() => setSub('diag')} />
      </div>

      <div className="group-label">About</div>
      <div className="card">
        <Row icon="star" label="What's new" sub={`Version ${APP_VERSION}`} onClick={onWhatsNew} />
      </div>

      <div className="group-label" style={{ color: 'var(--danger)' }}>Danger zone</div>
      <div className="card" style={{ borderColor: 'rgba(239,68,68,.25)' }}>
        <Row icon="trash" label="Delete all data" sub="Clears everything on this device" color="var(--danger)" onClick={async () => {
          if (!(await requireAuth('Delete all data'))) return
          setWiping(true)
        }} />
      </div>
      {wiping && <DeleteRun work={async () => { clearAllQuietly(); await flushStorage() }} onCancel={() => setWiping(false)} onFinished={async () => { clearAllQuietly(); await flushStorage(); location.reload() }} />}
      <p className="dim tiny" style={{ textAlign: 'center', marginTop: 24 }}>JustMoney · v{APP_VERSION} · your data stays on this device</p>
      <Watermark />

      {reportSheet && <ReportRun onClose={() => setReportSheet(false)} />}
    </div>
  )
}

const Row = ({ icon, label, sub, onClick, color, right }: { icon: string; label: string; sub?: string; onClick: () => void; color?: string; right?: ReactNode }) => (
  <button className="list-row" onClick={onClick} style={{ color }}>
    <span className="icon-tile" style={{ background: color ? 'rgba(239,68,68,.14)' : 'var(--glass)' }}><Icon name={icon} size={18} /></span><div className="grow"><div>{label}</div>{sub && <div className="dim small">{sub}</div>}</div>{right ?? <span className="chev"><Icon name="chevron" size={18} /></span>}
  </button>
)

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ---------- Profile ---------- */
function ProfilePage({ onBack }: { onBack: () => void }) {
  const [user, setUser] = useStored<User | null>(KEYS.user, null)
  const toast = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [age, setAge] = useState(user?.age ? String(user.age) : '')
  const [currency, setCurrency] = useState(user?.currency ?? 'INR')
  const [income, setIncome] = useState(user?.monthly_income ? String(user.monthly_income) : '')
  const [picker, setPicker] = useState(false)
  const [prof, setProf] = useState<Profession>(professionOf(user))
  return (
    <div className="page">
      <PageHeader title="Edit Profile" onBack={onBack} />
      <div className="col" style={{ gap: 14 }}>
        <div className="field"><label>Your name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Age</label><input className="input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} placeholder="optional" /></div>
        <div className="field"><label>Currency</label><button className="input row between" onClick={() => setPicker(true)}>{currency} — {CURRENCIES.find((c) => c[0] === currency)?.[1]}<Icon name="chevronDown" size={18} /></button></div>
        <div className="field"><label>What do you do?</label>
          <div style={{ position: 'relative' }}>
            <select className="input" value={prof} aria-label="What do you do?" style={{ paddingRight: 44 }} onChange={(e) => setProf(e.target.value as Profession)}>
              {PROFESSIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 14, top: 16, pointerEvents: 'none' }}><Icon name="chevronDown" size={18} /></span>
          </div>
          <div className="dim small" style={{ marginTop: 4 }}>{PROFESSIONS.find((x) => x[0] === prof)?.[2]}</div>
          <div className="dim tiny" style={{ lineHeight: 1.5 }}>Settings and the planner show what fits. A business owner sees shop payouts and customer credit; an employee sees salary tools; a student sees an allowance and an optional budget.</div>
        </div>
        {prof !== 'BUSINESS' && <div className="field"><label>{prof === 'STUDENT' ? 'Monthly allowance' : 'Monthly income'}</label><input className="input" inputMode="numeric" value={income} onChange={(e) => setIncome(e.target.value.replace(/\D/g, ''))} placeholder={prof === 'STUDENT' ? 'What you get each month (optional)' : ''} /></div>}
        <button className="btn block" onClick={() => {
          if (!name.trim()) { toast('Enter your name'); return }
          const changed = prof !== professionOf(user) || !user?.profession
          setUser({ id: user?.id ?? 'local', name: name.trim(), age: age ? Number(age) : null, currency, monthly_income: prof === 'BUSINESS' ? 0 : Number(income) || 0, profession: prof })
          if (changed) savePlanSettings(planFor(prof, getPlanSettings()))
          toast('Profile saved', changed ? `Showing what fits a ${professionLabel(prof).toLowerCase()}.` : undefined); onBack()
        }}>Save</button>
      </div>
      <CurrencyPicker open={picker} value={currency} onClose={() => setPicker(false)} onPick={setCurrency} />
    </div>
  )
}

export function CurrencyPicker({ open, value, onClose, onPick }: { open: boolean; value: string; onClose: () => void; onPick: (c: string) => void }) {
  const [q, setQ] = useState('')
  const list = CURRENCIES.filter(([c, n]) => !q || c.toLowerCase().includes(q.toLowerCase()) || n.toLowerCase().includes(q.toLowerCase()))
  return (
    <Sheet open={open} onClose={onClose} full>
      <SheetHeader title="Choose currency" onClose={onClose} />
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or name" />
      <div className="card" style={{ marginTop: 12 }}>
        {list.map(([c, n]) => (
          <button key={c} className="list-row" onClick={() => { document.body.classList.add('cur-morph'); setTimeout(() => document.body.classList.remove('cur-morph'), 700); onPick(c); onClose() }}>
            <b style={{ width: 48 }}>{c}</b><span className="grow muted">{n}</span>{value === c && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/* ---------- Categories ---------- */
function CategoriesPage({ onBack }: { onBack: () => void }) {
  const [stored, setStored] = useStored<string[] | null>(KEYS.categories, null)
  const cats = withFamily(stored)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  return (
    <div className="page">
      <PageHeader title="Edit Categories" onBack={onBack} />
      <p className="muted small">Customize how your transactions get tagged. Rename, add, or restore defaults to match how you spend.</p>
      <div className="card">
        {cats.map((c) => (
          <div key={c} className="list-row">
            {renaming === c ? (
              <form className="row grow" onSubmit={(e) => {
                e.preventDefault()
                const v = renameVal.trim()
                if (!v || (v !== c && cats.includes(v))) return
                setStored(cats.map((x) => (x === c ? v : x)))
                write(KEYS.transactions, read<Transaction[]>(KEYS.transactions, []).map((t) => (t.paymentCategory === c ? { ...t, paymentCategory: v } : t)))
                setRenaming(null); toast('Category renamed')
              }}><input className="input grow" style={{ height: 40 }} autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} /><button className="btn sm">Save</button></form>
            ) : (
              <>
                <span className="grow">{c}</span>
                {c !== 'Family' && <button className="dim" aria-label="Rename" onClick={() => { setRenaming(c); setRenameVal(c) }}><Icon name="edit" size={18} /></button>}
                {c !== 'Others' && c !== 'Family' && <button className="dim" aria-label="Delete" onClick={async () => {
                  if (await confirm({ title: `Delete "${c}"?`, body: 'Transactions already tagged with this stay labelled with it.', confirm: 'Delete', danger: true })) setStored(cats.filter((x) => x !== c))
                }}><Icon name="trash" size={18} /></button>}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="section-label">Add new category</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (!v || cats.includes(v)) return; setStored([...cats, v]); setDraft(''); toast('Category added') }}>
        <input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Pets" /><button className="btn sm">Add</button>
      </form>
      <button className="btn block secondary" style={{ marginTop: 20 }} onClick={() => { setStored(null); toast('Categories restored') }}>Restore defaults</button>
    </div>
  )
}

/* ---------- Notifications ---------- */
function NotificationsPage({ onBack }: { onBack: () => void }) {
  const [prefs, setPrefs] = useStored<NotificationPrefs>(KEYS.notificationPrefs, DEFAULT_PREFS)
  const [granted, setGranted] = useState(notificationsGranted())
  const [alerts, setAlerts] = useStored<AlertPrefs>(KEYS.alertPrefs, DEFAULT_ALERTS)
  const [sound, setSound] = useStored<string>(KEYS.notifSound, 'default')
  const [quickAdd, setQuickAdd] = useStored<boolean>(KEYS.quickAddNotif, false)
  const ALERT_ROWS: [keyof AlertPrefs, string, string][] = [
    ['nameIt', 'Who was this paid to?', 'The moment a payment arrives with no name on it'],
    ['digest', 'Weekly “needs a name” reminder', 'Sundays, only while 3 or more payments have no name'],
    ['unconfirmed', 'Payment not confirmed by bank', 'A receipt screenshot the bank message never matched'],
    ['duplicates', 'Possible double charge', 'The same merchant and amount twice, or a subscription charged twice'],
    ['backupDone', 'Backup saved', 'After each successful backup'],
    ['backupDue', 'Backup reminder', 'When no backup has run for a week'],
  ]
  const rows: [keyof NotificationPrefs, string, string][] = [
    ['daily', 'Daily Reminder', 'Every day at 9:00 PM'],
    ['weekly', 'Weekly Summary', 'Every Sunday at 10:00 AM'],
    ['bimonthly', 'Bi-Monthly Insights', '1st & 15th of every month at 11:00 AM'],
    ['monthly', 'Monthly Wrap-up', '28th of every month at 7:00 PM'],
  ]
  return (
    <div className="page">
      <PageHeader title="Notifications" onBack={onBack} />
      <p className="muted small">Pick the daily, weekly, and monthly nudges you want from JustMoney.</p>
      {!granted && (
        <button className="card pad row" style={{ width: '100%', textAlign: 'left', marginBottom: 12, borderColor: 'rgba(255,59,48,.4)' }} onClick={async () => setGranted(await requestNotificationPermission())}>
          <Icon name="bell" /><div className="grow"><b style={{ color: '#FF3B30' }}>Notifications Disabled</b><div className="dim small">Tap to enable notifications in this browser.</div></div>
        </button>
      )}
      <div className="section-label">Reminders</div>
      <div className="card">{rows.map(([k, t, s]) => (
        <div key={k} className="list-row"><div className="grow"><div>{t}</div><div className="dim small">{s}</div></div><Toggle on={prefs[k]} label={t} onChange={(v) => setPrefs({ ...prefs, [k]: v })} /></div>
      ))}</div>
      <div className="section-label">Money alerts</div>
      <div className="card">{ALERT_ROWS.map(([k, title, sub]) => (
        <div key={k} className="list-row"><div className="grow"><div>{title}</div><div className="dim small">{sub}</div></div><Toggle on={alerts[k]} label={title} onChange={(v) => { setAlerts({ ...alerts, [k]: v }); void syncNativeNotifications() }} /></div>
      ))}</div>
      <div className="section-label">Notification shade</div>
      <div className="card">
        <div className="list-row"><div className="grow"><div>Quick-add in notification shade</div><div className="dim small">A pinned “Add expense” notification that stays in the shade (Android)</div></div><Toggle on={quickAdd} label="Quick-add in notification shade" onChange={(v) => { setQuickAdd(v); void syncNativeNotifications() }} /></div>
      </div>
      <div className="section-label">Notification sound</div>
      <div className="card">{SOUNDS.map((s) => (
        <button key={s.id} className="list-row" onClick={() => {
          setSound(s.id); void syncNativeNotifications()
          if (s.id !== 'default' && s.id !== 'silent') { try { void new Audio(`/sounds/${s.id}.wav`).play() } catch { /* preview is optional */ } }
        }}>
          <div className="grow" style={{ textAlign: 'left' }}>{s.label}</div>{sound === s.id && <Icon name="check" size={18} />}
        </button>
      ))}</div>
      <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>The sound applies to JustMoney reminders and alerts. If you changed a notification channel in Android settings, Android keeps your choice there.</p>
    </div>
  )
}

/* ---------- Security ---------- */
export const GRACE_OPTIONS: [number, string][] = [[0, 'Immediately'], [60000, 'After 1 minute'], [300000, 'After 5 minutes'], [-1, 'Only when the app starts']]

/** One place for everything that protects the data: App Lock, screen privacy, notifications and widgets, encryption and backups. */
function SecurityPage({ onBack }: { onBack: () => void }) {
  const [pinHash, setPinHash] = useStored<string>(KEYS.appLock, '')
  const [grace, setGrace] = useStored<number>(KEYS.appLockGrace, 0)
  const [privacy, setPrivacy] = useStored<boolean>(KEYS.privacyScreen, false)
  const [bio, setBio] = useStored<boolean>(KEYS.appLockBiometric, false)
  const [widgetsOpen, setWidgetsOpen] = useStored<boolean>(KEYS.widgetsWhenLocked, true)
  const [notifPrivate, setNotifPrivate] = useStored<boolean>(KEYS.notifPrivate, true)
  const [reauth, setReauth] = useStored<boolean>(KEYS.reauth, true)
  const [blockCapture, setBlockCapture] = useStored<boolean>(KEYS.blockCapture, false)
  const [aiConsent] = useStored<boolean>(KEYS.aiConsent, false)
  const [setting, setSetting] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [scan, setScan] = useState(false)
  const [lastCheck] = useStored<{ at: number; good: number; total: number } | null>(KEYS.securityCheck, null)
  const [native2, setNative2] = useState<{ dataEncrypted?: boolean; localEncrypted?: boolean }>({})
  const [dev, setDev] = useState<{ screenLock: boolean; rooted: boolean; usbDebugging: boolean } | null>(null)
  const toast = useToast()
  const native = isNativeApp()
  const lockOn = !!pinHash || (native && bio)

  const refresh = () => {
    if (!native) return
    NativeDb.getBackupStatus().then((s) => setNative2(s as { dataEncrypted?: boolean; localEncrypted?: boolean })).catch(() => {})
    Device.deviceSecurity().then(setDev).catch(() => {})
  }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleBiometric(v: boolean) {
    if (!v) { if (!(await requireAuth('Turn off fingerprint unlock'))) return; setBio(false); toast(pinHash ? 'Fingerprint / face unlock off' : 'App Lock off'); return }
    const s = await Device.biometricStatus()
    if (!s.available) { toast('Not available', s.reason); return }
    // Confirm once now, so nobody gets locked out by a prompt that can't succeed.
    if (!(await verifyWithBiometric('Turn on App Lock'))) { toast('Not turned on', 'Verification was cancelled.'); return }
    setBio(true)
    toast('App Lock on', s.biometricEnrolled ? 'Unlock with your fingerprint or face.' : "No fingerprint or face is set up, so your phone's screen lock will be asked.")
    // a passcode inside the app is the way back in if the fingerprint reader fails
    if (!pinHash) setSetting(true)
  }

  const encrypted = native2.dataEncrypted !== false
  const items: SecItem[] = [
    { id: 'lock', ok: lockOn, title: lockOn ? 'App Lock is on' : 'App Lock is off', body: lockOn ? [pinHash ? 'passcode' : '', native && bio ? 'fingerprint or face' : ''].filter(Boolean).join(' and ') : 'Anyone holding your unlocked phone can open JustMoney and see everything.', fix: lockOn ? undefined : 'Turn on', run: () => (native ? toggleBiometric(true) : setSetting(true)) },
    ...(pinHash ? [{ id: 'hash', ok: pinHash.startsWith('pbkdf2$'), title: pinHash.startsWith('pbkdf2$') ? 'Passcode stored with a salted, slow hash' : 'Passcode uses an older, weaker hash', body: pinHash.startsWith('pbkdf2$') ? 'Wrong tries also slow down: 5 wrong means a 30 second wait, then longer.' : 'It is upgraded automatically the next time you unlock with it.' }] : []),
    ...(lockOn ? [{ id: 'grace', ok: grace >= 0 && grace <= 60000, title: grace === 0 ? 'Locks as soon as you leave the app' : grace === -1 ? 'Locks only when the app starts' : 'Locks after a short while', body: grace === -1 || grace > 60000 ? 'A shorter wait is safer: “Immediately” or 1 minute.' : 'Good.', fix: grace === -1 || grace > 60000 ? 'Set to 1 minute' : undefined, run: () => setGrace(60000) }] : []),
    ...(native ? [{ id: 'capture', ok: blockCapture, title: blockCapture ? 'Screenshots and screen recording are blocked' : 'Screenshots and screen recording are allowed', body: blockCapture ? 'The screen shows black in screenshots, recordings and casting.' : 'Anyone who can run a screen recorder or cast the screen can see your finances.', fix: blockCapture ? undefined : 'Block', run: () => setBlockCapture(true) }] : []),
    { id: 'switcher', ok: privacy, title: privacy ? 'Hidden in the app switcher' : 'Visible in the app switcher', body: 'Your balances are covered when you switch to another app.', fix: privacy ? undefined : 'Turn on', run: () => setPrivacy(true) },
    ...(native ? [{ id: 'notif', ok: notifPrivate, title: notifPrivate ? 'Notification details hidden on the lock screen' : 'Notifications show amounts on the lock screen', body: notifPrivate ? 'Reminders say “Contents hidden” until the phone is unlocked.' : 'Anyone who sees the phone can read bills and amounts.', fix: notifPrivate ? undefined : 'Turn on', run: () => setNotifPrivate(true) }] : []),
    ...(native && lockOn ? [{ id: 'widgets', ok: !widgetsOpen, title: widgetsOpen ? 'Widgets show your data while App Lock is on' : 'Widgets are hidden while App Lock is on', body: widgetsOpen ? 'Handy, but amounts are visible on the home screen. You can hide them if you share the phone.' : 'Widgets show “App Lock is on” instead of amounts.', fix: widgetsOpen ? 'Hide amounts' : undefined, run: () => { setWidgetsOpen(false); setTimeout(() => updateWidget(), 50) } }] : []),
    { id: 'reauth', ok: reauth || !lockOn, title: reauth ? 'Sensitive actions ask again' : 'Sensitive actions do not ask again', body: 'Deleting data, exporting, restoring and showing the AI key re-check your fingerprint or passcode.', fix: reauth ? undefined : 'Turn on', run: () => setReauth(true) },
    ...(native && dev ? [{ id: 'screenlock', ok: dev.screenLock, title: dev.screenLock ? 'The phone has a screen lock' : 'The phone has no screen lock', body: dev.screenLock ? 'The key that guards your data sits behind it.' : 'Set a PIN, pattern or fingerprint in your phone’s settings. Without it anyone who picks up the phone can open it, and the key that guards your data is not protected.' }] : []),
    ...(native && dev?.rooted ? [{ id: 'root', ok: false, title: 'The phone looks rooted', body: 'On a rooted phone other apps can get around the protections that keep your data private. Treat what is stored here as less safe.' }] : []),
    ...(native && dev?.usbDebugging ? [{ id: 'adb', ok: false, title: 'USB debugging is on', body: 'A computer you plug the phone into could read app data. Turn it off in Developer options when you are not developing.' }] : []),
    ...(native ? [{ id: 'rest', ok: encrypted, title: encrypted ? 'Your data is encrypted on this phone' : 'Encryption is not available on this phone', body: encrypted ? 'Everything is stored encrypted with a key that never leaves this phone’s secure hardware, so no other app, and no copy of the file, can read it.' : 'This phone’s secure key store could not be used, so data is kept as before. Keep an eye on who can access the phone.' }] : []),
    ...(native ? [{ id: 'backup', ok: !!native2.localEncrypted, title: native2.localEncrypted ? 'Backups are protected by a password' : 'Backups are not password protected', body: native2.localEncrypted ? 'The backup on this phone and the cloud copy are encrypted. Keep the password safe: without it a backup cannot be opened.' : 'The backup file in Documents can be read by anything that can open it. A password encrypts it.', fix: native2.localEncrypted ? 'Change' : 'Set password', run: () => setPwOpen(true) }] : []),
    { id: 'device', ok: true, title: 'Your data stays on this device', body: aiConsent ? 'With AI on, only numbers (no names) are sent for suggestions, and photos or messages you choose to read.' : 'Nothing leaves the phone unless you turn on AI or cloud backup.' },
  ]
  const bad = items.filter((i) => !i.ok)
  const fixable = bad.filter((i) => i.run && ['capture', 'switcher', 'notif', 'reauth', 'grace', 'widgets'].includes(i.id) && i.id !== 'widgets')

  const fixRecommended = () => {
    fixable.forEach((i) => i.run?.())
    toast(`${fixable.length} setting${fixable.length === 1 ? '' : 's'} turned on`, bad.some((i) => i.id === 'lock' || i.id === 'backup') ? 'App Lock and a backup password need you, so they are still open below.' : undefined)
  }

  const row = (label: string, sub: string, on: boolean, set: (v: boolean) => void, icon?: string) => (
    <div className="list-row">{icon && <Icon name={icon} />}<div className="grow"><div>{label}</div><div className="dim small">{sub}</div></div><Toggle on={on} label={label} onChange={set} /></div>
  )

  return (
    <div className="page">
      <PageHeader title="Security" onBack={onBack} />

      <button className="card pad row" style={{ width: '100%', gap: 14, textAlign: 'left', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 35%, transparent), color-mix(in srgb, color-mix(in srgb, var(--accent-deep) 56%, #000) 35%, transparent))', borderColor: 'color-mix(in srgb, color-mix(in srgb, var(--accent) 45%, #fff) 35%, transparent)' }} onClick={() => setScan(true)} aria-label="Run a quick security check">
        <span className="circle-icon" style={{ background: 'rgba(255,255,255,.14)', color: '#fff', flex: 'none' }}><Icon name="lock" size={24} /></span>
        <span className="grow" style={{ minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 17 }}>Quick security check</b>
          <span className="small" style={{ opacity: 0.75, display: 'block', lineHeight: 1.45 }}>{lastCheck ? `Last check ${ago(lastCheck.at)}: ${lastCheck.good} of ${lastCheck.total} passed` : 'Checks your lock, screen privacy, encryption and backups in a few seconds.'}</span>
        </span>
        <span className="chev"><Icon name="chevron" size={18} /></span>
      </button>
      {scan && <SecurityScan items={items} fixable={fixable} onFixAll={fixRecommended} onClose={() => { setScan(false); refresh() }} />}

      <div className="section-label">App Lock</div>
      <div className="card">
        {native && row('Fingerprint / face unlock', 'Ask for your face, fingerprint or phone screen lock before opening JustMoney.', bio, toggleBiometric, 'lock')}
        <div className="list-row"><Icon name="key" /><div className="grow"><div>{native ? 'JustMoney passcode' : 'Turn on App Lock'}</div><div className="dim small">{native ? 'A 4-digit passcode just for this app, alongside or instead of fingerprint.' : 'A 4-digit passcode asked each time you open JustMoney.'}</div></div>
          <Toggle on={!!pinHash} label="Passcode" onChange={async (v) => { if (v) setSetting(true); else if (await requireAuth('Turn off the passcode')) { setPinHash(''); toast(bio && native ? 'Passcode removed' : 'App Lock off') } }} /></div>
      </div>
      {lockOn && (
        <>
          <div className="label" style={{ margin: '14px 0 8px' }}>Lock again</div>
          <div className="card">{GRACE_OPTIONS.map(([v, l]) => (
            <button key={v} className="list-row" onClick={() => setGrace(v)}><span className="grow">{l}</span>{grace === v && <Icon name="check" size={18} />}</button>
          ))}</div>
          {pinHash && <button className="btn block secondary" style={{ marginTop: 12 }} onClick={() => setSetting(true)}>Change passcode</button>}
        </>
      )}

      <div className="section-label">Screen privacy</div>
      <div className="card">
        {native && row('Block screenshots and screen recording', 'The screen turns black in screenshots, recordings and when casting. Also hides JustMoney in recent apps.', blockCapture, setBlockCapture, 'eyeOff')}
        {row('Hide contents in app switcher', native ? 'Covers JustMoney in the list of recent apps.' : 'Covers the screen when you switch away from JustMoney.', privacy, setPrivacy)}
      </div>
      {native && blockCapture && <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>With this on you cannot take screenshots of JustMoney yourself, either. Turn it off to share a screenshot.</p>}

      {native && (
        <>
          <div className="section-label">Notifications and widgets</div>
          <div className="card">
            {row('Hide notification details on the lock screen', 'Reminders show “Contents hidden” until the phone is unlocked.', notifPrivate, setNotifPrivate)}
            {row('Show widget data while locked', widgetsOpen ? 'Home-screen widgets keep showing your balance and spending, even with App Lock on.' : 'Widgets show “App Lock is on” instead of amounts.', widgetsOpen, (v) => { setWidgetsOpen(v); setTimeout(() => updateWidget(), 50) })}
          </div>
        </>
      )}

      <div className="section-label">Protect important actions</div>
      <div className="card">{row('Ask again before sensitive actions', 'Deleting data, exporting, restoring a backup, showing the AI key and turning off App Lock ask for your fingerprint or passcode again.', reauth, setReauth)}</div>

      <div className="section-label">Data and backups</div>
      <div className="card">
        {native && <div className="list-row"><Icon name="lock" /><div className="grow"><div>Encrypted on this phone</div><div className="dim small">{encrypted ? 'AES-256, with a key that stays in the phone’s secure hardware. No other app can read your data.' : 'Not available on this phone.'}</div></div><span className="small" style={{ color: encrypted ? 'var(--credit)' : 'var(--amber)' }}>{encrypted ? 'On' : 'Off'}</span></div>}
        {native && <button className="list-row" onClick={() => setPwOpen(true)}><Icon name="key" /><div className="grow" style={{ textAlign: 'left' }}><div>Backup password</div><div className="dim small">{native2.localEncrypted ? 'Set. Backups on the phone and in the cloud are encrypted.' : 'Not set. Backups are readable by anything that can open the file.'}</div></div><span className="chev"><Icon name="chevron" size={18} /></span></button>}
        <div className="list-row"><Icon name="doc" /><div className="grow"><div>What goes into a backup</div><div className="dim small">Everything, except your passcode, fingerprint settings and API keys. Choose parts to leave out in Settings → What to back up.</div></div></div>
      </div>
      <p className="dim tiny" style={{ marginTop: 14, lineHeight: 1.5 }}>Keep your phone’s own screen lock on: it protects the phone itself, and the key that guards your data lives behind it.</p>

      <SetPinSheet open={setting} onClose={() => setSetting(false)} onSet={async (pin) => { setPinHash(await hashPin(pin)); toast('App Lock on') }} />
      <BackupPasswordSheet open={pwOpen} onClose={() => { setPwOpen(false); refresh() }} />
    </div>
  )
}

function SetPinSheet({ open, onClose, onSet }: { open: boolean; onClose: () => void; onSet: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  const [first, setFirst] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const reset = () => { setPin(''); setFirst(null); setErr('') }
  return (
    <Sheet open={open} onClose={() => { reset(); onClose() }}>
      <SheetHeader title={first ? 'Confirm passcode' : 'Set a 4-digit passcode'} onClose={() => { reset(); onClose() }} />
      <form className="col" onSubmit={(e) => {
        e.preventDefault()
        if (!/^\d{4}$/.test(pin)) return setErr('Enter 4 digits')
        if (!first) { setFirst(pin); setPin(''); setErr(''); return }
        if (pin !== first) { setErr("Passcodes don't match"); setPin(''); setFirst(null); return }
        onSet(pin); reset(); onClose()
      }}>
        <input className="input" style={{ textAlign: 'center', fontSize: 28, letterSpacing: '.5em' }} type="password" inputMode="numeric" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        {err && <div className="error-text">{err}</div>}
        <button className="btn block">{first ? 'Confirm' : 'Next'}</button>
      </form>
    </Sheet>
  )
}

/* ---------- AI ---------- */
function AIPage({ onBack }: { onBack: () => void }) {
  const [consent, setConsent] = useStored<boolean>(KEYS.aiConsent, false)
  const [key, setKey] = useStored<string>(KEYS.geminiKey, '')
  const [draft, setDraft] = useState(key)
  const [show, setShow] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()
  const native = isNativeApp()
  const [nano, setNano] = useState<string>(native ? 'checking' : 'unavailable')
  useEffect(() => {
    if (!native) return
    nanoStatus(true).then(setNano)
    const sub = Capture.addListener('nanoReady', () => { nanoStatus(true).then(setNano); toast('Gemini Nano is ready', 'On-device AI is now used for screenshots and messages.') })
    return () => { sub.then((h) => h.remove()) }
  }, [native, toast])
  const nanoText: Record<string, string> = {
    checking: 'Checking…',
    available: 'Ready — used when the built-in reader isn’t sure',
    downloadable: 'Supported on this phone — download the model to use it',
    downloading: 'Downloading in the background…',
    unavailable: 'Not supported on this phone (needs a recent Pixel / Galaxy with AICore)',
  }
  return (
    <div className="page">
      <PageHeader title="AI" onBack={onBack} />
      {native && (
        <>
          <div className="section-label" style={{ marginTop: 0 }}>Built into your phone · works offline</div>
          <div className="card">
            <div className="list-row"><Icon name="image" /><div className="grow"><div>Screenshot & receipt reader</div><div className="dim small">Ready — reads GPay, PhonePe, Paytm, bank and food-delivery screenshots and bills on the phone.</div></div><Icon name="check" size={18} /></div>
            <div className="list-row"><Icon name="sparkles" /><div className="grow"><div>Gemini Nano</div><div className="dim small">{nanoText[nano] ?? nano}</div></div>
              {nano === 'downloadable' && <button className="btn sm" onClick={async () => {
                try { await Capture.nanoDownload(); setNano('downloading'); toast('Downloading Gemini Nano', 'Android downloads it in the background — best on Wi-Fi.') } catch (e) { toast("Couldn't start the download", e instanceof Error ? e.message : '') }
              }}>Download</button>}
              {nano === 'available' && <Icon name="check" size={18} />}
            </div>
          </div>
          <p className="dim tiny" style={{ lineHeight: 1.5 }}>Nothing leaves your phone for these. The cloud option below is only used if it's on and the on-device reader can't find the expense.</p>
          <div className="section-label">Cloud AI (optional)</div>
        </>
      )}
      <div className="card"><div className="list-row"><Icon name="sparkles" /><div className="grow"><div>{native ? 'Google Gemini (cloud)' : 'AI processing'}</div><div className="dim small">{native ? 'Fallback for hard images, plus AI insights & statement import' : 'Smarter parsing, receipt reading, statement import & insights'}</div></div>
        <Toggle on={consent} label="Allow cloud AI" onChange={async (v) => {
          if (v) {
            if (await confirm({ title: 'Turn on AI processing?', body: 'JustMoney will send the text you type, receipt images, and statement contents directly from your device to Google Gemini using your API key, to extract transactions and generate spending insights. Nothing goes to JustMoney servers — there are none.', confirm: 'Allow' })) setConsent(true)
          } else if (await confirm({ title: 'Turn off AI processing?', body: 'Receipt reading and AI insights will stop working. Typed entries and PDF statements will use on-device parsing.', confirm: 'Turn off', danger: true })) setConsent(false)
        }} /></div></div>
      <div className="section-label">Gemini API key</div>
      <form className="col" onSubmit={(e) => { e.preventDefault(); setKey(draft.trim()); toast(draft.trim() ? 'API key saved' : 'API key removed') }}>
        <div className="row" style={{ position: 'relative' }}>
          <input className="input" type={show ? 'text' : 'password'} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="AIza…" autoComplete="off" />
          <button type="button" onClick={async () => { if (show || (await requireAuth('Show your AI key'))) setShow(!show) }} style={{ position: 'absolute', right: 14 }} aria-label="Toggle visibility"><Icon name={show ? 'eyeOff' : 'eye'} size={20} /></button>
        </div>
        <button className="btn block">Save key</button>
      </form>
      <p className="dim small" style={{ lineHeight: 1.5 }}>Get a free key at <a className="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. The key is stored only on this device.</p>
      {native && <AssistantHelp />}
    </div>
  )
}

/** How to reach JustMoney from Google Assistant, Gemini, Bixby and other apps. */
function AssistantHelp() {
  const toast = useToast()
  const links: [string, string][] = [
    ['Log by voice', 'justmoney://voice'],
    ['Add a spend directly', 'justmoney://add?text=paid 500 to Swiggy'],
    ['Scan a receipt', 'justmoney://scan'],
    ['Open splits', 'justmoney://split'],
  ]
  return (
    <>
      <div className="section-label">Assistants & sharing</div>
      <div className="card pad col small" style={{ gap: 10, lineHeight: 1.5 }}>
        <div><b>Share</b> any payment screenshot, receipt photo or bank SMS to <b>JustMoney</b> from Gallery, WhatsApp or Messages — it's read and saved automatically.</div>
        <div><b>Select text</b> (e.g. a bank SMS) → <b>Add to JustMoney</b> in the menu.</div>
        <div><b>Long-press the app icon</b> for Add by voice, Scan receipt, Add expense and Split.</div>
        <div><b>Google Assistant / Gemini:</b> “Hey Google, open Add by voice in JustMoney”, or create a routine that opens a link below.</div>
        <div><b>Bixby:</b> Quick commands or Modes & Routines → add an action that opens a link below (or the app shortcut).</div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        {links.map(([label, url]) => (
          <button key={url} className="list-row" onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Link copied', url) } catch { toast(url) } }}>
            <div className="grow"><div>{label}</div><div className="dim tiny" style={{ wordBreak: 'break-all' }}>{url}</div></div>
            <Icon name="share" size={16} />
          </button>
        ))}
      </div>
    </>
  )
}



type SecItem = { id: string; ok: boolean; title: string; body: string; fix?: string; run?: () => void }

const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/** The checks, gathered into four groups so the scan reads in four clear steps. */
const SCAN_GROUPS: { id: string; title: string; ids: string[]; path: string }[] = [
  { id: 'app', title: 'App Lock', ids: ['lock', 'hash', 'grace', 'reauth'], path: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z' },
  { id: 'screen', title: 'Screen privacy', ids: ['capture', 'switcher', 'notif', 'widgets'], path: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z' },
  { id: 'phone', title: 'This phone', ids: ['screenlock', 'root', 'adb', 'rest'], path: 'M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2' },
  { id: 'backup', title: 'Backups and data', ids: ['backup', 'device'], path: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' },
]

const SHIELD = 'M60 8l40 15v30c0 28-17 48-40 59C37 101 20 81 20 53V23z'

/** The artwork on top: a shield that wakes up, a radar sweep, a fingerprint being matched, then the result. */
function ScanArt({ stage, tone, progress }: { stage: 'init' | 'scan' | 'verify' | 'done'; tone: string; progress: number }) {
  return (
    <div className={`scan-art ${stage}`} style={{ ['--tone' as string]: tone }} aria-hidden="true">
      <div className="sa-glow" />
      <span className="sa-ring r1" /><span className="sa-ring r2" /><span className="sa-ring r3" />
      {stage === 'scan' && <span className="sa-sweep" />}
      {(stage === 'scan' || stage === 'verify') && (
        <svg className="sa-prog" viewBox="0 0 200 200"><circle cx="100" cy="100" r="92" pathLength="100" strokeDasharray={`${Math.max(4, progress)} 100`} /></svg>
      )}
      {stage === 'verify' && (
        <svg className="sa-finger" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M14 26a18 18 0 0136 0" /><path d="M18 52c-2-6-2-12-1-17a15 15 0 0130 0c0 8 1 14 4 19" />
          <path d="M24 56c-2-5-3-11-2-18a10 10 0 0120 0c0 6 1 11 3 16" /><path d="M30 58c-1-6-1-12 0-19a2.5 2.5 0 015 0c1 7 1 13 4 19" /><path d="M32 40v6" />
        </svg>
      )}
      {(stage === 'init' || stage === 'scan' || stage === 'done') && (
        <svg className={'sa-shield' + (stage === 'done' ? ' big' : '')} viewBox="0 0 120 120">
          <defs><linearGradient id="sa-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e4d9ff" stopOpacity=".95" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".55" /></linearGradient></defs>
          <path d={SHIELD} fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="url(#sa-g)" strokeWidth="5" strokeLinejoin="round" />
          {stage === 'done'
            ? (tone === '#34d399'
              ? <path className="sa-tick" d="M40 62l15 15 27-30" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
              : <path className="sa-tick" d="M60 36v30M60 82v1" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />)
            : <path d="M60 38l5 15 15 5-15 5-5 15-5-15-15-5 15-5z" fill="#fff" opacity=".92" />}
        </svg>
      )}
    </div>
  )
}

/** A full-screen security check in four stages: preparing, scanning, verifying, and the result with what needs attention. */
function SecurityScan({ items, fixable, onFixAll, onClose }: { items: SecItem[]; fixable: SecItem[]; onFixAll: () => void; onClose: () => void }) {
  const groups = SCAN_GROUPS.map((g) => ({ ...g, list: items.filter((i) => g.ids.includes(i.id)) })).filter((g) => g.list.length)
  const total = items.length
  const [started, setStarted] = useState(false) // the short "preparing" stage is over
  const [step, setStep] = useState(0) // how many groups are done
  const [phase, setPhase] = useState<'scan' | 'results'>('scan')
  const [showPassed, setShowPassed] = useState(false)
  const finished = step >= groups.length
  useEffect(() => { const t = setTimeout(() => setStarted(true), 1300); return () => clearTimeout(t) }, [])
  useEffect(() => {
    if (!started || phase !== 'scan' || finished) return
    const t = setTimeout(() => { setStep((n) => n + 1); try { navigator.vibrate?.(groups[step]?.list.some((i) => !i.ok) ? 18 : 6) } catch { /* no vibration */ } }, 1000)
    return () => clearTimeout(t)
  }, [started, step, phase, finished]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!finished || phase !== 'scan') return
    write(KEYS.securityCheck, { at: Date.now(), good: items.filter((i) => i.ok).length, total })
    const t = setTimeout(() => setPhase('results'), 800)
    return () => clearTimeout(t)
  }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps
  const bad = items.filter((i) => !i.ok)
  const good = total - bad.length
  const clear = bad.length === 0
  const tone = clear ? '#34d399' : good / Math.max(1, total) >= 0.7 ? '#fbbf24' : '#f87171'
  const stage: 'init' | 'scan' | 'verify' | 'done' = phase === 'results' ? 'done' : !started ? 'init' : step >= Math.max(1, groups.length - 1) ? 'verify' : 'scan'
  const progress = phase === 'results' ? 100 : !started ? 0 : Math.round((Math.min(step, groups.length) / Math.max(1, groups.length)) * 100)
  const heading: Record<string, [string, string]> = {
    init: ['Preparing Security Check', 'Initializing the security scan…'],
    scan: ['Scanning your app', 'Checking lock, privacy and this phone…'],
    verify: ['Verifying Security', 'Analyzing results…'],
  }

  return (
    <div className="scan-screen" role="dialog" aria-label="Security check">
      <button className="icon-btn scan-close" onClick={onClose} aria-label="Close"><Icon name="back" size={20} /></button>
      <div className="scan-body">
        <ScanArt stage={stage} tone={tone} progress={progress} />

        {phase === 'scan' ? (
          <>
            <div className="scan-head" key={stage}>
              <h1 className="scan-title">{heading[stage][0]}</h1>
              <div className="scan-sub">{heading[stage][1]}</div>
            </div>
            {stage === 'init'
              ? <div className="scan-bar"><i /></div>
              : (
                <ol className="scan-card">
                  {groups.map((g, i) => {
                    const state = i < step ? (g.list.every((x) => x.ok) ? 'ok' : 'warn') : i === step ? 'active' : 'wait'
                    return (
                      <li key={g.id} className={`scan-row ${state}`}>
                        <svg className="scan-gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={g.path} /></svg>
                        <span className="scan-label">{g.title}</span>
                        <span className="scan-state">{state === 'ok' ? <Icon name="check" size={14} stroke={3} /> : state === 'warn' ? <Icon name="info" size={14} stroke={3} /> : state === 'active' ? <i className="scan-ring" /> : <i className="scan-wait" />}</span>
                      </li>
                    )
                  })}
                </ol>
              )}
          </>
        ) : (
          <div className="scan-results">
            <div className="scan-head">
              <h1 className="scan-title">{clear ? 'Your app is secure' : `${bad.length} thing${bad.length === 1 ? '' : 's'} to look at`}</h1>
              <div className="scan-sub">{clear ? `All ${total} checks passed` : `${good} of ${total} checks passed`}</div>
            </div>
            <ol className="scan-card">
              {groups.map((g) => {
                const issues = g.list.filter((x) => !x.ok).length
                return (
                  <li key={g.id} className={`scan-row ${issues ? 'warn' : 'ok'}`}>
                    <svg className="scan-gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={g.path} /></svg>
                    <span className="scan-label">{g.title}</span>
                    {issues > 0 && <span className="scan-tag warn">{issues} to fix</span>}
                    <span className="scan-state"><Icon name={issues ? 'info' : 'check'} size={14} stroke={3} /></span>
                  </li>
                )
              })}
            </ol>
            {bad.length > 0 && (
              <>
                <div className="scan-section">Needs attention</div>
                <div className="scan-list">
                  {bad.map((i) => (
                    <div key={i.id} className="scan-issue">
                      <span style={{ color: '#fbbf24', flex: 'none', paddingTop: 2 }}><Icon name="info" size={18} /></span>
                      <div className="grow"><b>{i.title}</b><div style={{ opacity: 0.7, fontSize: 14, marginTop: 2, lineHeight: 1.45 }}>{i.body}</div></div>
                      {i.fix && i.run && <button className="chip on" style={{ height: 30, flex: 'none' }} onClick={i.run}>{i.fix}</button>}
                    </div>
                  ))}
                </div>
              </>
            )}
            <button className="scan-fold" onClick={() => setShowPassed((v) => !v)} aria-expanded={showPassed}>
              <span>Passed ({good})</span><span style={{ transform: showPassed ? 'rotate(90deg)' : undefined, transition: 'transform .2s', display: 'flex' }}><Icon name="chevron" size={16} /></span>
            </button>
            {showPassed && (
              <div className="scan-list">
                {items.filter((i) => i.ok).map((i) => (
                  <div key={i.id} className="scan-issue ok">
                    <span style={{ color: '#4ade80', flex: 'none' }}><Icon name="check" size={18} stroke={3} /></span>
                    <div className="grow" style={{ fontSize: 15 }}>{i.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="scan-foot">
        {phase === 'scan'
          ? <button className="scan-btn ghost" onClick={onClose}><span>Stop</span></button>
          : <div className="row" style={{ gap: 10 }}>
            {fixable.length > 0 && <button className="scan-btn alt" onClick={onFixAll}>Fix {fixable.length} now</button>}
            <button className="scan-btn" onClick={onClose}>Continue</button>
          </div>}
      </div>
    </div>
  )
}

/* ---------- Backup & restore ---------- */
function BackupPage({ onBack }: { onBack: () => void }) {
  const native = isNativeApp()
  const [st, setSt] = useState<{ lastAt?: number | null; localEncrypted?: boolean; lastError?: string | null }>({})
  const [pwOpen, setPwOpen] = useState(false)
  const [run, setRun] = useState<null | (() => Promise<{ ok: boolean; message?: string }>)>(null)
  const [restoring, setRestoring] = useState(false)
  const [own, setOwn] = useState<string | null>(null)
  const busy = !!run
  const [lastExport] = useStored<number>(KEYS.lastExport, 0)
  const refresh = () => { if (native) NativeDb.getBackupStatus().then((x) => setSt(x)).catch(() => {}) }
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function backupNow() {
    if (native) {
      if (!st.localEncrypted) { setPwOpen(true); return }
      setRun(() => async () => { const r = await runAutoBackup(true); return r.lastError ? { ok: false, message: r.lastError } : { ok: true } })
      return
    }
    if (!(await requireAuth('Back up your data'))) return
    const pw = await askPassword('Choose a password for this backup. You enter it to restore.', { confirm: true })
    if (!pw) return
    setRun(() => async () => {
      download(`justmoney-backup-${new Date().toISOString().slice(0, 10)}.json`, await encryptBackup(JSON.stringify(buildBackup()), pw), 'application/json')
      write(KEYS.lastExport, Date.now())
      return { ok: true }
    })
  }

  const when = (ts?: number | null) => (ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null)
  const last = native ? st.lastAt : lastExport
  return (
    <div className="page">
      <PageHeader title="Backup & restore" onBack={onBack} />

      <div className="card pad col" style={{ gap: 10 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div><div className="label">Last backup</div><b style={{ fontSize: 20 }}>{when(last) ?? 'None yet'}</b></div>
          {native && <span className="pill" style={{ background: 'var(--glass)', color: st.localEncrypted ? 'var(--credit)' : 'var(--amber)' }}>{st.localEncrypted ? 'Password protected' : 'Needs a password'}</span>}
        </div>
        {native && !st.localEncrypted && <div className="small" style={{ color: 'var(--amber)', lineHeight: 1.5 }}>Backups are always encrypted. None are made until you set a password.</div>}
        {st.lastError && st.localEncrypted && <div className="small" style={{ color: 'var(--amber)' }}>Last backup failed: {st.lastError}</div>}
        <button className="btn block" onClick={backupNow} disabled={busy}>{busy ? <Spinner /> : <Icon name="download" size={18} />}{native && !st.localEncrypted ? 'Set a password and back up' : 'Back up now'}</button>
      </div>

      {native && (
        <>
          <div className="section-label">Password</div>
          <div className="card">
            <button className="list-row" onClick={() => setPwOpen(true)}><Icon name="key" /><div className="grow" style={{ textAlign: 'left' }}><div>Backup password</div><div className="dim small">{st.localEncrypted ? 'Set. Change it to protect new backups with a new password.' : 'Not set. Choose one to start backing up.'}</div></div><span className="chev"><Icon name="chevron" size={18} /></span></button>
          </div>
        </>
      )}

      <div className="section-label">Automatic backup</div>
      <AutoBackupCard />

      <div className="section-label">What to back up</div>
      <BackupScopeSection />

      <div className="section-label">Restore</div>
      <div className="card">
        <Row icon="upload" label="Restore from a backup" sub="Pick a JustMoney backup. You enter its password, and nothing already here is overwritten." onClick={async () => { setOwn(native ? await readOwnBackup().catch(() => null) : null); setRestoring(true) }} />
      </div>
      <BackupPasswordSheet open={pwOpen} onClose={() => { setPwOpen(false); refresh() }} />
      {run && <BackupRun work={run} onClose={() => { setRun(null); refresh() }} />}
      {restoring && <RestoreRun latest={own} latestAt={st.lastAt} requireAuth={() => requireAuth('Restore a backup')} onClose={() => { setRestoring(false); refresh() }} />}
    </div>
  )
}

/* ---------- What to back up ---------- */
function BackupScopeSection() {
  const [scope, setScope] = useStored<Scope>(KEYS.backupScope, {})
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const toast = useToast()
  const change = (id: string, on: boolean) => {
    const next = { ...scope, [id]: on }
    setScope(next)
    applyScope(next)
    toast(on ? 'Included in backups' : 'Left out of backups', on ? undefined : 'Earlier backups keep it. New ones will not.')
  }
  const count = (g: BackupGroup) => (g.id === 'transactions' ? `${txns.length} entries` : g.keys ? `${g.keys.filter((k) => { const v = read<unknown>(k, undefined); return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && !(typeof v === 'object' && !Object.keys(v as object).length) }).length} saved` : '')
  return (
    <>
      <p className="muted small" style={{ marginTop: 0, lineHeight: 1.5 }}>A backup holds all your data by default, so a new phone or a reinstall brings everything back. Turn off any part you would rather keep out of the file.</p>
      <div className="card">
        {BACKUP_GROUPS.map((g) => (
          <div key={g.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><div style={{ fontWeight: 600 }}>{g.label}</div><div className="dim small" style={{ lineHeight: 1.45 }}>{g.desc}{count(g) ? ` · ${count(g)}` : ''}</div></div>
            <Toggle on={g.locked ? true : groupOn(scope, g.id)} label={g.label} onChange={(v) => { if (!g.locked) change(g.id, v) }} />
          </div>
        ))}
      </div>
      <div className="section-label">Always left out</div>
      <div className="card pad small" style={{ lineHeight: 1.5 }}>Your App Lock passcode and fingerprint settings, API keys (Gemini), and temporary data (caches, prices). These stay on this phone only, so a backup file never holds a secret. After a restore you set the passcode again.</div>
    </>
  )
}
