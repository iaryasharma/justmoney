import { describe, expect, it } from 'vitest'
import { bottleTarget, pickSeat, seatAt } from './bottle'

describe('spin the bottle', () => {
  it('lands on the chosen seat from any start, always spinning forward', () => {
    for (const n of [2, 3, 5, 8]) {
      for (const start of [0, 37, 359, 1234, -90]) {
        for (let seat = 0; seat < n; seat++) {
          for (const wobble of [-0.5, 0, 0.5]) {
            const end = bottleTarget(start, seat, n, 5, wobble)
            expect(end).toBeGreaterThanOrEqual(start + 5 * 360)
            expect(seatAt(end, n)).toBe(seat)
          }
        }
      }
    }
  })

  it('picks every seat, and only real ones', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 400; i++) { const s = pickSeat(4); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(4); seen.add(s) }
    expect(seen.size).toBe(4)
  })
})
