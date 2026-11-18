import { describe, it, expect } from 'vitest'
import { ACCENTS } from './accent'

describe('accent colours', () => {
  const list = Object.values(ACCENTS)
  it('has no repeated colour or name', () => {
    expect(new Set(list.map((a) => a.c.toLowerCase())).size).toBe(list.length)
    expect(new Set(list.map((a) => a.deep.toLowerCase())).size).toBe(list.length)
    expect(new Set(list.map((a) => a.label.toLowerCase())).size).toBe(list.length)
  })
  it('no two colours are near-identical', () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = Math.hypot(...rgb(list[i].c).map((v, k) => v - rgb(list[j].c)[k]))
      expect(d, `${list[i].label} vs ${list[j].label}`).toBeGreaterThan(30)
    }
  })
  it('the default is labelled', () => expect(ACCENTS.purple.label).toMatch(/default/i))
})
