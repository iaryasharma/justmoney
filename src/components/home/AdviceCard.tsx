import { useMemo, useState } from 'react'
import { Icon, Spinner } from '../ui/ui'
import { useStored, KEYS } from '../../lib/core/storage'
import { aiReady, generateAdvice } from '../../lib/capture/ai'
import { adviceContext, adviceSummary, localAdvice, type Advice, type AdviceArea } from '../../lib/plan/planAdvice'
import type { Insight, Transaction } from '../../lib/core/types'

interface Cached { day: string; area: string; items: Insight[] }
const TONE = { good: 'var(--credit)', warn: 'var(--amber)', bad: 'var(--danger)' } as const
const AREA_LABEL: Record<AdviceArea | 'all', string> = { all: 'your plan', plan: 'your spending plan', pots: 'your pots and late income', shop: 'your shop' }

/** Suggestions about the money, worked out on the phone. With AI switched on, a more personal take can be asked for too. */
export default function AdviceCard({ area = 'all', limit = 4, title = 'Suggestions' }: { area?: AdviceArea | 'all'; limit?: number; title?: string }) {
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  useStored(KEYS.planSettings, {}); useStored(KEYS.planSaved, {}); useStored(KEYS.savingsGoals, []); useStored(KEYS.allocations, []); useStored(KEYS.potMoves, [])
  const [cache, setCache] = useStored<Cached[]>(KEYS.adviceCache, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const today = new Date().toDateString()
  const items = useMemo(() => localAdvice(adviceContext(txns)).filter((a) => area === 'all' || a.area === area).slice(0, limit), [txns, area, limit]) // eslint-disable-line react-hooks/exhaustive-deps
  const ai = aiReady()
  const mine = cache.find((c) => c.area === area && c.day === today)

  const ask = async () => {
    setBusy(true); setErr(null)
    try {
      const got = await generateAdvice(adviceSummary(adviceContext(txns)), AREA_LABEL[area])
      setCache([...cache.filter((c) => !(c.area === area)), { day: today, area, items: got }])
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not get suggestions.') } finally { setBusy(false) }
  }

  if (!items.length && !ai) return null
  return (
    <>
      <div className="group-label">{title}</div>
      <div className="card">
        {items.length === 0 && <div className="empty small">Nothing to flag right now. That is a good sign.</div>}
        {items.map((a: Advice, i) => (
          <div key={i} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ width: 8, height: 8, marginTop: 7, borderRadius: 4, background: TONE[a.tone], flex: 'none' }} />
            <div className="grow"><div style={{ fontWeight: 600 }}>{a.suggestion}</div><div className="dim small" style={{ marginTop: 2, lineHeight: 1.45 }}>{a.tip}</div></div>
          </div>
        ))}
        {mine?.items.map((a, i) => (
          <div key={`ai${i}`} className="list-row" style={{ alignItems: 'flex-start' }}>
            <span style={{ width: 8, height: 8, marginTop: 7, borderRadius: 4, background: 'var(--accent)', flex: 'none' }} />
            <div className="grow"><div style={{ fontWeight: 600 }}>{a.suggestion} <span className="pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', padding: '1px 7px', fontSize: 10 }}>AI</span></div><div className="dim small" style={{ marginTop: 2, lineHeight: 1.45 }}>{a.tip}</div></div>
          </div>
        ))}
      </div>
      {ai
        ? <button className="link small row" style={{ gap: 6, marginTop: 8 }} disabled={busy} onClick={ask}>{busy ? <Spinner /> : <Icon name="sparkles" size={14} />}{mine ? 'Refresh AI suggestions' : 'Get more personal suggestions with AI'}</button>
        : <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>Worked out on your phone. Turn on AI in Settings for more personal ones.</p>}
      {err && <div className="error-text" style={{ marginTop: 6 }}>{err}</div>}
    </>
  )
}
