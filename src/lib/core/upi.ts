export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-_]{1,63}$/

export function buildUpiUrl(vpa: string, name: string, amount: number, note?: string) {
  const q = [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(name || 'Payee')}`,
    `am=${amount.toFixed(2)}`,
    'cu=INR',
  ]
  if (note) q.push(`tn=${encodeURIComponent(note)}`)
  return `upi://pay?${q.join('&')}`
}

export function buildCollectionMessage(opts: { myName: string; amount: string; upiUrl?: string; custom?: string }) {
  const pay = opts.upiUrl ? `Pay via UPI: ${opts.upiUrl}` : 'Scan the QR to pay.'
  if (opts.custom?.trim()) return `${opts.custom.trim()}\n\n${opts.myName}: ${opts.amount}. ${pay}`
  return `Hi! Settling up on JustMoney. You owe ${opts.myName} ${opts.amount}. ${pay}`
}
