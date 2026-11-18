import { useEffect, useRef, useState } from 'react'
import { Capture, isNativeApp } from '../lib/core/native'

const APP_ICONS = [
  { id: 'Default', label: 'Violet' },
  { id: 'Classic', label: 'Classic red' },
  { id: 'ClassicPink', label: 'Classic pink' },
  { id: 'ClassicBlue', label: 'Classic blue' },
  { id: 'ClassicOcean', label: 'Classic ocean' },
  { id: 'ClassicMidnight', label: 'Classic midnight' },
  { id: 'Rose', label: 'Rose' },
  { id: 'Blue', label: 'Blue' },
  { id: 'Green', label: 'Green' },
  { id: 'Orange', label: 'Orange' },
  { id: 'Pink', label: 'Pink' },
  { id: 'Teal', label: 'Teal' },
  { id: 'Crimson', label: 'Crimson' },
  { id: 'Gold', label: 'Gold' },
  { id: 'Light', label: 'Light' },
  { id: 'Mono', label: 'Mono' },
  { id: 'Sunset', label: 'Sunset' },
  { id: 'Ocean', label: 'Ocean' },
  { id: 'Aurora', label: 'Aurora' },
  { id: 'Midnight', label: 'Midnight' },
  { id: 'Coin', label: 'Coin' },
  { id: 'Growth', label: 'Growth' },
  { id: 'Orbit', label: 'Orbit' },
  { id: 'Wallet', label: 'Wallet' },
  { id: 'Ledger', label: 'Ledger' }
]

const HERO_ICONS = [
  { id: 'Spiderman', label: 'Spider-Man' },
  { id: 'SpidermanBlack', label: 'Spider-Man black' },
  { id: 'SpidermanVerse', label: 'Spider-Verse' },
  { id: 'SpidermanWeb', label: 'Web Jm' },
  { id: 'SpidermanTrapped', label: 'Jm in the web' },
  { id: 'SpidermanGlitch', label: 'Spider-Verse glitch' },
  { id: 'Thor', label: 'Thor' },
  { id: 'Captain', label: 'Captain America' },
  { id: 'CaptainJm', label: 'Captain America Jm' },
  { id: 'Doom', label: 'Doctor Doom' },
  { id: 'DoomHood', label: 'Doctor Doom hood' },
  { id: 'BlackPanther', label: 'Black Panther' },
  { id: 'BlackPantherPurple', label: 'Black Panther purple' },
  { id: 'Loki', label: 'Loki' },
  { id: 'IronMan', label: 'Iron Man' },
  { id: 'MoonKnightLight', label: 'Moon Knight light' },
  { id: 'MoonKnightEyesDark', label: 'Moon Knight dark' },
  { id: 'MoonKnightCrescent', label: 'Moon Knight crescent' },
  { id: 'MoonKnightNight', label: 'Moon Knight night' },
  { id: 'MoonKnightHood', label: 'Moon Knight hood' },
  { id: 'MrKnight', label: 'Mr. Knight' },
  { id: 'Deadpool', label: 'Deadpool' },
  { id: 'Wolverine', label: 'Wolverine' },
  { id: 'DoctorStrange', label: 'Doctor Strange' }
]

const SHOW_ICONS = [
  { id: 'Wednesday', label: 'Wednesday' },
  { id: 'MissMinutes', label: 'Miss Minutes' },
  { id: 'LokiTimeline', label: 'Sacred timeline' },
  { id: 'StrangerUpsideDown', label: 'Upside Down' },
  { id: 'StrangerLights', label: 'Christmas lights' },
  { id: 'StrangerDemogorgon', label: 'Demogorgon' },
  { id: 'StrangerEleven', label: 'Eleven 011' },
  { id: 'StrangerHellfire', label: 'Hellfire d20' },
  { id: 'StrangerCinematic', label: 'Stranger cinematic' },
  { id: 'StrangerRed', label: 'Stranger red' },
  { id: 'StrangerForest', label: 'Stranger forest' },
  { id: 'StrangerMax', label: 'Max headphones' },
  { id: 'BreakingBad', label: 'Breaking Bad' },
  { id: 'BreakingElement', label: 'Element tile' },
  { id: 'BreakingElement2', label: 'Element tile 2' },
  { id: 'BreakingHeisenberg', label: 'Heisenberg' },
  { id: 'MentalistWatch', label: 'Pocket watch' },
  { id: 'RedJohn', label: 'Red John' },
  { id: 'DarkSeries', label: 'Dark' },
  { id: 'DarkTriquetra', label: 'Dark knot' },
  { id: 'DarkLoop', label: 'Dark time loop' },
  { id: 'DarkWinden', label: 'Winden' },
  { id: 'SquidGame', label: 'Squid Game' },
  { id: 'MoneyHeist', label: 'Money Heist' },
  { id: 'HarryPotter', label: 'Harry Potter' }
]

const GAME_ICONS = [
  { id: 'GTA', label: 'GTA' },
  { id: 'Valorant', label: 'Valorant' },
  { id: 'Gaming', label: 'Gaming' },
  { id: 'AmongUs', label: 'Among Us' },
  { id: 'GodOfWar', label: 'God of War' },
  { id: 'BlackMythWukong', label: 'Black Myth: Wukong' },
  { id: 'GhostOfTsushima', label: 'Ghost of Tsushima' }
]

const ANIME_ICONS = [
  { id: 'OPLuffy', label: 'Luffy' },
  { id: 'OPZoro', label: 'Zoro' },
  { id: 'OPNami', label: 'Nami' },
  { id: 'OPUsopp', label: 'Usopp' },
  { id: 'OPSanji', label: 'Sanji' },
  { id: 'OPChopper', label: 'Chopper' },
  { id: 'OPRobin', label: 'Robin' },
  { id: 'OPFranky', label: 'Franky' },
  { id: 'OPBrook', label: 'Brook' },
  { id: 'OPJinbe', label: 'Jinbe' },
  { id: 'OPAce', label: 'Ace' },
  { id: 'OPSabo', label: 'Sabo' },
  { id: 'DSTanjiro', label: 'Tanjiro' },
  { id: 'DSNezuko', label: 'Nezuko' },
  { id: 'DSZenitsu', label: 'Zenitsu' },
  { id: 'DSInosuke', label: 'Inosuke' },
  { id: 'DragonBall', label: 'Dragon Ball' },
  { id: 'Pokemon', label: 'Pokémon' },
  { id: 'DeathNote', label: 'Death Note' }
]

const DRINK_ICONS = [
  { id: 'DietCoke', label: 'Diet Coke' },
  { id: 'RedBull', label: 'Red Bull' },
  { id: 'MonsterEnergy', label: 'Monster Energy' }
]

const FESTIVE_ICONS = [
  { id: 'Diwali', label: 'Diwali' },
  { id: 'Holi', label: 'Holi' },
  { id: 'Christmas', label: 'Christmas' },
  { id: 'Halloween', label: 'Halloween' },
  { id: 'Sankranti', label: 'Makar Sankranti' },
  { id: 'Rakhi', label: 'Rakhi' },
  { id: 'Navratri', label: 'Navratri' }
]
import { Icon, PageHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { restoreTransaction, updateTransaction, withFamily } from '../lib/core/data'
import { deleteForever, daysLeftInTrash, emptyTrash, type ActivityEntry, type TrashItem, TRASH_DAYS } from '../lib/core/trash'
import { clearErrors, formatReport, getErrors, type ErrorEntry } from '../lib/core/diagnostics'
import { applyAccent, ACCENTS } from '../lib/core/accent'
import { formatPrice } from '../lib/core/format'
import { shareFile } from '../lib/backup/shareFile'
import { read, write, useStored, KEYS } from '../lib/core/storage'
import type { CategoryBudgets, CategoryRule, SavingsGoal } from '../lib/core/types'
import type { Envelope } from './Envelopes'

const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  const d = Math.round(m / 1440)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

const SwitchRow = ({ icon, label, sub, on, onChange }: { icon: string; label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) => (
  <div className="list-row">
    <span className="icon-tile" style={{ background: 'var(--glass)' }}><Icon name={icon} size={18} /></span>
    <div className="grow"><div>{label}</div>{sub && <div className="dim small">{sub}</div>}</div>
    <Toggle on={on} onChange={onChange} label={label} />
  </div>
)

/* ---------- Trash & activity ---------- */
export function TrashPage({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [trash] = useStored<TrashItem[]>(KEYS.trash, [])
  const [activity] = useStored<ActivityEntry[]>(KEYS.activity, [])
  const [tab, setTab] = useState<'trash' | 'activity'>('trash')
  const ICON: Record<ActivityEntry['action'], string> = { added: 'plus', edited: 'edit', deleted: 'trash', restored: 'refresh' }
  return (
    <div className="page">
      <PageHeader title="Trash & activity" onBack={onBack} />
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'trash'} className={tab === 'trash' ? 'on' : ''} onClick={() => setTab('trash')}>Trash{trash.length ? ` (${trash.length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity</button>
      </div>
      {tab === 'trash' ? (
        <>
          <p className="dim small" style={{ margin: '10px 4px' }}>Deleted transactions stay here for {TRASH_DAYS} days, then are removed for good.</p>
          {trash.length === 0 ? <div className="empty"><b>Trash is empty</b>Deleted transactions appear here so you can bring them back.</div> : (
            <>
              <div className="card">
                {trash.map((i) => (
                  <div key={i.tx.id} className="list-row" style={{ alignItems: 'center' }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis">{i.tx.paymentReceiver}</div>
                      <div className="dim tiny">{i.tx.paymentCategory} · deleted {ago(i.deletedAt)} · {daysLeftInTrash(i.deletedAt)}d left</div>
                    </div>
                    <b className="num" style={{ color: i.tx.paymentType === 'CREDIT' ? 'var(--credit)' : 'var(--up)' }}>{i.tx.paymentType === 'CREDIT' ? '+' : '-'} {formatPrice(i.tx.paymentAmount, { round: true })}</b>
                    <button className="pill-btn" onClick={() => { restoreTransaction(i.tx); toast('Restored', i.tx.paymentReceiver) }}>Restore</button>
                    <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={`Delete ${i.tx.paymentReceiver} forever`} onClick={async () => { if (await confirm({ title: 'Delete forever?', body: 'This cannot be undone.', confirm: 'Delete', danger: true })) deleteForever(i.tx.id) }}><Icon name="close" size={14} /></button>
                  </div>
                ))}
              </div>
              <button className="btn block danger" style={{ marginTop: 14 }} onClick={async () => { if (await confirm({ title: 'Empty trash?', body: `${trash.length} transaction${trash.length === 1 ? '' : 's'} will be deleted for good.`, confirm: 'Empty', danger: true })) emptyTrash() }}>Empty trash</button>
            </>
          )}
        </>
      ) : activity.length === 0 ? <div className="empty"><b>No activity yet</b>Adds, edits, deletes and restores are listed here.</div> : (
        <div className="card" style={{ marginTop: 12 }}>
          {activity.map((a) => (
            <div key={a.id} className="list-row" style={{ alignItems: 'center' }}>
              <span className="icon-tile"><Icon name={ICON[a.action]} size={16} /></span>
              <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis"><span style={{ textTransform: 'capitalize' }}>{a.action}</span> · {a.title}</div><div className="dim tiny">{ago(a.at)}</div></div>
              <span className="num small">{a.type === 'CREDIT' ? '+' : '-'} {formatPrice(a.amount, { round: true })}</span>
              {a.before && activity.find((x) => x.before?.id === a.before!.id) === a && <button className="qchip" onClick={() => { updateTransaction(a.before!.id, a.before!); toast('Change undone', a.before!.paymentReceiver) }}>Undo</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Diagnostics ---------- */
export function DiagnosticsPage({ onBack, version }: { onBack: () => void; version: string }) {
  const toast = useToast()
  const [errors] = useStored<ErrorEntry[]>(KEYS.errorLog, [])
  const [captures] = useStored<{ at: number; pkg: string; app: string | null; ok: boolean }[]>(KEYS.captureLog, [])
  const share = async () => {
    const text = formatReport(version)
    try {
      if (navigator.share) await navigator.share({ title: 'JustMoney diagnostics', text })
      else { await navigator.clipboard.writeText(text); toast('Copied', 'Paste it into a message') }
    } catch (e) { if ((e as Error)?.name !== 'AbortError') toast('Could not share the report') }
  }
  return (
    <div className="page">
      <PageHeader title="Diagnostics" onBack={onBack} />
      <p className="muted small">If something misbehaves, JustMoney notes the error here — on this phone only. Share the report when you ask for help. It contains no transactions or amounts.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn grow" onClick={share} disabled={!errors.length}><Icon name="share" size={18} /> Share report</button>
        <button className="btn secondary grow" disabled={!errors.length} onClick={() => { clearErrors(); toast('Cleared') }}>Clear</button>
      </div>
      {errors.length === 0 ? <div className="empty"><b>No errors recorded</b>Everything looks healthy.</div> : (
        <div className="card" style={{ marginTop: 12 }}>
          {errors.map((e, i) => (
            <div key={`${e.at}-${i}`} style={{ padding: '12px 14px', borderTop: i ? '1px solid var(--divider)' : undefined }}>
              <div className="small" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{e.message}</div>
              <div className="dim tiny">{ago(e.at)}{e.where ? ` · ${e.where}` : ''}</div>
            </div>
          ))}
        </div>
      )}
      {captures.length > 0 && (
        <>
          <div className="section-label">Payment notifications seen</div>
          <div className="card">
            {captures.slice(0, 12).map((c, i) => (
              <div key={`${c.at}-${i}`} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><div className="small" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{c.pkg}</div><div className="dim tiny">{c.app ? `Recognised as ${c.app}` : 'App not recognised'} · {ago(c.at)}</div></div>
                <span className="small" style={{ color: c.ok ? 'var(--credit)' : 'var(--amber)' }}>{c.ok ? 'Added' : 'Not read'}</span>
              </div>
            ))}
          </div>
          <p className="dim tiny" style={{ lineHeight: 1.5 }}>Only the app name and the result are kept, never the message. If a business app shows “Not recognised” or “Not read”, share this with the developer.</p>
        </>
      )}
      <p className="dim tiny" style={{ textAlign: 'center', marginTop: 16 }}>JustMoney v{version}</p>
    </div>
  )
}

/* ---------- Customize Home ---------- */
const SECTIONS: [string, string, string][] = [
  ['donut', 'Spending chart', 'pie'], ['budget', 'Budget card', 'target'], ['safe', 'Safe to spend today', 'wallet'], ['forecast', 'Month-end forecast', 'trend'],
  ['categoryBudgets', 'Category budgets', 'tag'], ['accounts', 'Bank balances', 'bank'], ['goals', 'Goal & round-ups', 'star'],
]

export function CustomizeHomePage({ onBack }: { onBack: () => void }) {
  const [layout, setLayout] = useStored<{ hidden: string[] }>(KEYS.homeLayout, { hidden: ['safe'] })
  const [hideOnLaunch, setHideOnLaunch] = useStored<boolean>(KEYS.hideOnLaunch, false)
  const [accent, setAccent] = useStored<string>(KEYS.accent, 'purple')
  const toast = useToast()
  const [appIcon, setAppIcon] = useState('Default')
  const [openGroups, setOpenGroups] = useState<string[]>(['App icon']) // only the default icons are open at first
  useEffect(() => { if (isNativeApp()) Capture.getAppIcon().then((r) => setAppIcon(r.name)).catch(() => {}) }, [])
  const [theme, setTheme] = useStored<'dark' | 'light' | 'system'>(KEYS.theme, 'dark')
  const toggle = (k: string, on: boolean) => setLayout({ hidden: on ? layout.hidden.filter((x) => x !== k) : [...layout.hidden, k] })
  return (
    <div className="page">
      <PageHeader title="Appearance" onBack={onBack} />
      <div className="group-label">Theme</div>
      <div className="card pad">
        <div className="segmented">
          {(['dark', 'light', 'system'] as const).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t.toUpperCase()}</button>)}
        </div>
      </div>

      <div className="group-label">Show on Home</div>
      <div className="card">{SECTIONS.map(([k, label, icon]) => <SwitchRow key={k} icon={icon} label={label} on={!layout.hidden.includes(k)} onChange={(v) => toggle(k, v)} />)}</div>

      <div className="group-label">Privacy</div>
      <div className="card"><SwitchRow icon="eyeOff" label="Hide amounts on launch" sub="Tap the eye on Home to reveal them" on={hideOnLaunch} onChange={setHideOnLaunch} /></div>

      <div className="group-label">Accent colour</div>
      <div className="card pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: '14px 8px' }} role="radiogroup" aria-label="Accent colour">
        {Object.entries(ACCENTS).map(([id, a]) => (
          <button key={id} role="radio" aria-checked={accent === id} aria-label={a.label} onClick={() => { setAccent(id); applyAccent(id) }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'none', padding: 0, color: 'var(--text)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 20, background: `linear-gradient(145deg, ${a.c}, ${a.deep})`, outline: accent === id ? '3px solid var(--text)' : 'none', outlineOffset: 3, display: 'grid', placeItems: 'center', color: '#fff' }}>
              {accent === id && <Icon name="check" size={18} stroke={3} />}
            </span>
            <span className="tiny" style={{ fontWeight: accent === id ? 700 : 500, textAlign: 'center', lineHeight: 1.2 }}>{a.label}</span>
          </button>
        ))}
      </div>

      {isNativeApp() && (
        <>
          {([['App icon', APP_ICONS], ['Festive icons', FESTIVE_ICONS], ['Hero icons', HERO_ICONS], ['Web series', SHOW_ICONS], ['Game icons', GAME_ICONS], ['Anime', ANIME_ICONS], ['Drinks', DRINK_ICONS]] as const).map(([title, list]) => (
            <div key={title}>
              <button className="group-label" aria-expanded={openGroups.includes(title)} onClick={() => setOpenGroups((g) => (g.includes(title) ? g.filter((x) => x !== title) : [...g, title]))}
                style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8, textAlign: 'left', cursor: 'pointer' }}>
                <span className="grow">{title} <span className="dim" style={{ fontWeight: 400 }}>· {list.length}</span></span>
                <span style={{ display: 'grid', transform: openGroups.includes(title) ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}><Icon name="chevron" size={16} /></span>
              </button>
              {openGroups.includes(title) && <div className="card pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: '18px 8px', alignItems: 'start' }} role="radiogroup" aria-label={title}>
              {list.map((ic) => (
                <button key={ic.id} role="radio" aria-checked={appIcon === ic.id} aria-label={`${ic.label} icon`} onClick={() => { setAppIcon(ic.id); Capture.setAppIcon({ name: ic.id }).then(() => toast('App icon changed', 'Your launcher may take a moment to update it.')).catch(() => {}) }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%', color: 'var(--text)', padding: 0 }}>
                  <img src={`/icons/icon-${ic.id.toLowerCase()}.png`} width={56} height={56} alt="" style={{ flex: 'none', borderRadius: 16, outline: appIcon === ic.id ? '3px solid var(--accent)' : 'none', outlineOffset: 2 }} />
                  <span className="tiny" style={{ opacity: appIcon === ic.id ? 1 : .7, textAlign: 'center', lineHeight: 1.25, overflowWrap: 'anywhere' }}>{ic.label}</span>
                </button>
              ))}
              </div>}
            </div>
          ))}
        </>
      )}

    </div>
  )
}

/* ---------- Partner setup ---------- */
interface SetupFile { app: 'justmoney-setup'; version: 1; envelopes: Envelope[]; categoryBudgets: CategoryBudgets; categories: string[] | null; rules: CategoryRule[]; goals: Pick<SavingsGoal, 'name' | 'target' | 'deadline' | 'color'>[] }

/** Share your budget setup (not your transactions) with a partner, and merge theirs into yours. */
export function PartnerPage({ onBack }: { onBack: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const build = (): SetupFile => ({
    app: 'justmoney-setup', version: 1,
    envelopes: read<Envelope[]>(KEYS.envelopes, []), categoryBudgets: read<CategoryBudgets>(KEYS.categoryBudgets, {}), categories: read<string[] | null>(KEYS.categories, null),
    rules: read<CategoryRule[]>(KEYS.categoryRules, []),
    goals: read<SavingsGoal[]>(KEYS.savingsGoals, []).map((g) => ({ name: g.name, target: g.target, deadline: g.deadline, color: g.color })),
  })
  const exportSetup = async () => {
    const blob = new Blob([JSON.stringify(build(), null, 2)], { type: 'application/json' })
    try {
      // saved in Documents/JustMoney, then the phone's share sheet opens so it can be sent straight away
      const r = await shareFile('justmoney-setup.json', blob, { title: 'My JustMoney setup', keep: true })
      if (r.savedTo && !r.shared) toast('Setup file saved', r.savedTo)
      else if (!r.shared && !r.cancelled) toast('Setup file saved')
    } catch (e) { toast('Could not share the setup', String((e as Error)?.message ?? '').slice(0, 80)) }
  }
  const importSetup = async (f: File) => {
    let d: SetupFile
    try { d = JSON.parse(await f.text()) } catch { toast('Not a JustMoney setup file'); return }
    if (d?.app !== 'justmoney-setup') { toast('Not a JustMoney setup file'); return }
    if (!(await confirm({ title: 'Add this setup?', body: 'Envelopes, budgets, categories, rules and goals you don’t already have are added. Nothing you have is changed or removed, and no transactions are imported.', confirm: 'Add' }))) return
    let added = 0
    const envs = read<Envelope[]>(KEYS.envelopes, [])
    for (const e of d.envelopes ?? []) if (!envs.some((x) => x.name.toLowerCase() === e.name.toLowerCase())) { envs.push({ ...e, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }); added++ }
    write(KEYS.envelopes, envs)
    const budgets = read<CategoryBudgets>(KEYS.categoryBudgets, {})
    for (const [c, v] of Object.entries(d.categoryBudgets ?? {})) if (!(budgets[c] > 0)) { budgets[c] = v; added++ }
    write(KEYS.categoryBudgets, budgets)
    const mine = withFamily(read<string[] | null>(KEYS.categories, null))
    const extra = (d.categories ?? []).filter((c) => !mine.includes(c))
    if (extra.length) { write(KEYS.categories, [...mine.slice(0, -1), ...extra, ...mine.slice(-1)]); added += extra.length }
    const rules = read<CategoryRule[]>(KEYS.categoryRules, [])
    for (const r of d.rules ?? []) if (!rules.some((x) => x.match.toLowerCase() === r.match.toLowerCase())) { rules.push({ ...r, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }); added++ }
    write(KEYS.categoryRules, rules)
    const goals = read<SavingsGoal[]>(KEYS.savingsGoals, [])
    for (const g of d.goals ?? []) if (!goals.some((x) => x.name.toLowerCase() === g.name.toLowerCase())) { goals.push({ ...g, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, saved: 0, createdAt: Date.now() }); added++ }
    write(KEYS.savingsGoals, goals)
    toast(added ? `Added ${added} item${added === 1 ? '' : 's'}` : 'Nothing new to add', 'Budget setup merged')
  }
  return (
    <div className="page">
      <PageHeader title="Share setup" onBack={onBack} />
      <p className="muted small">Running a household budget together? Send your envelopes, budgets, categories, auto-categorise rules and goals to your partner, and add theirs to yours. Transactions are never shared.</p>
      <div className="col" style={{ marginTop: 14 }}>
        <button className="btn block" onClick={exportSetup}><Icon name="share" size={18} /> Send my setup</button>
        <button className="btn block secondary" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} /> Add a partner’s setup</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importSetup(f); e.target.value = '' }} />
      </div>
      <p className="dim tiny" style={{ marginTop: 14 }}>Live syncing between two phones needs an online service, which JustMoney deliberately doesn’t have — your data stays on your device.</p>
    </div>
  )
}

export { getErrors }
