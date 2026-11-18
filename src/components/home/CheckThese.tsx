import { useState } from 'react'
import { buzz, Icon, Sheet, SheetHeader, useToast } from '../ui/ui'
import { deleteTransaction } from '../../lib/core/data'
import { dismissAttention, duplicateCharges, unconfirmed, alertOn } from '../../lib/notify/alerts'
import { formatPrice } from '../../lib/core/format'
import type { Transaction } from '../../lib/core/types'

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Home card: payments the bank never confirmed, and charges that look doubled. */
export function CheckThese({ all }: { all: Transaction[] }) {
  const [open, setOpen] = useState(false)
  const [, bump] = useState(0)
  const toast = useToast()
  const notConfirmed = alertOn('unconfirmed') ? unconfirmed(all) : []
  const doubles = alertOn('duplicates') ? duplicateCharges(all) : []
  const n = notConfirmed.length + doubles.length
  if (!n && !open) return null
  const done = (msg: string) => { buzz(8); toast(msg); bump((x) => x + 1) }
  return (
    <>
      {n > 0 && (
        <button className="card mini-card" onClick={() => setOpen(true)}>
          <span className="icon-tile" style={{ background: 'rgba(255,59,48,.14)', color: '#FF3B30' }}><Icon name="bell" size={20} /></span>
          <span className="grow"><b>{n} payment{n === 1 ? '' : 's'} to check</b><span className="dim small" style={{ display: 'block' }}>{[notConfirmed.length && `${notConfirmed.length} not confirmed by your bank`, doubles.length && `${doubles.length} possible double charge${doubles.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></span>
          <span className="chev"><Icon name="chevron" size={18} /></span>
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} full>
        <SheetHeader title="Check these" sub="Things that may be wrong" onClose={() => setOpen(false)} />
        {n === 0 ? <div className="empty"><b>All clear</b>Nothing needs checking.</div> : (
          <div className="col" style={{ gap: 14 }}>
            {doubles.length > 0 && (
              <>
                <div className="section-label">Possible double charges</div>
                <div className="card">{doubles.map((d) => (
                  <div key={d.key} style={{ padding: '12px 14px', borderTop: '1px solid var(--divider)' }}>
                    <div className="row"><b className="grow ellipsis">{d.first.paymentReceiver}</b><b className="num">{formatPrice(d.first.paymentAmount, { round: true })}</b></div>
                    <div className="dim small">{d.why}</div>
                    <div className="dim small">{when(d.first.timestamp)} and {when(d.second.timestamp)}</div>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button className="btn sm secondary grow" onClick={() => { dismissAttention(d.key); done('Marked as fine') }}>Both are real</button>
                      <button className="btn sm grow" onClick={() => { deleteTransaction(d.second.id); done('Removed the second one') }}>Remove the second</button>
                    </div>
                  </div>
                ))}</div>
              </>
            )}
            {notConfirmed.length > 0 && (
              <>
                <div className="section-label">Not confirmed by your bank</div>
                <p className="dim small" style={{ margin: 0 }}>These came from a receipt screenshot, and no bank message matched them after a day. The payment may have failed or been reversed.</p>
                <div className="card">{notConfirmed.map((t) => (
                  <div key={t.id} style={{ padding: '12px 14px', borderTop: '1px solid var(--divider)' }}>
                    <div className="row"><b className="grow ellipsis">{t.paymentReceiver}</b><b className="num">{formatPrice(t.paymentAmount, { round: true })}</b></div>
                    <div className="dim small">{when(t.timestamp)}</div>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button className="btn sm secondary grow" onClick={() => { dismissAttention(t.id); done('Kept') }}>It went through</button>
                      <button className="btn sm grow" onClick={() => { deleteTransaction(t.id); done('Removed') }}>Remove</button>
                    </div>
                  </div>
                ))}</div>
              </>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}
