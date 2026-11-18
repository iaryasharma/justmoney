import { useLayoutEffect, useRef } from 'react'

// Page scroll, remembered the way phone apps do it: opening something starts at its top, and coming back puts the list where it was.

// The scroll position is tracked from scroll events. Reading window.scrollY while a new page is being drawn is too late: a shorter page has
// already pulled it up, so "back" would land at the top. The event only fires after the screen has changed, so this still holds the old value.
let lastY = 0
let touched = 0
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => { lastY = window.scrollY }, { passive: true })
  window.addEventListener('touchstart', () => { touched = Date.now() }, { passive: true })
}
export const currentScroll = () => lastY

/** Scrolls to `y`, and tries again as the page fills in (data and images arrive after the first draw), unless the finger has taken over. */
export function restoreScroll(y: number) {
  const started = Date.now()
  const go = () => { if (touched < started && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y) }
  window.scrollTo(0, y)
  lastY = y
  requestAnimationFrame(go)
  for (const ms of [60, 160, 340, 650]) setTimeout(go, ms)
}

/** A page that swaps in place of a list: open it from the top, and put the list back where you were when you leave. */
export function useScrollRestore(open: unknown) {
  const saved = useRef(0)
  const was = useRef(false)
  useLayoutEffect(() => {
    const now = open != null && open !== false
    if (now && !was.current) saved.current = lastY
    if (now) { window.scrollTo(0, 0); lastY = 0 } else if (was.current) restoreScroll(saved.current)
    was.current = now
  }, [open])
}

/**
 * Screens that replace each other (the tabs, and the Planner's pages). Each keeps its own position: going to a deeper page starts at the top,
 * and any other move (back, or another tab) returns to where that screen was left.
 */
export function useViewScroll(view: string, deeper: boolean) {
  const memory = useRef(new Map<string, number>())
  const prev = useRef(view)
  useLayoutEffect(() => {
    if (prev.current === view) return
    memory.current.set(prev.current, lastY)
    prev.current = view
    if (deeper) { window.scrollTo(0, 0); lastY = 0 } else restoreScroll(memory.current.get(view) ?? 0)
  }, [view, deeper])
}
