import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import BrandLogo from '../ui/BrandLogo'
import AccountLogo from '../ui/AccountLogo'
import ContactPicker, { Avatar } from '../people/ContactPicker'
import InvestmentLink from '../invest/InvestmentLink'
import { investmentResult } from '../../lib/invest/invest'
import type { Investment } from '../../lib/core/types'
import { buzz, Icon, Sheet, Toggle, useBackHandler, useConfirm, useToast } from '../ui/ui'
import { ambiguousApp, appLogo, merchantLogo } from '../../lib/payees/brands'
import { advance, categoryColor, categoryIcon, createRecurringRule, setBusinessExpense, SOURCE_LABELS, tagsOf, updateTransaction, withFamily } from '../../lib/core/data'
import { currencySymbol, formatPrice, monthShort } from '../../lib/core/format'
import { INCOME_CATEGORIES } from '../../lib/core/money'
import { learnRule, matchRule } from '../../lib/capture/rules'
import { payeeKey, payeeLabel, shownName } from '../../lib/payees/payee'
import { compressImage, removeReceipt, saveReceipt } from '../../lib/capture/receipts'
import { linkTransaction, unlinkTransaction } from '../../lib/payees/people'
import { isTransferCategory, SELF_TRANSFER, SPLIT } from '../../lib/accounts/accounts'
import { clearNudges, settlePart, splitPaybackFrom } from '../../lib/split/splitPlus'
import type { SplitPerson, SplitProject, SplitRow, SplitTxn } from '../../lib/split/split'
import { setSplitIntent } from '../../lib/split/splitHandoff'
import { removeTransaction } from '../../lib/core/remove'
import { detachTransactionFromLoans, loanToSettle, outstanding, settleWithTransaction } from '../../lib/payees/loans'
import { behalfBalance, fundedBy, isOnBehalf, markOnBehalf, paybackFrom, unmarkedAdvance, unmarkOnBehalf } from '../../lib/accounts/behalf'
import { isMerchantReceipt, markAsPayout, pendingSummary, undoPayout } from '../../lib/payees/merchant'
import { useProfession } from '../../lib/plan/profession'
import { looksLikePerson, personFor, rejectSuggestion, suggest, useCandidates } from '../../lib/payees/suggest'
import type { Person } from '../../lib/payees/peopleMatch'
import { write, useStored, KEYS } from '../../lib/core/storage'
import type { Loan, NewTransaction, PaymentMethod, RecurringCadence, RecurringRule, Transaction } from '../../lib/core/types'

const CADENCES: { key: RecurringCadence; label: string }[] = [
  { key: 'WEEKLY', label: 'Weekly' }, { key: 'MONTHLY', label: 'Monthly' }, { key: 'YEARLY', label: 'Yearly' },
]

/** One transaction in full, opened by tapping it. Actions live under the details; edit and delete at the bottom. */
export default function TransactionDetail({ tx, all, methods, hidden, onClose, onEdit, onDuplicate }: {
  tx: Transaction | null; all: Transaction[]; methods: PaymentMethod[]; hidden: boolean
  onClose: () => void; onEdit: (t: Transaction) => void
  onSplit: (t: Transaction) => void; onDuplicate: (prefill: Partial<NewTransaction>) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { shop: shopOn } = useProfession()
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [rules] = useStored<RecurringRule[]>(KEYS.recurringRules, [])
  const [receipts] = useStored<Record<string, string>>(KEYS.receipts, {})
  const [people] = useStored<Person[]>(KEYS.people, [])
  const [pickContact, setPickContact] = useState(false)
  const [pickInvest, setPickInvest] = useState(false)
  const [investments] = useStored<Investment[]>(KEYS.investments, [])
  // SplitMoney, for spotting a friend paying back their share (read before any early return: hooks keep their order)
  const [sp] = useStored<SplitProject[]>(KEYS.splitProjects, []), [spp] = useStored<SplitPerson[]>(KEYS.splitPeople, [])
  const [stx] = useStored<SplitTxn[]>(KEYS.splitTransactions, []), [srows] = useStored<SplitRow[]>(KEYS.splits, [])
  const candidates = useCandidates()
  const [, refresh] = useState(0)
  const [remember, setRemember] = useState(false)
  const [pickCategory, setPickCategory] = useState(false)
  const [learned, setLearned] = useState<{ payee: string; category: string; type: 'DEBIT' | 'CREDIT' } | null>(null)
  const [pickRepeat, setPickRepeat] = useState(false)
  const [viewReceipt, setViewReceipt] = useState(false)
  const [busy, setBusy] = useState(false)
  // marking it as money handled for someone: open while choosing who and how much was theirs
  const [behalf, setBehalf] = useState<{ personId: string | null; part: string } | null>(null)
  const [pickBehalf, setPickBehalf] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useBackHandler(viewReceipt, () => setViewReceipt(false))

  // keep showing the latest copy if it was edited while open
  const t = tx ? all.find((x) => x.id === tx.id) ?? tx : null
  if (!t) return null

  const credit = t.paymentType === 'CREDIT'
  const method = methods.find((m) => m.id === t.paymentMethodId)
  const tags = tagsOf(t.note)
  const noteText = t.note?.replace(/#[\p{L}\p{N}_-]+/gu, '').trim()
  const person = t.contactId ? people.find((x) => x.id === t.contactId) : undefined
  const loan = t.loanId ? loans.find((l) => l.id === t.loanId) : undefined
  const rule = t.recurringId ? rules.find((r) => r.id === t.recurringId) : undefined
  const receipt = receipts[t.id]
  const d = new Date(t.timestamp)
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  const money = (v: number, currency?: string) => (hidden ? `${currencySymbol(currency)}••••` : formatPrice(v, { currency }))
  // money in can also be your own money moving (cash you deposited, or from another account of yours): never income
  const catList = credit ? [...INCOME_CATEGORIES, SELF_TRANSFER, SPLIT] : withFamily(categories)

  // Same payee, same direction, all time.
  // official merchants are grouped under their brand (Uber India Systems Pvt Ltd = Uber); people stay exact
  const key = payeeKey(t.paymentReceiver, t.paymentCategory)
  const same = all.filter((x) => x.paymentType === t.paymentType && payeeKey(x.paymentReceiver, x.paymentCategory) === key)
  const groupName = payeeLabel(t.paymentReceiver, t.paymentCategory)
  const sameTotal = same.reduce((a, x) => a + x.paymentAmount, 0)
  const history = (() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => {
      const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      return { y: m.getFullYear(), m: m.getMonth(), total: 0 }
    })
    same.forEach((x) => { const xd = new Date(x.timestamp); const b = months.find((m) => m.y === xd.getFullYear() && m.m === xd.getMonth()); if (b) b.total += x.paymentAmount })
    return months
  })()
  const histMax = Math.max(...history.map((h) => h.total), 1)
  const histAvg = history.reduce((a, h) => a + h.total, 0) / history.filter((h) => h.total > 0).length || 0

  const remove = () => {
    // a loan, its repayments and both halves of a split go together, and come back together
    const r = removeTransaction(t)
    onClose()
    toast('Transaction deleted', `${t.paymentReceiver} · ${formatPrice(t.paymentAmount)}${r.count > 1 ? ` and ${r.count - 1} linked` : ''}`, { label: 'Undo', onClick: r.undo })
  }

  const changeCategory = (c: string) => {
    setPickCategory(false)
    if (c === t.paymentCategory) return
    buzz(8)
    updateTransaction(t.id, { paymentCategory: c })
    const payee = t.paymentReceiver.trim()
    const already = matchRule({ paymentReceiver: payee, note: t.note, paymentType: t.paymentType })?.category === c
    const generic = /^(Expense|Payment|Money received)$/.test(payee) || INCOME_CATEGORIES.includes(payee)
    setLearned(!already && payee && !generic ? { payee, category: c, type: t.paymentType } : null)
  }

  const duplicate = () => {
    onDuplicate({
      paymentAmount: t.paymentAmount, paymentType: t.paymentType, paymentReceiver: t.paymentReceiver, paymentCategory: t.paymentCategory,
      paymentSource: t.paymentSource, paymentMethodId: t.paymentMethodId, paymentApp: t.paymentApp, note: t.note,
      originalAmount: t.originalAmount, originalCurrency: t.originalCurrency,
    })
    onClose()
  }

  const makeRecurring = (cadence: RecurringCadence) => {
    setPickRepeat(false)
    const next = advance(t.timestamp, cadence, d.getDate())
    const r = createRecurringRule({
      paymentAmount: t.paymentAmount, paymentType: t.paymentType, paymentReceiver: t.paymentReceiver, paymentCategory: t.paymentCategory,
      paymentSource: t.paymentSource, paymentMethodId: t.paymentMethodId, paymentApp: t.paymentApp, note: t.note,
      originalAmount: t.originalAmount, originalCurrency: t.originalCurrency,
    }, cadence, next, d.getDate())
    updateTransaction(t.id, { recurringId: r.id })
    buzz(12)
    const nd = new Date(next)
    toast('Now repeating', `${t.paymentReceiver} · ${CADENCES.find((c) => c.key === cadence)!.label.toLowerCase()}, next on ${nd.getDate()} ${monthShort(nd.getMonth())}`)
  }

  const stopRecurring = () => {
    if (rule) write(KEYS.recurringRules, rules.map((r) => (r.id === rule.id ? { ...r, enabled: false } : r)))
    updateTransaction(t.id, { recurringId: undefined })
    toast('Stopped repeating', t.paymentReceiver)
  }

  const attach = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      saveReceipt(t.id, await compressImage(file))
      buzz(12)
      toast('Receipt attached')
    } catch (e) {
      toast('Could not add photo', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const guess = !person && t.paymentType ? suggest(t.paymentReceiver, candidates) : undefined
  const acceptGuess = () => {
    if (!guess) return
    const p = personFor(guess)
    const n = linkTransaction(t, p.id, { rememberName: true, includePast: true })
    buzz(10)
    toast(`Linked to ${p.name}`, n > 1 ? `${n} payments named “${t.paymentReceiver}” linked` : 'Future ones will link too')
  }
  const which = !t.appChosen && t.paymentType === 'DEBIT' ? ambiguousApp(t.paymentReceiver) : null
  const chooseApp = (o: { label: string; category?: string }) => {
    buzz(8)
    updateTransaction(t.id, { paymentReceiver: o.label, appChosen: true, ...(o.category && t.paymentCategory === 'Others' ? { paymentCategory: o.category } : {}) })
    toast(`Marked as ${o.label}`)
  }
  const settle = person ? loanToSettle(t, person) : undefined
  const onBehalf = isOnBehalf(t)
  const funder = !onBehalf && !behalf && !t.loanId ? fundedBy(t, all) : null
  const funderPerson = funder ? people.find((p) => p.id === funder) : undefined
  const payback = !onBehalf && !behalf ? paybackFrom(t, all) : null
  // a friend who owes you in SplitMoney paying some or all of it back
  const splitBack = credit && !onBehalf && !behalf && !isTransferCategory(t.paymentCategory) ? splitPaybackFrom(t.paymentReceiver, t.paymentAmount, sp, spp, stx, srows) : null
  const advanceTx = onBehalf && person ? unmarkedAdvance(t, all) : null
  const paybackPerson = payback ? people.find((p) => p.id === payback.personId) : undefined
  const behalfWho = behalf?.personId ? people.find((p) => p.id === behalf.personId) : undefined
  const balanceText = (p: Person) => {
    const b = behalfBalance(p.id, all)
    return Math.abs(b) < 1 ? `All square with ${p.name}` : b > 0 ? `${formatPrice(b, { round: true })} of ${p.name}’s money still with you` : `${p.name} still owes you ${formatPrice(-b, { round: true })}`
  }
  const saveBehalf = (personId: string, part = t.paymentAmount) => {
    const p = people.find((x) => x.id === personId)
    // it was counted against a loan: take it out first (a repayment comes off the loan; money lent or borrowed ends the loan)
    if (t.loanId) detachTransactionFromLoans(t)
    const mine = markOnBehalf(t, personId, part)
    setBehalf(null)
    buzz(12)
    toast(credit ? `Money from ${p?.name ?? 'them'}` : `Paid for ${p?.name ?? 'them'}`, mine ? `${formatPrice(t.paymentAmount - part)} kept as your own ${t.paymentCategory}` : 'Not counted as your spending or income')
  }
  const link = (p: Person) => {
    setPickContact(false)
    const n = linkTransaction(t, p.id, { rememberName: remember, includePast: remember })
    buzz(10)
    toast(`Linked to ${p.name}`, remember && n > 1 ? `${n} payments to “${t.paymentReceiver}” linked` : p.relation ? `Filed under ${p.relation}` : undefined)
  }

  return (
    <>
    <Sheet open onClose={onClose}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="dim small" style={{ fontWeight: 600 }}>{credit ? 'Money in' : 'Money out'}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>

      <div className="col" style={{ alignItems: 'center', gap: 8, textAlign: 'center', margin: '4px 0 18px' }}>
        <div style={{ position: 'relative' }}>
          <BrandLogo src={merchantLogo(t.paymentReceiver)} size={68} radius={34} alt={t.paymentReceiver}
            fallback={<span className="letter-avatar" style={{ width: 68, height: 68, fontSize: 28, background: categoryColor(t.paymentCategory) }}>{(t.paymentReceiver.trim()[0] ?? '?').toUpperCase()}</span>} />
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, overflowWrap: 'anywhere' }}>{shownName(t)}</div>
        <div className="num" style={{ fontSize: 'clamp(32px, 10vw, 40px)', fontWeight: 800, letterSpacing: '-.02em', color: credit ? 'var(--credit)' : undefined }}>
          {credit ? '+' : ''}{money(t.paymentAmount)}
        </div>
        {t.originalCurrency && t.originalAmount && (
          <div className="muted small num">Paid {money(t.originalAmount, t.originalCurrency)} · converted to {currencySymbol()}</div>
        )}
      </div>

      <div className="card">
        <button className="list-row" style={{ alignItems: 'center' }} onClick={() => { setPickCategory((v) => !v); setLearned(null) }} aria-expanded={pickCategory}>
          <span className="legend-icon morph" key={t.paymentCategory} style={{ background: `${categoryColor(t.paymentCategory)}22`, color: categoryColor(t.paymentCategory) }}><Icon name={categoryIcon(t.paymentCategory)} size={15} /></span>
          <span className="muted small" style={{ flex: 'none' }}>Category</span>
          <span className="grow" style={{ textAlign: 'right', fontWeight: 600 }}>{t.paymentCategory}</span>
          <span className="chev" style={{ display: 'flex', transform: pickCategory ? 'rotate(90deg)' : undefined, transition: 'transform .2s' }}><Icon name="chevron" size={16} /></span>
        </button>
        {pickCategory && (
          <div className="row wrap" style={{ gap: 8, padding: '4px 16px 14px' }} role="listbox" aria-label="Choose a category">
            {catList.map((c) => (
              <button key={c} role="option" aria-selected={c === t.paymentCategory} className={`chip${c === t.paymentCategory ? ' on' : ''}`} onClick={() => changeCategory(c)}>
                <Icon name={categoryIcon(c)} size={14} />{c}
              </button>
            ))}
          </div>
        )}
        {learned && (
          <div className="row" style={{ padding: '2px 16px 14px', gap: 10 }} role="status">
            <span className="grow small muted">Always use <b style={{ color: 'var(--text)' }}>{learned.category}</b> for “{learned.payee}”?</span>
            <button className="btn sm" onClick={() => { learnRule(learned.payee, learned.category, learned.type); toast('Rule saved', `${learned.payee} → ${learned.category}`); setLearned(null) }}>Always</button>
            <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => setLearned(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
          </div>
        )}
        <DetailRow icon={<span className="legend-icon"><Icon name="calendar" size={15} /></span>}
          label="Date" value={t.timeUnknown ? date : `${date}, ${time}`} />
        {method && (
          <DetailRow icon={<AccountLogo m={method} size={28} />} label={credit ? 'Received in' : 'Paid from'}
            value={`${method.name}${method.last4 ? ` ••${method.last4}` : ''}`} />
        )}
        {!method && t.paymentSource && (
          <DetailRow icon={<span className="legend-icon"><Icon name={t.paymentSource === 'CASH' ? 'wallet' : t.paymentSource === 'BANK' ? 'bank' : 'card'} size={15} /></span>}
            label="Paid with" value={SOURCE_LABELS[t.paymentSource]} />
        )}
        {t.paymentApp && (
          <DetailRow icon={<BrandLogo src={appLogo(t.paymentApp)} size={28} radius={8} fallback={<span className="legend-icon"><Icon name="send" size={15} /></span>} />}
            label="Via" value={t.paymentApp} />
        )}
        {t.paymentType === 'DEBIT' && (t.business || shopOn) && (
          <div className="list-row" style={{ alignItems: 'center' }}>
            <span className="legend-icon"><Icon name="bag" size={15} /></span>
            <span className="grow small"><b>Shop cost</b> <span className="muted">(stock, rent, wages)</span><div className="dim tiny">Kept out of your personal spending plan</div></span>
            <Toggle on={!!t.business} onChange={(on) => { const n = setBusinessExpense(t.id, on); toast(on ? 'Counted as a shop cost' : 'Back to personal spending', n > 1 ? `${n} payments to this payee changed, and new ones will follow` : undefined) }} label="Shop cost" />
          </div>
        )}
        {isMerchantReceipt(t) && (
          <DetailRow icon={<span className="legend-icon"><Icon name="bank" size={15} /></span>} label="Bank payout"
            value={t.settledBy ? 'Paid out to your bank' : t.paymentMethodId ? 'Paid straight to your bank' : 'Waiting for the bank payout'} />
        )}
        {t.settlesIds && (
          <div className="list-row" style={{ alignItems: 'center' }}>
            <span className="legend-icon"><Icon name="bank" size={15} /></span>
            <span className="grow small muted">Payout for {t.settlesIds.length} sale{t.settlesIds.length === 1 ? '' : 's'} already counted as income, so this is not counted again.</span>
            <button className="chip" onClick={() => { undoPayout(t.id); toast('Back to income') }}>Not a payout</button>
          </div>
        )}
        {shopOn && credit && !t.settlesIds && !isMerchantReceipt(t) && !t.settleSkip && pendingSummary(all).count > 0 && (
          <div className="list-row" style={{ alignItems: 'center' }}>
            <span className="legend-icon"><Icon name="bank" size={15} /></span>
            <span className="grow small muted">{formatPrice(pendingSummary(all).total, { round: true })} of shop sales are waiting for a bank payout. Is this it?</span>
            <button className="chip on" onClick={() => { const r = markAsPayout(t.id); toast(r ? `Payout of ${r.covered} sale${r.covered === 1 ? '' : 's'}` : 'Could not mark it', r && r.leftover >= 1 ? `${formatPrice(r.leftover, { round: true })} had no notification, kept as income` : undefined) }}>It is a payout</button>
          </div>
        )}
        <button className="list-row" style={{ alignItems: 'center' }} onClick={() => setPickContact(true)}>
          {person ? <Avatar name={person.name} size={28} family={!!person.familyId} /> : <span className="legend-icon"><Icon name="users" size={15} /></span>}
          <span className="muted small" style={{ flex: 'none' }}>Contact</span>
          <span className="grow" style={{ textAlign: 'right', fontWeight: 600 }}>{person ? `${person.name}${person.relation ? ` · ${person.relation}` : ''}` : <span className="dim">Link a contact</span>}</span>
          <span className="chev" style={{ display: 'flex' }}><Icon name="chevron" size={16} /></span>
        </button>
        {which && (
          <div className="col" style={{ padding: '0 16px 12px', gap: 8 }} role="group" aria-label="Which app">
            <span className="small muted">Which app was this? The bank only wrote “{t.rawReceiver ?? t.paymentReceiver}”.</span>
            <div className="row" style={{ gap: 8 }}>{which.map((o) => (
              <button key={o.label} className="qchip grow" style={{ justifyContent: 'center' }} onClick={() => chooseApp(o)}>{o.label}</button>
            ))}</div>
          </div>
        )}
        {(() => {
          const inv = t.investmentId ? investments.find((x) => x.id === t.investmentId) : undefined
          const r = inv ? investmentResult(inv) : null
          return (
            <button className="list-row" style={{ alignItems: 'center' }} onClick={() => setPickInvest(true)}>
              <span className="legend-icon"><Icon name="trend" size={15} /></span>
              <span className="muted small" style={{ flex: 'none' }}>Investment</span>
              <span className="grow" style={{ textAlign: 'right', fontWeight: 600 }}>
                {inv && r ? <>{inv.name}<span className="small" style={{ display: 'block', color: r.profit >= 0 ? 'var(--credit)' : 'var(--danger)' }}>{r.profit >= 0 ? 'Profit' : 'Loss'} {formatPrice(Math.abs(r.profit), { round: true })} ({r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%) · {r.days}d</span></>
                  : <span className="dim">{credit ? 'Investment return?' : 'Mark as investment'}</span>}
              </span>
              <span className="chev" style={{ display: 'flex' }}><Icon name="chevron" size={16} /></span>
            </button>
          )
        })()}
        {!t.investmentId && !t.splitTxnId && (
          <div className="list-row" style={{ alignItems: 'center' }}>
            <span className="legend-icon"><Icon name="users" size={15} /></span>
            <span className="grow small"><b>{credit ? 'Money for someone else' : 'Paid for someone else'}</b>
              <div className="dim tiny">{onBehalf && person ? balanceText(person) : credit ? 'They gave it to spend for them, or paid you back' : 'With their money, or they will pay you back'}</div></span>
            <Toggle on={onBehalf || !!behalf} label={credit ? 'Money for someone else' : 'Paid for someone else'} onChange={(on) => {
              if (onBehalf && !on) { unmarkOnBehalf(t); toast(credit ? 'Back to your income' : 'Back to your spending', t.behalfFrom) }
              else if (on && loan) {
                confirm({ title: 'Take it out of the loan?', body: `This payment is counted in your loan with ${loan.person}. Marking it as money for someone else removes it from that loan. If the loan was only for this, delete it in Loans afterwards.`, confirm: 'Move it' })
                  .then((ok) => { if (ok) setBehalf({ personId: t.contactId ?? null, part: String(t.paymentAmount) }) })
              } else setBehalf(on ? { personId: t.contactId ?? null, part: String(t.paymentAmount) } : null)
            }} />
          </div>
        )}
        {behalf && (
          <div className="col" style={{ padding: '0 16px 14px', gap: 8 }} role="group" aria-label="Who it was for">
            <button className="qchip" style={{ justifyContent: 'center' }} onClick={() => setPickBehalf(true)}>
              {behalfWho ? <>{credit ? 'From' : 'For'} <b>{behalfWho.name}</b> · change</> : credit ? 'Who gave it?' : 'Who was it for?'}
            </button>
            <label className="row small muted" style={{ gap: 8 }}>
                <span className="grow">{credit ? 'Their money or payback (the rest is your income)' : 'Their part (the rest stays yours)'}</span>
                <input className="input num" inputMode="decimal" style={{ width: 120, textAlign: 'right' }} value={behalf.part} aria-label="Their part"
                  onChange={(e) => setBehalf({ ...behalf, part: e.target.value.replace(/[^0-9.]/g, '') })} />
            </label>
            <button className="btn sm" disabled={!behalf.personId || !(parseFloat(behalf.part) > 0) || parseFloat(behalf.part) > t.paymentAmount + 0.001}
              onClick={() => saveBehalf(behalf.personId!, Math.min(parseFloat(behalf.part), t.paymentAmount))}>Save</button>
          </div>
        )}
        {advanceTx && person && (
          <div className="row" style={{ padding: '0 16px 12px', gap: 10 }} role="status">
            <span className="grow small muted"><b style={{ color: 'var(--text)' }}>{person.name}</b> sent you {formatPrice(advanceTx.paymentAmount, { round: true })} on {new Date(advanceTx.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Was that their money for this?</span>
            <button className="btn sm" onClick={() => { markOnBehalf(advanceTx, person.id); buzz(12); toast(`${formatPrice(advanceTx.paymentAmount)} counted as ${person.name}’s money`, 'No longer your income') }}>Yes</button>
          </div>
        )}
        {splitBack && (
          <div className="row" style={{ padding: '0 16px 12px', gap: 10 }} role="status">
            <span className="grow small muted"><b style={{ color: 'var(--text)' }}>{splitBack.person.name}</b> owes you {formatPrice(splitBack.owed, { round: true })} in {splitBack.project.name}. Count this as settling it?</span>
            <button className="btn sm" onClick={() => {
              const self = spp.find((x) => x.projectId === splitBack.project.id && x.isCurrentUser)
              if (!self) return
              const left = settlePart(splitBack.project.id, splitBack.person.id, self.id, Math.min(t.paymentAmount, splitBack.owed), splitBack.owed)
              if (!left) clearNudges(splitBack.project.id, splitBack.person.id)
              updateTransaction(t.id, { paymentCategory: SPLIT })
              buzz(12); toast(`${splitBack.person.name} settled in ${splitBack.project.name}`, left ? `${formatPrice(left)} still to come` : 'All square')
            }}>Yes</button>
          </div>
        )}
        {payback && paybackPerson && (
          <div className="row" style={{ padding: '0 16px 12px', gap: 10 }} role="status">
            <span className="grow small muted"><b style={{ color: 'var(--text)' }}>{paybackPerson.name}</b> owes you {formatPrice(payback.owed, { round: true })} for things you paid for. Count this as paying you back?</span>
            <button className="btn sm" onClick={() => saveBehalf(paybackPerson.id, Math.min(t.paymentAmount, payback.owed))}>Yes</button>
          </div>
        )}
        {funderPerson && (
          <div className="row" style={{ padding: '0 16px 12px', gap: 10 }} role="status">
            <span className="grow small muted">Bought with <b style={{ color: 'var(--text)' }}>{funderPerson.name}</b>’s money? {formatPrice(behalfBalance(funderPerson.id, all), { round: true })} they gave you is still unspent.</span>
            <button className="btn sm" onClick={() => saveBehalf(funderPerson.id)}>Yes</button>
          </div>
        )}
        {settle && person && (
          <div className="row" style={{ padding: '0 16px 12px', gap: 10 }} role="status">
            <span className="grow small muted">{settle.direction === 'LENT' ? `${person.name} owes you` : `You owe ${person.name}`} <b style={{ color: 'var(--text)' }}>{formatPrice(outstanding(settle), { round: true })}</b>. Count this as paying it back?</span>
            <button className="btn sm" onClick={() => { settleWithTransaction(t, settle.id); buzz(12); toast('Loan updated', `${formatPrice(Math.min(t.paymentAmount, outstanding(settle)))} counted against ${person.name}`) }}>Settle</button>
          </div>
        )}
        {guess && (
          <div className="row" style={{ padding: '0 16px 12px', gap: 10 }} role="status">
            <span className="grow small muted">Is this <b style={{ color: 'var(--text)' }}>{guess.name}</b> from your contacts?</span>
            <button className="btn sm" onClick={acceptGuess}>Yes</button>
            <button className="qchip" onClick={() => { rejectSuggestion(t.paymentReceiver, guess); refresh((n) => n + 1) }}>No</button>
          </div>
        )}
        {person
          ? <div className="row" style={{ padding: '0 16px 12px', justifyContent: 'flex-end' }}><button className="small dim" onClick={() => { unlinkTransaction(t.id); toast('Contact removed') }}>Unlink {person.name}</button></div>
          : looksLikePerson(t.paymentReceiver, t.paymentCategory) && <div className="row" style={{ padding: '0 16px 12px', gap: 10 }}><span className="grow small muted">Also link past and future payments named “{t.paymentReceiver}”</span><Toggle on={remember} onChange={setRemember} label="Remember this name" /></div>}
        {noteText && <DetailRow icon={<span className="legend-icon"><Icon name="message" size={15} /></span>} label="Note" value={noteText} />}
        {tags.length > 0 && (
          <DetailRow icon={<span className="legend-icon"><Icon name="tag" size={15} /></span>} label="Tags"
            value={<span className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>{tags.map((x) => <span key={x} className="pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{x}</span>)}</span>} />
        )}
        {t.recurringId && (
          <DetailRow icon={<span className="legend-icon"><Icon name="repeat" size={15} /></span>} label="Repeats"
            value={rule ? `${CADENCES.find((c) => c.key === rule.cadence)!.label}${rule.enabled ? '' : ' · paused'}` : 'Added automatically'} />
        )}
        {loan && <DetailRow icon={<span className="legend-icon"><Icon name="users" size={15} /></span>} label={loan.direction === 'LENT' ? 'Lent to' : 'Borrowed from'} value={loan.person} />}
        {t.autoCaptured && <DetailRow icon={<span className="legend-icon"><Icon name="bell" size={15} /></span>} label="Source" value={t.seenIn?.length === 2 ? 'Payment screen, confirmed by the bank message' : t.seenIn?.[0] === 'screen' ? 'Payment screen, waiting for the bank message' : 'Auto-captured from a notification'} />}
      </div>

      {receipt && (
        <button className="card" style={{ display: 'block', width: '100%', marginTop: 12, padding: 0 }} onClick={() => setViewReceipt(true)} aria-label="View receipt photo">
          <img src={receipt} alt="Receipt" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', display: 'block' }} />
          <span className="row small muted" style={{ padding: '8px 14px', gap: 6 }}><Icon name="image" size={14} />Receipt · tap to view</span>
        </button>
      )}

      <div className="act-grid" role="group" aria-label="Actions">
        {!credit && !t.splitTxnId && <button className="act-btn" onClick={() => { setSplitIntent(t.id); onClose(); onEdit(t) }}><Icon name="split" size={18} />Split this</button>}
        <button className="act-btn" onClick={duplicate}><Icon name="plus" size={18} />Duplicate</button>
        {rule?.enabled
          ? <button className="act-btn" onClick={stopRecurring}><Icon name="repeat" size={18} />Stop repeating</button>
          : <button className="act-btn" onClick={() => setPickRepeat((v) => !v)} aria-expanded={pickRepeat}><Icon name="repeat" size={18} />Repeat</button>}
        <button className="act-btn" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="image" size={18} />{busy ? 'Adding…' : receipt ? 'Replace photo' : 'Add receipt'}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {pickRepeat && (
        <div className="row" style={{ marginTop: 10, gap: 8 }} role="group" aria-label="How often">
          {CADENCES.map((c) => <button key={c.key} className="qchip grow" style={{ justifyContent: 'center' }} onClick={() => makeRecurring(c.key)}>{c.label}</button>)}
        </div>
      )}

      {same.length > 1 && (
        <div className="card pad" style={{ marginTop: 14 }}>
          <div className="row between" style={{ marginBottom: 12 }}>
            <b className="small">{credit ? 'From' : 'To'} {groupName}</b>
            <span className="muted small">{same.length} {credit ? 'times' : 'payments'} · {money(sameTotal)}</span>
          </div>
          <div className="hist" role="img" aria-label={`Last 6 months: ${history.map((h) => `${monthShort(h.m)} ${hidden ? 'hidden' : formatPrice(h.total, { round: true })}`).join(', ')}`}>
            {history.map((h, i) => (
              <div key={`${h.y}-${h.m}`} className="hist-col">
                <div className="hist-bar-wrap"><div className={`hist-bar${i === history.length - 1 ? ' now' : ''}`} style={{ height: `${h.total ? Math.max(6, (h.total / histMax) * 100) : 0}%` }} /></div>
                <span className="tiny dim">{monthShort(h.m)}</span>
              </div>
            ))}
          </div>
          {histAvg > 0 && <div className="dim tiny" style={{ marginTop: 8, textAlign: 'center' }}>Average {money(histAvg)} in the months you {credit ? 'received' : 'paid'}</div>}
        </div>
      )}
      <div className="dim tiny" style={{ textAlign: 'center', marginTop: 12 }}>Added {new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn danger grow" onClick={remove}><Icon name="trash" size={18} />Delete</button>
        <button className="btn grow" onClick={() => { onClose(); onEdit(t) }}><Icon name="edit" size={18} />Edit</button>
      </div>

      {viewReceipt && receipt && createPortal(
        <div className="receipt-view" role="dialog" aria-modal aria-label="Receipt photo">
          <div className="row between" style={{ padding: '14px 16px' }}>
            <button className="icon-btn" onClick={() => setViewReceipt(false)} aria-label="Close photo"><Icon name="close" size={18} /></button>
            <button className="pill-btn" style={{ color: 'var(--danger)' }} onClick={() => { removeReceipt(t.id); setViewReceipt(false); toast('Receipt removed') }}><Icon name="trash" size={15} />Remove</button>
          </div>
          <img src={receipt} alt="Receipt" style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'contain' }} />
        </div>,
        document.body,
      )}
    </Sheet>
    {pickInvest && <InvestmentLink tx={t} onClose={() => setPickInvest(false)} />}
    <ContactPicker open={pickContact} onClose={() => setPickContact(false)} onPick={link} title={credit ? 'Who sent this?' : 'Who was this for?'} />
    <ContactPicker open={pickBehalf} onClose={() => setPickBehalf(false)} onPick={(p) => { setPickBehalf(false); setBehalf((b) => b && { ...b, personId: p.id }) }} title={credit ? 'Whose money is this?' : 'Who did you pay for?'} />
    </>
  )
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      <span style={{ display: 'flex', flex: 'none' }}>{icon}</span>
      <span className="muted small" style={{ flex: 'none', paddingTop: 6 }}>{label}</span>
      <span className="grow" style={{ textAlign: 'right', paddingTop: 5, overflowWrap: 'anywhere', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
