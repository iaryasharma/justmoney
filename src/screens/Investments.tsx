import { useEffect, useState } from 'react'
import { Icon, PageHeader, Sheet, SheetHeader, useConfirm, useToast } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { formatPrice, toLocalInput } from '../lib/core/format'
import { tracksBalance } from '../lib/accounts/accounts'
import {
  addInvestment, countsTowardsWorth, INVESTMENT_TYPES, investmentResult, portfolio, sellInvestment, typeMeta, valueOf,
} from '../lib/invest/invest'
import { cachedPrice, refreshPrices } from '../lib/invest/prices'
import { StockSheet } from './Portfolio'
import type { Investment, InvestmentType, PaymentMethod } from '../lib/core/types'

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
const gainColor = (n: number) => (n > 0 ? 'var(--credit)' : n < 0 ? 'var(--danger)' : 'var(--text-60)')

export default function InvestmentsPage({ onBack }: { onBack: () => void }) {
  const [list, setList] = useStored<Investment[]>(KEYS.investments, [])
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  useStored(KEYS.priceCache, {}) // re-draw when fresh prices arrive
  const [adding, setAdding] = useState(false)
  const [pricing, setPricing] = useState<Investment | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [updating, setUpdating] = useState<Investment | null>(null)
  const [selling, setSelling] = useState<Investment | null>(null)
  const [chart, setChart] = useState<string | null>(null)
  const charted = list.find((i) => i.id === chart && !i.closedAt) ?? null
  const confirm = useConfirm()
  const toast = useToast()

  const pf = portfolio(list)
  const accounts = methods.filter(tracksBalance)
  const hasSymbols = list.some((i) => i.symbol && !i.closedAt)
  const refresh = async (force: boolean) => {
    setRefreshing(true)
    const r = await refreshPrices(list, force)
    setRefreshing(false)
    if (force) toast(r.updated ? `${r.updated} price${r.updated === 1 ? '' : 's'} updated` : 'No new prices', r.error)
  }
  useEffect(() => { if (hasSymbols) refresh(false) }, [list.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const byType = INVESTMENT_TYPES.map((t) => ({ ...t, value: list.filter((i) => i.type === t.type && countsTowardsWorth(i)).reduce((a, i) => a + valueOf(i), 0) })).filter((t) => t.value > 0)

  return (
    <div className="page">
      <PageHeader title="Investments" onBack={onBack} right={<span className="row" style={{ gap: 6 }}>{hasSymbols && <button className="btn sm" disabled={refreshing} onClick={() => refresh(true)} aria-label="Refresh prices"><Icon name="refresh" size={16} /></button>}<button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add</button></span>} />

      {list.length > 0 && (
        <div className="card pad col" style={{ gap: 10 }}>
          <div className="row between"><span className="label">Portfolio value</span><span className="small" style={{ color: gainColor(pf.gain) }}>{pf.gain >= 0 ? '+' : ''}{formatPrice(pf.gain, { round: true })} ({pct(pf.gainPct)})</span></div>
          <div className="row between"><span className="h2 num">{formatPrice(pf.value, { round: true })}</span><span className="muted small">invested {formatPrice(pf.invested, { round: true })}</span></div>
          {byType.length > 0 && (
            <>
              <div className="row" style={{ gap: 2, height: 10, borderRadius: 5, overflow: 'hidden' }} role="img" aria-label="Allocation by type">
                {byType.map((t) => <i key={t.type} title={`${t.label} ${formatPrice(t.value, { round: true })}`} style={{ flex: t.value, background: t.color }} />)}
              </div>
              <div className="row wrap small" style={{ gap: '4px 14px' }}>
                {byType.map((t) => <span key={t.type} className="row" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 4, background: t.color }} />{t.label} <span className="dim num">{Math.round((t.value / pf.value) * 100)}%</span></span>)}
              </div>
            </>
          )}
        </div>
      )}

      <div className="section-label">Holdings</div>
      <div className="col">
        {list.length === 0 && <div className="empty"><b>No investments yet</b>Add shares, mutual funds, FDs, gold or PPF with the Add button.</div>}
        {list.filter((i) => !i.closedAt).map((inv) => {
          const meta = typeMeta(inv.type)
          const v = valueOf(inv)
          const res = investmentResult(inv)
          const quote = cachedPrice(inv)
          const g = v - inv.invested
          const pending = inv.type === 'IPO' && inv.ipoStatus !== 'ALLOTTED'
          return (
            <div key={inv.id} className="card pad col" style={{ gap: 8 }}>
              <div className="row">
                <div style={{ width: 36, height: 36, borderRadius: 12, background: `${meta.color}22`, color: meta.color, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800 }}>{meta.label.slice(0, 3).toUpperCase()}</div>
                <div className="grow" role={inv.symbol ? 'button' : undefined} onClick={inv.symbol ? () => setChart(inv.id) : undefined}>
                  <div style={{ fontWeight: 700 }}>{inv.name}</div>
                  <div className="dim small">{meta.label}{inv.units ? ` · ${+inv.units.toFixed(4)} units` : ''}{inv.rate ? ` · ${inv.rate}%` : ''}{inv.maturityDate ? ` · matures ${new Date(inv.maturityDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''}{pending ? ' · applied, awaiting allotment' : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontWeight: 700 }}>{formatPrice(v, { round: true })}</div>
                  {!pending && <div className="tiny num" style={{ color: gainColor(g) }}>{pct(inv.invested ? (g / inv.invested) * 100 : 0)}</div>}
                </div>
              </div>
              {!pending && res.put > 0 && (
                <div className="small" style={{ lineHeight: 1.5 }}>
                  <span style={{ color: gainColor(res.profit), fontWeight: 600 }}>{res.profit >= 0 ? 'Profit' : 'Loss'} {formatPrice(Math.abs(res.profit), { round: true })} ({pct(res.pct)})</span>
                  <span className="dim"> · in {formatPrice(res.put, { round: true })}{res.back > 0 ? `, back ${formatPrice(res.back, { round: true })}` : ''} · {res.days} day{res.days === 1 ? '' : 's'}{res.perYear != null ? ` · ${pct(res.perYear * 100)}/yr` : ''}</span>
                </div>
              )}
              {quote && <div className="tiny dim">₹{quote.price.toFixed(2)} per share · {inv.symbol} · {Math.max(0, Math.round((Date.now() - quote.at) / 60000))} min ago</div>}
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {pending ? (
                  <>
                    <button className="chip" style={{ height: 30 }} onClick={async () => {
                      if (await confirm({ title: 'Not allotted?', body: 'The blocked money is released back to your account. This removes the application.', confirm: 'Remove' })) setList(list.filter((x) => x.id !== inv.id))
                    }}>Not allotted</button>
                    <button className="chip on" style={{ height: 30 }} onClick={() => { setList(list.map((x) => (x.id === inv.id ? { ...x, ipoStatus: 'ALLOTTED', updatedAt: Date.now() } : x))); toast('Allotted', 'Update its value once it lists.') }}>Allotted</button>
                  </>
                ) : (
                  <>
                    {(inv.type === 'STOCK' || inv.type === 'IPO') && <button className="chip" style={{ height: 30 }} onClick={() => setPricing(inv)}>{inv.symbol ? 'Live price' : 'Set live price'}</button>}
                    {!(inv.rate && inv.startDate) && !inv.symbol && <button className="chip" style={{ height: 30 }} onClick={() => setUpdating(inv)}>Update value</button>}
                    <button className="chip" style={{ height: 30 }} onClick={() => setSelling(inv)}>{inv.type === 'FD' || inv.type === 'RD' ? 'Close' : 'Sell'}</button>
                  </>
                )}
                <button className="dim" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete ${inv.name}?`, body: 'This only removes it from the list — nothing is added to your accounts.', confirm: 'Delete', danger: true })) setList(list.filter((x) => x.id !== inv.id)) }}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {list.some((i) => i.closedAt) && (
        <>
          <div className="section-label">Sold</div>
          <div className="col">
            {list.filter((i) => i.closedAt).map((inv) => {
              const r = investmentResult(inv)
              return (
                <div key={inv.id} className="card pad col" style={{ gap: 4 }}>
                  <div className="row between"><b>{inv.name}</b><b className="num" style={{ color: gainColor(r.profit) }}>{r.profit >= 0 ? '+' : '-'}{formatPrice(Math.abs(r.profit), { round: true })} ({pct(r.pct)})</b></div>
                  <div className="dim small">In {formatPrice(r.put, { round: true })} · back {formatPrice(r.back, { round: true })} · held {r.days} day{r.days === 1 ? '' : 's'}{r.perYear != null ? ` · ${pct(r.perYear * 100)}/yr` : ''}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <PriceSheet inv={pricing} onClose={() => setPricing(null)} onSave={(d) => { if (pricing) { setList(list.map((x) => (x.id === pricing.id ? { ...x, ...d, updatedAt: Date.now() } : x))); setTimeout(() => refreshPrices([{ ...pricing, ...d }], true).then((r) => toast(r.updated ? 'Live price on' : 'Saved, no price yet', r.error)), 0) } }} />
      <AddInvestmentSheet open={adding} onClose={() => setAdding(false)} accounts={accounts} />
      <UpdateValueSheet inv={updating} onClose={() => setUpdating(null)} onSave={(v, units) => {
        if (!updating) return
        setList(list.map((x) => (x.id === updating.id ? { ...x, currentValue: v, units: units ?? x.units, updatedAt: Date.now() } : x)))
      }} />
      {charted && <StockSheet inv={charted} onClose={() => setChart(null)} onEditPrice={() => { setPricing(charted); setChart(null) }} />}
      <SellSheet inv={selling} onClose={() => setSelling(null)} accounts={accounts} />
    </div>
  )
}

function AddInvestmentSheet({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: PaymentMethod[] }) {
  const toast = useToast()
  const [type, setType] = useState<InvestmentType>('STOCK')
  const [name, setName] = useState('')
  const [invested, setInvested] = useState('')
  const [current, setCurrent] = useState('')
  const [units, setUnits] = useState('')
  const [price, setPrice] = useState('')
  const [rate, setRate] = useState('')
  const [start, setStart] = useState(toLocalInput(Date.now()).slice(0, 10))
  const [maturity, setMaturity] = useState('')
  const [from, setFrom] = useState<string | null>(null)
  const deposit = type === 'FD' || type === 'RD' || type === 'PPF'
  const unitBased = type === 'STOCK' || type === 'MF' || type === 'GOLD' || type === 'CRYPTO'
  const reset = () => { setName(''); setInvested(''); setCurrent(''); setUnits(''); setPrice(''); setRate(''); setMaturity(''); setFrom(null) }
  return (
    <Sheet open={open} onClose={onClose} full>
      <SheetHeader title={<>Add an investment</>} onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        const inv = Number(invested)
        if (!name.trim() || !(inv > 0)) return
        const u = Number(units), p = Number(price)
        const value = unitBased && u > 0 && p > 0 ? u * p : Number(current) || inv
        addInvestment({
          type, name: name.trim(), invested: inv, currentValue: value, units: unitBased && u > 0 ? u : null,
          rate: deposit && Number(rate) > 0 ? Number(rate) : null,
          startDate: deposit ? new Date(start).getTime() || Date.now() : null,
          maturityDate: deposit && maturity ? new Date(maturity).getTime() : null,
          ipoStatus: type === 'IPO' ? 'APPLIED' : null,
        }, from)
        toast(type === 'IPO' ? 'IPO application added' : 'Investment added', from && type !== 'IPO' ? 'Recorded as money moved from your account (not spending).' : undefined)
        reset(); onClose()
      }}>
        <div className="row wrap" style={{ gap: 8 }}>{INVESTMENT_TYPES.map((t) => <button type="button" key={t.type} className={`chip${type === t.type ? ' on' : ''}`} onClick={() => setType(t.type)}>{t.label}</button>)}</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'IPO' ? 'IPO name (e.g. Tata Technologies)' : type === 'FD' ? 'e.g. Kotak FD' : type === 'MF' ? 'e.g. Parag Parikh Flexi Cap' : 'Name'} />
        <input className="input" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={type === 'IPO' ? 'Amount applied / blocked' : deposit ? 'Principal' : 'Amount invested'} />
        {unitBased && (
          <div className="row">
            <input className="input" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={type === 'GOLD' ? 'Grams' : 'Units / shares'} />
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Price now (per unit)" />
          </div>
        )}
        {!deposit && type !== 'IPO' && !(unitBased && units && price) && <input className="input" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Current value (optional)" />}
        {deposit && (
          <>
            <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Interest rate % per year" />
            <div className="row">
              <div className="field grow"><label>Started</label><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div className="field grow"><label>Matures</label><input className="input" type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} /></div>
            </div>
          </>
        )}
        {type !== 'IPO' && accounts.length > 0 && (
          <div className="field"><label>Paid from account (optional)</label>
            <div className="chips">{accounts.map((m) => <button type="button" key={m.id} className={`chip${from === m.id ? ' on' : ''}`} onClick={() => setFrom(from === m.id ? null : m.id)}>{m.name}</button>)}</div>
          </div>
        )}
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}

function UpdateValueSheet({ inv, onClose, onSave }: { inv: Investment | null; onClose: () => void; onSave: (value: number, units?: number) => void }) {
  const [value, setValue] = useState('')
  const [price, setPrice] = useState('')
  return (
    <Sheet open={!!inv} onClose={onClose}>
      <SheetHeader title={<>Update {inv?.name}</>} onClose={onClose} />
      <form className="col" onSubmit={(e) => {
        e.preventDefault()
        const v = inv?.units && Number(price) > 0 ? inv.units * Number(price) : Number(value)
        if (!(v >= 0) || (!price && !value)) return
        onSave(v); setValue(''); setPrice(''); onClose()
      }}>
        {inv?.units ? <input className="input" autoFocus inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={`Price per unit now (${+inv.units.toFixed(4)} units)`} /> : null}
        <input className="input" autoFocus={!inv?.units} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={inv?.units ? 'or total current value' : 'Current value'} />
        <button className="btn block">Save</button>
      </form>
    </Sheet>
  )
}

function SellSheet({ inv, onClose, accounts }: { inv: Investment | null; onClose: () => void; accounts: PaymentMethod[] }) {
  const toast = useToast()
  const [received, setReceived] = useState('')
  const [portion, setPortion] = useState(100)
  const [to, setTo] = useState<string | null>(null)
  const principal = inv ? inv.invested * (portion / 100) : 0
  const profit = Number(received) - principal
  const live = inv?.units ? cachedPrice(inv) : undefined
  const atMarket = live && inv?.units ? Math.round(inv.units * (portion / 100) * live.price * 100) / 100 : 0
  return (
    <Sheet open={!!inv} onClose={onClose}>
      <SheetHeader title={<>Sell {inv?.name}</>} sub="Only the profit is counted as income — getting your own money back isn't." onClose={onClose} />
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault()
        if (!inv || !(Number(received) > 0)) return
        sellInvestment(inv.id, Number(received), portion / 100, to)
        toast(profit >= 0 ? `Profit ${formatPrice(profit, { round: true })}` : `Loss ${formatPrice(-profit, { round: true })}`, to ? 'Recorded in your account.' : undefined)
        setReceived(''); setPortion(100); onClose()
      }}>
        <div className="field"><label>How much did you sell</label>
          <div className="chips">{[25, 50, 75, 100].map((p) => <button type="button" key={p} className={`chip${portion === p ? ' on' : ''}`} onClick={() => setPortion(p)}>{p === 100 ? 'All' : `${p}%`}</button>)}</div>
        </div>
        <input className="input" autoFocus inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount received" />
        {atMarket > 0 && <button type="button" className="qchip" onClick={() => setReceived(String(atMarket))}>At today's price: {formatPrice(atMarket, { round: true })}</button>}
        {Number(received) > 0 && <div className="small" style={{ color: gainColor(profit) }}>{profit >= 0 ? 'Profit' : 'Loss'}: {formatPrice(Math.abs(profit), { round: true })} on {formatPrice(principal, { round: true })} invested</div>}
        {accounts.length > 0 && (
          <div className="field"><label>Money went to</label>
            <div className="chips">{accounts.map((m) => <button type="button" key={m.id} className={`chip${to === m.id ? ' on' : ''}`} onClick={() => setTo(to === m.id ? null : m.id)}>{m.name}</button>)}</div>
          </div>
        )}
        <button className="btn block">Record sale</button>
      </form>
    </Sheet>
  )
}


/** Which listed share this is and how many you hold, so its price can be fetched live. */
export function PriceSheet({ inv, onClose, onSave }: { inv: Investment | null; onClose: () => void; onSave: (d: { symbol: string | null; exchange: 'NSE' | 'BSE'; units: number | null }) => void }) {
  const [symbol, setSymbol] = useState('')
  const [exchange, setExchange] = useState<'NSE' | 'BSE'>('NSE')
  const [units, setUnits] = useState('')
  useEffect(() => { if (inv) { setSymbol(inv.symbol ?? ''); setExchange(inv.exchange ?? 'NSE'); setUnits(inv.units ? String(inv.units) : '') } }, [inv])
  return (
    <Sheet open={!!inv} onClose={onClose}>
      <SheetHeader title={<>Live price for {inv?.name}</>} sub="Use the share's ticker as on NSE or BSE, like RELIANCE or TATATECH. An IPO only has a price once it lists." onClose={onClose} />
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        const u = Number(units)
        onSave({ symbol: symbol.trim().toUpperCase() || null, exchange, units: u > 0 ? u : null })
        onClose()
      }}>
        <input className="input" autoFocus value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9&-]/g, ''))} placeholder="Ticker, e.g. RELIANCE" />
        <div className="segmented"><button type="button" className={exchange === 'NSE' ? 'on' : ''} onClick={() => setExchange('NSE')}>NSE</button><button type="button" className={exchange === 'BSE' ? 'on' : ''} onClick={() => setExchange('BSE')}>BSE</button></div>
        <input className="input" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="How many shares you hold" />
        <button className="btn block" disabled={!symbol.trim() || !(Number(units) > 0)}>Save</button>
      </form>
    </Sheet>
  )
}
