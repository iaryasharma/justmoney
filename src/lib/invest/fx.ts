// Exchange rates from the free, key-less open.er-api.com feed, cached for 12 hours.
import { read, write, KEYS } from '../core/storage'

type Cache = Record<string, { at: number; rates: Record<string, number> }>
const TTL = 12 * 3600000

/** Units of `to` per one unit of `from`. Throws when offline with no cached rate. */
export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1
  const cache = read<Cache>(KEYS.fxRates, {})
  const hit = cache[from]
  if (hit && Date.now() - hit.at < TTL && hit.rates[to]) return hit.rates[to]
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`)
    const body = await res.json()
    if (body?.result !== 'success' || !body.rates?.[to]) throw new Error('Rate unavailable')
    write(KEYS.fxRates, { ...cache, [from]: { at: Date.now(), rates: body.rates } })
    return body.rates[to]
  } catch (e) {
    if (hit?.rates[to]) return hit.rates[to] // stale beats nothing
    throw e
  }
}
