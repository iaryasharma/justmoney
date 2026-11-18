import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon, PageHeader, useToast } from '../components/ui/ui'
import { useStored, KEYS } from '../lib/core/storage'
import { buildStory, storyHeadline, storyImage, storySvg } from '../lib/reports/story'
import { CARD_H, CARD_W, svgToUrl } from '../lib/reports/recap'
import { saveFile, shareFile } from '../lib/backup/shareFile'
import { useProfession } from '../lib/plan/profession'
import type { Transaction, User } from '../lib/core/types'

/** Planner page: the year in money, as a card you can share. */
export default function StoryPage({ onBack, toggle }: { onBack: () => void; toggle?: ReactNode }) {
  const toast = useToast()
  const [user] = useStored<User | null>(KEYS.user, null)
  const [all] = useStored<Transaction[]>(KEYS.transactions, [])
  useStored(KEYS.planSaved, {}); useStored(KEYS.savingsGoals, []); useStored(KEYS.planMonths, []); useStored(KEYS.savingsLog, [])
  const { shop } = useProfession()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const s = useMemo(() => buildStory(year, shop), [year, shop, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSvg(null)
    storySvg(s, user?.name?.split(' ')[0] ?? '').then((x) => { if (live) setSvg(svgToUrl(x)) })
    return () => { live = false }
  }, [s, user?.name])
  const first = all.reduce((a, t) => Math.min(a, t.timestamp), Infinity)
  const minYear = Number.isFinite(first) ? new Date(first).getFullYear() : now.getFullYear()

  const share = async () => {
    try {
      const blob = await storyImage(s, user?.name?.split(' ')[0] ?? '')
      const res = await shareFile(`justmoney-${year}-in-money.png`, blob, { title: `My ${year} in money` })
      if (!res.shared && !res.cancelled) toast('Saved', 'Check your downloads')
    } catch (e) { toast('Could not share it', String((e as Error)?.message ?? '').slice(0, 80)) }
  }

  const save = async () => {
    try {
      const blob = await storyImage(s, user?.name?.split(' ')[0] ?? '')
      const { savedTo } = await saveFile(`justmoney-${year}-in-money.png`, blob)
      toast('Card saved', `Saved to ${savedTo}`)
    } catch (e) { toast('Could not save the card', String((e as Error)?.message ?? '').slice(0, 80)) }
  }

  return (
    <div className="page">
      <PageHeader title={toggle ? 'Share your money' : 'Your year in money'} onBack={onBack} />
      {toggle}
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => setYear(year - 1)} disabled={year <= minYear} style={{ opacity: year <= minYear ? 0.3 : 1 }} aria-label="Previous year"><Icon name="back" size={18} /></button>
        <b>{year}</b>
        <button className="icon-btn" onClick={() => setYear(year + 1)} disabled={year >= now.getFullYear()} style={{ opacity: year >= now.getFullYear() ? 0.3 : 1 }} aria-label="Next year"><Icon name="chevron" size={18} /></button>
      </div>
      <div className="recap-frame" role="group" aria-label="Year card">
        {svg ? <img src={svg} alt={`${year} in money: ${storyHeadline(s).big} ${storyHeadline(s).line}`} width={CARD_W} height={CARD_H} /> : <div className="skeleton" style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }} />}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 16 }}>
        <button className="btn grow" onClick={share} disabled={!s.count}><Icon name="share" size={18} /> Share</button>
        <button className="btn secondary grow" onClick={save} disabled={!s.count}><Icon name="download" size={18} /> Save card</button>
      </div>
      {!s.count && <p className="muted small" style={{ textAlign: 'center' }}>No transactions in {year} yet.</p>}
      <p className="dim tiny" style={{ marginTop: 12, lineHeight: 1.5 }}>The card shows amounts, so check it before you share it.</p>
    </div>
  )
}
