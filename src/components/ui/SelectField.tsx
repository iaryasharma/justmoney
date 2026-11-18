import { useMemo, useState, type ReactNode } from 'react'
import { Icon, Sheet, SheetHeader } from './ui'

export interface SelectOption { id: string; label: string; icon?: ReactNode; sub?: string }

/**
 * A field that opens a list, instead of a wall of chips: it shows what is chosen, and tapping it opens a searchable list with your
 * most used choices on top. `none` adds a "None" row (for optional fields).
 */
export function SelectField({ title, value, options, recent = [], onChange, none, placeholder = 'Choose', searchAbove = 8 }: {
  title: string; value: string | null; options: SelectOption[]; recent?: string[]; onChange: (id: string | null) => void
  none?: string; placeholder?: string; searchAbove?: number
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const cur = options.find((o) => o.id === value) ?? null
  const shown = useMemo(() => options.filter((o) => !q.trim() || `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [options, q])
  const top = useMemo(() => (q.trim() ? [] : recent.map((id) => options.find((o) => o.id === id)).filter((o): o is SelectOption => !!o).slice(0, 4)), [recent, options, q])
  const close = () => { setOpen(false); setQ('') }
  const pick = (id: string | null) => { onChange(id); close() }
  const row = (o: SelectOption) => (
    <button type="button" key={o.id} className={`sf-row${o.id === value ? ' on' : ''}`} onClick={() => pick(o.id)}>
      {o.icon && <span className="sf-ic">{o.icon}</span>}
      <span className="grow"><b>{o.label}</b>{o.sub && <span className="sf-sub">{o.sub}</span>}</span>
      {o.id === value && <Icon name="check" size={18} stroke={3} />}
    </button>
  )
  return (
    <>
      <button type="button" className="sf-field" onClick={() => setOpen(true)} aria-haspopup="listbox" aria-label={`${title}: ${cur?.label ?? none ?? placeholder}`}>
        {cur?.icon && <span className="sf-ic">{cur.icon}</span>}
        <span className={`grow${cur ? '' : ' dim'}`}>{cur?.label ?? (value === null && none ? none : placeholder)}</span>
        <span className="sf-chev"><Icon name="chevronDown" size={18} /></span>
      </button>
      <Sheet open={open} onClose={close}>
        <SheetHeader title={title} onClose={close} />
        {options.length > searchAbove && (
          <div className="row" style={{ position: 'relative', marginBottom: 10 }}>
            <span className="muted" style={{ position: 'absolute', left: 14, display: 'flex' }}><Icon name="search" size={18} /></span>
            <input className="input search-box" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label={`Search ${title}`} />
          </div>
        )}
        <div className="sf-list" role="listbox">
          {none && !q.trim() && (
            <button type="button" className={`sf-row${value === null ? ' on' : ''}`} onClick={() => pick(null)}><span className="grow"><b>{none}</b></span>{value === null && <Icon name="check" size={18} stroke={3} />}</button>
          )}
          {top.length > 0 && <div className="sf-group">Most used</div>}
          {top.map(row)}
          {top.length > 0 && <div className="sf-group">All</div>}
          {shown.map(row)}
          {shown.length === 0 && <div className="empty small">Nothing matches “{q}”.</div>}
        </div>
      </Sheet>
    </>
  )
}
