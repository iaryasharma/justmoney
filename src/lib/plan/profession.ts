// What the user does for a living decides which tools the app shows: a shop owner sees payouts, customer credit and shop costs;
// an employee sees salary tools. Chosen in Profile (and at the start); an employee until the user says otherwise.
import { useStored, read, write, KEYS } from '../core/storage'
import { DEFAULT_STUDENT, savePlanSettings, type IncomeMode, type PlanSettings } from './plan'
import type { User } from '../core/types'

export type Profession = 'EMPLOYEE' | 'BUSINESS' | 'BOTH' | 'FREELANCE' | 'STUDENT' | 'OTHER'

/** In the order shown in the menu. */
export const PROFESSIONS: [Profession, string, string][] = [
  ['EMPLOYEE', 'Employee', 'Paid a salary'],
  ['BUSINESS', 'Business', 'A shop or business, sales that change'],
  ['BOTH', 'Both: employee and business owner', 'A job and a business'],
  ['FREELANCE', 'Freelancer', 'Pay that comes when it comes'],
  ['STUDENT', 'Student', 'I don’t earn. I spend what I get'],
  ['OTHER', 'Other', 'Pay that comes when it comes'],
]

export const professionLabel = (p: Profession) => PROFESSIONS.find((x) => x[0] === p)?.[1] ?? 'Employee'

/**
 * The chosen profession. Never guessed: one payment through a business app does not make someone a shopkeeper,
 * and shop tools (payouts, customer credit, shop costs) stay hidden until the user picks a business.
 */
export const professionOf = (user: Pick<User, 'profession'> | null): Profession => user?.profession ?? 'EMPLOYEE'

export const showsShop = (p: Profession) => p === 'BUSINESS' || p === 'BOTH'
// a student has no salary, so the salary tools (salary log, income, save rules) stay hidden for them too
export const showsSalary = (p: Profession) => p !== 'BUSINESS' && p !== 'STUDENT'
/** "Salary came late?": only for someone paid a salary (a freelancer's pay comes when it comes, a shop's sales change). */
export const showsLatePay = (p: Profession) => p === 'EMPLOYEE' || p === 'BOTH'
/** The Planner pages a profession does not see. Salary tools need a salary, so a shop owner and a student do not get them. */
export const hiddenPlannerPages = (p: Profession): string[] => (showsSalary(p) ? [] : ['income', 'salarylog', 'saverules'])

/** How the spending plan starts for each: a salary, a shop, or money planned whenever it arrives. A student's allowance comes monthly, so it is planned like a salary. */
export const modeFor = (p: Profession): IncomeMode => (p === 'BUSINESS' ? 'VARIABLE' : p === 'FREELANCE' || p === 'OTHER' ? 'INCOME' : 'FIXED')

/** Which plan modes make sense for them. A student's plan is always the monthly one. */
export const modesFor = (p: Profession): IncomeMode[] => (p === 'STUDENT' ? ['FIXED'] : p === 'EMPLOYEE' ? ['FIXED', 'INCOME'] : p === 'BUSINESS' ? ['VARIABLE', 'INCOME'] : ['FIXED', 'INCOME', 'VARIABLE'])

/** The plan settings a profession starts with. A student keeps their budget choices if they already made them. */
export const planFor = (p: Profession, current?: PlanSettings): Partial<PlanSettings> => ({
  mode: modeFor(p),
  student: p === 'STUDENT' ? current?.student ?? { ...DEFAULT_STUDENT } : undefined,
})

export function setProfession(p: Profession) {
  const user = read<User | null>(KEYS.user, null)
  if (user) write(KEYS.user, { ...user, profession: p })
  savePlanSettings(planFor(p, read<PlanSettings>(KEYS.planSettings, {} as PlanSettings)))
}

export function useProfession() {
  const [user] = useStored<User | null>(KEYS.user, null)
  const profession = professionOf(user)
  return { profession, shop: showsShop(profession), salaried: showsSalary(profession), student: profession === 'STUDENT' }
}
