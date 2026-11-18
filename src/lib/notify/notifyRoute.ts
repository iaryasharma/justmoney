// Where a notification should take you when tapped. Every notification carries a route string:
//   home | insights | settings | add        → that tab (or the quick-add sheet)
//   planner:<page>                           → a Planner page, e.g. planner:loans
//   report:<filename>                        → the generated PDF report
export type NotifyRoute = string

export const ROUTES = {
  add: 'add',
  insights: 'insights',
  home: 'home',
  reminders: 'planner:reminders',
  emi: 'planner:emi',
  subs: 'planner:subs',
  money: 'planner:money',
  loans: 'planner:loans',
  budgets: 'planner:budgets',
  plan: 'planner:plan',
  recap: 'planner:recap',
  card: 'planner:card',
  report: (filename: string) => `report:${filename}`,
  tx: (id: string) => `tx:${id}`,
} as const

/** A tap on a "who was this paid to?" notification asks the Home screen to open the Review sheet (it may not be mounted yet). */
export const reviewRequest = { pending: false }

let handler: ((route: NotifyRoute) => void) | null = null
let pending: NotifyRoute | null = null

/** The app registers one handler; a tap that arrived before it was ready is delivered right away. */
export function setRouteHandler(h: ((route: NotifyRoute) => void) | null) {
  handler = h
  if (h && pending) { const p = pending; pending = null; h(p) }
}

export function openRoute(route: NotifyRoute | null | undefined) {
  if (!route) return
  if (handler) handler(route)
  else pending = route
}
