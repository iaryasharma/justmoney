// Several payments in one line: "tea 20, auto 100 and lunch 250" becomes three entries.
import { localParseTransaction } from './ai'
import type { NewTransaction } from '../core/types'

/** Splits a typed line into pieces that each carry their own amount. Returns one piece when it is a single payment. */
export function splitEntries(text: string): string[] {
  const pieces = text.split(/\n|;|,(?!\d{3}\b)|\s+(?:and|&|\+)\s+/i).map((p) => p.trim()).filter(Boolean)
  const withAmount = pieces.filter((p) => /\d/.test(p))
  // every piece needs a number, or this is one sentence with a comma in it
  return pieces.length > 1 && withAmount.length === pieces.length ? pieces : [text.trim()]
}

/** The payments in a typed line, when it holds more than one and each can be read without the cloud AI. */
export function parseMany(text: string): NewTransaction[] | null {
  const pieces = splitEntries(text)
  if (pieces.length < 2) return null
  const rows = pieces.map((p) => localParseTransaction(p))
  return rows.every((r): r is NewTransaction => !!r) ? rows : null
}
