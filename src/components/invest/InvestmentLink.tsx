import { useState } from 'react'
import { buzz, Sheet, SheetHeader, useToast } from '../ui/ui'
import { formatPrice } from '../../lib/core/format'
import { investmentResult, linkInvestmentBuy, linkInvestmentReturn, typeMeta } from '../../lib/invest/invest'
import { openRoute } from '../../lib/notify/notifyRoute'
import { useStored, KEYS } from '../../lib/core/storage'
import type { Investment, Transaction } from '../../lib/core/types'

/** Marks a payment as money put into an investment, or as one coming back, and says which investment. */
export default function InvestmentLink({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const toast = useToast()
  const [list] = useStored<Investment[]>(KEYS.investments, [])
  const [portion, setPortion] = useState(100)
  const [picked, setPicked] = useState<string | null>(null)
  if (!tx) return null
  const credit = tx.paymentType === 'CREDIT'
  const open = list.filter((i) => !i.closedAt)
  const money = (v: number) => formatPrice(v, { round: true })

  const done = (msg: string, sub?: string) => { buzz(12); toast(msg, sub); setPicked(null); onClose() }
  const buy = (inv: Investment) => { linkInvestmentBuy(tx, inv.id); done(`${money(tx.paymentAmount)} put into ${inv.name}`, 'Not counted as spending') }
  const sell = (inv: Investment) => {
    const put = investmentResult(inv).put
    linkInvestmentReturn(tx, inv.id, portion / 100)
    const gain = tx.paymentAmount - put * (portion / 100)
    done(portion === 100 ? `${inv.name} closed` : `${portion}% of ${inv.name} sold`, `${money(tx.paymentAmount)} came back · ${gain >= 0 ? 'profit' : 'loss'} ${money(Math.abs(gain))}`)
  }

  return (
    <Sheet open onClose={onClose} full>
      <SheetHeader title={credit ? <>Which investment paid you?</> : <>Which investment is this?</>}
        sub={`${money(tx.paymentAmount)} ${credit ? 'came back' : 'went in'}. Either way it is your own money moving, so it is not counted as spending or income. The profit shows on the investment.`} onClose={onClose} />
      {credit && (
        <div className="field"><label>How much of it did you sell</label>
          <div className="chips">{[25, 50, 75, 100].map((p) => <button key={p} className={`chip${portion === p ? ' on' : ''}`} onClick={() => setPortion(p)}>{p === 100 ? 'All of it' : `${p}%`}</button>)}</div>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        {open.length === 0 && <div className="empty small">{credit ? 'No open investments to link.' : 'No investments yet. Add one, then link this payment.'}</div>}
        {open.map((inv) => {
          const r = investmentResult(inv)
          const meta = typeMeta(inv.type)
          return (
            <button key={inv.id} className="list-row" onClick={() => (credit ? (picked === inv.id ? sell(inv) : setPicked(inv.id)) : buy(inv))}>
              <span className="icon-tile" style={{ background: `${meta.color}22`, color: meta.color, fontSize: 11, fontWeight: 800 }}>{meta.label.slice(0, 3).toUpperCase()}</span>
              <div className="grow" style={{ textAlign: 'left' }}><div>{inv.name}</div><div className="dim small">In {money(r.put)} · worth {money(r.worth)}</div></div>
              {credit && picked === inv.id ? <b style={{ color: 'var(--accent)' }}>Tap to confirm</b> : null}
            </button>
          )
        })}
      </div>
      {!credit && <button className="btn block secondary" style={{ marginTop: 12 }} onClick={() => { onClose(); openRoute('planner:portfolio') }}>Add an investment</button>}
    </Sheet>
  )
}
