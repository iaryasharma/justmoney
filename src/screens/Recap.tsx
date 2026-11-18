import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon, PageHeader, useToast } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { buildRecap, CARD_H, CARD_W, recapHeadline, recapImage, recapSvg, svgToUrl } from '../lib/reports/recap'
import { monthShort } from '../lib/core/format'
import { saveFile, shareFile } from '../lib/backup/shareFile'
import type { Transaction, User } from '../lib/core/types'

/** Planner page: the month as a card you can share. */
export default function RecapPage({ onBack, toggle }: { onBack: () => void; toggle?: ReactNode }) {
  const toast = useToast()
  const [user] = useStored<User | null>(KEYS.user, null)
  const [all] = useStored<Transaction[]>(KEYS.transactions, []) // re-run when entries change
  const now = new Date()
  // After the 25th the month is nearly done, so open this month's; early in the month show last month's wrap-up
  // (or when last month has nothing in it, which would only show an empty card)
  const [sel, setSel] = useState(() => {
    const last = new Date(now.getFullYear(), now.getMonth() - 1)
    const lastHasData = all.some((t) => t.timestamp >= last.getTime() && t.timestamp < new Date(now.getFullYear(), now.getMonth()).getTime())
    return now.getDate() >= 25 || !lastHasData ? { y: now.getFullYear(), m: now.getMonth() } : { y: last.getFullYear(), m: last.getMonth() }
  })
  const r = useMemo(() => buildRecap(sel.y, sel.m), [sel, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const isFuture = sel.y > now.getFullYear() || (sel.y === now.getFullYear() && sel.m >= now.getMonth())
  const shift = (d: number) => { const x = new Date(sel.y, sel.m + d); setSel({ y: x.getFullYear(), m: x.getMonth() }) }
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSvg(null)
    recapSvg(r, user?.name ?? '').then((x) => { if (live) setSvg(svgToUrl(x)) })
    return () => { live = false }
  }, [r, user?.name])

  const share = async () => {
    try {
      const blob = await recapImage(r, user?.name ?? '')
      const res = await shareFile(`justmoney-recap-${monthShort(r.month).toLowerCase()}-${r.year}.png`, blob, { title: `My ${monthShort(r.month)} in money` })
      if (!res.shared && !res.cancelled) toast('Recap saved', 'Check your downloads')
    } catch (e) {
      toast('Could not share the recap', String((e as Error)?.message ?? '').slice(0, 80))
    }
  }

  const save = async () => {
    try {
      const blob = await recapImage(r, user?.name ?? '')
      const { savedTo } = await saveFile(`justmoney-recap-${monthShort(r.month).toLowerCase()}-${r.year}.png`, blob)
      toast('Card saved', `Saved to ${savedTo}`)
    } catch (e) {
      toast('Could not save the card', String((e as Error)?.message ?? '').slice(0, 80))
    }
  }

  return (
    <div className="page">
      <PageHeader title={toggle ? 'Share your money' : 'Monthly recap'} onBack={onBack} />
      {toggle}
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="back" size={18} /></button>
        <b>{monthShort(sel.m)} {sel.y}</b>
        <button className="icon-btn" onClick={() => shift(1)} disabled={isFuture} style={{ opacity: isFuture ? 0.3 : 1 }} aria-label="Next month"><Icon name="chevron" size={18} /></button>
      </div>

      {/* the card is one SVG, so what you see here is exactly the image that gets shared */}
      <div className="recap-frame" role="group" aria-label="Recap card">
        {svg ? <img src={svg} alt={`${monthShort(r.month)} ${r.year} recap: ${recapHeadline(r)}`} width={CARD_W} height={CARD_H} /> : <div className="skeleton" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }} />}
      </div>

      <div className="row" style={{ gap: 10, marginTop: 16 }}>
        <button className="btn grow" onClick={share} disabled={!r.count}><Icon name="share" size={18} /> Share</button>
        <button className="btn secondary grow" onClick={save} disabled={!r.count}><Icon name="download" size={18} /> Save card</button>
      </div>
      {!r.count && <p className="muted small" style={{ textAlign: 'center' }}>No transactions in this month yet.</p>}
    </div>
  )
}
