import { useState } from 'react'
import { buzz, Icon, Sheet, SheetHeader, useToast } from '../ui/ui'
import { getCategories } from '../../lib/core/data'
import { formatPrice } from '../../lib/core/format'
import { cashInHand, markWithdrawal, setCashBalance, spendCash, withdrawCash, withdrawalsAsSpending } from '../../lib/accounts/cash'
import type { PaymentMethod, Transaction } from '../../lib/core/types'

type Mode = 'WITHDRAW' | 'SPEND' | 'SET'

/** Cash in hand: record a withdrawal, a cash spend, or correct the balance, and stop ATM withdrawals counting as spending. */
export default function CashSheet({ open, onClose, all, methods }: { open: boolean; onClose: () => void; all: Transaction[]; methods: PaymentMethod[] }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('SPEND')
  const [amount, setAmount] = useState('')
  const [payee, setPayee] = useState('')
  const [category, setCategory] = useState('Food')
  const [from, setFrom] = useState<string | null>(null)
  const cash = cashInHand(all)
  const banks = methods.filter((m) => m.type === 'BANK' || m.type === 'DEBIT_CARD')
  const asSpending = withdrawalsAsSpending(all)
  const a = parseFloat(amount)
  const valid = mode === 'SET' ? amount !== '' && a >= 0 : a > 0

  const save = () => {
    if (!valid) return
    buzz(12)
    if (mode === 'WITHDRAW') { withdrawCash(a, from ?? banks[0]?.id ?? null); toast(`${formatPrice(a)} added to cash`, 'Not counted as spending') }
    else if (mode === 'SPEND') { spendCash(a, payee, category); toast(`${formatPrice(a)} spent in cash`, payee.trim() || category) }
    else { setCashBalance(a, all); toast('Cash balance set', formatPrice(a)) }
    setAmount(''); setPayee('')
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title={<>Cash in hand</>} sub={`${formatPrice(cash.balance)} now · ${formatPrice(cash.withdrawn)} withdrawn, ${formatPrice(cash.spent)} spent`} onClose={onClose} />
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={mode === 'SPEND' ? 'on' : ''} onClick={() => setMode('SPEND')}>Spent</button>
        <button className={mode === 'WITHDRAW' ? 'on' : ''} onClick={() => setMode('WITHDRAW')}>Withdrew</button>
        <button className={mode === 'SET' ? 'on' : ''} onClick={() => setMode('SET')}>Set balance</button>
      </div>
      <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={mode === 'SET' ? 'Cash you have right now' : 'Amount'} aria-label="Amount" />
      {mode === 'SPEND' && (
        <>
          <input className="input" style={{ marginTop: 10 }} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="What for (optional)" aria-label="What for" />
          <div className="chips" style={{ marginTop: 10 }}>{getCategories().map((c) => <button key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        </>
      )}
      {mode === 'WITHDRAW' && banks.length > 1 && (
        <div className="field" style={{ marginTop: 10 }}><label>From</label><div className="chips">{banks.map((m) => <button key={m.id} className={`chip${(from ?? banks[0].id) === m.id ? ' on' : ''}`} onClick={() => setFrom(m.id)}>{m.name}</button>)}</div></div>
      )}
      <button className="btn block" style={{ marginTop: 14 }} disabled={!valid} onClick={save}>{mode === 'SPEND' ? 'Add cash spend' : mode === 'WITHDRAW' ? 'Add withdrawal' : 'Set balance'}</button>

      {asSpending.length > 0 && (
        <>
          <div className="section-label">ATM withdrawals counted as spending</div>
          <p className="dim small" style={{ marginTop: 0 }}>Taking cash out is moving your own money. Mark it so only what you spend in cash counts.</p>
          <div className="card">
            {asSpending.slice(0, 6).map((t) => (
              <div key={t.id} className="list-row">
                <div className="grow"><div>{t.paymentReceiver}</div><div className="dim small">{new Date(t.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div></div>
                <b className="num">{formatPrice(t.paymentAmount, { round: true })}</b>
                <button className="qchip" onClick={() => { markWithdrawal(t); toast('Not counted as spending') }}>Not spending</button>
              </div>
            ))}
          </div>
          {asSpending.length > 1 && <button className="btn block" style={{ marginTop: 10 }} onClick={() => { asSpending.forEach(markWithdrawal); toast(`${asSpending.length} withdrawals marked`, 'No longer counted as spending') }}><Icon name="check" size={18} />Mark all {asSpending.length}</button>}
        </>
      )}
    </Sheet>
  )
}
