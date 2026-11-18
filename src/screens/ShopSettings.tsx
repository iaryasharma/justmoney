import { PageHeader, Toggle } from '../components/ui/ui'
import { formatPrice } from '../lib/core/format'
import { useStored, KEYS } from '../lib/core/storage'
import { getAccounts } from '../lib/accounts/accounts'
import { getMerchantSettings, saveMerchantSettings, type MerchantSettings } from '../lib/payees/merchant'
import type { PaymentMethod } from '../lib/core/types'

/** Where PhonePe and Paytm business money lands, and what to do when the bank sends no message about it. */
export default function ShopPayoutPage({ onBack }: { onBack: () => void }) {
  const [methods] = useStored<PaymentMethod[]>(KEYS.paymentMethods, [])
  const [stored] = useStored<Partial<MerchantSettings>>(KEYS.merchantSettings, {})
  const s = { ...getMerchantSettings(), ...stored }
  const banks = (methods.length ? methods : getAccounts()).filter((m) => m.type === 'BANK')
  const acc = banks.find((m) => m.id === s.accountId)
  return (
    <div className="page">
      <PageHeader title="Shop payouts" onBack={onBack} />
      <p className="muted small" style={{ marginTop: 0, lineHeight: 1.5 }}>PhonePe and Paytm hold your sales for about a day, then pay them into your bank in one go. If your bank does not send a message about it, JustMoney can record the payout for you, so your balance stays right.</p>

      <div className="section-label">The account the money lands in</div>
      {banks.length === 0
        ? <div className="card pad small muted">Add a bank account first (Settings → Accounts & cards), with its balance, so payouts can raise it.</div>
        : (
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {banks.map((m) => <button key={m.id} className={`chip${s.accountId === m.id ? ' on' : ''}`} onClick={() => saveMerchantSettings({ accountId: s.accountId === m.id ? null : m.id })}>{m.name}</button>)}
          </div>
        )}
      <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>{acc ? `${acc.name} goes up by the payout when it is recorded.` : 'Not chosen: payouts are still recorded, but no balance changes.'}{acc?.openingBalance != null ? ` Now ${formatPrice(acc.openingBalance, { round: true })} before payouts.` : ''}</p>

      <div className="section-label">When the bank sends no message</div>
      <div className="card">
        <div className="list-row">
          <div className="grow"><div>Ask me the next morning</div><div className="dim small">“Did your money reach the bank?” for sales from earlier days that no payout message covered</div></div>
          <Toggle on={s.ask} onChange={(v) => saveMerchantSettings({ ask: v })} label="Ask me the next morning" />
        </div>
        <div className="list-row">
          <div className="grow"><div>Settle automatically</div><div className="dim small">If I do not answer, mark them settled at the time below</div></div>
          <Toggle on={s.auto} onChange={(v) => saveMerchantSettings({ auto: v })} label="Settle automatically" />
        </div>
        <div className="list-row" style={{ opacity: s.auto ? 1 : 0.5 }}>
          <div className="grow"><div>At what time</div><div className="dim small">Sales from earlier days are settled then. Today’s sales wait for tomorrow.</div></div>
          <input className="input" style={{ width: 110 }} type="time" value={s.time} disabled={!s.auto} onChange={(e) => e.target.value && saveMerchantSettings({ time: e.target.value })} aria-label="Auto-settle time" />
        </div>
      </div>
      <p className="dim tiny" style={{ marginTop: 10, lineHeight: 1.5 }}>If the bank’s own message arrives later, it replaces the recorded payout, so the money is never counted twice. If a payout was recorded by mistake, open it and tap “Not a payout”.</p>
    </div>
  )
}
