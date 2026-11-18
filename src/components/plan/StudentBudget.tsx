import { useState } from 'react'
import { formatPrice } from '../../lib/core/format'
import { DEFAULT_STUDENT, savePlanSettings, type PlanSettings, type StudentPlan } from '../../lib/plan/plan'

const CAPS = [3000, 5000, 10000, 15000]
const SAVE_GOALS = [0, 500, 1000, 2000]

/**
 * A student's budget, set on the plan page: no spending limit or a total for the month, and an optional amount saved each month.
 * Both take effect at once. Nothing is saved unless the money is put aside.
 */
export default function StudentBudget({ settings }: { settings: PlanSettings }) {
  const st = settings.student ?? DEFAULT_STUDENT
  const [capStr, setCapStr] = useState(st.cap > 0 ? String(st.cap) : '')
  const set = (patch: Partial<StudentPlan>) => savePlanSettings({ student: { ...st, ...patch } })
  const fmt = (v: number) => formatPrice(v, { round: true })

  return (
    <>
      <div className="section-label">Spending this month</div>
      <div className="segmented">
        <button className={st.budget === 'NONE' ? 'on' : ''} onClick={() => set({ budget: 'NONE' })}>No limit</button>
        <button className={st.budget === 'CAP' ? 'on' : ''} onClick={() => { const cap = st.cap || 5000; setCapStr(String(cap)); set({ budget: 'CAP', cap }) }}>Set a limit</button>
      </div>
      {st.budget === 'CAP' && (
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {CAPS.map((c) => <button key={c} className={`chip${st.cap === c ? ' on' : ''}`} onClick={() => { setCapStr(String(c)); set({ cap: c }) }}>{fmt(c)}</button>)}
          </div>
          <input className="input num" inputMode="numeric" value={capStr} placeholder="Or type an amount for the month" aria-label="Monthly spending limit"
            onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 7); setCapStr(v); set({ cap: Number(v) || 0 }) }} />
          {st.cap <= 0 && <div className="dim tiny">Type an amount to set the limit. Until then there is no limit.</div>}
        </div>
      )}
      <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {st.budget === 'CAP' ? 'Going over is shown in plain words, and nothing is taken back from next month.' : 'You spend what you get. The plan shows what is left and what that is per day, without any warnings.'}
      </p>

      <div className="section-label">Saving each month</div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        {SAVE_GOALS.map((s) => <button key={s} className={`chip${st.saveGoal === s ? ' on' : ''}`} onClick={() => set({ saveGoal: s })}>{s === 0 ? 'None' : fmt(s)}</button>)}
      </div>
      <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>A fixed amount, taken off your allowance first. Nothing is saved unless you put it aside.</p>
    </>
  )
}
