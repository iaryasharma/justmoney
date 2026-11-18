import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initStorage } from './lib/core/storage'
import { installErrorLog } from './lib/core/diagnostics'

// Load the on-device database (SQLite in the Android app) while the launch animation plays.
installErrorLog()
let storageReady = false
const listeners = new Set<() => void>()
initStorage().finally(() => { storageReady = true; listeners.forEach((f) => f()) })

function Root() {
  const [ready, setReady] = useState(storageReady)
  useEffect(() => { const f = () => setReady(true); listeners.add(f); if (storageReady) f(); return () => { listeners.delete(f) } }, [])
  return (
    // until the on-device data is loaded, a plain dark screen (the launch animation is in App, after any unlock)
    ready ? <App /> : <div style={{ position: 'fixed', inset: 0, background: '#06030d' }} />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
