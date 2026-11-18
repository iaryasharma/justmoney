import { CountUp } from '../components/ui/CountUp'
import CaptureSetup from '../components/capture/CaptureSetup'
import { useEffect, useMemo, useRef, useState } from 'react'
import { reviewRequest } from '../lib/notify/notifyRoute'
import BrandLogo from '../components/ui/BrandLogo'
import AccountLogo from '../components/ui/AccountLogo'
import Watermark from '../components/ui/Watermark'
import TransactionDetail from '../components/transactions/TransactionDetail'
import { BackupNudge, CoachTip, ForecastCard, GoalStrip, MonthReviewCard, PayoutPrompt, PlanCard, SafeToSpendCard, ShopCard, WindfallCard } from '../components/home/HomeCards'
import { ReviewBanner, ReviewSheet } from '../components/home/ReviewInbox'
import { CheckThese } from '../components/home/CheckThese'
import { cashInHand } from '../lib/accounts/cash'
import CashSheet from '../components/transactions/CashSheet'
import type { PlannerPage } from './Planner'
import { ambiguousApp, appLogo, merchantBrand, merchantLogo, networkLogo } from '../lib/payees/brands'
import { shownName } from '../lib/payees/payee'
import { buzz, Donut, Icon, Sheet, SheetHeader, useBackHandler, useConfirm, useToast } from '../components/ui/ui'
import { read, useStored, KEYS } from '../lib/core/storage'
import type { Person } from '../lib/payees/peopleMatch'
import { suggest, useCandidates } from '../lib/payees/suggest'
import { categoryColor, categoryIcon, withFamily, deleteTransaction, restoreTransaction, tagsOf, updateTransaction } from '../lib/core/data'
import { currencySymbol, formatDateTime, formatPrice, monthRange, monthShort } from '../lib/core/format'
import { accountBalance, isTransferCategory, tracksBalance, UPI_APPS } from '../lib/accounts/accounts'
import { BUSINESS, isMerchantApp, pendingSummary } from '../lib/payees/merchant'
import { currentPlan, getPlanSettings, incomeMode } from '../lib/plan/plan'
import { useProfession } from '../lib/plan/profession'
import { committedCategories, isCommittedOutflow, isPersonalSpend, plannedIncome, spendable as spendableOf } from '../lib/core/money'
import type { Commitment, CategoryBudgets, Hold, IncomeSource, NewTransaction, PaymentMethod, Transaction, User } from '../lib/core/types'
import { activeHoldIds } from '../lib/accounts/holds'
import { parseSearch } from '../lib/capture/nlsearch'
import { requestQuickSplit } from '../lib/split/splitHandoff'

export function useMonth() {
  const now = new Date()
  return useState({ year: now.getFullYear(), month: now.getMonth() })
}

export function monthTxns(all: Transaction[], year: number, month: number) {
  const { start, end } = monthRange(year, month)
  return all.filter((t) => t.timestamp >= start && t.timestamp < end).sort((a, b) => b.timestamp - a.timestamp)
}

/** Personal spending: debits outside committed categories (family support and other planned commitments). */
const sumPersonal = (l: Transaction[], committed: Set<string>) => l.reduce((a, t) => a + (isPersonalSpend(t, committed) ? t.paymentAmount : 0), 0)

type QuickKey = 'today' | 'week' | 'big' | 'recurring' | 'business'
const quickOk = (t: Transaction, keys: QuickKey[]) => keys.every((k) =>
  k === 'today' ? new Date(t.timestamp).toDateString() === new Date().toDateString()
  : k === 'week' ? t.timestamp >= Date.now() - 7 * 86400000
  : k === 'big' ? t.paymentAmount >= 1000
  : k === 'business' ? t.paymentType === 'CREDIT' && (t.paymentCategory === BUSINESS || isMerchantApp(t.paymentApp)) && !isTransferCategory(t.paymentCategory)
  : !!t.recurringId)

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return `${d.getDate()} ${monthShort(d.getMonth())}${d.getFullYear() !== today.getFullYear() ? `, ${d.getFullYear()}` : ''}`
}

function groupByDay(list: Transaction[]) {
  const out: { key: string; label: string; total: number; items: Transaction[] }[] = []
  for (const t of list) {
    const d = new Date(t.timestamp)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    let g = out[out.length - 1]
    if (!g || g.key !== key) { g = { key, label: dayLabel(t.timestamp), total: 0, items: [] }; out.push(g) }
    g.items.push(t)
    if (t.paymentType === 'DEBIT') g.total += t.paymentAmount
  }
  return out
}

export default function Home({ onEdit, onOpenAccounts, onPlanner, openTxId, onOpenedTx, onAdd, onSplit, onDuplicate, sel, setSel }: {
  onPlanner: (p: PlannerPage) => void
  openTxId: string | null; onOpenedTx: () => void
  onEdit: (t: Transaction) => void
  onSplit: (t: Transaction) => void
  onDuplicate: (prefill: Partial<NewTransaction>) => void
  onOpenAccounts: () => void
  onAdd: () => void
  sel: { year: number; month: number }; setSel: (v: { year: number; month: number }) => void
}) {
  const [oldestFirst, setOldestFirst] = useState(false)
  const [narrow] = useState(() => window.innerWidth < 380) // small phones get a smaller donut
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  // rows added while this screen is open slide in and glow once
  const seen = useRef<Set<string> | null>(null)
  const fresh = useMemo(() => {
    if (!seen.current) return new Set<string>()
    const added = all.filter((x) => !seen.current!.has(x.id))
    return added.length > 0 && added.length <= 3 ? new Set(added.map((x) => x.id)) : new Set<string>()
  }, [all])
  useEffect(() => { seen.current = new Set(all.map((x) => x.id)) }, [all])
  const pending = useMemo(() => pendingSummary(all), [all])
  const { shop: shopOn } = useProfession()
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [people] = useStored<Person[]>(KEYS.people, [])
  const candidates = useCandidates()
  const personOf = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [hidden, setHidden] = useState(() => read<boolean>(KEYS.hideOnLaunch, false))
  const [layout] = useStored<{ hidden: string[] }>(KEYS.homeLayout, { hidden: ['safe'] }) // "₹X a day" repeats the plan card's line, so it starts hidden
  const show = (k: string) => !layout.hidden.includes(k)
  const [reviewOpen, setReviewOpen] = useState(false)
  useEffect(() => {
    const go = () => { if (reviewRequest.pending) { reviewRequest.pending = false; setReviewOpen(true) } }
    go()
    window.addEventListener('justmoney:review', go)
    return () => window.removeEventListener('justmoney:review', go)
  }, [])
  const [filter, setFilter] = useState<'ALL' | 'EXPENSES' | 'INCOME'>('ALL')
  const [highlight, setHighlight] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [detail, setDetail] = useState<Transaction | null>(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filterSheet, setFilterSheet] = useState(false)
  const [receipts] = useStored<Record<string, string>>(KEYS.receipts, {})
  const [quick, setQuick] = useState<QuickKey[]>([])
  // a notification (unusual spend, duplicate) points at one transaction: show its details
  useEffect(() => {
    if (!openTxId) return
    const t = all.find((x) => x.id === openTxId)
    if (t) setDetail(t)
    onOpenedTx()
  }, [openTxId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState<null | 'category' | 'tag'>(null)
  const [tagDraft, setTagDraft] = useState('')
  const toast = useToast()
  const swipeRef = useRef<{ x: number; y: number; ok: boolean } | null>(null)
  const cats = withFamily(categories)
  const [commitments] = useStored<Commitment[]>(KEYS.commitments, [])
  const committed = useMemo(() => committedCategories(commitments), [commitments])

  const txns = useMemo(() => monthTxns(all, sel.year, sel.month), [all, sel])
  const prev = useMemo(() => {
    const d = new Date(sel.year, sel.month - 1)
    return monthTxns(all, d.getFullYear(), d.getMonth())
  }, [all, sel])
  const total = sumPersonal(txns, committed)
  const prevTotal = sumPersonal(prev, committed)
  const committedOut = txns.filter((t) => isCommittedOutflow(t, committed))
  const committedTotal = committedOut.reduce((a, t) => a + t.paymentAmount, 0)
  const familyTotal = committedOut.filter((t) => t.paymentCategory === 'Family').reduce((a, t) => a + t.paymentAmount, 0)

  const slices = useMemo(() => {
    const m = new Map<string, number>()
    txns.filter((t) => isPersonalSpend(t, committed)).forEach((t) => {
      const c = cats.includes(t.paymentCategory) ? t.paymentCategory : 'Others'
      m.set(c, (m.get(c) ?? 0) + t.paymentAmount)
    })
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: categoryColor(label, cats) }))
  }, [txns, cats, committed])

  const now = new Date()
  const isCurrent = sel.year === now.getFullYear() && sel.month === now.getMonth()
  const catOf = (t: Transaction) => (cats.includes(t.paymentCategory) ? t.paymentCategory : 'Others')

  // what was typed, read as a sentence ("swiggy last month", "over 500 on travel"), on top of the filters chosen by hand
  const intent = useMemo(() => parseSearch(query, cats), [query, cats])
  const filterCount = countFilters(filters)
  const eff: Filters = {
    ...filters,
    categories: [...new Set([...filters.categories, ...intent.categories])],
    min: intent.min != null ? String(intent.min) : filters.min, max: intent.max != null ? String(intent.max) : filters.max,
    from: intent.from ?? filters.from, to: intent.to ?? filters.to,
  }
  const searching = query.trim() !== '' || filterCount > 0 || quick.length > 0 || !!highlight
  const pool = searching && wideDates(eff) ? [...all].sort((a, b) => b.timestamp - a.timestamp) : txns
  const shown = pool.filter((t) =>
    (filter === 'ALL' && !intent.type ? true : (intent.type ? intent.type === 'DEBIT' : filter === 'EXPENSES') ? t.paymentType === 'DEBIT' : t.paymentType === 'CREDIT') && matches(t, intent.text, eff, t.contactId ? personOf.get(t.contactId)?.name : undefined)
    && quickOk(t, quick) && (!highlight || (t.paymentType === 'DEBIT' && catOf(t) === highlight)))
  const shownTotal = shown.reduce((a, t) => a + (t.paymentType === 'DEBIT' ? t.paymentAmount : -t.paymentAmount), 0)
  const allTags = useMemo(() => [...new Set(all.flatMap((t) => tagsOf(t.note)))].sort(), [all])

  let diff: { text: string; up: boolean } | null = null
  if (prevTotal > 0 && total > 0) {
    const pct = ((total - prevTotal) / prevTotal) * 100
    const up = pct >= 0
    diff = Math.abs(pct) > 1000
      ? { text: `${up ? '+' : ''}${formatPrice(Math.abs(total - prevTotal), { round: true })}`, up }
      : { text: `Expenses ${up ? 'up' : 'down'} by ${Math.abs(Math.round(pct))}%`, up }
  }

  const mask = (v: number) => (hidden ? `${currencySymbol()}••••` : formatPrice(v, { round: true }))
  const ordered = oldestFirst ? [...shown].reverse() : shown
  const [holds, setHolds] = useStored<Hold[]>(KEYS.holds, [])
  const openHolds = useMemo(() => activeHoldIds(holds), [holds])
  const confirmHold = useConfirm()
  const [holdOpen, setHoldOpen] = useState<string | null>(null)
  const openHold = holds.find((h) => h.id === holdOpen) ?? null
  const groups = useMemo(() => {
    const base: { key: string; label: string; total: number; items: Transaction[]; holds: Hold[] }[] = groupByDay(ordered).map((g) => ({ ...g, holds: [] }))
    // IPO / mandate blocks and unblocks sit in their day, outside spending and income
    const here = searching || filter !== 'ALL' ? [] : holds.filter((h) => { const d = new Date(h.timestamp); return d.getFullYear() === sel.year && d.getMonth() === sel.month })
    for (const h of here) {
      const d = new Date(h.timestamp)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      let g = base.find((x) => x.key === key)
      if (!g) { g = { key, label: dayLabel(h.timestamp), total: 0, items: [], holds: [] }; base.push(g) }
      g.holds.push(h)
    }
    const dayStart = (k: string) => { const [y, m, dd] = k.split('-').map(Number); return new Date(y, m, dd).getTime() }
    base.sort((a, b) => (oldestFirst ? 1 : -1) * (dayStart(a.key) - dayStart(b.key)))
    return base
  }, [ordered, holds, searching, filter, sel, oldestFirst])

  // the list slides the way the month moved
  const monthIdx = sel.year * 12 + sel.month
  const prevMonth = useRef(monthIdx)
  const slide = monthIdx > prevMonth.current ? 'from-right' : monthIdx < prevMonth.current ? 'from-left' : ''
  useEffect(() => { prevMonth.current = monthIdx }, [monthIdx])
  const [searchFocus, setSearchFocus] = useState(false)

  const selecting = selected.length > 0
  // the bottom dock gives way to the selection bar while selecting
  useEffect(() => {
    document.body.classList.toggle('selecting', selecting)
    return () => document.body.classList.remove('selecting')
  }, [selecting])
  const clearSel = () => { setSelected([]); setBulk(null) }
  useBackHandler(selecting, clearSel)
  const toggleSel = (id: string) => { buzz(8); setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])) }
  const chosen = all.filter((t) => selected.includes(t.id))

  const shiftMonth = (delta: number) => {
    const d = new Date(sel.year, sel.month + delta)
    if (d.getFullYear() * 12 + d.getMonth() > now.getFullYear() * 12 + now.getMonth()) { buzz(30); return }
    buzz(10); clearSel(); setHighlight(null)
    setSel({ year: d.getFullYear(), month: d.getMonth() })
  }
  const bulkDelete = () => {
    const snapshot = chosen
    snapshot.forEach((t) => deleteTransaction(t.id))
    clearSel()
    toast(`${snapshot.length} transaction${snapshot.length === 1 ? '' : 's'} deleted`, undefined, { label: 'Undo', onClick: () => snapshot.forEach(restoreTransaction) })
  }
  const bulkCategory = (c: string) => {
    chosen.forEach((t) => updateTransaction(t.id, { paymentCategory: c }))
    toast(`Moved ${chosen.length} to ${c}`)
    clearSel()
  }
  const bulkTag = (raw: string) => {
    const name = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-')
    if (!name) return
    const tag = `#${name}`
    chosen.forEach((t) => { if (!tagsOf(t.note).includes(tag)) updateTransaction(t.id, { note: `${t.note ? `${t.note} ` : ''}${tag}` }) })
    toast(`Tagged ${chosen.length} with ${tag}`)
    setTagDraft('')
    clearSel()
  }

  return (
    <div className="page home"
      onTouchStart={(e) => { const t = e.touches[0]; swipeRef.current = { x: t.clientX, y: t.clientY, ok: !(e.target as HTMLElement).closest('.swipe, .bank-tiles, .qchips, .sheet, .backdrop, .sel-bar, input') } }}
      onTouchEnd={(e) => {
        const s = swipeRef.current; swipeRef.current = null
        if (!s?.ok || selecting) return
        const t = e.changedTouches[0]
        const dx = t.clientX - s.x, dy = t.clientY - s.y
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) shiftMonth(dx < 0 ? 1 : -1)
      }}>
      <div className="home-head">
        <h1 className="home-title">Spending</h1>
        <button className="month-pill" onClick={() => setPicker(true)}>
          <span className="cal-icon"><Icon name="calendar" size={18} /></span>{monthShort(sel.month)} {sel.year}<Icon name="chevronDown" size={16} />
        </button>
      </div>

      <div className="dim small" style={{ marginTop: 18 }}>Spent in {new Date(sel.year, sel.month).toLocaleDateString('en-IN', { month: 'long' })}</div>
      <div className="row between" style={{ marginTop: 2 }}>
        <div className="home-amount">{hidden ? `${currencySymbol()}••••••` : <CountUp value={total} format={(v) => formatPrice(v, { round: true })} />}</div>
        <button onClick={() => setHidden(!hidden)} className="eye-btn" aria-label={hidden ? 'Show amounts' : 'Hide amounts'}><Icon name={hidden ? 'eyeOff' : 'eye'} size={26} /></button>
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
        {diff && (
          <span className="pill" style={{ padding: '7px 14px', fontSize: 14, background: diff.up ? 'rgba(255,107,107,.14)' : 'rgba(79,235,32,.12)', color: diff.up ? 'var(--up)' : 'var(--down)', border: `1px solid ${diff.up ? 'rgba(255,107,107,.25)' : 'rgba(79,235,32,.22)'}` }}>
            <Icon name={diff.up ? 'up' : 'down'} size={15} stroke={2.5} /> {diff.text}
          </span>
        )}
        {committedTotal > 0 && !hidden && (
          <span className="pill" style={{ padding: '7px 14px', fontSize: 14, background: 'rgba(244,162,97,.14)', color: '#F4A261' }} title="Not counted in your expenses">
            <Icon name="users" size={14} /> {formatPrice(committedTotal, { round: true })} {familyTotal === committedTotal ? 'sent to family' : 'commitments'}
          </span>
        )}
      </div>

      {show('donut') && slices.length > 0 && (
        <div className="donut-wrap">
          <Donut slices={slices} highlight={highlight} onSelect={setHighlight} size={narrow ? 128 : 148} thickness={narrow ? 26 : 30}
            label={hidden ? 'Spending by category, amounts hidden' : `Spending by category: ${slices.map((s) => `${s.label} ${formatPrice(s.value, { round: true })}, ${Math.round((s.value / total) * 100)} percent`).join('; ')}`}>
            {(() => {
              // the total is right above: the centre speaks only for a category you tapped
              const h = slices.find((s) => s.label === highlight)
              return h ? (
                <div>
                  <div className="num" style={{ fontWeight: 700, fontSize: 16 }}>{mask(h.value)}</div>
                  <div className="tiny muted">{h.label}</div>
                </div>
              ) : null
            })()}
          </Donut>
          <div className="grow col donut-legend" style={{ gap: 2 }}>
            {slices.slice(0, 6).map((s) => (
              <button key={s.label} className="legend-row" style={{ opacity: highlight && highlight !== s.label ? 0.4 : 1 }} onClick={() => setHighlight(highlight === s.label ? null : s.label)}>
                <span className="legend-dot" style={{ background: s.color }} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="small ellipsis" style={{ display: 'block' }}>{s.label}</span>
                  <span className="tiny dim num">{Math.round((s.value / total) * 100)}%</span>
                </span>
                <span className="num" style={{ fontWeight: 600, fontSize: 12.5 }}>{mask(s.value)}</span>
              </button>
            ))}
            {slices.length > 6 && <div className="tiny dim" style={{ paddingLeft: 18 }}>+{slices.length - 6} more</div>}
          </div>
        </div>
      )}

      {show('budget') && <BudgetBar spent={total} commitments={commitments} hidden={hidden} isCurrent={isCurrent} sel={sel} />}
      {show('plan') && isCurrent && <div className="home-slot"><MonthReviewCard hidden={hidden} /></div>}
      {isCurrent && shopOn && <div className="home-slot"><PayoutPrompt txns={all} hidden={hidden} /></div>}
      {show('plan') && isCurrent && <div className="home-slot"><WindfallCard txns={all} hidden={hidden} /></div>}
      {show('plan') && isCurrent && shopOn && <div className="home-slot"><ShopCard txns={all} hidden={hidden} onCredit={() => onPlanner('udhaar')} /></div>}
      {show('plan') && isCurrent && <div className="home-slot"><PlanCard txns={all} hidden={hidden} onOpen={() => onPlanner('plan')} /></div>}
      {show('safe') && isCurrent && <SafeToSpendCard txns={all} hidden={hidden} onOpen={() => onPlanner('calendar')} />}
      {show('forecast') && isCurrent && <ForecastCard txns={all} hidden={hidden} onOpen={() => onPlanner('calendar')} />}
      {show('categoryBudgets') && <CategoryBudgetList txns={txns} />}
      <ReviewBanner all={all} onOpen={() => setReviewOpen(true)} />
      <div className="home-slot"><CaptureSetup /></div>
      <CheckThese all={all} />
      <BackupNudge count={all.length} />
      {show('accounts') && <AccountsStrip all={all} methods={methods} hidden={hidden} onOpen={onOpenAccounts} />}
      {show('goals') && <GoalStrip txns={all} hidden={hidden} onOpen={() => onPlanner('goals')} />}
      <CoachTip count={all.length} />

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn sm secondary grow" onClick={() => { requestQuickSplit(); onPlanner('split') }}>
          <Icon name="split" size={16} /> Split a bill
        </button>
      </div>

      <div className="row" style={{ marginTop: 22, gap: 10 }}>
        <div className="row grow" style={{ position: 'relative' }}>
          <span className="muted" style={{ position: 'absolute', left: 16, display: 'flex' }}><Icon name="search" size={20} /></span>
          <input className="input search-box" onFocus={() => setSearchFocus(true)} onBlur={() => setSearchFocus(false)} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search receiver, category, note, #tag…" aria-label="Search transactions" />
          {query && <button style={{ position: 'absolute', right: 14, display: 'flex' }} className="dim" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={16} /></button>}
        </div>
        <button className="icon-btn filter-btn" data-hide={searchFocus && !filterCount ? '1' : undefined} style={{ width: 52, height: 52, position: 'relative', background: filterCount ? 'var(--accent)' : 'var(--card)', border: '1px solid var(--card-border)', color: filterCount ? '#fff' : undefined }} onClick={() => setFilterSheet(true)} aria-label="Filters">
          <Icon name="sliders" size={20} />
          {filterCount > 0 && <span className="tiny" style={{ position: 'absolute', top: -4, right: -4, background: 'var(--blue)', color: '#fff', borderRadius: 9, minWidth: 18, height: 18, display: 'grid', placeItems: 'center', fontWeight: 700 }}>{filterCount}</span>}
        </button>
      </div>
      {intent.labels.length > 0 && (
        <div className="row wrap nl-chips" style={{ gap: 6, marginTop: 8 }} aria-label="What the search understood">
          <span className="tiny dim">Showing</span>
          {intent.labels.map((l) => <span key={l} className="nl-chip">{l}</span>)}
          {intent.text && <span className="nl-chip text">“{intent.text}”</span>}
        </div>
      )}
      <div className="qchips" role="group" aria-label="Quick filters">
        {([['today', 'Today'], ['week', 'This week'], ['big', `Over ${currencySymbol()}1,000`], ['recurring', 'Recurring'], ...(shopOn ? [['business', 'Business sales']] : [])] as [QuickKey, string][]).map(([k, label]) => (
          <button key={k} className={`qchip${quick.includes(k) ? ' on' : ''}`} aria-pressed={quick.includes(k)} onClick={() => setQuick((q) => (q.includes(k) ? q.filter((x) => x !== k) : [...q, k]))}>{label}</button>
        ))}
      </div>
      {shopOn && quick.includes('business') && pending.count > 0 && (
        <div className="card pad" style={{ marginTop: 10 }}>
          <div className="row between"><b>Awaiting bank payout</b><b className="num">{formatPrice(pending.total, { round: true })}</b></div>
          <div className="dim small" style={{ marginTop: 4, lineHeight: 1.45 }}>{pending.count} sale{pending.count === 1 ? '' : 's'} still with PhonePe or Paytm since {new Date(pending.since).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. When the bank credits them, that credit is matched to these and not counted as income again.</div>
        </div>
      )}
      {highlight && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="qchip on" onClick={() => setHighlight(null)}><Icon name={categoryIcon(highlight)} size={14} />{highlight}<Icon name="close" size={13} /></button>
        </div>
      )}
      {searching && (
        <div className="row between small" style={{ margin: '10px 4px 0' }}>
          <span className="muted">{shown.length} result{shown.length === 1 ? '' : 's'} · {wideDates(eff) ? dateLabel(eff) : `${monthShort(sel.month)} ${sel.year}`}</span>
          <span className="num">{formatPrice(Math.abs(shownTotal), { round: true })} {shownTotal >= 0 ? 'net spent' : 'net in'}</span>
        </div>
      )}

      <div className="tabs-line" style={{ marginTop: 14 }}>
        {(['ALL', 'EXPENSES', 'INCOME'] as const).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'ALL' ? 'All' : f === 'EXPENSES' ? 'Expenses' : 'Income'}</button>
        ))}
        <button className="sort-btn" onClick={() => setOldestFirst(!oldestFirst)} aria-label={oldestFirst ? 'Showing oldest first' : 'Showing newest first'} title={oldestFirst ? 'Oldest first' : 'Newest first'}>
          <Icon name="sort" size={20} />
        </button>
      </div>

      <div key={monthIdx} className={`month-slide ${slide}`}>
        {ordered.length === 0 ? (
          searching
            ? <div className="empty"><b>No matches</b>Try another search, or clear your filters.</div>
            : all.length === 0
            ? (
              <div className="card pad col" style={{ gap: 14, alignItems: 'center', textAlign: 'center', margin: '18px 0' }}>
                <span className="icon-tile" style={{ width: 56, height: 56, borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="wallet" size={28} /></span>
                <div><b style={{ fontSize: 18 }}>Welcome to JustMoney</b><div className="muted small" style={{ marginTop: 4 }}>Add your first expense in about 3 seconds.</div></div>
                <div className="col small muted" style={{ gap: 8, textAlign: 'left', alignSelf: 'stretch' }}>
                  <span className="row" style={{ gap: 10 }}><span className="icon-tile" style={{ width: 28, height: 28, borderRadius: 10, background: 'var(--glass)' }}><Icon name="plus" size={14} /></span>Tap <b>+</b> and type it like a message</span>
                  <span className="row" style={{ gap: 10 }}><span className="icon-tile" style={{ width: 28, height: 28, borderRadius: 10, background: 'var(--glass)' }}><Icon name="mic" size={14} /></span>Say it, or snap a receipt</span>
                  <span className="row" style={{ gap: 10 }}><span className="icon-tile" style={{ width: 28, height: 28, borderRadius: 10, background: 'var(--glass)' }}><Icon name="bell" size={14} /></span>Or let payments from GPay and PhonePe add themselves</span>
                </div>
                <button className="btn block" onClick={onAdd}><Icon name="plus" size={18} />Add your first expense</button>
              </div>
            )
            : txns.length === 0
            ? <div className="empty"><b>Nothing in {monthShort(sel.month)} {sel.year}</b>Swipe to another month, or add an entry.<div style={{ marginTop: 14 }}><button className="btn sm" onClick={onAdd}><Icon name="plus" size={16} />Add expense</button></div></div>
            : <div className="empty"><b>Nothing in this filter</b>Switch to All to see your other entries.</div>
        ) : groups.map((g) => (
          <div key={g.key}>
            <div className="day-head"><span>{g.label}</span>{g.total > 0 && <span className="num">{mask(g.total)}</span>}</div>
            {g.holds.map((h) => <HoldRow key={h.id} h={h} active={openHolds.has(h.id)} account={methods.find((m) => m.id === h.paymentMethodId)} hidden={hidden} onOpen={() => setHoldOpen(h.id)} />)}
            {g.items.map((t) => (
              <TxRow key={t.id} t={t} contact={t.contactId ? personOf.get(t.contactId) : undefined} maybe={!t.contactId && t.paymentType === 'CREDIT' ? suggest(t.paymentReceiver, candidates)?.name : undefined} method={methods.find((m) => m.id === t.paymentMethodId)} hidden={hidden}
                fresh={fresh.has(t.id)} selecting={selecting} selected={selected.includes(t.id)} hasReceipt={!!receipts[t.id]} onToggle={() => toggleSel(t.id)} onLongPress={() => toggleSel(t.id)}
                onOpen={() => setDetail(t)} onEdit={() => onEdit(t)} />
            ))}
          </div>
        ))}
      </div>
      <HoldDetail h={openHold} active={!!openHold && openHolds.has(openHold.id)} holds={holds} account={methods.find((m) => m.id === openHold?.paymentMethodId)} hidden={hidden} onClose={() => setHoldOpen(null)}
        onRemove={async () => { if (!openHold) return; if (await confirmHold({ title: 'Remove this entry?', body: 'It is a record of money blocked or unblocked, not a payment. Removing it changes your account balance if the money was still held.', confirm: 'Remove', danger: true })) { setHolds(holds.filter((x) => x.id !== openHold.id)); setHoldOpen(null) } }} />
      <Watermark />

      {selecting && !bulk && (
        <div className="sel-bar" role="toolbar" aria-label="Selected transactions">
          <b className="grow small">{selected.length} selected</b>
          <button className="pill-btn" onClick={() => setBulk('category')} aria-label="Change category"><Icon name="pie" size={16} /><span className="lbl">Category</span></button>
          <button className="pill-btn" onClick={() => setBulk('tag')} aria-label="Add tag"><Icon name="tag" size={16} /><span className="lbl">Tag</span></button>
          <button className="pill-btn" style={{ color: 'var(--danger)', width: 44, padding: 0, justifyContent: 'center' }} onClick={bulkDelete} aria-label="Delete selected"><Icon name="trash" size={16} /></button>
          <button className="icon-btn" style={{ width: 44, height: 44 }} onClick={clearSel} aria-label="Cancel selection"><Icon name="close" size={18} /></button>
        </div>
      )}
      <Sheet open={bulk === 'category'} onClose={() => setBulk(null)}>
        <SheetHeader title="Change category" sub={`${selected.length} transaction${selected.length === 1 ? '' : 's'}`} onClose={() => setBulk(null)} />
        <div className="row wrap" style={{ gap: 8 }}>
          {cats.map((c) => <button key={c} className="chip" onClick={() => bulkCategory(c)}><Icon name={categoryIcon(c)} size={15} />{c}</button>)}
        </div>
      </Sheet>
      <Sheet open={bulk === 'tag'} onClose={() => setBulk(null)}>
        <SheetHeader title="Add a tag" sub={`${selected.length} transaction${selected.length === 1 ? '' : 's'}`} onClose={() => setBulk(null)} />
        <form className="row" onSubmit={(e) => { e.preventDefault(); bulkTag(tagDraft) }}>
          <input className="input grow" autoFocus placeholder="e.g. goa-trip" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} aria-label="Tag" />
          <button className="btn sm" disabled={!tagDraft.trim()}>Add</button>
        </form>
        {allTags.length > 0 && <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>{allTags.map((t) => <button key={t} className="chip" onClick={() => bulkTag(t)}>{t}</button>)}</div>}
      </Sheet>
      <ReviewSheet open={reviewOpen} all={all} onClose={() => setReviewOpen(false)} />
      <TransactionDetail tx={detail} all={all} methods={methods} hidden={hidden} onClose={() => setDetail(null)} onEdit={onEdit}
        onSplit={(t) => { setDetail(null); onSplit(t) }} onDuplicate={onDuplicate} />
      <FilterSheet open={filterSheet} onClose={() => setFilterSheet(false)} value={filters} onChange={setFilters} categories={cats} methods={methods} tags={allTags} />
      <MonthPicker open={picker} value={sel} onClose={() => setPicker(false)} onConfirm={(v) => { setSel(v); setPicker(false) }} />
    </div>
  )
}

interface Filters { categories: string[]; methodIds: string[]; apps: string[]; tags: string[]; min: string; max: string; allTime: boolean; month: string; from: string; to: string }
const EMPTY_FILTERS: Filters = { categories: [], methodIds: [], apps: [], tags: [], min: '', max: '', allTime: false, month: '', from: '', to: '' }
/** A date filter looks beyond the month on screen. */
const wideDates = (f: Filters) => f.allTime || !!f.month || !!f.from || !!f.to
const dateLabel = (f: Filters) => f.month ? new Date(`${f.month}-01T12:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  : f.from || f.to ? `${f.from ? new Date(`${f.from}T12:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'start'} – ${f.to ? new Date(`${f.to}T12:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'today'}` : 'all time'
const countFilters = (f: Filters) =>
  f.categories.length + f.methodIds.length + f.apps.length + f.tags.length + (f.min ? 1 : 0) + (f.max ? 1 : 0) + (f.allTime ? 1 : 0) + (f.month ? 1 : 0) + (f.from || f.to ? 1 : 0)

function matches(t: Transaction, query: string, f: Filters, contact?: string) {
  const q = query.trim().toLowerCase()
  if (q) {
    const hay = `${t.paymentReceiver} ${t.paymentCategory} ${t.note ?? ''} ${t.paymentAmount} ${t.originalCurrency ?? ''} ${t.paymentApp ?? ''} ${contact ?? ''} ${t.rawReceiver ?? ''}`.toLowerCase()
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false
  }
  if (f.categories.length && !f.categories.includes(t.paymentCategory)) return false
  if (f.methodIds.length && !f.methodIds.includes(t.paymentMethodId ?? '')) return false
  if (f.apps.length && !f.apps.includes(t.paymentApp ?? '')) return false
  if (f.tags.length && !tagsOf(t.note).some((tag) => f.tags.includes(tag))) return false
  if (f.month) { const d = new Date(t.timestamp); if (`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` !== f.month) return false }
  if (f.from && t.timestamp < new Date(`${f.from}T00:00:00`).getTime()) return false
  if (f.to && t.timestamp > new Date(`${f.to}T23:59:59.999`).getTime()) return false
  if (f.min && t.paymentAmount < Number(f.min)) return false
  if (f.max && t.paymentAmount > Number(f.max)) return false
  return true
}

function FilterSheet({ open, onClose, value, onChange, categories, methods, tags }: {
  open: boolean; onClose: () => void; value: Filters; onChange: (f: Filters) => void
  categories: string[]; methods: PaymentMethod[]; tags: string[]
}) {
  const toggle = (k: 'categories' | 'methodIds' | 'apps' | 'tags', v: string) =>
    onChange({ ...value, [k]: value[k].includes(v) ? value[k].filter((x) => x !== v) : [...value[k], v] })
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="Filters" onClose={onClose} />
      <div className="col" style={{ gap: 16 }}>
        <div className="field"><label>When</label>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className={`chip${!wideDates(value) ? ' on' : ''}`} onClick={() => onChange({ ...value, allTime: false, month: '', from: '', to: '' })}>Month on screen</button>
            <button className={`chip${value.allTime && !value.month && !value.from && !value.to ? ' on' : ''}`} onClick={() => onChange({ ...value, allTime: true, month: '', from: '', to: '' })}>All time</button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <div className="grow" style={{ minWidth: 0 }}><div className="tiny dim" style={{ marginBottom: 4 }}>A month</div>
              <input className="input" type="month" value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value, allTime: false, from: '', to: '' })} aria-label="Pick a month" /></div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <div className="grow" style={{ minWidth: 0 }}><div className="tiny dim" style={{ marginBottom: 4 }}>From date</div>
              <input className="input" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value, allTime: false, month: '' })} aria-label="From date" /></div>
            <div className="grow" style={{ minWidth: 0 }}><div className="tiny dim" style={{ marginBottom: 4 }}>To date</div>
              <input className="input" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value, allTime: false, month: '' })} aria-label="To date" /></div>
          </div>
        </div>
        <div className="field"><label>Category</label><div className="row wrap" style={{ gap: 8 }}>
          {categories.map((c) => <button key={c} className={`chip${value.categories.includes(c) ? ' on' : ''}`} onClick={() => toggle('categories', c)}>{c}</button>)}
        </div></div>
        {methods.length > 0 && <div className="field"><label>Account / card</label><div className="row wrap" style={{ gap: 8 }}>
          {methods.map((m) => <button key={m.id} className={`chip${value.methodIds.includes(m.id) ? ' on' : ''}`} onClick={() => toggle('methodIds', m.id)}><AccountLogo m={m} size={16} />{m.name}</button>)}
        </div></div>}
        <div className="field"><label>Paid / received via</label><div className="row wrap" style={{ gap: 8 }}>
          {UPI_APPS.map((a) => <button key={a} className={`chip${value.apps.includes(a) ? ' on' : ''}`} onClick={() => toggle('apps', a)}><BrandLogo src={appLogo(a)} size={16} radius={4} />{a}</button>)}
        </div></div>
        {tags.length > 0 && <div className="field"><label>Tags</label><div className="row wrap" style={{ gap: 8 }}>
          {tags.map((t) => <button key={t} className={`chip${value.tags.includes(t) ? ' on' : ''}`} onClick={() => toggle('tags', t)}>{t}</button>)}
        </div></div>}
        <div className="field"><label>Amount</label><div className="row">
          <input className="input" inputMode="decimal" placeholder="Min" value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value.replace(/[^0-9.]/g, '') })} />
          <input className="input" inputMode="decimal" placeholder="Max" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value.replace(/[^0-9.]/g, '') })} />
        </div></div>
        <div className="row">
          <button className="btn secondary grow" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button>
          <button className="btn grow" onClick={onClose}>Show results</button>
        </div>
      </div>
    </Sheet>
  )
}

/** Per-category caps for the visible month: amber from 80%, red once over. */
function CategoryBudgetList({ txns }: { txns: Transaction[] }) {
  const [budgets] = useStored<CategoryBudgets>(KEYS.categoryBudgets, {})
  const entries = Object.entries(budgets).filter(([, v]) => v > 0)
  if (!entries.length) return null
  const spentBy = (c: string) => txns.filter((t) => t.paymentType === 'DEBIT' && t.paymentCategory === c).reduce((a, t) => a + t.paymentAmount, 0)
  return (
    <div className="card pad col" style={{ marginTop: 10, gap: 12 }}>
      {entries.map(([c, cap]) => {
        const spent = spentBy(c)
        const pct = Math.round((spent / cap) * 100)
        const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--amber)' : categoryColor(c)
        return (
          <div key={c} className="col" style={{ gap: 6 }}>
            <div className="row between small">
              <span className="row" style={{ gap: 6 }}>{c}{pct >= 80 && <span style={{ color, display: 'flex' }}><Icon name="info" size={14} /></span>}</span>
              <span className="num"><span style={{ color: pct >= 80 ? color : undefined }}>{formatPrice(spent, { round: true })}</span><span className="dim"> / {formatPrice(cap, { round: true })}</span></span>
            </div>
            <div className="bar" style={{ height: 6 }}><i style={{ width: `${Math.min(pct, 100)}%`, background: color }} /></div>
          </div>
        )
      })}
    </div>
  )
}

/** Live balances of bank accounts that have an opening balance set. */
function AccountsStrip({ all, methods, hidden, onOpen }: { all: Transaction[]; methods: PaymentMethod[]; hidden: boolean; onOpen: () => void }) {
  const banks = methods.filter(tracksBalance)
  const total = banks.reduce((a, m) => a + accountBalance(m, all), 0)
  const cash = cashInHand(all)
  const [cashOpen, setCashOpen] = useState(false)
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  return (
    <div className="card pad" style={{ marginTop: 12 }}>
      <button className="row between" style={{ width: '100%' }} onClick={onOpen}>
        <span className="row" style={{ gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>Bank balance</span>
        </span>
        <span className="row" style={{ gap: 6, minWidth: 0 }}>
          {banks.length > 0 && <b className="num ellipsis" style={{ fontSize: 'clamp(16px, 5vw, 20px)' }}>{hidden ? fmt(total) : <CountUp value={total} format={(v) => fmt(v)} />}</b>}
          <span className="chev"><Icon name="chevron" size={18} /></span>
        </span>
      </button>
      <div className="bank-tiles">
        {banks.map((m) => {
          const bal = accountBalance(m, all)
          return (
            <button key={m.id} className="bank-tile" onClick={onOpen}>
              <AccountLogo m={m} size={36} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="small muted ellipsis" style={{ display: 'block' }}>{m.name}</span>
                <b className="num" style={{ fontSize: 16, color: bal < 0 ? 'var(--danger)' : undefined }}>{fmt(bal)}</b>
              </span>
            </button>
          )
        })}
        {(
          <button className="bank-tile" aria-label="Cash in hand" onClick={() => setCashOpen(true)}>
            <span className="icon-tile" style={{ background: 'rgba(52,199,89,.15)', color: '#34C759', width: 36, height: 36 }}><Icon name="wallet" size={18} /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="small muted ellipsis" style={{ display: 'block' }}>Cash in hand</span>
              {cash.has
                ? <b className="num" style={{ fontSize: 16, color: cash.balance < 0 ? 'var(--danger)' : undefined }}>{fmt(cash.balance)}</b>
                : <span className="small" style={{ color: 'var(--accent)' }}>Track cash</span>}
            </span>
          </button>
        )}
        <CashSheet open={cashOpen} onClose={() => setCashOpen(false)} all={all} methods={methods} />
        <button className="bank-tile" onClick={onOpen}>
          <span className="add-dot"><Icon name="plus" size={18} stroke={2.4} /></span>
          <span className="small" style={{ fontWeight: 600 }}>{banks.length ? 'Add Account' : 'Add a bank balance'}</span>
        </button>
      </div>
    </div>
  )
}

function BudgetBar({ spent, commitments, hidden, isCurrent, sel }: { spent: number; commitments: Commitment[]; hidden: boolean; isCurrent: boolean; sel: { year: number; month: number } }) {
  const [budget, setBudget] = useStored<number>(KEYS.monthlyBudget, 0)
  const [user] = useStored<User | null>(KEYS.user, null)
  const [income] = useStored<IncomeSource[]>(KEYS.incomeSources, [])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const committedAmt = commitments.reduce((a, c) => a + c.amount, 0)
  const [allTx] = useStored<Transaction[]>(KEYS.transactions, [])
  useStored(KEYS.planSettings, {})
  const [planMonthsData] = useStored<Record<string, unknown>>(KEYS.planMonths, {})
  // with no budget typed in, the limit is the spending plan: what is left after family, bills and saving first
  const plan = useMemo(() => currentPlan(allTx, sel.year, sel.month, commitments), [allTx, commitments, sel.year, sel.month, planMonthsData]) // eslint-disable-line react-hooks/exhaustive-deps
  const effective = budget > 0 ? budget : plan.limit > 0 ? plan.limit : Math.max(0, spendableOf(plannedIncome(user, income), commitments))

  // this month with no budget typed in: the spending plan card above says the same, with a way to save
  if (budget <= 0 && plan.limit > 0 && isCurrent) return null
  if (budget <= 0 && incomeMode(getPlanSettings(), allTx) === 'INCOME' && isCurrent) return null

  if (editing) {
    return (
      <form className="card pad row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); setBudget(Number(draft) || 0); setEditing(false) }}>
        <input className="input grow" inputMode="numeric" autoFocus placeholder="Set monthly budget" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))} />
        <button className="btn sm">Save</button>
      </form>
    )
  }
  if (!effective) {
    return <button className="card pad row" style={{ marginTop: 12, width: '100%' }} onClick={() => { setDraft(''); setEditing(true) }}><Icon name="plus" size={18} /> Set a monthly budget</button>
  }
  const pct = Math.round((spent / effective) * 100)
  const over = spent > effective
  const color = over ? 'var(--danger)' : pct > 80 ? 'var(--amber)' : 'var(--toggle)'
  const fmt = (v: number) => (hidden ? '••••' : formatPrice(v, { round: true }))
  const today = new Date()
  const daysInMonth = new Date(sel.year, sel.month + 1, 0).getDate()
  const daysLeft = isCurrent ? daysInMonth - today.getDate() + 1 : 0
  const perDay = !over && daysLeft > 0 ? (effective - spent) / daysLeft : 0
  const warn = !over && pct >= 80
  return (
    <div className="card pad col" style={{ marginTop: 24, gap: 12 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="circle-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="target" size={22} /></span>
        <span className="grow" style={{ fontSize: 15 }}><b style={{ fontSize: 18 }}><CountUp value={pct} />%</b> <span className="muted">of</span> <b>{fmt(effective)}</b> <span className="muted">{budget > 0 ? 'budget' : plan.limit > 0 ? 'spending plan' : committedAmt > 0 ? 'spendable' : ''} used</span></span>
        <button className="pill-btn" onClick={() => { setDraft(String(budget || '')); setEditing(true) }}><Icon name="edit" size={15} />Edit</button>
      </div>
      <div className="bar" style={{ height: 10 }}><i style={{ width: `${Math.min(pct, 100)}%`, background: color, boxShadow: `0 0 12px ${over ? 'rgba(239,68,68,.6)' : 'transparent'}` }} /></div>
      {budget <= 0 && plan.limit > 0 && <div className="muted small">Income {fmt(plan.income)} – family & bills {fmt(plan.committed)}{plan.setAside > 0 ? ` – kept aside ${fmt(plan.setAside)}` : ''} – saving first {fmt(plan.saveTarget)}</div>}
      {budget <= 0 && plan.limit <= 0 && committedAmt > 0 && <div className="muted small">Income {fmt(plannedIncome(user, income))} – Commitments {fmt(committedAmt)}</div>}
      {warn && (
        <div className="budget-note" style={{ color: 'var(--amber)' }} role="alert"><Icon name="info" size={16} />Budget {pct}% used — time to slow down</div>
      )}
      {perDay > 0 && (
        <div className="budget-note muted"><Icon name="calendar" size={16} />About <b className="num" style={{ color: 'var(--text)' }}>{fmt(perDay)}</b>/day for the next {daysLeft} day{daysLeft === 1 ? '' : 's'}</div>
      )}
      <div className="row between">
        <span className="row" style={{ gap: 10 }}>
          <span className="circle-icon" style={{ width: 34, height: 34, border: `1.5px solid ${over ? 'var(--danger)' : 'var(--card-border)'}`, color: over ? 'var(--danger)' : 'var(--text-60)' }}><Icon name="trend" size={16} /></span>
          <span className="num">{hidden ? fmt(spent) : <CountUp value={spent} format={(v) => fmt(v)} />} <span className="muted">spent</span></span>
        </span>
        <span className="over-pill num" style={over
          ? { background: 'rgba(239,68,68,.16)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,.35)' }
          : { background: 'rgba(30,203,72,.12)', color: 'var(--toggle)', border: '1px solid rgba(30,203,72,.3)' }}>
          {hidden ? fmt(Math.abs(effective - spent)) : <CountUp value={Math.abs(effective - spent)} format={(v) => fmt(v)} />} {over ? 'over' : 'left'}
        </span>
      </div>
    </div>
  )
}

/** "7:12 PM" — the day header above the row already says which day; empty when only the date is known. */
function rowTime(ts: number, timeUnknown?: boolean) {
  return timeUnknown ? '' : formatDateTime(ts).split(', ')[1] ?? ''
}

/** A block or unblock of money for an IPO or mandate: a padlock, the amount in red (blocked) or green (unblocked), and no + or -. */
function HoldRow({ h, active, account, hidden, onOpen }: { h: Hold; active: boolean; account?: PaymentMethod; hidden: boolean; onOpen: () => void }) {
  const blocked = h.kind === 'BLOCKED'
  const color = blocked ? 'var(--danger)' : 'var(--credit)'
  return (
    <button className="list-row" style={{ width: '100%', textAlign: 'left', padding: '12px 4px', borderTop: '1px solid var(--glass)' }} onClick={onOpen} aria-label={`${blocked ? 'Blocked' : 'Unblocked'} ${h.amount}`}>
      <span style={{ position: 'relative', flex: 'none', display: 'inline-flex' }}>
        <span className="icon-tile" style={{ width: 46, height: 46, borderRadius: 23, background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            {blocked ? <path d="M8 10V7a4 4 0 0 1 8 0v3" /> : <path d="M8 10V7a4 4 0 0 1 7.5-2" />}
          </svg>
        </span>
        {account && <span style={{ position: 'absolute', right: -5, bottom: -4, display: 'flex', borderRadius: 8, border: '2px solid var(--bg)', background: 'var(--bg)' }}><AccountLogo m={account} size={20} /></span>}
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontSize: 16, fontWeight: 600 }}>{blocked ? 'Money blocked' : 'Money unblocked'}</div>
        <div className="dim small ellipsis" style={{ marginTop: 3 }}>{h.name}{account ? ` · ${account.name}` : ''}{blocked && active ? ' · held' : ''}{h.settledBy ? ' · taken, now an investment' : ''}</div>
      </div>
      <div className="num" style={{ color, fontWeight: 600 }}>{hidden ? `${currencySymbol()}••••` : formatPrice(h.amount)}</div>
    </button>
  )
}

/** The details of a block or unblock, like a payment's: what it is, how much, for what, which account, when, and whether the money is still held. */
function HoldDetail({ h, active, holds, account, hidden, onClose, onRemove }: { h: Hold | null; active: boolean; holds: Hold[]; account?: PaymentMethod; hidden: boolean; onClose: () => void; onRemove: () => void }) {
  const [invs] = useStored<{ id: string; name: string }[]>(KEYS.investments, [])
  if (!h) return null
  const blocked = h.kind === 'BLOCKED'
  const color = blocked ? 'var(--danger)' : 'var(--credit)'
  const inv = h.investmentId ? invs.find((i) => i.id === h.investmentId) : null
  const status = !blocked ? 'Released: the money is back in the account' : h.settledBy ? 'Taken by the bank: now an investment' : active ? 'Held: not available until it is unblocked' : 'Released: unblocked later'
  const paired = !blocked ? null : holds.find((x) => x.kind === 'UNBLOCKED' && Math.abs(x.amount - h.amount) < 0.5 && x.timestamp >= h.timestamp && (x.paymentMethodId ?? null) === (h.paymentMethodId ?? null))
  const rows: [string, string][] = [
    ['Status', status],
    ['For', h.name],
    ['Account', account ? `${account.name}${account.last4 ? ` ••${account.last4}` : ''}` : 'Not matched to an account'],
    ['When', formatDateTime(h.timestamp)],
    ...(paired ? [['Unblocked', formatDateTime(paired.timestamp)] as [string, string]] : []),
    ...(inv ? [['Investment', inv.name] as [string, string]] : []),
  ]
  return (
    <Sheet open onClose={onClose}>
      <SheetHeader title={<>Money {blocked ? 'blocked.' : 'unblocked.'}</>} sub={blocked ? 'Held at the bank for an IPO or UPI mandate' : 'Released back to your account'} onClose={onClose} />
      <div className="col" style={{ alignItems: 'center', gap: 6, margin: '4px 0 14px' }}>
        <span className="icon-tile" style={{ width: 56, height: 56, borderRadius: 28, background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" />{blocked ? <path d="M8 10V7a4 4 0 0 1 8 0v3" /> : <path d="M8 10V7a4 4 0 0 1 7.5-2" />}</svg>
        </span>
        <div className="big-amount num" style={{ fontSize: 34, color }}>{hidden ? `${currencySymbol()}••••` : formatPrice(h.amount)}</div>
      </div>
      <div className="card">
        {rows.map(([k, v]) => <div key={k} className="list-row"><span className="dim">{k}</span><span className="grow" style={{ textAlign: 'right' }}>{v}</span></div>)}
      </div>
      <p className="dim tiny" style={{ lineHeight: 1.5 }}>This is not a payment, so it is not counted as spending or income. {blocked && active ? 'The amount is taken out of the account balance until it is unblocked.' : ''}</p>
      <button className="btn block secondary" style={{ color: 'var(--danger)' }} onClick={onRemove}>Remove this entry</button>
    </Sheet>
  )
}

function TxRow({ t, contact, maybe, method, hidden, fresh, selecting, selected, hasReceipt, onToggle, onLongPress, onOpen, onEdit }: {
  t: Transaction; contact?: Person; maybe?: string; method?: PaymentMethod; hidden: boolean; fresh?: boolean; selecting: boolean; selected: boolean; hasReceipt: boolean
  onToggle: () => void; onLongPress: () => void; onOpen: () => void; onEdit: () => void
}) {
  const toast = useToast()
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  // 'pending' until the finger clearly moves one way: sideways = swipe, up/down = page scroll
  const start = useRef<{ x: number; y: number; base: number; cur: number; mode: 'pending' | 'swipe' | 'scroll' } | null>(null)
  const holdTimer = useRef<number | undefined>(undefined)
  const heldFired = useRef(false) // the click that ends a long press must not also open/toggle the row
  const credit = t.paymentType === 'CREDIT'
  // paid by card: a red card instead of the amount icon
  const card = !credit && (method?.type === 'DEBIT_CARD' || method?.type === 'CREDIT_CARD' || t.paymentSource === 'DEBIT_CARD' || t.paymentSource === 'CREDIT_CARD'
    || /\b(pos|card|debit card|credit card|vps|ecom)\b/i.test(`${t.paymentReceiver} ${t.note ?? ''}`))

  // the row shrinks and fades before it is removed
  const [leaving, setLeaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const onDelete = () => {
    setDx(0); setLeaving(true); buzz(14)
    setTimeout(() => {
      deleteTransaction(t.id)
      toast('Transaction deleted', `${t.paymentReceiver} · ${formatPrice(t.paymentAmount)}`, { label: 'Undo', onClick: () => restoreTransaction(t) })
    }, 280)
  }
  // a card swells a little before its editor opens
  const edit = () => { setOpening(true); buzz(8); setTimeout(() => { setOpening(false); onEdit() }, 150) }
  const tags = tagsOf(t.note)
  const noteText = t.note?.replace(/#[\p{L}\p{N}_-]+/gu, '').trim()

  return (
    <div className={`swipe${leaving ? ' leaving' : ''}${opening ? ' opening' : ''}`}>
      {/* only behind the row while it is moved, so the buttons never peek out at rest */}
      {/* swiping right slides the row away from the left edge, revealing Delete there; swiping left reveals Edit on the right */}
      {dx > 0 && (
        <div className="swipe-actions" style={{ justifyContent: 'flex-start' }}>
          <button style={{ background: 'var(--danger)', width: Math.max(dx, 0) }} onClick={onDelete} aria-label="Delete transaction"><Icon name="trash" /><span>Delete</span></button>
        </div>
      )}
      {dx < 0 && (
        <div className="swipe-actions" style={{ justifyContent: 'flex-end' }}>
          <button style={{ background: 'var(--blue)', width: Math.max(-dx, 0) }} onClick={() => { setDx(0); edit() }} aria-label="Edit transaction"><Icon name="edit" /><span>Edit</span></button>
        </div>
      )}
      <div
        className={`swipe-content list-row${selected ? ' tx-selected' : ''}${fresh ? ' tx-new' : ''}`}
        aria-selected={selecting ? selected : undefined}
        style={{ userSelect: 'none', WebkitTouchCallout: 'none', transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : undefined, padding: '12px 4px', borderTop: '1px solid var(--divider)' }}
        // Tapping to open/close is a native click — the browser only fires it for a real tap
        // (not after a drag), which is far more reliable across devices than guessing from
        // pointer-move deltas. Pointer events below only drive the horizontal swipe-reveal.
        onClick={() => {
          if (heldFired.current) { heldFired.current = false; return }
          if (selecting) onToggle()
          else if (dx !== 0) setDx(0)
          else onOpen()
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          start.current = { x: e.clientX, y: e.clientY, base: dx, cur: dx, mode: 'pending' }
          heldFired.current = false
          window.clearTimeout(holdTimer.current)
          if (!selecting && dx === 0) {
            holdTimer.current = window.setTimeout(() => {
              if (start.current?.mode !== 'pending') return
              start.current.mode = 'scroll'
              heldFired.current = true
              buzz(20)
              onLongPress()
            }, 450)
          }
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s || s.mode === 'scroll' || selecting) return
          const mx = e.clientX - s.x
          const my = e.clientY - s.y
          if (s.mode === 'pending') {
            if (Math.abs(mx) < 12 && Math.abs(my) < 12) return
            window.clearTimeout(holdTimer.current)
            if (Math.abs(mx) < Math.abs(my) * 1.5) { s.mode = 'scroll'; return }
            s.mode = 'swipe'
            setDragging(true)
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
          }
          s.cur = Math.max(-84, Math.min(84, s.base + mx))
          setDx(s.cur)
        }}
        onPointerUp={(e) => {
          const s = start.current
          start.current = null
          window.clearTimeout(holdTimer.current)
          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* wasn't captured */ }
          if (s?.mode === 'swipe') {
            const open = s.cur > 42 || s.cur < -42
            if (open !== (dx !== 0)) buzz(10)
            setDragging(false); setDx(s.cur > 42 ? 84 : s.cur < -42 ? -84 : 0)
          }
        }}
        onPointerCancel={(e) => {
          start.current = null
          window.clearTimeout(holdTimer.current)
          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* wasn't captured */ }
          setDragging(false); setDx(0)
        }}
      >
        {selecting && <span className={`sel-check${selected ? ' on' : ''}`} aria-hidden>{selected && <Icon name="check" size={13} stroke={3} />}</span>}
        <div style={{ position: 'relative', flex: 'none' }}>
          <BrandLogo src={merchantLogo(t.paymentReceiver)} size={46} radius={23} alt={t.paymentReceiver}
            fallback={<span className="letter-avatar" style={{ background: categoryColor(t.paymentCategory) }}>{(t.paymentReceiver.trim()[0] ?? '?').toUpperCase()}</span>} />
          {card ? (
            networkLogo(method?.network)
              ? <span style={{ position: 'absolute', right: -6, bottom: -5, display: 'flex' }}><BrandLogo src={networkLogo(method?.network)} size={26} alt={`${method?.network} card`} /></span>
              : <span className="tx-avatar debit" style={{ position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, border: '2px solid var(--bg)' }}><Icon name="card" size={11} stroke={2.4} /></span>
          ) : null}
        </div>
        <div className="grow">
          <div className="ellipsis" style={{ fontSize: 15, fontWeight: 600 }}>{shownName(t)}</div>
          <div className="row small dim tx-sub" style={{ gap: 6, marginTop: 3 }}>
            <span>{t.paymentCategory}</span>
            {!t.appChosen && t.paymentType === 'DEBIT' && ambiguousApp(t.paymentReceiver) && <span style={{ color: 'var(--accent)' }}>Which {merchantBrand(t.paymentReceiver)?.label}?</span>}
            {contact && <span className="row" style={{ gap: 3, color: 'var(--accent)' }}><Icon name="users" size={11} />{contact.name}</span>}
            {maybe && <span className="row" style={{ gap: 3, color: 'var(--accent)', opacity: 0.75 }}><Icon name="users" size={11} />Maybe {maybe}</span>}
            {t.recurringId && <span title="Recurring" style={{ display: 'flex' }}><Icon name="repeat" size={12} /></span>}
            {hasReceipt && <span title="Has a receipt photo" style={{ display: 'flex' }}><Icon name="image" size={12} /></span>}
            {(rowTime(t.timestamp, t.timeUnknown) || (t.originalCurrency && t.originalAmount)) && <span>·</span>}
            <span>{t.originalCurrency && t.originalAmount ? `${formatPrice(t.originalAmount, { currency: t.originalCurrency })}${rowTime(t.timestamp, t.timeUnknown) ? ' · ' : ''}` : ''}{rowTime(t.timestamp, t.timeUnknown)}</span>
          </div>
          {tags.length > 0 && (
            <div className="row tiny dim tx-sub" style={{ gap: 6, marginTop: 3 }}>
              {tags.map((tag) => <span key={tag} style={{ color: 'var(--accent)' }}>{tag}</span>)}
            </div>
          )}
          {noteText && <div className="tiny dim ellipsis" style={{ marginTop: 2 }}>{noteText}</div>}
        </div>
        {/* only money coming in is coloured; money going out is the normal case, in ink */}
        <div className="num" style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', color: credit ? 'var(--credit)' : 'var(--text)' }}>
          {credit ? '+' : ''}{hidden ? `${currencySymbol()}••••` : formatPrice(t.paymentAmount)}
        </div>
      </div>
    </div>
  )
}

export function MonthPicker({ open, value, onClose, onConfirm }: {
  open: boolean; value: { year: number; month: number }; onClose: () => void; onConfirm: (v: { year: number; month: number }) => void
}) {
  const [year, setYear] = useState(value.year)
  const [month, setMonth] = useState(value.month)
  const now = new Date()
  return (
    <Sheet open={open} onClose={onClose}>
      <h2 className="h2" style={{ marginBottom: 16 }}>Select Month</h2>
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => setYear(year - 1)} aria-label="Previous year"><Icon name="back" size={18} /></button>
        <b style={{ fontSize: 18 }}>{year}</b>
        <button className="icon-btn" disabled={year >= now.getFullYear()} style={{ opacity: year >= now.getFullYear() ? 0.3 : 1 }} onClick={() => setYear(year + 1)} aria-label="Next year"><Icon name="chevron" size={18} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {Array.from({ length: 12 }, (_, m) => {
          const future = year > now.getFullYear() || (year === now.getFullYear() && m > now.getMonth())
          return <button key={m} disabled={future} className={`chip${m === month ? ' on' : ''}`} style={{ justifyContent: 'center', opacity: future ? 0.3 : 1 }} onClick={() => setMonth(m)}>{monthShort(m)}</button>
        })}
      </div>
      <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
        <button className="btn sm secondary" onClick={onClose}>Cancel</button>
        <button className="btn sm" onClick={() => onConfirm({ year, month })}>Confirm</button>
      </div>
    </Sheet>
  )
}
