// A short burst of confetti, for the moments that deserve it (a goal reached, the emergency fund complete).
import { themeHex } from './accent'
const COLORS = ['#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#fb923c']

export function celebrate(count = 46) {
  try { navigator.vibrate?.([14, 40, 14, 40, 30]) } catch { /* no vibration */ }
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const host = document.createElement('div')
  host.className = 'confetti'
  host.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i')
    const a = (Math.random() * 120 - 60) * (Math.PI / 180)
    const v = 220 + Math.random() * 300
    s.style.cssText = `background:${themeHex(COLORS[i % COLORS.length])};--dx:${Math.sin(a) * v}px;--dy:${-Math.cos(a) * v * 0.9}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 120}ms;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px`
    host.appendChild(s)
  }
  document.body.appendChild(host)
  setTimeout(() => host.remove(), 2400)
}
