import { useMemo, useState } from 'react'
import ContactPicker, { Avatar } from '../components/people/ContactPicker'
import LinkReview from '../components/people/LinkReview'
import { Icon, PageHeader, Sheet, SheetHeader, Toggle, useConfirm, useToast } from '../components/ui/ui'
import { formatPrice } from '../lib/core/format'
import { RELATIONS } from '../lib/core/money'
import { addAlias, importAllContacts, personStats, removePerson, setRelation, updatePerson } from '../lib/payees/people'
import { isNativeApp } from '../lib/core/native'
import { createLoan, isSettledLoan, linkLoanToPerson, loanIsWith, outstanding, personLoans } from '../lib/payees/loans'
import { behalfBalance, behalfPeople, isOnBehalf } from '../lib/accounts/behalf'
import { friendBalances, type FriendBalance, type SplitPerson, type SplitProject, type SplitRow, type SplitTxn } from '../lib/split/split'
import { creditTotals } from '../lib/payees/udhaar'
import { useProfession } from '../lib/plan/profession'
import type { CreditSale } from '../lib/core/types'
import type { Loan } from '../lib/core/types'
import { looksLikePerson } from '../lib/payees/suggest'
import { normName } from '../lib/payees/peopleMatch'
import type { Person } from '../lib/payees/peopleMatch'
import { useStored, KEYS } from '../lib/core/storage'
import type { Transaction } from '../lib/core/types'

/** A person's open balances in split groups (groups name people freely, so they are matched by name or nickname). */
const splitsWith = (p: Person, list: FriendBalance[]) => {
  const names = [p.name, ...p.aliases].map(normName)
  return list.filter((b) => b.direction !== 'settled' && names.includes(normName(b.person.name)))
}
/** What a split group says: above 0 they owe you, below 0 you owe them. */
const splitNet = (list: FriendBalance[]) => list.reduce((a, b) => a + (b.direction === 'owes-you' ? b.amount : -b.amount), 0)

/**
 * People from your contacts, and everything owed between you and them in one place: loans, split groups and money
 * handled on their behalf. Opened from the Planner it also leads to the loans, split groups and (for a shop) customer credit.
 */
export function PeoplePage({ onBack, open: openPage }: { onBack: () => void; open?: (p: 'loans' | 'split' | 'udhaar') => void }) {
  const [people] = useStored<Person[]>(KEYS.people, [])
  const [txns] = useStored<Transaction[]>(KEYS.transactions, [])
  const [autoLink, setAutoLink] = useStored<boolean>(KEYS.autoLinkNames, false)
  const [loans] = useStored<Loan[]>(KEYS.loans, [])
  const [projects] = useStored<SplitProject[]>(KEYS.splitProjects, [])
  const [splitPeople] = useStored<SplitPerson[]>(KEYS.splitPeople, [])
  const [splitTxns] = useStored<SplitTxn[]>(KEYS.splitTransactions, [])
  const [splitRows] = useStored<SplitRow[]>(KEYS.splits, [])
  const splits = useMemo(() => friendBalances(projects, splitPeople, splitTxns, splitRows), [projects, splitPeople, splitTxns, splitRows])
  const [credits] = useStored<CreditSale[]>(KEYS.creditSales, [])
  const { shop } = useProfession()
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [importing, setImporting] = useState(false)
  const toast = useToast()
  const [reviewing, setReviewing] = useState(false)
  const toLink = new Set(txns.filter((t) => !t.contactId && !t.loanId && looksLikePerson(t.paymentReceiver, t.paymentCategory)).map((t) => normName(t.paymentReceiver))).size
  const [openId, setOpenId] = useState<string | null>(null)
  const open = people.find((p) => p.id === openId) ?? null
  const active = (p: Person) => !p.imported || !!p.familyId || (p.aliases?.length ?? 0) > 0 || txns.some((t) => t.contactId === p.id) || loans.some((l) => l.personId === p.id)
  const searching = q.trim().length > 0
  const hit = (p: Person) => normName(p.name).includes(normName(q)) || p.phones.some((ph) => ph.includes(q.replace(/\D/g, '')) && q.replace(/\D/g, '').length >= 3)
  const family = people.filter((p) => p.familyId && (!searching || hit(p)))
  const others = people.filter((p) => !p.familyId && (searching ? hit(p) : active(p)))
  const hidden = people.filter((p) => p.imported && !active(p)).length

  const row = (p: Person) => {
    const s = personStats(p.id, txns)
    const l = personLoans(p, loans)
    const held = behalfBalance(p.id, txns)
    const sp = splitNet(splitsWith(p, splits))
    return (
      <button key={p.id} className="list-row" onClick={() => setOpenId(p.id)}>
        <Avatar name={p.name} family={!!p.familyId} />
        <div className="grow" style={{ textAlign: 'left' }}>
          <div>{p.name}</div>
          <div className="dim small">{p.relation ? `${p.relation} · ` : ''}{l.owesYou > 0 ? <b style={{ color: 'var(--credit)' }}>Owes you {formatPrice(l.owesYou, { round: true })}</b> : l.youOwe > 0 ? <b style={{ color: 'var(--up)' }}>You owe {formatPrice(l.youOwe, { round: true })}</b>
            : sp >= 1 ? <b style={{ color: 'var(--credit)' }}>Owes you {formatPrice(sp, { round: true })} in splits</b> : sp <= -1 ? <b style={{ color: 'var(--up)' }}>You owe {formatPrice(-sp, { round: true })} in splits</b>
            : held >= 1 ? <b>Holding {formatPrice(held, { round: true })} of theirs</b> : held <= -1 ? <b style={{ color: 'var(--credit)' }}>Owes you {formatPrice(-held, { round: true })} for purchases</b> : s.list.length ? `${s.list.length} payment${s.list.length === 1 ? '' : 's'}` : 'No payments yet'}</div>
        </div>
        <span className="chev"><Icon name="chevron" size={18} /></span>
      </button>
    )
  }

  const loanT = loans.reduce((a, l) => (isSettledLoan(l) ? a : { in: a.in + (l.direction === 'LENT' ? outstanding(l) : 0), out: a.out + (l.direction === 'BORROWED' ? outstanding(l) : 0) }), { in: 0, out: 0 })
  const splitT = splitNet(splits)
  const behalfT = behalfPeople(txns).reduce((a, p) => ({ held: a.held + Math.max(0, p.balance), owed: a.owed + Math.max(0, -p.balance) }), { held: 0, owed: 0 })
  const shopT = creditTotals(credits)
  const owedRow = (icon: string, label: string, sub: string, onClick?: () => void) => (
    <button key={label} className="list-row" onClick={onClick} disabled={!onClick}>
      <span className="legend-icon"><Icon name={icon} size={15} /></span>
      <div className="grow" style={{ textAlign: 'left' }}><div>{label}</div><div className="dim small">{sub}</div></div>
      {onClick && <span className="chev"><Icon name="chevron" size={18} /></span>}
    </button>
  )
  const money = (v: number) => formatPrice(v, { round: true })

  return (
    <div className="page">
      <PageHeader title={openPage ? 'People' : 'Contacts & family'} onBack={onBack} />
      {openPage && (
          <div className="card" style={{ marginBottom: 12 }}>
            {owedRow('repeat', 'Loans', loanT.in || loanT.out ? `Owed to you ${money(loanT.in)} · you owe ${money(loanT.out)}` : 'Money lent or borrowed', () => openPage('loans'))}
            {owedRow('split', 'Split groups', !projects.length ? 'Split bills with friends' : Math.abs(splitT) < 1 ? 'Settled up' : splitT > 0 ? `${money(splitT)} owed to you` : `You owe ${money(-splitT)}`, () => openPage('split'))}
            {(behalfT.held >= 1 || behalfT.owed >= 1) && owedRow('users', 'On someone’s behalf', [behalfT.held >= 1 && `Holding ${money(behalfT.held)} of theirs`, behalfT.owed >= 1 && `${money(behalfT.owed)} to get back`].filter(Boolean).join(' · '))}
            {shop && owedRow('bag', 'Customer credit', shopT.count ? `${money(shopT.owed)} owed to the shop` : 'Who owes the shop', () => openPage('udhaar'))}
          </div>
      )}
      <p className="muted small">Link payments to people. Contacts stay on this phone.</p>
      <button className="btn block" onClick={() => setPicking(true)}><Icon name="plus" size={18} />Add a person</button>
      {isNativeApp() && (
        <button className="btn block secondary" style={{ marginTop: 10 }} disabled={importing} onClick={async () => {
          setImporting(true)
          try { const r = await importAllContacts(); toast(r.added ? `${r.added} contact${r.added === 1 ? '' : 's'} imported` : 'Nothing new to import', 'A payment to a mobile number or its UPI id now shows the contact’s name.') }
          catch (e) { toast('Could not read contacts', (e as Error)?.message ?? '') } finally { setImporting(false) }
        }}><Icon name="users" size={18} />{importing ? 'Importing…' : 'Import all contacts'}</button>
      )}
      {toLink > 0 && <button className="btn block secondary" style={{ marginTop: 10 }} onClick={() => setReviewing(true)}><Icon name="check" size={18} />Review {toLink} payee{toLink === 1 ? '' : 's'} to link</button>}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="list-row"><div className="grow"><div>Link automatically when sure</div><div className="dim small">Only when a payee name fits exactly one saved person. Otherwise you are asked.</div></div><Toggle on={autoLink} onChange={setAutoLink} label="Link automatically when sure" /></div>
      </div>
      {family.length > 0 && <><div className="section-label">Family</div><div className="card">{family.map(row)}</div></>}
      <div className="section-label">People</div>
      {people.length > 8 && <input className="input" style={{ marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your contacts by name or number" aria-label="Search contacts" />}
      <div className="card">{others.length ? others.slice(0, 200).map(row) : <div className="empty small">{searching ? 'No one matches.' : 'No one yet. Add a person here, import your contacts, or link one from any transaction.'}</div>}</div>
      {!searching && hidden > 0 && <p className="dim tiny" style={{ marginTop: 8, lineHeight: 1.5 }}>{hidden} imported contact{hidden === 1 ? ' is' : 's are'} kept to name payments. They show here once you pay or receive from them, or when you search.</p>}

      <LinkReview open={reviewing} onClose={() => setReviewing(false)} />
      <ContactPicker open={picking} onClose={() => setPicking(false)} onPick={(p) => { setPicking(false); setOpenId(p.id) }} title="Add a person" />
      {open && <PersonSheet person={open} txns={txns} loans={loans} splits={splitsWith(open, splits)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function PersonSheet({ person, txns, loans, splits, onClose }: { person: Person; txns: Transaction[]; loans: Loan[]; splits: FriendBalance[]; onClose: () => void }) {
  const [loanAmt, setLoanAmt] = useState('')
  const [dir, setDir] = useState<'LENT' | 'BORROWED'>('LENT')
  const pl = personLoans(person, loans)
  const people = useStored<Person[]>(KEYS.people, [])[0]
  // open loans typed by name that belong to no saved person yet
  const strays = loans.filter((l) => !isSettledLoan(l) && !l.personId && !people.some((p) => loanIsWith(l, p)))
  const confirm = useConfirm()
  const s = personStats(person.id, txns)
  const held = behalfBalance(person.id, txns)
  const behalfList = s.list.filter(isOnBehalf)
  const [draft, setDraft] = useState('')
  const toast = useToast()
  // payee names not linked to anyone yet, most used first
  const unlinked = (() => {
    const m = new Map<string, { name: string; n: number }>()
    // people only: official merchants, businesses and generic labels are never suggested
    for (const t of txns) if (!t.contactId && looksLikePerson(t.paymentReceiver, t.paymentCategory)) { const k = normName(t.paymentReceiver); const e = m.get(k); if (e) e.n++; else m.set(k, { name: t.paymentReceiver.trim(), n: 1 }) }
    const q = normName(draft)
    return [...m.values()].filter((e) => (!q || normName(e.name).includes(q)) && !person.aliases.some((a) => normName(a) === normName(e.name))).sort((a, b) => b.n - a.n).slice(0, 8)
  })()
  const add = (payee: string) => {
    const n = addAlias(person.id, payee)
    setDraft('')
    toast(`“${payee.trim()}” is now ${person.name}`, n ? `${n} earlier payment${n === 1 ? '' : 's'} linked` : 'Future payments will link')
  }
  return (
    <Sheet open onClose={onClose}>
      <SheetHeader title={person.name} sub={person.phones.length ? person.phones.map((p) => `+91 ${p}`).join(' · ') : 'No number saved'} onClose={onClose} />
      <div className="row" style={{ gap: 10, marginBottom: 4 }}>
        <div className="card pad grow"><div className="dim tiny">You sent</div><div className="num" style={{ fontWeight: 700, color: 'var(--up)' }}>{formatPrice(s.sent, { round: true })}</div></div>
        <div className="card pad grow"><div className="dim tiny">You got</div><div className="num" style={{ fontWeight: 700, color: 'var(--credit)' }}>{formatPrice(s.received, { round: true })}</div></div>
      </div>
      <div className="section-label">Loans</div>
      <div className="card">
        {pl.open.length === 0 && <div className="empty small">Nothing owed either way.</div>}
        {pl.open.map((l) => (
          <div key={l.id} className="list-row">
            <div className="grow"><div>{l.direction === 'LENT' ? `${person.name} owes you` : `You owe ${person.name}`}</div><div className="dim small">{new Date(l.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{l.note ? ` · ${l.note}` : ''}</div></div>
            <b className="num" style={{ color: l.direction === 'LENT' ? 'var(--credit)' : 'var(--up)' }}>{formatPrice(outstanding(l), { round: true })}</b>
          </div>
        ))}
      </div>
      {strays.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          {strays.map((l) => (
            <div key={l.id} className="list-row">
              <div className="grow"><div>{l.direction === 'LENT' ? `Lent to “${l.person}”` : `Borrowed from “${l.person}”`}</div><div className="dim small">{formatPrice(outstanding(l), { round: true })} · not linked to anyone</div></div>
              <button className="chip on" style={{ height: 30 }} onClick={() => { linkLoanToPerson(l.id, person.id); toast(`Linked to ${person.name}`) }}>It’s {person.name.split(' ')[0]}</button>
            </div>
          ))}
        </div>
      )}
      <form className="col" style={{ gap: 8, marginTop: 10 }} onSubmit={(e) => {
        e.preventDefault()
        const amount = parseFloat(loanAmt)
        if (!(amount > 0)) return
        createLoan({ person: person.name, personId: person.id, direction: dir, amount, date: Date.now(), dueDate: null, note: null, accountId: null })
        setLoanAmt(''); toast(dir === 'LENT' ? `${person.name} owes you ${formatPrice(amount, { round: true })}` : `You owe ${person.name} ${formatPrice(amount, { round: true })}`, 'When a payment from them arrives, tap it to settle.')
      }}>
        <div className="segmented"><button type="button" className={dir === 'LENT' ? 'on' : ''} onClick={() => setDir('LENT')}>I lent</button><button type="button" className={dir === 'BORROWED' ? 'on' : ''} onClick={() => setDir('BORROWED')}>I borrowed</button></div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" inputMode="decimal" value={loanAmt} onChange={(e) => setLoanAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount" aria-label="Loan amount" style={{ minWidth: 0 }} />
          <button className="btn sm" disabled={!(parseFloat(loanAmt) > 0)}>Add</button>
        </div>
      </form>
      {splits.length > 0 && <>
        <div className="section-label">Split groups</div>
        <div className="card">{splits.map((b) => (
          <div key={b.person.id} className="list-row">
            <div className="grow"><div>{b.project.name}</div><div className="dim small">{b.direction === 'owes-you' ? `${person.name} owes you` : `You owe ${person.name}`}</div></div>
            <b className="num" style={{ color: b.direction === 'owes-you' ? 'var(--credit)' : 'var(--up)' }}>{formatPrice(b.amount, { round: true })}</b>
          </div>
        ))}</div>
      </>}
      {behalfList.length > 0 && <>
        <div className="section-label">On their behalf</div>
        <p className="dim small" style={{ marginTop: 0 }}>Money they gave you to spend for them, and what you paid for them. None of it counts as your spending or income.</p>
        <div className="card">
          <div className="list-row">
            <div className="grow">{Math.abs(held) < 1 ? 'All square' : held > 0 ? 'Their money still with you' : `${person.name} still owes you`}</div>
            <b className="num" style={{ color: held < 0 ? 'var(--credit)' : undefined }}>{formatPrice(Math.abs(held), { round: true })}</b>
          </div>
          {behalfList.slice(0, 8).map((t) => (
            <div key={t.id} className="list-row">
              <div className="grow"><div>{t.paymentType === 'CREDIT' ? `Got from ${person.name.split(' ')[0]}` : t.paymentReceiver}</div><div className="dim small">{new Date(t.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{t.behalfFrom && t.paymentType === 'DEBIT' ? ` · ${t.behalfFrom}` : ''}</div></div>
              <b className="num" style={{ color: t.paymentType === 'CREDIT' ? 'var(--credit)' : 'var(--up)' }}>{t.paymentType === 'CREDIT' ? '+' : '-'}{formatPrice(t.paymentAmount, { round: true })}</b>
            </div>
          ))}
        </div>
      </>}
      <div className="section-label">Family</div>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        <button className={`chip${!person.relation ? ' on' : ''}`} onClick={() => setRelation(person.id, null)}>Not family</button>
        {RELATIONS.map((r) => <button key={r} className={`chip${person.relation === r ? ' on' : ''}`} onClick={() => setRelation(person.id, r)}>{r}</button>)}
      </div>
      <div className="section-label">Also known as</div>
      <p className="dim small" style={{ marginTop: 0 }}>Other names their payments show up under: a nickname, or how a bank or UPI app writes them.</p>
      {person.aliases.length > 0 && <div className="chips" style={{ marginBottom: 10, flexWrap: 'wrap' }}>{person.aliases.map((a) => (
        <button key={a} className="chip" onClick={() => updatePerson(person.id, { aliases: person.aliases.filter((x) => x !== a) })}>{a}<Icon name="close" size={12} /></button>
      ))}</div>}
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) add(draft) }}>
        <input className="input grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Payee name, e.g. Ro, ROHAN M" aria-label="Add a payee name" />
        <button className="btn sm" disabled={!draft.trim()}>Add</button>
      </form>
      {unlinked.length > 0 && <div className="chips" style={{ marginTop: 10, flexWrap: 'wrap' }}>{unlinked.map((e) => <button key={e.name} className="chip" onClick={() => add(e.name)}>+ {e.name}</button>)}</div>}
      <div className="section-label">Recent</div>
      <div className="card">
        {s.list.length === 0 ? <div className="empty small">Nothing linked yet. Open a payment and tap Contact.</div> : s.list.slice(0, 8).map((t) => (
          <div key={t.id} className="list-row">
            <div className="grow"><div>{t.paymentReceiver}</div><div className="dim small">{new Date(t.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
            <b className="num" style={{ color: t.paymentType === 'CREDIT' ? 'var(--credit)' : 'var(--up)' }}>{t.paymentType === 'CREDIT' ? '+' : '-'}{formatPrice(t.paymentAmount, { round: true })}</b>
          </div>
        ))}
      </div>
      <button className="btn danger block" style={{ marginTop: 16 }} onClick={async () => { if (await confirm({ title: `Remove ${person.name}?`, body: 'Their payments stay, just no longer linked.', confirm: 'Remove', danger: true })) { removePerson(person.id); onClose() } }}><Icon name="trash" size={18} />Remove</button>
    </Sheet>
  )
}
