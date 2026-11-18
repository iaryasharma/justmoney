import { useState } from 'react'
import BrandLogo from '../components/ui/BrandLogo'
import AccountLogo from '../components/ui/AccountLogo'
import { bankLogo, networkLogo, NETWORK_LABELS } from '../lib/payees/brands'
import { Icon, PageHeader, Sheet, SheetHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { useStored, uid, KEYS } from '../lib/core/storage'
import { frozenFor } from '../lib/accounts/holds'
import { mergeAccount } from '../lib/capture/statementImport'
import { addTransaction, METHOD_COLORS, MAX_METHODS, SOURCE_LABELS } from '../lib/core/data'
import { formatPrice, ordinal, toLocalInput } from '../lib/core/format'
import {
  accountBalance, applySalarySettings, BANKS, cardAccount, cardSpentThisMonth, detectBank, isTransferCategory, nextPayday, openingNow, SELF_TRANSFER, tracksBalance,
} from '../lib/accounts/accounts'
import type { CardNetwork, Hold, PaymentMethod, PaymentSource, SalarySettings, Transaction, User } from '../lib/core/types'

const DEFAULT_SALARY: SalarySettings = { accountId: null, day: 1, autoAdd: true }

/** Bank accounts, cards and cash with live balances, salary payday, and self transfers. */
export default function AccountsPage({ onBack }: { onBack: () => void }) {
  const [methods, setMethods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [holds] = useStored<Hold[]>(KEYS.holds, [])
  const [salary] = useStored<SalarySettings>(KEYS.salary, DEFAULT_SALARY)
  const [user] = useStored<User | null>(KEYS.user, null)
  const [sheet, setSheet] = useState<null | 'add' | 'transfer' | 'salary'>(null)
  const [balanceFor, setBalanceFor] = useState<PaymentMethod | null>(null)
  const [mergeFrom, setMergeFrom] = useState<string | null>(null)
  const confirm = useConfirm()
  const toast = useToast()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const banks = methods.filter(tracksBalance)
  const total = banks.reduce((a, m) => a + accountBalance(m, txns), 0)
  const salaryAcc = methods.find((m) => m.id === salary.accountId)

  return (
    <div className="page">
      <PageHeader title="Accounts & cards" onBack={onBack} right={<button className="btn sm" onClick={() => methods.length >= MAX_METHODS ? toast(`Maximum ${MAX_METHODS} reached`) : setSheet('add')}><Icon name="plus" size={16} /> Add</button>} />

      {banks.length > 0 && (
        <div className="card pad">
          <div className="label">Total in bank accounts</div>
          <div className="big-amount" style={{ fontSize: 34 }}>{formatPrice(total, { round: true })}</div>
          {banks.length > 1 && <button className="btn sm secondary" style={{ marginTop: 10 }} onClick={() => setSheet('transfer')}><Icon name="repeat" size={16} /> Move money between accounts</button>}
        </div>
      )}

      <button className="card pad row" style={{ width: '100%', textAlign: 'left', marginTop: 10 }} onClick={() => setSheet('salary')}>
        <Icon name="calendar" />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Salary</div>
          <div className="dim small">
            {salaryAcc
              ? `${formatPrice(user?.monthly_income ?? 0, { round: true })} on the ${ordinal(salary.day)} → ${salaryAcc.name}${salary.autoAdd ? ' · added automatically' : ''}`
              : 'Set which account your salary comes to, and when'}
          </div>
        </div>
        <Icon name="chevron" size={18} />
      </button>

      <div className="col" style={{ marginTop: 14 }}>
        {methods.length === 0 && <div className="empty"><b>No accounts yet</b>Add your bank accounts (e.g. Kotak, UCO) with their current balance, plus cards and cash. Payments from SMS and screenshots are matched to them automatically.</div>}
        {methods.map((m) => {
          const count = txns.filter((t) => t.paymentMethodId === m.id).length
          const spent = txns.filter((t) => t.paymentMethodId === m.id && t.paymentType === 'DEBIT' && !isTransferCategory(t.paymentCategory) && t.timestamp >= monthStart).reduce((a, t) => a + t.paymentAmount, 0)
          const bal = tracksBalance(m) ? accountBalance(m, txns) : null
          return (
            <div key={m.id} className="card pad col" style={{ gap: 8, background: `linear-gradient(135deg, ${m.color}33, transparent 70%)` }}>
              <div className="row">
                <AccountLogo m={m} size={40} />
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{m.name}{m.last4 ? <span className="dim"> ••{m.last4}</span> : null}</div>
                  <div className="dim small">{SOURCE_LABELS[m.type]}{m.bank ? ` · ${m.bank}` : ''} · {count} transaction{count === 1 ? '' : 's'}{salary.accountId === m.id ? ' · salary account' : ''}</div>
                </div>
                {count > 0 && methods.some((x) => x.id !== m.id && x.type === m.type) && (
                  <button className="dim" aria-label="Move into another account" onClick={() => setMergeFrom(mergeFrom === m.id ? null : m.id)}><Icon name="repeat" size={18} /></button>
                )}
                <button className="dim" aria-label="Remove" onClick={async () => { if (await confirm({ title: `Remove "${m.name}"?`, body: 'Existing transactions linked to it keep the reference.', confirm: 'Remove', danger: true })) setMethods(methods.filter((x) => x.id !== m.id)) }}><Icon name="trash" size={18} /></button>
              </div>
              {mergeFrom === m.id && (
                <div className="col" style={{ gap: 6 }}>
                  <div className="small">Move its {count} transaction{count === 1 ? '' : 's'} into:</div>
                  <div className="chips">
                    {methods.filter((x) => x.id !== m.id && x.type === m.type).map((x) => (
                      <button key={x.id} className="chip" onClick={async () => {
                        if (!(await confirm({ title: `Move into ${x.name}?`, body: `All of ${m.name}'s transactions move to ${x.name} and ${m.name} is removed. The more recently set balance is kept.`, confirm: 'Move' }))) return
                        mergeAccount(m.id, x.id); setMergeFrom(null); toast('Accounts merged', `${count} transactions now in ${x.name}`)
                      }}><AccountLogo m={x} size={16} />{x.name}{x.last4 ? ` ••${x.last4}` : ''}</button>
                    ))}
                  </div>
                </div>
              )}
              {(m.type === 'DEBIT_CARD' || m.type === 'CREDIT_CARD') && <NetworkPicker value={m.network ?? null} onChange={(n) => setMethods(methods.map((x) => (x.id === m.id ? { ...x, network: n } : x)))} />}
              {bal !== null ? (
                <div className="row between">
                  <div><div className="label">Balance</div><div className="h2 num" style={{ color: bal < 0 ? 'var(--danger)' : undefined }}>{formatPrice(bal)}</div>
                    {frozenFor(new Set([m.id]), holds) > 0 && <div className="dim tiny" style={{ marginTop: 2 }}>{formatPrice(frozenFor(new Set([m.id]), holds))} held for an IPO / mandate, already taken out of this</div>}</div>
                  <button className="chip" style={{ height: 30 }} onClick={() => setBalanceFor(m)}>Set balance</button>
                </div>
              ) : m.type === 'DEBIT_CARD' ? (
                <DebitCardLink card={m} methods={methods} spent={spent} onLink={(id) => setMethods(methods.map((x) => (x.id === m.id ? { ...x, linkedAccountId: id, openingBalance: null, openingDate: null } : x)))} />
              ) : m.type === 'CREDIT_CARD' ? (
                <div className="small">Spent this month: <b className="num">{formatPrice(cardSpentThisMonth(m, txns), { round: true })}</b></div>
              ) : (
                <div className="row between small"><span>This month: <b className="num">{formatPrice(spent, { round: true })}</b></span>
                  <button className="link small" onClick={() => setBalanceFor(m)}>Track balance</button></div>
              )}
            </div>
          )
        })}
      </div>
      <p className="dim tiny" style={{ marginTop: 12, lineHeight: 1.5 }}>Balance = what you set + money in − money out since. If it drifts from your bank, tap “Set balance”.</p>

      <AccountSheet open={sheet === 'add'} onClose={() => setSheet(null)} usedColors={methods.map((m) => m.color)} accounts={methods}
        onSave={(m) => { setMethods([...methods, m]); toast(`${m.name} added`, tracksBalance(m) ? `Balance ${formatPrice(m.openingBalance ?? 0)}` : undefined) }} />
      <BalanceSheet account={balanceFor} txns={txns} onClose={() => setBalanceFor(null)}
        onSave={(m, value) => { setMethods(methods.map((x) => (x.id === m.id ? { ...x, openingBalance: value, openingDate: openingNow() } : x))); toast('Balance updated', `${m.name}: ${formatPrice(value)}`) }} />
      <TransferSheet open={sheet === 'transfer'} onClose={() => setSheet(null)} accounts={banks} />
      <SalarySheet open={sheet === 'salary'} onClose={() => setSheet(null)} accounts={methods.filter((m) => m.type === 'BANK')} value={salary} income={user?.monthly_income ?? 0} />
    </div>
  )
}

function AccountSheet({ open, onClose, onSave, usedColors, accounts }: { open: boolean; onClose: () => void; onSave: (m: PaymentMethod) => void; usedColors: string[]; accounts: PaymentMethod[] }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<PaymentSource>('BANK')
  const [bank, setBank] = useState<string | null>(null)
  const [last4, setLast4] = useState('')
  const [balance, setBalance] = useState('')
  const [linkedTo, setLinkedTo] = useState<string | null>(null) // debit card → bank account
  const [network, setNetwork] = useState<CardNetwork | null>(null)
  const bankAccounts = accounts.filter((m) => m.type === 'BANK')
  const sameBank = bankAccounts.filter((m) => bank && (m.bank ?? detectBank(m.name)) === bank)
  const spendsFrom = linkedTo ?? (sameBank.length === 1 ? sameBank[0].id : null)
  const [color, setColor] = useState(METHOD_COLORS.find((c) => !usedColors.includes(c)) ?? METHOD_COLORS[0])
  const reset = () => { setName(''); setBank(null); setLast4(''); setBalance(''); setLinkedTo(null); setNetwork(null) }
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Add an account</>} onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        const card = type === 'DEBIT_CARD' && !!spendsFrom
        const hasBal = type !== 'CREDIT_CARD' && !card && balance.trim() !== ''
        onSave({
          id: uid(), name: name.trim(), type, last4: last4 || undefined, color, createdAt: Date.now(),
          bank: bank ?? detectBank(name), openingBalance: hasBal ? Number(balance) || 0 : null, openingDate: hasBal ? openingNow() : null,
          linkedAccountId: card ? spendsFrom : null,
          network: type === 'DEBIT_CARD' || type === 'CREDIT_CARD' ? network : null,
        })
        reset(); onClose()
      }}>
        <div className="row wrap" style={{ gap: 8 }}>{(Object.keys(SOURCE_LABELS) as PaymentSource[]).map((t) => <button type="button" key={t} className={`chip${type === t ? ' on' : ''}`} onClick={() => setType(t)}>{SOURCE_LABELS[t]}</button>)}</div>
        {type !== 'CASH' && (
          <div className="field"><label>Bank</label>
            <div className="chips">{BANKS.slice(0, 14).map((b) => <button type="button" key={b.short} className={`chip${bank === b.short ? ' on' : ''}`} onClick={() => { setBank(b.short); if (!name) setName(type === 'CREDIT_CARD' ? `${b.short} Credit Card` : b.short) }}><BrandLogo src={bankLogo(b.short)} size={16} radius={4} />{b.short}</button>)}</div>
          </div>
        )}
        <input className="input" value={name} onChange={(e) => { setName(e.target.value); if (!bank) setBank(detectBank(e.target.value)) }} placeholder={type === 'CASH' ? 'e.g. Wallet cash' : 'e.g. Kotak Savings'} />
        {type !== 'CASH' && <input className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder={type === 'BANK' ? 'Last 4 digits of account no. (helps match SMS)' : 'Last 4 digits of card'} />}
        {(type === 'DEBIT_CARD' || type === 'CREDIT_CARD') && <NetworkPicker value={network} onChange={setNetwork} />}
        {type === 'DEBIT_CARD' && bankAccounts.length > 0 && (
          <div className="field"><label>Spends from</label>
            <div className="chips">
              {bankAccounts.map((m) => (
                <button type="button" key={m.id} className={`chip${spendsFrom === m.id ? ' on' : ''}`} onClick={() => { setLinkedTo(m.id); if (!bank) setBank(m.bank ?? detectBank(m.name)) }}>
                  <AccountLogo m={m} size={16} />{m.name}{m.last4 ? ` ••${m.last4}` : ''}
                </button>
              ))}
            </div>
            <div className="dim tiny">The card uses this account's money, so it has no balance of its own. Payments with the card number in an SMS are matched to it.</div>
          </div>
        )}
        {type !== 'CREDIT_CARD' && !(type === 'DEBIT_CARD' && spendsFrom) && (
          <div className="field"><label>Current balance</label>
            <input className="input num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value.replace(/[^0-9.-]/g, ''))} placeholder="e.g. 42,300 — leave empty to skip balance tracking" />
          </div>
        )}
        <div className="row wrap" style={{ gap: 10 }}>{METHOD_COLORS.map((c) => <button type="button" key={c} aria-label={c} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 15, background: c, outline: color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />)}</div>
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}

/** Visa, Mastercard or RuPay: the card's logo is then shown beside its payments. */
function NetworkPicker({ value, onChange }: { value: CardNetwork | null; onChange: (n: CardNetwork | null) => void }) {
  return (
    <div className="field"><label>Card type</label>
      <div className="chips">
        {(['VISA', 'MASTERCARD', 'RUPAY'] as CardNetwork[]).map((n) => (
          <button type="button" key={n} className={`chip${value === n ? ' on' : ''}`} onClick={() => onChange(value === n ? null : n)}><BrandLogo src={networkLogo(n)} size={16} radius={4} />{NETWORK_LABELS[n]}</button>
        ))}
      </div>
    </div>
  )
}

/** A debit card shows the account it spends from; unlinked cards can be linked here. */
function DebitCardLink({ card, methods, spent, onLink }: { card: PaymentMethod; methods: PaymentMethod[]; spent: number; onLink: (id: string) => void }) {
  const acc = cardAccount(card, methods)
  const [picking, setPicking] = useState(false)
  const banks = methods.filter((m) => m.type === 'BANK')
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between small">
        <span>{acc ? <>Spends from <b>{acc.name}{acc.last4 ? ` ••${acc.last4}` : ''}</b></> : 'Not linked to a bank account'}</span>
        {banks.length > 0 && <button className="link small" onClick={() => setPicking(!picking)}>{acc ? 'Change' : 'Link'}</button>}
      </div>
      <div className="small">This month: <b className="num">{formatPrice(spent, { round: true })}</b></div>
      {picking && (
        <div className="chips">
          {banks.map((b) => <button key={b.id} className={`chip${acc?.id === b.id ? ' on' : ''}`} onClick={() => { onLink(b.id); setPicking(false) }}><AccountLogo m={b} size={16} />{b.name}</button>)}
        </div>
      )}
    </div>
  )
}

function BalanceSheet({ account, txns, onClose, onSave }: { account: PaymentMethod | null; txns: Transaction[]; onClose: () => void; onSave: (m: PaymentMethod, v: number) => void }) {
  const [value, setValue] = useState('')
  const current = account && tracksBalance(account) ? accountBalance(account, txns) : null
  return (
    <Sheet open={!!account} onClose={onClose}>
      <SheetHeader title={<>Balance in {account?.name}</>} sub="Type what your bank app shows right now. Transactions from now on will move it." onClose={onClose} />
      <form className="col" onSubmit={(e) => { e.preventDefault(); if (!account || value.trim() === '') return; onSave(account, Number(value) || 0); setValue(''); onClose() }}>
        {current !== null && <div className="muted small">JustMoney currently shows {formatPrice(current)}</div>}
        <input className="input num" autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.-]/g, ''))} placeholder="Current balance" />
        <button className="btn block">Save balance</button>
      </form>
    </Sheet>
  )
}

function TransferSheet({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: PaymentMethod[] }) {
  const toast = useToast()
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [when, setWhen] = useState(toLocalInput(Date.now()))
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Move money</>} sub="Between your own accounts — not counted as spending or income." onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        const a = Number(amount)
        const f = accounts.find((m) => m.id === from), t = accounts.find((m) => m.id === to)
        if (!f || !t || f.id === t.id || !(a > 0)) return
        const ts = new Date(when).getTime() || Date.now()
        addTransaction({ paymentAmount: a, paymentType: 'DEBIT', paymentReceiver: `To ${t.name}`, paymentCategory: SELF_TRANSFER, paymentMethodId: f.id, timestamp: ts })
        addTransaction({ paymentAmount: a, paymentType: 'CREDIT', paymentReceiver: `From ${f.name}`, paymentCategory: SELF_TRANSFER, paymentMethodId: t.id, timestamp: ts })
        toast('Moved', `${formatPrice(a)}: ${f.name} → ${t.name}`)
        setAmount(''); onClose()
      }}>
        <div className="field"><label>From</label><div className="chips">{accounts.map((m) => <button type="button" key={m.id} className={`chip${from === m.id ? ' on' : ''}`} onClick={() => setFrom(m.id)}>{m.name}</button>)}</div></div>
        <div className="field"><label>To</label><div className="chips">{accounts.filter((m) => m.id !== from).map((m) => <button type="button" key={m.id} className={`chip${to === m.id ? ' on' : ''}`} onClick={() => setTo(m.id)}>{m.name}</button>)}</div></div>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" />
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button className="btn block">Move money</button>
      </form>
    </Sheet>
  )
}

function SalarySheet({ open, onClose, accounts, value, income }: { open: boolean; onClose: () => void; accounts: PaymentMethod[]; value: SalarySettings; income: number }) {
  const toast = useToast()
  const [acc, setAcc] = useState<string | null>(value.accountId)
  const [day, setDay] = useState(value.day)
  const [auto, setAuto] = useState(value.autoAdd)
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Salary</>} sub={income ? `${formatPrice(income)} a month (from your profile)` : 'Add your monthly income in Planner → Income first.'} onClose={onClose} />
      <div className="col" style={{ gap: 14 }}>
        <div className="field"><label>Comes to</label>
          {accounts.length ? <div className="chips">{accounts.map((m) => <button key={m.id} className={`chip${acc === m.id ? ' on' : ''}`} onClick={() => setAcc(m.id)}>{m.name}</button>)}</div>
            : <div className="dim small">Add a bank account first.</div>}
        </div>
        <div className="field"><label>On day</label>
          <div className="chips">{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button key={d} className={`chip${day === d ? ' on' : ''}`} style={{ minWidth: 44, justifyContent: 'center' }} onClick={() => setDay(d)}>{d}</button>)}</div>
        </div>
        <div className="row between"><div><div>Add it automatically on payday</div><div className="dim small">If the bank SMS for it also comes in, it's matched — not added twice.</div></div><Toggle on={auto} onChange={setAuto} label="Add salary automatically on payday" /></div>
        <button className="btn block" disabled={!acc} onClick={() => {
          applySalarySettings({ accountId: acc, day, autoAdd: auto })
          toast('Salary saved', auto && income ? `Next: ${new Date(nextPayday(day)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : undefined)
          onClose()
        }}>Save</button>
      </div>
    </Sheet>
  )
}
