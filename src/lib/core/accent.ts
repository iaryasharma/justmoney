// Accent colour: the purple used for the + button, active tab, chips and highlights.
import { read, KEYS } from './storage'

export const ACCENTS: Record<string, { label: string; c: string; deep: string }> = {
  purple: { label: 'Purple (default)', c: '#8b5cf6', deep: '#6d28d9' },
  blue: { label: 'Blue', c: '#3b82f6', deep: '#1d4ed8' },
  green: { label: 'Green', c: '#22c55e', deep: '#15803d' },
  orange: { label: 'Orange', c: '#f97316', deep: '#c2410c' },
  pink: { label: 'Pink', c: '#ec4899', deep: '#be185d' },
  teal: { label: 'Teal', c: '#14b8a6', deep: '#0f766e' },
  red: { label: 'Red', c: '#ef4444', deep: '#b91c1c' },
  rose: { label: 'Rose', c: '#ff2d6a', deep: '#be123c' },        // the pink-red of the Kotak 811 logo
  magenta: { label: 'Magenta', c: '#d946ef', deep: '#a21caf' },
  indigo: { label: 'Indigo', c: '#6366f1', deep: '#4338ca' },
  cyan: { label: 'Cyan', c: '#06b6d4', deep: '#0e7490' },
  mint: { label: 'Mint', c: '#10b981', deep: '#047857' },
  lime: { label: 'Lime', c: '#65a30d', deep: '#3f6212' },
  amber: { label: 'Amber', c: '#f59e0b', deep: '#b45309' },
  coral: { label: 'Coral', c: '#fb7185', deep: '#e11d48' },
  slate: { label: 'Slate', c: '#64748b', deep: '#334155' },
  navy: { label: 'Navy', c: '#2563eb', deep: '#1e3a8a' },
  forest: { label: 'Forest', c: '#16a34a', deep: '#14532d' },
  olive: { label: 'Olive', c: '#84a313', deep: '#4d5d0a' },
  maroon: { label: 'Maroon', c: '#be3a4a', deep: '#7f1d2b' },
  brown: { label: 'Brown', c: '#a16a45', deep: '#6b4226' },
  lavender: { label: 'Lavender', c: '#a78bfa', deep: '#7c5ce0' },
  plum: { label: 'Plum', c: '#a855a8', deep: '#6b216b' },
}

export function applyAccent(id: string | null = read<string>(KEYS.accent, 'purple')) {
  const a = ACCENTS[id ?? 'purple'] ?? ACCENTS.purple
  const s = document.documentElement.style
  for (const v of ['--accent', '--accent-deep', '--accent-soft']) s.removeProperty(v) // older versions set these directly
  if (!id || id === 'purple') { s.removeProperty('--user-accent'); s.removeProperty('--user-accent-deep'); s.removeProperty('--user-accent-soft'); return } // the stylesheet's own purple (per theme)
  s.setProperty('--user-accent', a.c); s.setProperty('--user-accent-deep', a.deep); s.setProperty('--user-accent-soft', `${a.c}29`)
  // --accent-glow and --home-glow are built from these in the stylesheet, so they follow automatically
}

/** The current accent's hue, or null while the app uses its own violet (nothing needs changing then). */
function accentHue(): number | null {
  const id = read<string>(KEYS.accent, 'purple')
  if (!id || id === 'purple' || !ACCENTS[id]) return null
  const c = ACCENTS[id].c
  const r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (!d) return null
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

function rotate(hex: string, hue: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const s = max ? d / max : 0
  const h0 = !d ? 0 : (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
  const h0n = (h0 + 360) % 360
  if (s <= 0.25 || h0n < 225 || h0n > 305) return hex // not a violet: keep it
  const f = (n: number) => { const k = (n + hue / 60) % 6; return max - max * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`
}

/** One colour of the app's violet, moved to the chosen accent (for images and canvases, which cannot use CSS variables). */
export const themeHex = (hex: string): string => { const h = accentHue(); return h == null || !/^#[0-9a-f]{6}$/i.test(hex) ? hex : rotate(hex, h) }

/** Every violet in a piece of SVG / text, moved to the chosen accent. */
export const retheme = (svg: string): string => { const h = accentHue(); return h == null ? svg : svg.replace(/#[0-9a-fA-F]{6}\b/g, (m) => rotate(m, h)) }
