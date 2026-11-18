import { describe, expect, it } from 'vitest'
import { hiddenPlannerPages, modeFor, modesFor, planFor, PROFESSIONS, showsLatePay, showsSalary, showsShop, type Profession } from './profession'
import { DEFAULT_STUDENT } from './plan'

/** What each profession sees, in one table. A change to a rule should show up here. */
const SCREENS: Record<Profession, {
  salary: boolean; shop: boolean; late: boolean; plannerHidden: string[]; modes: string[]; plan: string; student: boolean
}> = {
  EMPLOYEE: { salary: true, shop: false, late: true, plannerHidden: [], modes: ['FIXED', 'INCOME'], plan: 'FIXED', student: false },
  BUSINESS: { salary: false, shop: true, late: false, plannerHidden: ['income', 'salarylog', 'saverules'], modes: ['VARIABLE', 'INCOME'], plan: 'VARIABLE', student: false },
  BOTH: { salary: true, shop: true, late: true, plannerHidden: [], modes: ['FIXED', 'INCOME', 'VARIABLE'], plan: 'FIXED', student: false },
  FREELANCE: { salary: true, shop: false, late: false, plannerHidden: [], modes: ['FIXED', 'INCOME', 'VARIABLE'], plan: 'INCOME', student: false },
  STUDENT: { salary: false, shop: false, late: false, plannerHidden: ['income', 'salarylog', 'saverules'], modes: ['FIXED'], plan: 'FIXED', student: true },
  OTHER: { salary: true, shop: false, late: false, plannerHidden: [], modes: ['FIXED', 'INCOME', 'VARIABLE'], plan: 'INCOME', student: false },
}

describe('what each profession sees', () => {
  it('the menu has exactly these six, in this order', () => {
    expect(PROFESSIONS.map(([k]) => k)).toEqual(['EMPLOYEE', 'BUSINESS', 'BOTH', 'FREELANCE', 'STUDENT', 'OTHER'])
  })
  for (const [p, want] of Object.entries(SCREENS) as [Profession, typeof SCREENS[Profession]][]) {
    it(`${p}: salary, shop, late pay, Planner pages, plan modes and plan type`, () => {
      expect(showsSalary(p)).toBe(want.salary)
      expect(showsShop(p)).toBe(want.shop)
      expect(showsLatePay(p)).toBe(want.late)
      expect(hiddenPlannerPages(p)).toEqual(want.plannerHidden)
      expect(modesFor(p)).toEqual(want.modes)
      expect(modeFor(p)).toBe(want.plan)
      expect(p === 'STUDENT').toBe(want.student)
    })
  }
})

describe('a student', () => {
  it('starts with no budget and no saving goal', () => {
    expect(planFor('STUDENT')).toEqual({ mode: 'FIXED', student: DEFAULT_STUDENT })
  })
  it('keeps the budget they already set when they pick student again', () => {
    const set = { budget: 'CAP' as const, cap: 4000, saveGoal: 500 }
    expect(planFor('STUDENT', { saveRate: 20, setAside: 10, emergencyShare: 40, emergencyMonths: 3, student: set }).student).toEqual(set)
  })
  it('drops the student budget when another profession is picked', () => {
    expect(planFor('EMPLOYEE').student).toBeUndefined()
  })
})

describe('the menu labels', () => {
  it('reads as the list the user gave', () => {
    expect(PROFESSIONS.map((p) => p[1])).toEqual(['Employee', 'Business', 'Both: employee and business owner', 'Freelancer', 'Student', 'Other'])
  })
})
