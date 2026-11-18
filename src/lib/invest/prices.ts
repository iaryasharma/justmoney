// Live share prices from Yahoo Finance (no key needed).
// Prices are cached for a few minutes so a portfolio fits inside a free plan's request limit.
import { CapacitorHttp } from '@capacitor/core'
import { isNativeApp } from '../core/native'
import { read, write, KEYS } from '../core/storage'
import type { Investment } from '../core/types'

export interface Quote { price: number; at: number; source: 'yahoo'; /** previous close, for today's change */ prev?: number }
const TTL = 5 * 60 * 1000

export const priceKey = (symbol: string, exchange: string) => `${exchange}:${symbol.toUpperCase()}`
export const getCache = () => read<Record<string, Quote>>(KEYS.priceCache, {})
export const cachedPrice = (inv: Pick<Investment, 'symbol' | 'exchange'>) => (inv.symbol ? getCache()[priceKey(inv.symbol, inv.exchange ?? 'NSE')] : undefined)

function safeParse(s: string) { try { return JSON.parse(s) } catch { return null } }

export async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  if (isNativeApp()) {
    const r = await CapacitorHttp.get({ url, headers })
    const body = typeof r.data === 'string' ? safeParse(r.data) : r.data
    if (r.status >= 400) throw new Error(body?.message ?? `HTTP ${r.status}`)
    return body
  }
  const r = await fetch(url, { headers })
  const body = safeParse(await r.text())
  if (!r.ok) throw new Error(body?.message ?? `HTTP ${r.status}`)
  return body
}

async function yahoo(symbol: string, exchange: string): Promise<{ price: number; prev?: number } | null> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}.${exchange === 'BSE' ? 'BO' : 'NS'}?interval=1d&range=1d`
  let last: Error | null = null
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJson(`https://${host}.finance.yahoo.com${path}`, { 'User-Agent': 'Mozilla/5.0' })
      const meta = j?.chart?.result?.[0]?.meta
      const p = Number(meta?.regularMarketPrice)
      const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose)
      return Number.isFinite(p) && p > 0 ? { price: p, prev: Number.isFinite(prev) && prev > 0 ? prev : undefined } : null
    } catch (e) {
      // 404 just means this ticker is not on that exchange; anything else is worth trying the other host for
      if (/not found|404/i.test((e as Error).message)) return null
      last = e as Error
    }
  }
  if (last) throw last
  return null
}

/** Yahoo Finance quote for a share: tries the given exchange first, then the other one, on two Yahoo hosts. */
async function quote(symbol: string, exchange: string): Promise<{ price: number; prev?: number } | null> {
  const order = exchange === 'BSE' ? ['BSE', 'NSE'] : ['NSE', 'BSE']
  for (const ex of order) {
    const p = await yahoo(symbol, ex)
    if (p) return p
  }
  return null
}

/**
 * Fetches prices for these holdings (those with a symbol), skipping ones fresh in the cache unless forced.
 * Returns how many were updated and the last problem seen, if any.
 */
export async function refreshPrices(list: Investment[], force = false): Promise<{ updated: number; error?: string }> {
  const cache = getCache()
  const now = Date.now()
  const want = list.filter((i) => i.symbol && !i.closedAt).map((i) => ({ s: i.symbol!.toUpperCase().replace(/\.(NS|BO)$/, ''), e: i.exchange ?? 'NSE' }))
    .filter((x, i, a) => a.findIndex((y) => y.s === x.s && y.e === x.e) === i)
    .filter((x) => force || !cache[priceKey(x.s, x.e)] || now - cache[priceKey(x.s, x.e)].at > TTL)
  if (!want.length) return { updated: 0 }
  const next = { ...cache }
  let error: string | undefined
  let updated = 0
  const results = await Promise.all(want.map(async (x) => {
    try { return { x, p: await quote(x.s, x.e) } } catch (e) { error = (e as Error).message; return { x, p: null } }
  }))
  for (const { x, p } of results) {
    if (p) { next[priceKey(x.s, x.e)] = { price: p.price, prev: p.prev, at: now, source: 'yahoo' }; updated++ } else error ??= `No price found for ${x.s}. Check the ticker.`
  }
  if (updated) write(KEYS.priceCache, next)
  return { updated, error: updated === want.length ? undefined : error }
}

/** The price of one share right now, for checking a ticker. */
export async function testPrices(symbol = 'RELIANCE', exchange = 'NSE'): Promise<{ price: number | null; problem?: string }> {
  try { return { price: (await quote(symbol.toUpperCase(), exchange))?.price ?? null } } catch (e) { return { price: null, problem: (e as Error).message } }
}

export type ChartRange = '1D' | '5D' | '1M' | '6M' | '1Y' | '5Y'
const RANGES: Record<ChartRange, { range: string; interval: string }> = {
  '1D': { range: '1d', interval: '5m' }, '5D': { range: '5d', interval: '15m' }, '1M': { range: '1mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' }, '1Y': { range: '1y', interval: '1d' }, '5Y': { range: '5y', interval: '1wk' },
}
export interface ChartData { points: { t: number; c: number }[]; price: number; prev?: number }

/** Price history for the chart (Yahoo Finance), trying the chosen exchange first and the other as a fallback. */
export async function fetchChart(symbol: string, exchange: string, range: ChartRange): Promise<ChartData | null> {
  const { range: r, interval } = RANGES[range]
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/, '')
  for (const ex of exchange === 'BSE' ? ['BO', 'NS'] : ['NS', 'BO']) {
    try {
      const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}.${ex}?interval=${interval}&range=${r}`, { 'User-Agent': 'Mozilla/5.0' })
      const res = j?.chart?.result?.[0]
      const ts: number[] = res?.timestamp ?? []
      const close: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? []
      const points = ts.map((t, i) => ({ t: t * 1000, c: close[i] as number })).filter((p) => Number.isFinite(p.c) && p.c > 0)
      if (points.length > 1) return { points, price: Number(res.meta?.regularMarketPrice) || points[points.length - 1].c, prev: Number(res.meta?.chartPreviousClose) || undefined }
    } catch { /* try the other exchange */ }
  }
  return null
}
