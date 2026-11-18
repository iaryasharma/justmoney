import { useEffect, useRef, useState } from 'react'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A number that rolls from what it showed before to the new value (switching month, a payment added). It opens on its real value:
 * counting up from zero on every visit made the figure you came to read wrong for most of a second.
 */
export function CountUp({ value, format = (v: number) => String(Math.round(v)), ms = 450 }: { value: number; format?: (v: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduced()) { setShown(value); return }
    const a = from.current
    if (a === value) { setShown(value); return }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const v = a + (value - a) * (1 - Math.pow(1 - p, 3))
      from.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{format(shown)}</>
}
