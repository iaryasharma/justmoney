export type PaymentType = 'DEBIT' | 'CREDIT'
export type PaymentSource = 'BANK' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD'

export interface Transaction {
  /** The bank's UPI / UTR reference number, when the message or screen gave one: the exact way to tell the same payment from another. */
  ref?: string
  /** Where the capture came from: the UPI app's success screen, the bank's message, or both (which means the bank confirmed it). */
  seenIn?: ('screen' | 'bank')[]
  /** The other side's UPI id or mobile number as the message wrote it (never a masked one): what a name is remembered against. */
  payeeId?: string
  id: string
  timestamp: number
  paymentAmount: number
  paymentType: PaymentType
  paymentReceiver: string
  paymentCategory: string
  paymentSource?: PaymentSource
  paymentMethodId?: string | null
  /** Free text; #hashtags inside it act as tags. */
  note?: string
  /** Set when the spend happened in another currency; paymentAmount is the converted value. */
  originalAmount?: number
  originalCurrency?: string
  /** The recurring rule that generated this entry, if any. */
  recurringId?: string
  /** UPI / wallet app used, e.g. "PhonePe", "Google Pay". */
  paymentApp?: string | null
  /** Added automatically from a payment notification. */
  autoCaptured?: boolean
  /** An auto-captured payment the user has looked at (or fixed). */
  reviewed?: boolean
  /** Only the date is known (e.g. from a bank statement): show no time of day. */
  timeUnknown?: boolean
  /** The loan this entry lent out or got back (money lent / repaid). */
  loanId?: string
  /** The person (from your contacts) this payment went to or came from. */
  contactId?: string
  /** The investment this payment put money into or got back from. */
  investmentId?: string
  /** A sale taken through a business app (PhonePe Business, Paytm for Business): the bank payout that paid it out. */
  settledBy?: string
  /** A bank payout from a business app: the sales it covers (so it is a transfer, not income again). */
  settlesIds?: string[]
  /** The user said this credit is not a payout, so do not match it again. */
  settleSkip?: boolean
  /** A payout the app recorded itself (confirmed by the user, or settled automatically) because no bank message arrived. */
  autoPayout?: boolean
  /** Spent on the shop (stock, rent, wages), not on the person: left out of the personal spending plan. */
  business?: boolean
  /** The name the bank or UPI app wrote, when it was shown under a brand name instead. */
  rawReceiver?: string
  /** The category it had before it was marked as money handled for someone (On behalf), to put back if unmarked. */
  behalfFrom?: string
  /** The SplitMoney expense this payment was shared in: this entry is your share, its sibling (category Split) the others'. */
  splitTxnId?: string
  /** The category it had before a split moved the whole payment to Split, to put back when the split is undone. */
  splitCategory?: string
  /** The user said which app (e.g. Flipkart or Flipkart Minutes) a brand-name payment was. */
  appChosen?: boolean
  createdAt: number
  updatedAt: number
}

export type NewTransaction = Pick<Transaction, 'paymentAmount' | 'paymentType' | 'paymentReceiver' | 'paymentCategory'> &
  Partial<Pick<Transaction, 'timestamp' | 'paymentSource' | 'paymentMethodId' | 'note' | 'originalAmount' | 'originalCurrency' | 'recurringId' | 'paymentApp' | 'autoCaptured' | 'timeUnknown' | 'loanId' | 'ref' | 'seenIn' | 'payeeId'>> &
  /** The user picked the category themselves, so rules must not override it (not stored). */
  { manualCategory?: boolean }

/** An IPO / mandate block or unblock: money held at the bank and released, never spent or received. */
/** A UPI AutoPay / recurring mandate the bank told us about (Netflix, Spotify, a SIP…). Setting it up moves no money. */
export interface AutoPay {
  id: string
  name: string
  amount: number
  /** monthly, yearly, weekly, quarterly, daily, "as presented"… as the message put it */
  frequency?: string
  /** when the next charge is due, if the message said */
  nextAt?: number
  status: 'active' | 'paused' | 'cancelled'
  createdAt: number
  updatedAt: number
}

export interface Hold {
  id: string
  timestamp: number
  amount: number
  kind: 'BLOCKED' | 'UNBLOCKED'
  name: string
  paymentMethodId?: string | null
  /** The payment that took this blocked money (an IPO allotment): the block is then over and the payment is an investment. */
  settledBy?: string | null
  investmentId?: string | null
  /** How many messages reported this one block (the mandate SMS and the bank's lien notice are one block). */
  seen?: number
  /** The application / mandate number the message quotes, when it does: the surest way to tell two applications for the same amount apart. */
  appNo?: string
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'RUPAY'

export interface PaymentMethod {
  id: string
  name: string
  type: PaymentSource
  last4?: string
  color: string
  createdAt: number
  /** Bank short name (e.g. "Kotak", "UCO"), used to match SMS and screenshots to this account. */
  bank?: string | null
  /** Balance typed in by the user, valid as of openingDate; later transactions move it. */
  openingBalance?: number | null
  openingDate?: number | null
  /** Debit card: the bank account it spends from (its balance is that account's). */
  linkedAccountId?: string | null
  /** Debit and credit cards: the network, shown beside this card's payments. */
  network?: CardNetwork | null
}

/** Where and when the salary lands; optionally added automatically on payday. */
export interface SalarySettings { accountId: string | null; day: number; autoAdd: boolean }

export interface User {
  id: string
  name: string
  age?: number | null
  currency: string
  monthly_income: number
  /** What the user does for a living: decides which tools the app shows. */
  profession?: 'EMPLOYEE' | 'BUSINESS' | 'BOTH' | 'FREELANCE' | 'STUDENT' | 'OTHER'
}

export interface IncomeSource { id: string; name: string; amount: number }

export interface EmiPlan {
  id: string; name: string; totalAmount: number; months: number; monthlyAmount: number
  dueDay: number; paidCount: number; createdAt: number; reminderEnabled: boolean
}

export interface PaymentReminder {
  id: string; title: string; type: 'DAILY' | 'WEEKLY' | 'MONTHLY'; time: string
  dayOfWeek?: number; dayOfMonth?: number; enabled: boolean; createdAt: number
}

export interface NotificationPrefs { daily: boolean; weekly: boolean; bimonthly: boolean; monthly: boolean }

export interface Insight { suggestion: string; tip: string }
export interface InsightsCacheEntry { monthKey: string; suggestions: Insight[]; fetchedAt: number; currency: string }

export type RecurringCadence = 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export interface RecurringRule {
  id: string
  template: Omit<NewTransaction, 'timestamp' | 'recurringId'>
  cadence: RecurringCadence
  /** Epoch ms of the next entry to create. */
  nextAt: number
  /** Day of month monthly/yearly rules return to after a short month. */
  anchorDay?: number
  enabled: boolean
  createdAt: number
}

export interface SavingsGoal {
  id: string; name: string; target: number; saved: number
  deadline?: number | null; color: string; createdAt: number
  /** The emergency fund the spending plan builds a little of every month. */
  emergency?: boolean
}

/** A one-tap expense (chai ₹20, auto ₹100). */
export interface QuickPreset { id: string; label: string; amount: number; category: string; payee?: string }

export type CategoryBudgets = Record<string, number>
export type ThemePref = 'system' | 'dark' | 'light'

export interface FamilyMember { id: string; name: string; relation?: string | null }

/** A cost that comes once a year (insurance, fees, a festival), set aside a little every month. */
export interface SinkingFund {
  id: string; name: string; amount: number; dueAt: number; saved: number; createdAt: number
  /** Times it was paid: the money the fund covered, so that payment is not counted as spending. */
  paid?: { at: number; amount: number }[]
}

/** Goods sold on credit: a customer who owes the shop. It is income only once they pay. */
export interface CreditSale {
  id: string; customer: string; amount: number; date: number; due?: number | null; note?: string | null; createdAt: number
  payments: { id: string; amount: number; date: number; txId?: string | null }[]
}

/** A fixed monthly outflow planned from income, e.g. ₹15,000 sent to family. */
export interface Commitment {
  id: string
  name: string
  amount: number
  /** Outflow category it is paid from; transactions in it count towards this commitment. */
  category: string
  /** Who receives it, for family support. */
  memberId?: string | null
  createdAt: number
}

export type InvestmentType = 'STOCK' | 'IPO' | 'MF' | 'FD' | 'RD' | 'GOLD' | 'PPF' | 'NPS' | 'CRYPTO' | 'OTHER'
/** Money put into (IN) or got back from (OUT) an investment, on a date; txId when it came from a transaction. */
export interface InvestmentFlow { id: string; date: number; amount: number; kind: 'IN' | 'OUT'; txId?: string | null }
export interface Investment {
  id: string
  type: InvestmentType
  name: string
  /** Money put in so far. */
  invested: number
  /** Latest value; for FD/RD it is computed from rate and dates when those are set. */
  currentValue: number
  units?: number | null
  /** FD / RD / PPF annual interest rate (%) and dates. */
  rate?: number | null
  startDate?: number | null
  maturityDate?: number | null
  /** IPO application status. */
  ipoStatus?: 'APPLIED' | 'ALLOTTED' | 'NOT_ALLOTTED' | null
  /** Listed shares: the ticker (e.g. RELIANCE) and exchange, to fetch a live price. */
  symbol?: string | null
  exchange?: 'NSE' | 'BSE' | null
  /** Every rupee in and out, dated: the source of profit, time held and annualised return. */
  flows?: InvestmentFlow[]
  /** Fully sold; kept so its result stays on record. */
  closedAt?: number | null
  updatedAt: number
  createdAt: number
}
export interface NetWorthPoint { month: string; value: number }

export interface LoanRepayment { id: string; amount: number; date: number; accountId?: string | null; txId?: string | null }
/** Money lent to someone (LENT) or borrowed from someone (BORROWED). */
export interface Loan {
  id: string
  person: string
  direction: 'LENT' | 'BORROWED'
  amount: number
  date: number
  dueDate?: number | null
  note?: string | null
  /** The person (from Contacts & family) this loan is with. */
  personId?: string | null
  accountId?: string | null
  /** The transaction the money left in, when the loan was recorded from one. */
  txId?: string | null
  repayments: LoanRepayment[]
  createdAt: number
}

/** "If a payment mentions X, use category Y" (plus optional app/account). */
export interface CategoryRule {
  id: string
  match: string
  type?: 'DEBIT' | 'CREDIT' | null
  category: string
  createdAt: number
  hits?: number
}

/** A payment notification captured by the listener service, waiting to be turned into a transaction. */
export interface CapturedNotification { id: number; pkg: string; title: string; text: string; ts: number }
