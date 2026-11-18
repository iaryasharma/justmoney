// One pipeline for every way an expense arrives: shared screenshots, picked
// receipts, shared/selected text, assistant deep links. It prefers what runs on
// the phone, and only goes to the cloud when that is configured and needed:
//
//   images: ML Kit OCR (on-device) → screenshot parser → Gemini Nano (on-device)
//           → Gemini cloud (if key + consent) → low-confidence guess for review
//   text:   bank-SMS parser → Gemini cloud → Gemini Nano → local text parser
import { recordHold } from '../accounts/holds'
import { Capacitor } from '@capacitor/core'
import { aiReady, extractInfo, extractInfoFromImage, localParseTransaction, sanitizeExtractedTransactions } from './ai'
import { mergeIntoExisting } from './autocapture'
import { addTransactionsBulk, buildVendorCategoryMap, getCategories, isBlockEvent } from '../core/data'
import { getCurrency } from '../core/format'
import { Capture, isNativeApp } from '../core/native'
import { parseScreenshot, type OcrResult } from './screenshot'
import { getFamily, INCOME_CATEGORIES } from '../core/money'
import { enrichFromText } from '../accounts/accounts'
import { looksLikeBankSms, parseBankSmsBatch } from './sms'
import type { NewTransaction, Transaction } from '../core/types'

export type Method = 'on-device' | 'gemini-nano' | 'gemini-cloud' | 'sms' | 'guess'

export interface ImportOutcome {
  added: Transaction[]
  skipped: number
  /** Images that showed a failed / pending payment and were deliberately not saved. */
  failed: number
  /** Images or text where no expense could be found. */
  notFound: number
  /** Screenshots that matched a payment already saved (by its reference, or amount and time): the entry got the payee's name instead of a duplicate. */
  updated?: number
  /** IPO / mandate blocks and unblocks saved as holds, not as transactions. */
  held?: number
  methods: Method[]
  /** At least one entry is a low-confidence guess the user should check. */
  needsReview: boolean
  /** Best partial reading when nothing could be saved (to prefill manual entry). */
  partial?: Partial<NewTransaction>
}

export interface ImageInput { uri?: string; file?: File }

/* ---------- on-device building blocks ---------- */

export async function ocrImage(input: ImageInput): Promise<OcrResult | null> {
  if (!isNativeApp()) return null
  try {
    if (input.uri) return await Capture.ocr({ uri: input.uri })
    if (input.file) return await Capture.ocr({ base64: await toBase64(input.file) })
  } catch { /* fall through to other methods */ }
  return null
}

let nanoState: Promise<string> | null = null
/** "available" | "downloadable" | "downloading" | "unavailable" (cached per session). */
export function nanoStatus(refresh = false): Promise<string> {
  if (!isNativeApp()) return Promise.resolve('unavailable')
  if (!nanoState || refresh) nanoState = Capture.nanoStatus().then((s) => s.status).catch(() => 'unavailable')
  return nanoState
}

/** Asks the on-device model to structure OCR'd or typed text into transactions. */
async function nanoExtract(text: string, what: 'screenshot' | 'message'): Promise<NewTransaction[]> {
  if ((await nanoStatus()) !== 'available') return []
  const prompt = [
    `Extract the money transaction(s) from this ${what === 'screenshot' ? 'payment-app screenshot or receipt (OCR text)' : 'message'}.`,
    `Currency: ${getCurrency()}. Today: ${new Date().toDateString()}.`,
    `Expense categories (DEBIT): ${getCategories().join(', ')}. Income categories (CREDIT): ${INCOME_CATEGORIES.join(', ')}.`,
    `Family members: ${getFamily().map((m) => m.relation ? `${m.name} (${m.relation})` : m.name).join(', ') || 'none saved'}. Money to/from family uses category "Family".`,
    `Known payees and their categories: ${JSON.stringify(buildVendorCategoryMap())}.`,
    'Reply with ONLY a JSON array, no prose, like:',
    '[{"paymentAmount":500,"paymentType":"DEBIT","paymentReceiver":"Swiggy","paymentCategory":"Food","paymentSource":"BANK","timestamp":null}]',
    'paymentType is DEBIT for money paid and CREDIT for money received. Use [] if there is no completed transaction.',
    '---',
    text.slice(0, 4000),
  ].join('\n')
  try {
    const { text: out } = await Capture.nanoGenerate({ prompt })
    const json = out.match(/\[[\s\S]*\]/)?.[0] ?? out.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return []
    const parsed = JSON.parse(json)
    return sanitizeExtractedTransactions(Array.isArray(parsed) ? parsed : [parsed])
  } catch {
    return []
  }
}

/* ---------- images ---------- */

async function readOneImage(input: ImageInput): Promise<{ rows: NewTransaction[]; method?: Method; failed?: boolean; held?: boolean; review?: boolean; partial?: Partial<NewTransaction> }> {
  const ocr = await ocrImage(input)
  let guess: NewTransaction | null = null
  if (ocr && isBlockEvent(ocr.text)) { recordHold(ocr.text, Date.now()); return { rows: [], held: true } } // IPO / mandate block or unblock: kept as a hold
  if (ocr) {
    const p = parseScreenshot(ocr)
    if (p.failed) return { rows: [], failed: true }
    if (p.tx && p.confidence === 'high') return { rows: [p.tx], method: 'on-device' }
    guess = p.tx
    const viaNano = (await nanoExtract(ocr.text, 'screenshot')).map((r) => enrichFromText(r, ocr.text))
    if (viaNano.length) return { rows: viaNano, method: 'gemini-nano' }
  }
  if (aiReady()) {
    try {
      const file = input.file ?? (input.uri ? await uriToFile(input.uri) : null)
      if (file) {
        const rows = await extractInfoFromImage(file)
        if (rows.length) return { rows, method: 'gemini-cloud' }
      }
    } catch { /* offline or quota: fall back to the guess */ }
  }
  if (guess && guess.paymentReceiver !== 'Payment') return { rows: [guess], method: 'guess', review: true }
  return { rows: [], partial: guess ?? undefined }
}

/**
 * The entry a shared receipt is for, already saved from the bank message or notification (within 3 hours), filled in with what the
 * receipt adds. A receipt read as ₹7330 or ₹2330 when the bank recorded ₹330 is that payment: "₹" was read as a leading 7 or 2.
 */
export function matchShared(row: NewTransaction) {
  const tx = { ...row, timestamp: row.timestamp ?? Date.now() }
  const hit = mergeIntoExisting(tx, 'screen', 3 * 3600000)
  if (hit) return hit
  const s = String(row.paymentAmount)
  // shortcut: a real ₹250 receipt whose bank message has not come yet could join a nameless ₹50 entry; OCR confidence per digit would settle it
  return /^[27]\d{2,}(?:\.\d+)?$/.test(s) ? mergeIntoExisting({ ...tx, paymentAmount: Number(s.slice(1)) }, 'screen', 3 * 3600000) : null
}

export async function importImages(inputs: ImageInput[], extra?: Partial<NewTransaction>): Promise<ImportOutcome> {
  const out: ImportOutcome = { added: [], skipped: 0, failed: 0, notFound: 0, methods: [], needsReview: false }
  for (const input of inputs) {
    const r = await readOneImage(input)
    if (r.failed) { out.failed++; continue }
    if (r.held) { out.held = (out.held ?? 0) + 1; continue }
    if (!r.rows.length) { out.notFound++; out.partial ??= r.partial; continue }
    // a payment screenshot of money already saved from the bank message: complete that entry (payee name, reference), do not add another
    const fresh: NewTransaction[] = []
    for (const row of r.rows) {
      // however the picture was read, the bank's entry for the same payment is completed, never doubled
      const hit = matchShared(row)
      if (hit) out.updated = (out.updated ?? 0) + 1
      else fresh.push(row)
    }
    if (!fresh.length) continue
    const res = addTransactionsBulk(fresh.map((x) => ({ ...x, ...(r.method === 'on-device' && (x.paymentApp || x.ref) ? { seenIn: ['screen' as const] } : {}), ...extra })))
    out.added.push(...res.rows)
    out.skipped += res.skipped
    if (r.method && !out.methods.includes(r.method)) out.methods.push(r.method)
    if (r.review) out.needsReview = true
  }
  return out
}

/* ---------- text (shared, selected, or from an assistant) ---------- */

export async function importText(raw: string, extra?: Partial<NewTransaction>): Promise<ImportOutcome> {
  const out: ImportOutcome = { added: [], skipped: 0, failed: 0, notFound: 0, methods: [], needsReview: false }
  const text = raw.trim()
  if (text && isBlockEvent(text)) { out.held = recordHold(text, Date.now()) ? 1 : 0; if (!out.held) out.skipped = 1; return out }
  if (!text) { out.notFound = 1; return out }
  const save = (rows: NewTransaction[], method: Method, review = false) => {
    const res = addTransactionsBulk(rows.map((x) => ({ ...enrichFromText(x, text), ...extra })))
    out.added.push(...res.rows); out.skipped += res.skipped; out.methods.push(method); out.needsReview ||= review
    return out
  }
  if (looksLikeBankSms(text)) {
    const rows = parseBankSmsBatch(text)
    if (rows.length) return save(rows, 'sms')
  }
  if (aiReady()) {
    try { return save([await extractInfo(text)], 'gemini-cloud') } catch { /* try on-device next */ }
  }
  const viaNano = await nanoExtract(text, 'message')
  if (viaNano.length) return save(viaNano, 'gemini-nano')
  const local = localParseTransaction(text)
  if (local) return save([local], 'on-device', !local.paymentReceiver || local.paymentCategory === 'Others')
  out.notFound = 1
  return out
}

/* ---------- helpers ---------- */

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function uriToFile(uri: string): Promise<File | null> {
  try {
    const blob = await (await fetch(Capacitor.convertFileSrc(uri))).blob()
    return new File([blob], 'shared-image', { type: blob.type || 'image/jpeg' })
  } catch {
    return null
  }
}

export const methodLabel: Record<Method, string> = {
  'on-device': 'read on your phone',
  'gemini-nano': 'Gemini Nano (on-device)',
  'gemini-cloud': 'Gemini',
  sms: 'bank SMS',
  guess: 'best guess — please check',
}
