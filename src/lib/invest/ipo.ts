import { activeHoldIds } from '../accounts/holds'
import { investmentResult } from './invest'
import type { Hold, Investment } from '../core/types'

export type IpoStatus = 'BLOCKED' | 'ALLOTTED' | 'REFUNDED'
export interface IpoApplication {
  id: string
  name: string
  amount: number
  appliedAt: number
  status: IpoStatus
  /** When the money came back, or was taken. */
  endedAt?: number | null
  investment?: Investment | null
  /** Gain on the shares, when they are held and priced. */
  gain?: { put: number; worth: number; pct: number } | null
}

/** Your IPO applications, from the blocks the bank told you about: still held, taken as shares, or given back. */
export function ipoApplications(holds: Hold[], investments: Investment[]): IpoApplication[] {
  const live = activeHoldIds(holds)
  const unblocks = holds.filter((h) => h.kind === 'UNBLOCKED')
  const used = new Set<string>()
  return holds.filter((h) => h.kind === 'BLOCKED').sort((a, b) => b.timestamp - a.timestamp).map((h) => {
    if (h.settledBy) {
      const inv = investments.find((i) => i.id === h.investmentId) ?? null
      const r = inv ? investmentResult(inv) : null
      const taken = inv?.flows?.find((f) => f.txId === h.settledBy)?.date ?? null
      return { id: h.id, name: h.name, amount: h.amount, appliedAt: h.timestamp, status: 'ALLOTTED' as const, endedAt: taken, investment: inv,
        gain: r && r.put > 0 ? { put: r.put, worth: r.worth, pct: ((r.worth - r.put) / r.put) * 100 } : null }
    }
    if (live.has(h.id)) return { id: h.id, name: h.name, amount: h.amount, appliedAt: h.timestamp, status: 'BLOCKED' as const }
    const un = unblocks.find((u) => !used.has(u.id) && u.timestamp >= h.timestamp && Math.abs(u.amount - h.amount) < 0.5 && (u.paymentMethodId ?? null) === (h.paymentMethodId ?? null))
    if (un) used.add(un.id)
    return { id: h.id, name: h.name, amount: h.amount, appliedAt: h.timestamp, status: 'REFUNDED' as const, endedAt: un?.timestamp ?? null }
  })
}

