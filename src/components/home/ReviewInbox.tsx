import { useState } from 'react'
import BrandLogo from '../ui/BrandLogo'
import { buzz, Icon, Sheet, SheetHeader, useToast } from '../ui/ui'
import { merchantLogo } from '../../lib/payees/brands'
import { categoryColor, categoryIcon, updateTransaction, withFamily } from '../../lib/core/data'
import { INCOME_CATEGORIES } from '../../lib/core/money'
import { formatPrice } from '../../lib/core/format'
import { useStored, KEYS } from '../../lib/core/storage'
import { isUnnamed, payeeSuggestions } from '../../lib/payees/payeeGuess'
import { learnNumber } from '../../lib/notify/alerts'
import type { Transaction } from '../../lib/core/types'

export const needsReview = (all: Transaction[]) => all.filter((t) => t.autoCaptured && !t.reviewed).sort((a, b) => b.timestamp - a.timestamp)

/** Home banner: "3 auto-captured payments need a look". */
export function ReviewBanner({ all, onOpen }: { all: Transaction[]; onOpen: () => void }) {
  const n = needsReview(all).length
  if (!n) return null
  return (
    <button className="card mini-card" onClick={onOpen}>
      <span className="icon-tile" style={{ background: 'rgba(255,149,0,.15)', color: '#FF9500' }}><Icon name="bell" size={20} /></span>
      <span className="grow"><b>{n} captured payment{n === 1 ? '' : 's'} to check</b></span>
      <span className="chev"><Icon name="chevron" size={18} /></span>
    </button>
  )
}

/** Approve or fix auto-captured payments in one place. */
export function ReviewSheet({ open, all, onClose }: { open: boolean; all: Transaction[]; onClose: () => void }) {
  const toast = useToast()
  const [categories] = useStored<string[] | null>(KEYS.categories, null)
  const [editing, setEditing] = useState<string | null>(null)
  const [naming, setNaming] = useState<Record<string, string>>({})
  const list = needsReview(all).slice(0, 40)
  const approve = (t: Transaction) => { buzz(8); updateTransaction(t.id, { reviewed: true }) }
  const approveAll = () => { list.forEach((t) => updateTransaction(t.id, { reviewed: true })); toast(`${list.length} approved`); onClose() }
  // the bank gave no name: say who it was, and the category follows what that name was filed under before
  const nameIt = (t: Transaction, name: string) => {
    const n = name.trim(); if (!n) return
    const before = all.find((x) => x.id !== t.id && !isUnnamed(x) && x.paymentReceiver === n && x.paymentType === t.paymentType)
    buzz(8)
    if (t.payeeId) learnNumber(t.payeeId, n)
    updateTransaction(t.id, { paymentReceiver: n, reviewed: true, ...(before && /^(Others|Other income)$/.test(t.paymentCategory) ? { paymentCategory: before.paymentCategory } : {}) })
    toast(`Saved as ${n}`)
  }
  const setCategory = (t: Transaction, c: string) => { buzz(8); updateTransaction(t.id, { paymentCategory: c, reviewed: true }); setEditing(null) }
  return (
    <Sheet open={open} onClose={onClose} full>
      <SheetHeader title="Review payments" sub="Added automatically from your payment notifications" onClose={onClose} />
      {list.length === 0 ? <div className="empty"><b>All caught up</b>Nothing left to review.</div> : (
        <>
          <button className="btn block" onClick={approveAll}><Icon name="check" size={18} /> Approve all {list.length}</button>
          <div className="card" style={{ marginTop: 12 }}>
            {list.map((t) => {
              const credit = t.paymentType === 'CREDIT'
              const cats = credit ? INCOME_CATEGORIES : withFamily(categories)
              return (
                <div key={t.id} style={{ padding: '12px 14px', borderTop: '1px solid var(--divider)' }}>
                  <div className="row" style={{ gap: 12 }}>
                    <BrandLogo src={merchantLogo(t.paymentReceiver)} size={38} radius={19} alt={t.paymentReceiver} fallback={<span className="letter-avatar" style={{ width: 38, height: 38, fontSize: 16, background: categoryColor(t.paymentCategory) }}>{(t.paymentReceiver.trim()[0] ?? '?').toUpperCase()}</span>} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 600 }}>{t.paymentReceiver}</div>
                      <button className="row dim small" style={{ gap: 4 }} onClick={() => setEditing(editing === t.id ? null : t.id)} aria-expanded={editing === t.id}><Icon name={categoryIcon(t.paymentCategory)} size={13} />{t.paymentCategory} · change</button>
                    </div>
                    <b className="num" style={{ color: credit ? 'var(--credit)' : 'var(--up)' }}>{credit ? '+' : '-'} {formatPrice(t.paymentAmount, { round: true })}</b>
                    <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => approve(t)} aria-label={`Approve ${t.paymentReceiver}`}><Icon name="check" size={16} /></button>
                  </div>
                  {isUnnamed(t) && (
                    <div className="col" style={{ gap: 8, marginTop: 10 }}>
                      <div className="dim small">{credit ? 'Who sent this?' : 'Who was this paid to?'} The bank did not say.</div>
                      {payeeSuggestions(t, all).length > 0 && <div className="row wrap" style={{ gap: 6 }}>{payeeSuggestions(t, all).map((s) => <button key={s} className="qchip" onClick={() => nameIt(t, s)}>{s}</button>)}</div>}
                      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); nameIt(t, naming[t.id] ?? '') }}>
                        <input className="input grow" style={{ height: 40 }} value={naming[t.id] ?? ''} onChange={(e) => setNaming({ ...naming, [t.id]: e.target.value })} placeholder="Type a name" aria-label="Name" />
                        <button className="btn sm" disabled={!(naming[t.id] ?? '').trim()}>Save</button>
                      </form>
                    </div>
                  )}
                  {editing === t.id && <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>{cats.map((c) => <button key={c} className={`qchip${c === t.paymentCategory ? ' on' : ''}`} onClick={() => setCategory(t, c)}>{c}</button>)}</div>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Sheet>
  )
}
