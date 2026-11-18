// Credit card billing cycle maths.
export interface CardCycle { statementDay: number; dueDay: number }

/** The billing cycle that contains `now`: from the day after the last statement to the next statement date. */
export function cycleOf(c: CardCycle, now = new Date()) {
  const at = (y: number, m: number, d: number) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate())).getTime()
  const y = now.getFullYear(), m = now.getMonth()
  let next = at(y, m, c.statementDay)
  if (next < new Date(y, m, now.getDate()).getTime()) next = at(y, m + 1, c.statementDay)
  const nd = new Date(next)
  const prev = at(nd.getFullYear(), nd.getMonth() - 1, c.statementDay)
  // the payment is due after its statement: the same month if the due day is later, otherwise the next month
  const dueFor = (stmt: number) => { const d = new Date(stmt); return c.dueDay > c.statementDay ? at(d.getFullYear(), d.getMonth(), c.dueDay) : at(d.getFullYear(), d.getMonth() + 1, c.dueDay) }
  // still paying off the last statement? that due date is the one that matters now
  const today = new Date(y, m, now.getDate()).getTime()
  const lastDue = dueFor(prev)
  return { start: prev + 86400000, statement: next, due: lastDue >= today ? lastDue : dueFor(next) }
}
