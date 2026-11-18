import { useEffect, useState } from 'react'

// The launch animation: a violet glow rises, the JM mark draws in, the wordmark follows, then it all fades into the app.
// Plays once per cold start (not when the app comes back from the background). With App Lock on it plays after unlocking, so the lock screen comes first.
const MARK = 'M-124.64 110.49L-124.64 110.49Q-131.57 110.49 -136.83 109.65Q-142.09 108.82 -145.92 107.86L-145.92 107.86L-145.92 77.73Q-142.09 78.68 -137.91 79.40Q-133.72 80.12 -128.94 80.12L-128.94 80.12Q-122.72 80.12 -117.58 77.73Q-112.44 75.33 -109.57 68.64Q-106.70 61.94 -106.70 49.51L-106.70 49.51L-106.70 -110.49L-70.59 -110.49L-70.59 49.27Q-70.59 71.27 -77.40 84.78Q-84.22 98.29 -96.41 104.39Q-108.61 110.49 -124.64 110.49M107.36 -70.31L107.36 -70.31Q129.12 -70.31 137.52 -59.19Q145.92 -48.07 140.63 -23.20L140.63 -23.20L122.89 60.27L102.09 60.27L119.62 -22.24Q122.83 -37.31 118.11 -44.96Q113.40 -52.61 100.01 -52.61L100.01 -52.61Q81.36 -52.61 71.06 -41.85Q60.76 -31.09 56.39 -10.52L56.39 -10.52L41.34 60.27L20.53 60.27L38.07 -22.24Q40.21 -32.29 38.78 -39.10Q37.36 -45.92 32.34 -49.27Q27.31 -52.61 18.22 -52.61L18.22 -52.61Q5.31 -52.61 -3.25 -47.23Q-11.81 -41.85 -17.22 -31.57Q-22.64 -21.28 -25.84 -6.22L-25.84 -6.22L-39.97 60.27L-61.02 60.27L-33.77 -67.92L-16.79 -67.92L-17.39 -50.46L-16.20 -50.46Q-10.71 -57.16 -3.91 -61.58Q2.89 -66.01 10.52 -68.16Q18.15 -70.31 25.81 -70.31L25.81 -70.31Q40.64 -70.31 49.44 -65.05Q58.25 -59.79 60.45 -48.79L60.45 -48.79L61.65 -48.79Q70.45 -59.79 82.68 -65.05Q94.92 -70.31 107.36 -70.31'
const SHOW_MS = 1500

export default function Splash({ ready = true, onDone }: { ready?: boolean; onDone?: () => void }) {
  const [minDone, setMinDone] = useState(false)
  const [gone, setGone] = useState(false)
  useEffect(() => { const t = setTimeout(() => setMinDone(true), SHOW_MS); return () => clearTimeout(t) }, [])
  const leaving = ready && minDone
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => { setGone(true); onDone?.() }, 450)
    return () => clearTimeout(t)
  }, [leaving])
  if (gone) return null
  return (
    <div className={'splash' + (leaving ? ' leave' : '')} aria-hidden="true">
      <div className="splash-glow" />
      <svg className="splash-mark" viewBox="-170 -140 340 280" width="132" height="109">
        <defs><linearGradient id="spmk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="color-mix(in srgb, var(--accent) 25%, #fff)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient></defs>
        <path d={MARK} fill="url(#spmk)" stroke="url(#spmk)" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      <div className="splash-word"><b>Just</b>Money</div>
      <div className="splash-tag">Know where it goes</div>
    </div>
  )
}
