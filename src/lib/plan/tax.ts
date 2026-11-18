// Indian income tax estimate, FY 2026-27 (the first "tax year" under the Income Tax Act 2025).
// Budget 2026 kept the FY 2025-26 slabs, rebate and standard deductions as they were.
export type Regime = 'old' | 'new'

/** The year these slabs are for; change it (and the slabs) after each Budget. */
export const TAX_YEAR = 'FY 2026-27'
export const TAX_YEAR_LONG = 'FY 2026-27 (tax year 2026-27)'

type Slab = [upTo: number, rate: number]
const NEW_SLABS: Slab[] = [
  [400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15],
  [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3],
]
const OLD_SLABS: Slab[] = [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]]

export const STANDARD_DEDUCTION: Record<Regime, number> = { new: 75000, old: 50000 }

function slabTax(taxable: number, slabs: Slab[]) {
  let tax = 0
  let lower = 0
  for (const [upTo, rate] of slabs) {
    if (taxable <= lower) break
    tax += (Math.min(taxable, upTo) - lower) * rate
    lower = upTo
  }
  return tax
}

export interface TaxResult {
  regime: Regime
  grossIncome: number
  taxableIncome: number
  taxBeforeRebate: number
  rebate: number
  cess: number
  totalTax: number
}

export function computeTax(gross: number, regime: Regime, deductions: number): TaxResult {
  const ded = regime === 'old' ? deductions : 0
  const taxableIncome = Math.max(gross - STANDARD_DEDUCTION[regime] - ded, 0)
  const taxBeforeRebate = slabTax(taxableIncome, regime === 'new' ? NEW_SLABS : OLD_SLABS)
  let rebate = 0
  if (regime === 'new' && taxableIncome <= 1200000) rebate = Math.min(taxBeforeRebate, 60000)
  if (regime === 'old' && taxableIncome <= 500000) rebate = Math.min(taxBeforeRebate, 12500)
  const cess = (taxBeforeRebate - rebate) * 0.04
  return {
    regime, grossIncome: gross, taxableIncome, taxBeforeRebate, rebate, cess,
    totalTax: Math.round(taxBeforeRebate - rebate + cess),
  }
}

export function compareRegimes(gross: number, deductions: number) {
  const o = computeTax(gross, 'old', deductions)
  const n = computeTax(gross, 'new', deductions)
  const cheaper: Regime | 'tie' = o.totalTax === n.totalTax ? 'tie' : o.totalTax < n.totalTax ? 'old' : 'new'
  return { old: o, new: n, cheaper, saving: Math.abs(o.totalTax - n.totalTax) }
}

export const WAYS_TO_SAVE = [
  { section: '80C', limit: '₹1,50,000', what: 'PPF, ELSS, EPF, life insurance, home-loan principal' },
  { section: '80CCD(1B)', limit: '₹50,000', what: 'Extra NPS contribution' },
  { section: '80D', limit: '₹25,000 (+₹50,000 for senior parents)', what: 'Health insurance premiums' },
  { section: '80TTA/80TTB', limit: '₹10,000 / ₹50,000 (seniors)', what: 'Savings-account interest' },
  { section: 'HRA', limit: 'Least of 3 formulae', what: 'Rent paid while receiving HRA' },
  { section: '80CCD(2)', limit: 'Up to 14% of salary', what: "Employer's NPS contribution (both regimes)" },
]
