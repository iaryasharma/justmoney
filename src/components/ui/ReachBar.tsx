import { useEffect, useRef } from 'react'
import { celebrate } from '../../lib/core/celebrate'

/** A goal's progress bar. It fills from empty; when the goal is reached while you watch, it pulses and a little confetti goes off. */
export function ReachBar({ pct, color, done, height, block, confetti = true, style }: { pct: number; color: string; done: boolean; height?: number; block?: boolean; confetti?: boolean; style?: React.CSSProperties }) {
  const was = useRef(done)
  useEffect(() => {
    if (done && !was.current && confetti) celebrate()
    was.current = done
  }, [done, confetti])
  return (
    <span className={`bar${done ? ' reached' : ''}`} style={{ display: block ? 'block' : undefined, height, ...style }}>
      <i style={{ width: `${Math.min(100, pct)}%`, background: done ? 'var(--toggle)' : color }} />
    </span>
  )
}
