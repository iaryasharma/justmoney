// Spin the bottle: who pays this round. Seats sit clockwise round a circle, seat 0 at the top.

/** A fair pick in [0, n), from the platform's crypto source. */
export function pickSeat(n: number): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] % n // shortcut: modulo bias is < n / 2^32, fine for a table of friends
}

/**
 * The rotation (degrees) the bottle ends at so its neck points at `seat`: always forward from `current`,
 * a few whole turns first, and `wobble` (-0.5..0.5) moves it inside the seat so it never stops dead-centre.
 */
export function bottleTarget(current: number, seat: number, n: number, turns = 5, wobble = 0): number {
  const step = 360 / n
  const want = seat * step + wobble * Math.min(step * 0.4, 24) // at most ±12°: the neck still clearly points at the seat
  const from = ((current % 360) + 360) % 360
  const extra = ((want - from) % 360 + 360) % 360
  return current + turns * 360 + extra
}

/** Which seat a rotation points at (the inverse of bottleTarget). */
export function seatAt(rotation: number, n: number): number {
  const step = 360 / n
  const a = ((rotation % 360) + 360) % 360
  return Math.round(a / step) % n
}
