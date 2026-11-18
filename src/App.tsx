import Splash from './components/ui/Splash'
import { useViewScroll } from './lib/core/useScrollRestore'
import { useEffect, useRef, useState } from 'react'
import { buzz, ConfirmProvider, handleBack, Icon, Sheet, SheetHeader, ToastProvider, useToast } from './components/ui/ui'
import { AuthPrompt, LockScreen, useAppLock } from './components/ui/AppLock'
import { PasswordPromptHost } from './components/backup/BackupPassword'
import { EditTransactionSheet, QuickAddSheet } from './components/transactions/TransactionSheets'
import { useStored, KEYS } from './lib/core/storage'
import { startNotificationLoop } from './lib/notify/notify'
import { reconcileSettlements, runAutoSettle } from './lib/payees/merchant'
import { useProfession } from './lib/plan/profession'
import { closeMonths } from './lib/plan/plan'
import { processSplitRepeats } from './lib/split/splitPlus'
import { applyScope } from './lib/backup/backupScope'
import { migrateCategories, migrateFitness, migrateNames, migrateStreaming, processRecurring } from './lib/core/data'
import { installedAt, isNativeApp, runAutoBackup } from './lib/backup/backup'
import { applySalarySettings } from './lib/accounts/accounts'
import { read, resyncFromNative, write } from './lib/core/storage'
import { App as CapApp } from '@capacitor/app'
import { Device } from './lib/core/native'
import { syncNativeNotifications } from './lib/notify/nativeNotify'
import { updateWidget } from './lib/notify/widget'
import { rescanSmsOnce, syncCapturedPayments } from './lib/capture/autocapture'
import { attachRepaymentTransaction, findLoanMatch } from './lib/payees/loans'
import { Capture } from './lib/core/native'
import { deleteTransaction } from './lib/core/data'
import { formatPrice } from './lib/core/format'
import { setPendingSplit } from './lib/split/splitHandoff'
import { openRoute, reviewRequest, setRouteHandler } from './lib/notify/notifyRoute'
import { startNotificationTapListener } from './lib/notify/nativeNotify'
import ReportViewer from './components/reports/ReportViewer'
import { detectAnomalies } from './lib/payees/anomaly'
import { notifyImmediate } from './lib/notify/notify'
import { ROUTES } from './lib/notify/notifyRoute'
import { purgeTrash } from './lib/core/trash'
import { applyAccent } from './lib/core/accent'
import { runAutoReport } from './lib/reports/autoReport'
import Home, { useMonth } from './screens/Home'
import Insights from './screens/Insights'
import Planner, { type PlannerPage } from './screens/Planner'
import Settings, { APP_VERSION } from './screens/Settings'
import Onboarding from './screens/Onboarding'
import CaptureCenter from './components/capture/CaptureCenter'
import type { Commitment, NewTransaction, SalarySettings, ThemePref, Transaction, User } from './lib/core/types'

type Tab = 'home' | 'insights' | 'planner' | 'settings'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'insights', label: 'Insights', icon: 'insights' },
  { id: 'planner', label: 'Planner', icon: 'planner' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
]

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  )
}

/** Applies the saved theme (or the OS setting) to <html data-theme>. */
function useTheme(darkBars: boolean) {
  const [pref] = useStored<ThemePref>(KEYS.theme, 'dark')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      applyAccent()
      const t = pref === 'system' ? (mq.matches ? 'light' : 'dark') : pref
      document.documentElement.dataset.theme = t
      // Onboarding and the lock screen are always dark, whatever the theme.
      const lightBars = t === 'light' && !darkBars
      const bg = lightBars ? '#f4f4f6' : '#000000'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
      // Android: paint the status/navigation bar strips the same colour as the app.
      if (isNativeApp()) Device.setSystemBars({ color: bg, lightBackground: lightBars }).catch(() => {})
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref, darkBars])
}

function Shell() {
  const [onboarded, setOnboarded] = useStored<boolean>(KEYS.onboardingCompleted, false)
  useTheme(!onboarded) // onboarding is always dark
  const initialTab = new URLSearchParams(location.search).get('tab')
  const [tab, setTab] = useState<Tab>(() => (initialTab === 'split' ? 'planner' : (initialTab as Tab)) || 'home')
  const [plannerPage, setPlannerPage] = useState<PlannerPage | null>(() => (initialTab === 'split' ? 'split' : null))
  const [sel, setSel] = useMonth()
  const [quick, setQuick] = useState<null | 'text' | 'voice'>(() => (new URLSearchParams(location.search).get('action') === 'voice' ? 'voice' : null))
  const [editing, setEditing] = useState<Transaction | null | 'new'>(null)
  const [prefill, setPrefill] = useState<Partial<NewTransaction> | undefined>(undefined)
  const [lastSeen, setLastSeen] = useStored<string>(KEYS.lastSeenWhatsNew, '')
  const [whatsNew, setWhatsNew] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [openTxId, setOpenTxId] = useState<string | null>(null)

  // Tapping a notification opens the page it is about (a Planner page, a tab, or the PDF report).
  useEffect(() => {
    setRouteHandler((route) => {
      setEditing(null); setQuick(null)
      if (route === 'add') setQuick('text')
      else if (route.startsWith('planner:')) { setTab('planner'); setPlannerPage(route.slice('planner:'.length) as PlannerPage) }
      else if (route.startsWith('report:')) setReport(route.slice('report:'.length))
      else if (route === 'review') { setTab('home'); setPlannerPage(null); reviewRequest.pending = true; window.dispatchEvent(new Event('justmoney:review')) }
      else if (route.startsWith('tx:')) { setTab('home'); setPlannerPage(null); setOpenTxId(route.slice('tx:'.length)) }
      else if (route === 'home' || route === 'insights' || route === 'settings') { setTab(route); setPlannerPage(null) }
    })
    const stopTap = startNotificationTapListener()
    const fromUrl = new URLSearchParams(location.search).get('route') // browser: app opened by tapping a notification
    if (fromUrl) openRoute(fromUrl)
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'route') openRoute(e.data.route) }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => { setRouteHandler(null); stopTap(); navigator.serviceWorker?.removeEventListener('message', onMsg) }
  }, [])
  const lock = useAppLock()
  const [splashed, setSplashed] = useState(false) // the launch animation plays once, after any unlock
  const [privacy] = useStored<boolean>(KEYS.privacyScreen, false)
  const [blockCapture, setBlockCapture] = useStored<boolean | undefined>(KEYS.blockCapture, undefined)
  // before screenshot blocking was its own switch, hiding the app switcher on Android also blocked screenshots: keep what people had
  useEffect(() => { if (blockCapture === undefined && privacy) setBlockCapture(true) }, [blockCapture, privacy, setBlockCapture])
  // screenshots, screen recording and casting are blocked when asked for; the recent-apps picture is hidden when the app switcher privacy is on
  useEffect(() => { if (isNativeApp()) Device.setSecure({ enabled: !!blockCapture }).catch(() => {}) }, [blockCapture])
  useEffect(() => { if (isNativeApp()) Device.setRecentsHidden({ enabled: privacy }).catch(() => {}) }, [privacy])
  const toast = useToast()
  const toastRef = useRef(toast)
  // a save the phone refused is said out loud once in a while, not silently dropped
  useEffect(() => {
    let last = 0
    const onFail = (e: Event) => {
      if (Date.now() - last < 15000) return
      last = Date.now()
      toastRef.current("Couldn't save", (e as CustomEvent<string>).detail || 'Try again in a moment.')
    }
    window.addEventListener('justmoney:save-failed', onFail)
    return () => window.removeEventListener('justmoney:save-failed', onFail)
  }, [])

  useEffect(() => { applyScope() }, [])
  useEffect(() => { migrateCategories(); migrateNames(); migrateStreaming(); migrateFitness() }, [])
  useEffect(() => startNotificationLoop(), [])
  // Android: rebuild the system reminder schedule whenever what it depends on changes.
  const [reminders] = useStored<unknown[]>(KEYS.reminders, [])
  const [emis] = useStored<unknown[]>(KEYS.emiPlans, [])
  const [nprefs] = useStored<unknown>(KEYS.notificationPrefs, null)
  const [autoDebit] = useStored<unknown>(KEYS.autoDebit, null)
  const [commits] = useStored<unknown[]>(KEYS.commitments, [])
  const [salarySet] = useStored<unknown>(KEYS.salary, null)
  const [loansAll] = useStored<unknown[]>(KEYS.loans, [])
  useEffect(() => {
    if (!onboarded || !isNativeApp()) return
    const t = setTimeout(() => { syncNativeNotifications() }, 800)
    return () => clearTimeout(t)
  }, [onboarded, reminders, emis, nprefs, autoDebit, commits, salarySet, loansAll])
  useEffect(() => {
    if (!isNativeApp()) return
    const sub = CapApp.addListener('resume', () => { syncNativeNotifications() })
    return () => { sub.then((h) => h.remove()) }
  }, [])
  // Android: payments seen in notifications (GPay, PhonePe, bank SMS…) become transactions.
  useEffect(() => {
    if (!onboarded || !isNativeApp()) return
    const run = async () => {
      await rescanSmsOnce()
      const { added } = await syncCapturedPayments()
      if (!added.length) return
      const one = added.length === 1 ? added[0] : null
      const loanMatch = one ? findLoanMatch(one) : null
      if (one && loanMatch) {
        toastRef.current(
          'Loan repayment?',
          loanMatch.direction === 'LENT'
            ? `Looks like ${loanMatch.person} just paid back ${formatPrice(one.paymentAmount)} — mark it against the loan?`
            : `Looks like you just repaid ${loanMatch.person} ${formatPrice(one.paymentAmount)} — mark it against the loan?`,
          { label: 'Mark as repayment', onClick: () => attachRepaymentTransaction(loanMatch.id, one) },
        )
        return
      }
      toastRef.current(
        one ? `Auto-added ${formatPrice(one.paymentAmount)} · ${one.paymentReceiver}` : `Auto-added ${added.length} payments`,
        one ? [one.paymentCategory, one.paymentApp].filter(Boolean).join(' · ') : 'From your payment notifications',
        { label: 'Undo', onClick: () => added.forEach((t) => deleteTransaction(t.id)) },
      )
    }
    run()
    const subs = [CapApp.addListener('resume', run), Capture.addListener('paymentCaptured', run)]
    return () => { subs.forEach((s) => s.then((h) => h.remove())) }
  }, [onboarded])
  // Android: refresh the home-screen widget after data changes (debounced).
  const [txAll] = useStored<unknown[]>(KEYS.transactions, [])
  const txAllCount = txAll.length
  // shop jobs only for someone who said they run a shop
  const { shop } = useProfession()
  // shop payouts from the bank are matched to the PhonePe / Paytm business sales they cover
  useEffect(() => { if (shop) reconcileSettlements() }, [txAllCount, shop])
  // shop sales the bank never reported: settled at the time set in Settings → Shop payouts, if the user did not answer
  useEffect(() => {
    if (!onboarded) return
    const run = () => { if (!shop) return; const r = runAutoSettle(); if (r) toastRef.current(`${formatPrice(r.total, { round: true })} of shop sales settled`, r.accountId ? 'Added to your bank balance. Open it to undo if it has not arrived.' : 'Choose the account in Settings → Shop payouts.') }
    // while the app is open it does this itself, and tells the background job so with a heartbeat
    const beat = () => { if (document.visibilityState === 'visible') write(KEYS.heartbeat, Date.now()) }
    const tick = () => { beat(); run() }
    // coming back to the app: the background job may have settled sales while it was closed
    const onVisible = () => { if (document.visibilityState === 'visible') resyncFromNative().then(tick) }
    tick()
    const id = setInterval(tick, 60000)
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [onboarded, shop])
  // a finished month closes: what was not spent is saved, an overspend is offered back to this month
  useEffect(() => { if (onboarded) closeMonths(read<Transaction[]>(KEYS.transactions, []), read<Commitment[]>(KEYS.commitments, [])) }, [onboarded, txAllCount])
  const [budgetAmt] = useStored<number>(KEYS.monthlyBudget, 0)
  const [lockPin] = useStored<string>(KEYS.appLock, '')
  const [lockBio] = useStored<boolean>(KEYS.appLockBiometric, false)
  const [profileForWidget] = useStored<unknown>(KEYS.user, null)
  const [methodsForWidget] = useStored<unknown[]>(KEYS.paymentMethods, [])
  const [goalsForWidget] = useStored<unknown[]>(KEYS.savingsGoals, [])
  const [rulesForWidget] = useStored<unknown[]>(KEYS.recurringRules, [])
  const [holdsForWidget] = useStored<unknown[]>(KEYS.holds, [])
  useEffect(() => {
    if (!onboarded || !isNativeApp()) return
    const t = setTimeout(() => { updateWidget() }, 1500)
    return () => clearTimeout(t)
  }, [onboarded, txAll, budgetAmt, commits, profileForWidget, lockPin, lockBio, methodsForWidget, goalsForWidget, rulesForWidget, holdsForWidget, emis, loansAll])
  // Keep the automatic salary entry's amount in step with the profile income.
  const [user] = useStored<User | null>(KEYS.user, null)
  useEffect(() => {
    const s = read<SalarySettings | null>(KEYS.salary, null)
    if (s?.accountId) applySalarySettings(s)
  }, [user?.monthly_income])
  useEffect(() => {
    if (!onboarded) return
    const n = processRecurring()
    if (n > 0) toastRef.current(`${n} recurring entr${n === 1 ? 'y' : 'ies'} added`)
    // repeating group expenses (rent on the 5th) are added to SplitMoney the same way
    const s = processSplitRepeats()
    if (s > 0) toastRef.current(`${s} repeating split${s === 1 ? '' : 's'} added`)
    const id = setInterval(() => { processRecurring(); processSplitRepeats() }, 60000)
    return () => clearInterval(id)
  }, [onboarded])

  // Deleted entries are kept 30 days; clear out older ones.
  useEffect(() => { purgeTrash() }, [])

  // New default categories (Fuel, Games): add them once to a customised list; people on the default list already get them.
  useEffect(() => {
    const cats = read<string[] | null>(KEYS.categories, null)
    const coach = read<{ seen: string[] }>(KEYS.coach, { seen: [] })
    if (!cats || coach.seen.includes('cats-fuel-games')) return
    const add = ['Fuel', 'Games'].filter((c) => !cats.includes(c))
    if (add.length) { const i = cats.indexOf('Others'); write(KEYS.categories, i < 0 ? [...cats, ...add] : [...cats.slice(0, i), ...add, ...cats.slice(i)]) }
    write(KEYS.coach, { seen: [...coach.seen, 'cats-fuel-games'] })
  }, [])

  // Unusual or duplicate payments: look at entries added since the last check.
  useEffect(() => {
    if (!onboarded) return
    const seen = read<{ at: number } | null>(KEYS.anomalySeen, null)
    write(KEYS.anomalySeen, { at: Date.now() })
    if (!seen) return // first run: nothing to compare against yet
    const all = read<Transaction[]>(KEYS.transactions, [])
    const fresh = all.filter((t) => t.createdAt > seen.at && t.timestamp > Date.now() - 3 * 86400000)
    if (!fresh.length || fresh.length > 5) return // imports and backups add many at once
    for (const a of detectAnomalies(all, fresh)) {
      notifyImmediate(a.title, a.body, `anomaly-${a.txId}`, ROUTES.tx(a.txId))
      toastRef.current(a.title, a.body, { label: 'View', onClick: () => { setTab('home'); setPlannerPage(null); setOpenTxId(a.txId) } })
    }
  }, [onboarded, txAll]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onboarded || !isNativeApp()) return
    const t = setTimeout(() => { syncNativeNotifications() }, 2000)
    return () => clearTimeout(t)
  }, [onboarded, txAll])

  // Monthly PDF report (if turned on): on launch and when the app returns to the foreground.
  useEffect(() => {
    if (!onboarded || !isNativeApp()) return
    runAutoReport()
    const sub = CapApp.addListener('resume', () => { runAutoReport() })
    return () => { sub.then((h) => h.remove()) }
  }, [onboarded])

  // Daily backup: checked on launch and whenever the app returns to the foreground.
  useEffect(() => {
    installedAt()
    if (!onboarded || !isNativeApp()) return
    runAutoBackup()
    const sub = CapApp.addListener('resume', () => { runAutoBackup() })
    return () => { sub.then((h) => h.remove()) }
  }, [onboarded])
  useEffect(() => { if (onboarded && lastSeen && lastSeen !== APP_VERSION) setWhatsNew(true); else if (onboarded && !lastSeen) setLastSeen(APP_VERSION) }, [onboarded]) // eslint-disable-line react-hooks/exhaustive-deps
  useViewScroll(tab === 'planner' ? `planner|${plannerPage ?? ''}` : tab, tab === 'planner' && !!plannerPage)

  // Android back gesture: close what's open on top → leave a sub-page → go Home → leave the app.
  const backState = useRef({ tab, locked: lock.locked })
  backState.current = { tab, locked: lock.locked }
  useEffect(() => {
    if (!isNativeApp()) return
    const sub = CapApp.addListener('backButton', () => {
      if (backState.current.locked) { CapApp.minimizeApp(); return }
      if (handleBack()) return
      if (backState.current.tab !== 'home') { setTab('home'); setPlannerPage(null); return }
      CapApp.minimizeApp()
    })
    return () => { sub.then((s) => s.remove()) }
  }, [])

  if (!onboarded) return <Onboarding onDone={() => setOnboarded(true)} />

  const openPlanner = (p: PlannerPage) => { setTab('planner'); setPlannerPage(p) }

  return (
    <div className="app">
      {tab === 'home' && <Home sel={sel} setSel={setSel} onEdit={setEditing} onOpenAccounts={() => openPlanner('methods')} onPlanner={openPlanner} openTxId={openTxId} onOpenedTx={() => setOpenTxId(null)} onAdd={() => setQuick('text')}
        onSplit={(t) => { setPendingSplit({ description: t.paymentReceiver, amount: t.paymentAmount, txnId: t.id }); openPlanner('split') }}
        onDuplicate={(p) => { setPrefill(p); setEditing('new') }} />}
      {tab === 'insights' && <Insights />}
      {tab === 'planner' && <Planner page={plannerPage} setPage={setPlannerPage} />}
      {tab === 'settings' && <Settings openPlanner={openPlanner} onWhatsNew={() => setWhatsNew(true)} />}

      <nav className="tabbar">
        <div className="tabpill">
          {TABS.slice(0, 2).map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => { buzz(6); setTab(t.id); if (t.id === 'planner') setPlannerPage(null) }} aria-current={tab === t.id} title={t.label}>
              <Icon name={t.icon} size={22} fill={tab === t.id && t.id === 'home'} stroke={tab === t.id ? 2.4 : 2} />
              <span>{t.label}</span>
            </button>
          ))}
          <button className="fab-dock" aria-label="Add expense" onClick={() => { buzz(12); setQuick('text') }}><Icon name="plus" size={24} stroke={2.6} /></button>
          {TABS.slice(2).map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => { buzz(6); setTab(t.id); if (t.id === 'planner') setPlannerPage(null) }} aria-current={tab === t.id} title={t.label}>
              <Icon name={t.icon} size={22} fill={tab === t.id && t.id === 'home'} stroke={tab === t.id ? 2.4 : 2} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <QuickAddSheet open={!!quick} initialMode={quick === 'voice' ? 'voice' : null} onClose={() => setQuick(null)} onManual={() => { setQuick(null); setEditing('new') }} />
      <EditTransactionSheet open={editing !== null} tx={editing === 'new' ? null : editing} prefill={editing === 'new' ? prefill : undefined} onClose={() => { setEditing(null); setPrefill(undefined) }} />
      <CaptureCenter
        onQuickAdd={(m) => setQuick(m)}
        onTab={(t) => { setTab(t); setPlannerPage(null) }}
        onOpenSplit={() => openPlanner('split')}
        onEdit={(t) => setEditing(t)}
        onManual={(p) => { setPrefill(p); setEditing('new') }}
      />
      <ReportViewer filename={report} onClose={() => setReport(null)} />
      <WhatsNewSheet open={whatsNew} onClose={() => { setWhatsNew(false); setLastSeen(APP_VERSION) }} />

      {lock.locked && <LockScreen onUnlock={lock.unlock} />}
      {onboarded && !lock.locked && !splashed && <Splash onDone={() => setSplashed(true)} />}
      <AuthPrompt />
      <PasswordPromptHost />
      {lock.covered && !lock.locked && <div className="privacy-cover"><div style={{ fontSize: 28 }}><b style={{ fontWeight: 800 }}>Just</b>Money</div></div>}
    </div>
  )
}

const CHANGELOG: [string, string][] = [
  ['A calmer look', 'Cleaner Home, Insights, Planner and Settings: one title per screen, labelled tabs, expenses in plain white and only income in green, shorter rows, and no more walls of explanation.'],
  ['Who pays?', 'SplitMoney → Who pays?: pick who is at the table, choose a bottle and spin. Whoever the neck points at pays this round.'],
  ['SplitMoney, grown up', 'Split a bill item by item (scan it and each line is filled in), send each friend a tappable pay link (it opens their UPI app with their amount) or a share card with a UPI QR, nudge a friend, settle part of what is owed, call it even, repeat a split every month, and let a matching payment settle it for you.'],
  ['Split from any payment', 'Open a payment and tap Split this, or split it straight from Edit.'],
  ['Paid for someone else', 'Mark a payment as made for a friend or family with their money. It is not your spending, and when they pay you back it closes the loop, even if they paid you first.'],
  ['Net worth in one place', 'Net worth, its timeline and your next milestone are now one page. Investments has its own page, and that is where you add them.'],
  ['Hide amounts on widgets', 'Tap the eye on the Bank balance or Spent today widget to hide every amount on all your widgets. Widgets also got the new, quieter look.'],
  ['Reads Hindi too', 'Receipts and bills in Devanagari are read on your phone, and ₹ is always read as the rupee sign, never as a number.'],
  ['Shared receipts, right name', 'A Paytm, PhonePe or MyJio receipt you share is matched to the right payment and shop, so a ₹330 recharge stays ₹330.'],
  ['Fewer fake credits', 'Cashback, wallet and store-credit messages (like a brand’s wallet credit) are no longer added as money you received.'],
  ['Auto-capture from the start', 'Payment apps and bank SMS are turned on by default when you set up capture; shopping and promo apps are left out.'],
  ['Bills & subscriptions', 'Subscriptions, EMIs, AutoPay, repeating entries and reminders are together on one page in the Planner.'],
  ['New logos', 'Amazon Now, Toing, MyJio and Smart Bazaar.'],
]

function WhatsNewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} full>
      <SheetHeader title={`What's new in ${APP_VERSION}`} onClose={onClose} />
      <div className="col" style={{ gap: 14, margin: '18px 0 24px' }}>
        {CHANGELOG.map(([t, d]) => (
          <div key={t} className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--purple)', marginTop: 7, flex: 'none' }} />
            <div><b>{t}</b><div className="muted small">{d}</div></div>
          </div>
        ))}
      </div>
      <button className="btn block" onClick={onClose}>Got it</button>
    </Sheet>
  )
}
