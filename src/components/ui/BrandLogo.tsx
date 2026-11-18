import { useState } from 'react'

/** A brand logo tile; renders nothing (or `fallback`) if the image is missing. */
export default function BrandLogo({ src, size = 20, radius, alt = '', fallback = null }: {
  src: string | null; size?: number; radius?: number; alt?: string; fallback?: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <>{fallback}</>
  // card networks and Google Drive are transparent artwork: no tile behind them
  const bare = /\/brands\/(?:visa|mastercard|rupay|googledrive)\.webp$/.test(src)
  return (
    <img src={src} alt={alt} width={size} height={size} loading="lazy" onError={() => setBroken(true)}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.24), objectFit: bare ? 'contain' : 'cover', flex: 'none', background: bare ? 'transparent' : '#fff' }} />
  )
}
