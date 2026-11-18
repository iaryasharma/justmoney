// On the 1st of each month (when the app opens), saves last month's PDF report and tells you it's ready.
import { read, write, KEYS } from '../core/storage'
import { isNativeApp } from '../core/native'
import { buildExpenseReportPdf, reportFilename, savePdfReport } from './report'
import { notifyImmediate } from '../notify/notify'
import { ROUTES } from '../notify/notifyRoute'
import { monthShort } from '../core/format'
import type { Transaction } from '../core/types'

export interface AutoReportState { enabled: boolean; lastKey: string }
export const getAutoReport = () => ({ enabled: false, lastKey: '', ...read<Partial<AutoReportState>>(KEYS.autoReport, {}) }) as AutoReportState

let running = false

/** Returns the filename if a report was made. Safe to call on every launch / resume. */
export async function runAutoReport(now = new Date()): Promise<string | null> {
  const s = getAutoReport()
  if (!isNativeApp() || !s.enabled || running) return null
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const key = `${prev.getFullYear()}-${prev.getMonth() + 1}`
  if (s.lastKey === key) return null
  const all = read<Transaction[]>(KEYS.transactions, [])
  const a = prev.getTime(), b = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const rows = all.filter((t) => t.timestamp >= a && t.timestamp < b)
  if (!rows.length) { write(KEYS.autoReport, { ...s, lastKey: key }); return null }
  running = true
  try {
    const filename = reportFilename(prev.getFullYear(), prev.getMonth())
    const blob = await buildExpenseReportPdf({ title: `${monthShort(prev.getMonth())} ${prev.getFullYear()}`, txns: rows, allTxns: all })
    await savePdfReport(blob, filename, { share: false })
    write(KEYS.autoReport, { ...s, lastKey: key })
    notifyImmediate('Monthly report ready', `Your ${monthShort(prev.getMonth())} report was saved. Tap to open it.`, `autoreport-${key}`, ROUTES.report(filename))
    return filename
  } catch (e) {
    console.error('[autoReport] failed', e)
    return null
  } finally {
    running = false
  }
}
