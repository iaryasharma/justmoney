// A small on-device error log (nothing is sent anywhere). Shared from Settings → Diagnostics when something goes wrong.
import { read, write, KEYS } from './storage'

export interface ErrorEntry { at: number; message: string; stack?: string; where?: string }
export const getErrors = () => read<ErrorEntry[]>(KEYS.errorLog, [])
export const clearErrors = () => write(KEYS.errorLog, [])

function push(e: ErrorEntry) {
  const last = getErrors()[0]
  if (last && last.message === e.message && e.at - last.at < 2000) return // same error in a loop
  write(KEYS.errorLog, [e, ...getErrors()].slice(0, 40))
}

let installed = false
export function installErrorLog() {
  if (installed) return
  installed = true
  window.addEventListener('error', (ev) => push({ at: Date.now(), message: ev.message || 'Error', stack: ev.error?.stack?.split('\n').slice(0, 6).join('\n'), where: ev.filename ? `${ev.filename.split('/').pop()}:${ev.lineno}` : undefined }))
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as { message?: string; stack?: string } | string | undefined
    push({ at: Date.now(), message: typeof r === 'string' ? r : r?.message ?? 'Unhandled promise rejection', stack: typeof r === 'object' ? r?.stack?.split('\n').slice(0, 6).join('\n') : undefined })
  })
}

export function formatReport(appVersion: string) {
  const errs = getErrors()
  return [`JustMoney ${appVersion}`, navigator.userAgent, `Captured ${errs.length} error(s)`, '',
    ...errs.map((e) => `[${new Date(e.at).toISOString()}] ${e.message}${e.where ? ` (${e.where})` : ''}${e.stack ? `\n${e.stack}` : ''}`)].join('\n')
}
