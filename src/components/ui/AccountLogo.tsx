import BrandLogo from './BrandLogo'
import { Icon } from './ui'
import { bankLogo } from '../../lib/payees/brands'
import type { PaymentMethod } from '../../lib/core/types'

/**
 * An account/card's logo: its bank's logo if we have one, else a tinted icon in the
 * account's own color (never a bare dot). Debit/credit cards get a small card badge in
 * the corner so they don't look like the bank account they're drawn from.
 */
export default function AccountLogo({ m, size = 16 }: { m: PaymentMethod; size?: number }) {
  const isCard = m.type === 'DEBIT_CARD' || m.type === 'CREDIT_CARD'
  const radius = Math.max(3, Math.round(size * 0.25))
  const badge = Math.max(9, Math.round(size * 0.62))
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: 'none', width: size, height: size }}>
      <BrandLogo src={bankLogo(m.bank, m.name)} size={size} radius={radius} alt={m.name}
        fallback={
          <span style={{
            width: size, height: size, borderRadius: radius, background: `${m.color}22`, color: m.color,
            display: 'grid', placeItems: 'center', flex: 'none',
          }}>
            <Icon name={m.type === 'CASH' ? 'wallet' : isCard ? 'card' : 'bank'} size={Math.round(size * 0.62)} stroke={2.2} />
          </span>
        } />
      {isCard && (
        <span style={{
          position: 'absolute', right: -3, bottom: -3, width: badge, height: badge, borderRadius: Math.round(badge * 0.3),
          background: m.color, color: '#fff', display: 'grid', placeItems: 'center', border: '1.5px solid var(--bg)',
        }}>
          <Icon name="card" size={Math.round(badge * 0.6)} stroke={2.6} />
        </span>
      )}
    </span>
  )
}
