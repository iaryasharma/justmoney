// One identity per payee, for history, alerts and recurring detection.
// Official merchants are merged under their brand — "Uber India Systems Pvt Ltd", "UBER TRIP" and "Uber" are all Uber.
// People are never merged: two people can share a name and still be different accounts, so they stay exact.
import { merchantBrand } from './brands'
import { isTransferCategory } from '../accounts/accounts'

export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Entries that are about a person (family, lent or borrowed money, own-account transfers) never take a brand. */
const personal = (category?: string) => !!category && (category === 'Family' || isTransferCategory(category))

/** Grouping key: the brand's normalised name for official merchants, otherwise the payee's own normalised name. */
export function payeeKey(name: string, category?: string): string {
  const brand = personal(category) ? null : merchantBrand(name)
  return normName(brand ? brand.label : name)
}

/** Money in that is pay or earnings keeps who paid it (an employer called "Zomato Ltd" is not the Zomato app). */
const earnings = (category: string) => /salary|income|interest|dividend|bonus|freelance|rent/i.test(category)

/** A transaction's name as shown: official merchants under their brand (refunds from them too), everyone else as written. */
export const shownName = (t: { paymentReceiver: string; paymentCategory: string; paymentType: string }) =>
  t.paymentType === 'DEBIT' || !earnings(t.paymentCategory) ? payeeLabel(t.paymentReceiver, t.paymentCategory) : t.paymentReceiver

/** The name to show for a group of entries: the brand's own name when they were merged, else the payee as written. */
export function payeeLabel(name: string, category?: string): string {
  const brand = personal(category) ? null : merchantBrand(name)
  return brand ? brand.label : name
}
