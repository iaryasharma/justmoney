import { useMemo, useState } from 'react'
import { Icon } from '../ui/ui'
import BrandLogo from '../ui/BrandLogo'
import { merchantLogo } from '../../lib/payees/brands'
import { isTransferCategory } from '../../lib/accounts/accounts'
import { formatPrice } from '../../lib/core/format'
import { useStored, KEYS } from '../../lib/core/storage'
import type { Transaction } from '../../lib/core/types'

const DAY = 86400000

/**
 * Payments already in the list that could be this money: same direction, not yet a loan, split, transfer or money for someone,
 * from the last few weeks. Closest amount first, then the newest. The bank message usually added it already, so recording
 * a loan or a settle-up links to it instead of adding the same money a second time.
 */
export function paymentCandidates(all: Transaction[], type: 'DEBIT' | 'CREDIT', amount: number, near = Date.now(), days = 30) {
  return all
    .filter((t) => t.paymentType === type && !t.loanId && !t.splitTxnId && !isTransferCategory(t.paymentCategory) && Math.abs(t.timestamp - near) <= days * DAY)
    .map((t) => ({ t, off: amount > 0 ? Math.abs(t.paymentAmount - amount) / amount : 0 }))
    .sort((a, b) => a.off - b.off || b.t.timestamp - a.t.timestamp)
    .map((x) => x.t)
}

/** "Already in your list?": pick the payment this money came in (or went out) as, or leave it to add a new entry. */
export default function PaymentPick({ type, amount, near, value, onChange, label }: {
  type: 'DEBIT' | 'CREDIT'; amount: number; near?: number; value: string | null; onChange: (id: string | null) => void; label?: string
}) {
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  const [open, setOpen] = useState(false)
  const list = useMemo(() => paymentCandidates(all, type, amount, near), [all, type, amount, near])
  const chosen = value ? all.find((t) => t.id === value) : undefined
  const day = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  if (!list.length && !chosen) return null
  return (
    <div className="card" role="group" aria-label={label ?? 'Link a payment already in your list'}>
      <button type="button" className="list-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="legend-icon"><Icon name="receipt" size={15} /></span>
        <span className="grow small" style={{ textAlign: 'left' }}>
          <b>{label ?? 'Already in your list?'}</b>
          <div className="dim tiny">{chosen ? `Linked: ${chosen.paymentReceiver} · ${formatPrice(chosen.paymentAmount)} · ${day(chosen.timestamp)}` : 'Pick the payment so it is not added twice'}</div>
        </span>
        <span className="chev" style={{ display: 'flex', transform: open ? 'rotate(90deg)' : undefined }}><Icon name="chevron" size={16} /></span>
      </button>
      {open && (
        <div role="listbox" aria-label="Payments">
          <button type="button" role="option" aria-selected={!value} className={`list-row${!value ? ' on' : ''}`} onClick={() => { onChange(null); setOpen(false) }}>
            <span className="grow small" style={{ textAlign: 'left' }}>None of these · add a new entry</span>
            {!value && <Icon name="check" size={16} />}
          </button>
          {list.slice(0, 8).map((t) => (
            <button type="button" role="option" aria-selected={value === t.id} key={t.id} className="list-row" onClick={() => { onChange(t.id); setOpen(false) }}>
              <BrandLogo src={merchantLogo(t.paymentReceiver)} size={28} radius={14} alt="" fallback={<span className="letter-avatar" style={{ width: 28, height: 28, fontSize: 13 }}>{(t.paymentReceiver[0] ?? '?').toUpperCase()}</span>} />
              <span className="grow small" style={{ textAlign: 'left' }}>{t.paymentReceiver}<div className="dim tiny">{day(t.timestamp)} · {t.paymentCategory}</div></span>
              <b className="num small" style={{ color: type === 'CREDIT' ? 'var(--credit)' : 'var(--up)' }}>{formatPrice(t.paymentAmount)}</b>
              {value === t.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
