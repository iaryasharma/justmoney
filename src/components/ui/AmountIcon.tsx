import type { CSSProperties } from 'react'

/** The ₹+ / ₹− badge shown on a credit/debit transaction — a designed icon, not drawn. */
export default function AmountIcon({ credit, size = 20, style }: { credit: boolean; size?: number; style?: CSSProperties }) {
  return (
    <img src={credit ? '/icons/amount-added.webp' : '/icons/amount-deducted.webp'} width={size} height={size}
      alt={credit ? 'Amount added' : 'Amount deducted'} style={{ width: size, height: size, flex: 'none', ...style }} />
  )
}
