// A picture of a split to send to the group: the bill, who owes what, and a UPI QR code anyone can scan to pay you.
// Friends need nothing installed: the QR opens their own UPI app, and the message beside it has each person's link with their amount.
import QRCode from 'qrcode'
import { formatPrice } from '../core/format'

export interface CardLine { name: string; amount: number }

const W = 1080

/** Draws the card as a PNG. `upiUrl` (your UPI id, no amount: each person types or taps their own) puts a QR at the bottom. */
export async function splitCardImage(opts: { title: string; total: number; payer: string; lines: CardLine[]; upiUrl?: string; upi?: string }): Promise<Blob> {
  const rowH = 92
  const qrSize = opts.upiUrl ? 420 : 0
  const H = 330 + opts.lines.length * rowH + (opts.upiUrl ? qrSize + 170 : 40) + 90
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#0f0d18'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#8b5cf6'; g.fillRect(0, 0, W, 14)
  const font = (size: number, weight = 600) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Devanagari", sans-serif`
  g.fillStyle = '#ffffff'; g.font = font(64, 800); g.fillText(fit(g, opts.title, W - 140), 70, 130)
  g.fillStyle = '#b8b3c7'; g.font = font(38, 500); g.fillText(`${formatPrice(opts.total)} · paid by ${opts.payer}`, 70, 195)
  let y = 300
  for (const l of opts.lines) {
    g.fillStyle = '#1b1828'; roundRect(g, 50, y - 62, W - 100, rowH - 14, 22); g.fill()
    g.fillStyle = '#ffffff'; g.font = font(40, 600); g.fillText(fit(g, l.name, W - 460), 90, y)
    g.fillStyle = '#4ade80'; g.font = font(44, 800)
    const a = formatPrice(l.amount); g.fillText(a, W - 90 - g.measureText(a).width, y)
    y += rowH
  }
  if (opts.upiUrl) {
    const qr = await QRCode.toDataURL(opts.upiUrl, { margin: 1, width: qrSize, color: { dark: '#000000', light: '#ffffff' } })
    const img = await load(qr)
    const x = (W - qrSize) / 2
    y += 30
    g.fillStyle = '#ffffff'; roundRect(g, x - 24, y - 24, qrSize + 48, qrSize + 48, 28); g.fill()
    g.drawImage(img, x, y, qrSize, qrSize)
    y += qrSize + 80
    g.fillStyle = '#ffffff'; g.font = font(36, 600); center(g, 'Scan with any UPI app to pay', y)
    if (opts.upi) { g.fillStyle = '#b8b3c7'; g.font = font(30, 500); center(g, opts.upi, y + 48) }
  }
  g.fillStyle = '#6f6a80'; g.font = font(26, 500); center(g, 'Split with JustMoney', H - 40)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the card'))), 'image/png'))
}

function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}
const center = (g: CanvasRenderingContext2D, text: string, y: number) => g.fillText(text, (W - g.measureText(text).width) / 2, y)
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}
const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
