// Logos for banks, payment apps, shopping and subscription brands (public/brands/*.webp, 128px, about 2 KB each).
// Matched by name so they appear wherever the app shows a payee, app or account.

interface Brand { key: string; label: string; re: RegExp }

const B = (key: string, label: string, re: RegExp): Brand => ({ key, label, re })

/** Merchants and services (checked against payee names). More specific first. */
const MERCHANTS: Brand[] = [
  B('flipkart-minutes', 'Flipkart Minutes', /flipkart\s*minutes/i),
  B('flipkart', 'Flipkart', /flipkart/i),
  B('amazonpay', 'Amazon Pay', /amazon\s*pay/i),
  B('primevideo', 'Prime Video', /prime\s*video|amazon\s*prime/i),
  B('amazon-now', 'Amazon Now', /amazon\s*now/i),
  B('amazon-fresh', 'Amazon Fresh', /amazon\s*fresh/i),
  B('amazon', 'Amazon', /amazon|amzn/i),
  B('myntra', 'Myntra', /myntra/i),
  B('meesho', 'Meesho', /meesho/i),
  B('blinkit', 'Blinkit', /blinkit|grofers/i),
  B('zepto', 'Zepto', /zepto/i),
  B('instamart', 'Swiggy Instamart', /instamart/i),
  B('swiggy', 'Swiggy', /swiggy|instamart/i),
  B('district-dinein', 'District Dinein', /district.*dine\s*-?in|dine\s*-?in.*district/i),
  B('zomato-dinein', 'Zomato Dinein', /zomato\s*(?:dining|dine\s*-?in)/i),
  B('district', 'District', /district/i),
  B('dineout', 'Swiggy Dineout', /dine\s*-?out/i),
  B('zomato', 'Zomato', /zomato/i),
  B('mcdonalds', "McDonald's", /mc\s?donald|hardcastle/i),
  B('burgerking', 'Burger King', /burger\s?king|\bbk\s?india/i),
  B('burgersingh', 'Burger Singh', /burger\s?singh/i),
  B('wendys', "Wendy's", /wendy[’']?s/i),
  B('chaayos', 'Chaayos', /chaayos/i),
  B('cafecoffeeday', 'Cafe Coffee Day', /cafe\s?coffee\s?day|\bccd\b/i),
  B('bikanerwala', 'Bikanerwala', /bikaner\s?wala/i),
  B('burgerfarm', 'Burger Farm', /burger\s?farm/i),
  B('tacobell', 'Taco Bell', /taco\s?bell/i),
  B('nbc', 'Nothing Before Coffee', /nothing\s?before\s?coffee|\bnbc\b/i),
  B('uber', 'Uber', /\buber\b|ubereats/i),
  B('rapido', 'Rapido', /rapido|roppen/i),
  B('netflix', 'Netflix', /netflix/i),
  B('spotify', 'Spotify', /spotify/i),
  B('hotstar', 'JioHotstar', /hotstar/i),
  B('crunchyroll', 'Crunchyroll', /crunchy\s?roll/i),
  B('youtubemusic', 'YouTube Music', /you\s?tube\s?music|\byt\s?music\b/i),
  B('youtube', 'YouTube', /you\s?tube/i),
  B('applemusic', 'Apple Music', /apple\s?music/i),
  B('apple', 'Apple', /^\s*apple\s*$|apple\s?(?:services|store|india|\.com|bill)|itunes|icloud/i),
  B('instagram', 'Instagram', /instagram/i),
  B('whatsapp', 'WhatsApp', /whats\s?app/i),
  B('snapchat', 'Snapchat', /snap\s?chat/i),
  B('linkedin', 'LinkedIn', /linked\s?in/i),
  B('samsung', 'Samsung', /samsung/i),
  B('phonepe', 'PhonePe', /phone\s?pe/i),
  B('phonepebusiness', 'PhonePe Business', /phone\s?pe\s*(?:for\s*)?(?:business|merchant)/i),
  B('paytmbusiness', 'Paytm Business', /paytm\s*(?:for\s*)?(?:business|merchant)|paytm\s*soundbox/i),
  B('paytmcheckin', 'Paytm Check-in', /paytm\s*check\s*-?\s*in/i),
  B('paytm', 'Paytm', /paytm/i),
  B('mobikwik', 'MobiKwik', /mobi\s?kwik/i),
  B('supermoney', 'super.money', /super\.?\s?money/i),
  // shopping
  B('ajio', 'AJIO', /\bajio\b/i),
  B('nykaa', 'Nykaa', /nykaa/i),
  B('pilgrim', 'Pilgrim', /\bpilgrim\b/i),
  B('dotandkey', 'Dot & Key', /dot\s*(?:&|and|n)?\s*key/i),
  B('lenskart', 'Lenskart', /lenskart/i),
  B('bewakoof', 'Bewakoof', /bewakoof/i),
  B('souledstore', 'The Souled Store', /souled\s*store|\bsouled\b/i),
  B('reliancedigital', 'Reliance Digital', /reliance\s*digital/i),
  B('croma', 'Croma', /\bcroma\b/i),
  B('smartbazaar', 'Smart Bazaar', /smart\s*baza{1,2}r/i),
  B('dmart', 'DMart', /\bd\s?-?\s?mart\b|avenue\s*supermarts/i),
  B('westside', 'Westside', /west\s?side/i),
  B('zudio', 'Zudio', /zudio/i),
  B('trends', 'Trends', /\b(?:reliance\s*)?trends\b/i),
  B('redtape', 'Red Tape', /red\s?tape/i),
  B('limeroad', 'Limeroad', /lime\s?road/i),
  B('maxshopping', 'Max Shopping', /\bmax\s?(?:fashion|shopping|retail)\b/i),
  B('vishalmegamart', 'Vishal Mega Mart', /vishal\s?mega\s?mart|\bvmm\b/i),
  B('vmart', 'V-Mart', /\bv\s?-?\s?mart\b/i),
  B('bonkerscorner', 'Bonkers Corner', /bonkers\s?corner/i),
  B('glitchez', 'Glitchez', /glitchez/i),
  B('zara', 'Zara', /\bzara\b|inditex/i),
  B('hm', 'H&M', /\bh\s?(?:&|and)\s?m\b|hennes/i),
  B('levis', "Levi's", /\blevi'?s\b|levi\s?strauss/i),
  B('decathlon', 'Decathlon', /decathlon/i),
  // food
  B('dominos', "Domino's", /domino'?s|jubilant\s*food/i),
  B('pizzahut', 'Pizza Hut', /pizza\s?hut|devyani/i),
  B('haldirams', "Haldiram's", /haldiram/i),
  B('baristacoffee', 'Barista', /\bbarista\b/i),
  B('starbucks', 'Starbucks', /starbucks/i),
  B('savana', 'Savana', /\bsavana\b/i),
  B('brownsugar', 'Brown Sugar', /brown\s?sugar/i),
  B('dosaka', 'Dosaka', /\bdosaka\b/i),
  B('toing', 'Toing', /\btoing\b/i),
  // travel and tickets
  B('irctc', 'IRCTC', /irctc/i),
  B('makemytrip', 'MakeMyTrip', /make\s?my\s?trip|\bmmt\b/i),
  B('goibibo', 'Goibibo', /goibibo/i),
  B('cleartrip', 'Cleartrip', /clear\s?trip/i),
  B('redbus', 'redBus', /red\s?bus/i),
  B('abhibus', 'AbhiBus', /abhi\s?bus/i),
  B('ola', 'Ola', /\bola\b|ola\s?cabs?|ani\s?technologies/i),
  B('nammayatri', 'Namma Yatri', /namma\s?yatri/i),
  B('nammametro', 'Namma Metro', /namma\s?metro|bangalore\s?metro|bengaluru\s?metro|\bbmrcl?\b/i),
  B('delhimetro', 'Delhi Metro', /delhi\s?metro|\bdmrc\b/i),
  B('jaipurmetro', 'Jaipur Metro', /jaipur\s?metro|\bjmrc\b/i),
  B('punemetro', 'Pune Metro', /pune\s?metro|\bpmrda?\b|maha\s?metro/i),
  B('bookingcom', 'Booking.com', /booking\.?\s?com/i),
  B('bookmyshow', 'BookMyShow', /book\s?my\s?show|\bbms\b/i),
  B('pvr', 'PVR INOX', /\bpvr\b|\binox\b/i),
  // telecom and payments
  B('jiomart', 'JioMart', /jio\s?mart/i),
  B('jio', 'Jio', /\b(?:my\s?)?jio\b(?!\s?(?:hotstar|cinema))|reliance\s*jio/i),
  B('airtel', 'Airtel', /\bairtel\b/i),
  B('bsnl', 'BSNL', /\bbsnl\b|bharat\s?sanchar/i),
  B('vi', 'Vi', /vodafone|\bvi\s?(?:recharge|prepaid|postpaid|mobile)\b/i),
  B('cred', 'CRED', /\bcred\b/i),
  B('navi', 'Navi', /\bnavi\b(?!\s*mumbai)/i),
  B('slice', 'slice', /\bslice\b/i),
  B('paypal', 'PayPal', /paypal/i),
  B('roblox', 'Roblox', /roblox/i),
  B('discord', 'Discord', /discord/i),
  B('steam', 'Steam', /\bsteam(?:\s?games|powered)?\b/i),
  B('epicgames', 'Epic Games', /epic\s?games/i),
  B('googleone', 'Google One', /google\s?one/i),
  B('googleplay', 'Google Play', /google\s?play|play\s?store/i),
  // investing
  B('zerodha', 'Zerodha', /zerodha|\bkite\b/i),
  B('groww', 'Groww', /\bgroww\b/i),
  B('angelone', 'Angel One', /angel\s?(?:one|broking)/i),
]

/** UPI / wallet app names as stored on transactions. */
const APPS: Record<string, string> = {
  PhonePe: 'phonepe', 'PhonePe Business': 'phonepebusiness', 'Paytm Business': 'paytmbusiness', Paytm: 'paytm', BHIM: 'bhim', 'super.money': 'supermoney', 'Amazon Pay': 'amazonpay',
  'Google Pay': 'googlepay', MobiKwik: 'mobikwik', 'WhatsApp Pay': 'whatsapp', CRED: 'cred', Navi: 'navi', Slice: 'slice', Pop: 'pop', PayPal: 'paypal', Zerodha: 'zerodha', Groww: 'groww',
}

/** Bank short names (see accounts.ts BANKS). */
const BANKS: Record<string, string> = {
  Kotak: 'kotak', UCO: 'uco', SBI: 'sbi', HDFC: 'hdfc', 'Indian Bank': 'indianbank',
  ICICI: 'icici', PNB: 'pnb', BoB: 'bankofbaroda', Union: 'unionbank', 'IDFC First': 'idfc', Yes: 'yesbank', AU: 'aubank',
  'Airtel Payments': 'airtel', 'Jio Payments': 'jio', Axis: 'axis', Canara: 'canara',
}

/** Account names written out in full ("Union Bank of India") that the short names above wouldn't catch. */
const BANK_NAMES: [RegExp, string][] = [
  [/\bicici\b/i, 'icici'], [/\bpnb\b|punjab national/i, 'pnb'], [/bank of baroda|\bbob\b/i, 'bankofbaroda'],
  [/union bank/i, 'unionbank'], [/\bidfc\b/i, 'idfc'], [/\byes bank\b/i, 'yesbank'], [/\bau (?:small|bank)\b/i, 'aubank'],
  [/airtel payments/i, 'airtel'], [/jio payments/i, 'jio'], [/\baxis\b/i, 'axis'], [/\bcanara\b/i, 'canara'],
]

/** Card networks: only used when the card's bank has no logo of its own. */
const NETWORKS: [RegExp, string][] = [[/\bvisa\b/i, 'visa'], [/master\s?card/i, 'mastercard'], [/\brupay\b/i, 'rupay']]

/** Variants that share their parent brand's logo file: one image, not copies of it. */
const LOGO_OF: Record<string, string> = {
  dineout: 'swiggy', 'zomato-dinein': 'zomato', 'district-dinein': 'district', 'amazon-fresh': 'amazon',
}

const url = (key: string) => `/brands/${LOGO_OF[key] ?? key}.webp`

/** The logo file for a brand key ("instamart" → the Swiggy logo). */
export const brandLogo = url

export const driveLogo = url('googledrive')

/** The official brand a payee name belongs to ("UBER INDIA SYSTEMS PVT LTD" → Uber), or null for everyone else. */
export function merchantBrand(name?: string | null): { key: string; label: string } | null {
  if (!name) return null
  const b = MERCHANTS.find((m) => m.re.test(name))
  return b ? { key: b.key, label: b.label } : null
}

/** The merchant matching rules, so the Android widgets can pick the same logo the app does. */
export const brandRules = () => MERCHANTS.map((m) => ({ key: m.key, re: m.re.source, flags: m.re.flags }))

/** "/brands/uber.webp" → "uber" (the file name the widgets load from the app's assets). */
export const logoKey = (url: string | null | undefined) => (url ? url.replace('/brands/', '').replace('.webp', '') : null)

/** Apps that deliver in minutes, and online shops, for the monthly "where does it go" view (by brand key). */
export const QUICK_COMMERCE = ['zepto', 'blinkit', 'instamart', 'flipkart-minutes', 'amazon-now', 'amazon-fresh', 'jiomart']
export const ECOMMERCE = ['amazon', 'flipkart', 'myntra', 'meesho', 'ajio', 'nykaa', 'lenskart']

/**
 * Banks write one name for what are two apps. When a payment says only that name, the user is asked which app it was.
 * (The bank's "FLIPKART" can be the shop or Flipkart Minutes; "SWIGGY" can be food or Instamart.)
 */
export const AMBIGUOUS_APPS: Record<string, { label: string; category?: string }[]> = {
  flipkart: [{ label: 'Flipkart' }, { label: 'Flipkart Minutes', category: 'Grocery' }],
  swiggy: [{ label: 'Swiggy', category: 'Food' }, { label: 'Swiggy Instamart', category: 'Grocery' }],
}

/** The choices to offer when this payee could be more than one app, or null. Only a bare brand name is ambiguous. */
export function ambiguousApp(name?: string | null) {
  const b = merchantBrand(name)
  if (!b || !AMBIGUOUS_APPS[b.key]) return null
  const bare = (name ?? '').toLowerCase().replace(/[^a-z]/g, '').replace(/(pvt|private|ltd|limited|internet|india|services|technologies|retail|payments|upi|marketplace|pr|bundl)/g, '')
  return bare === b.key ? AMBIGUOUS_APPS[b.key] : null
}

export function merchantLogo(name?: string | null): string | null {
  if (!name) return null
  const b = MERCHANTS.find((m) => m.re.test(name))
  return b ? url(b.key) : null
}

export function appLogo(app?: string | null): string | null {
  return app && APPS[app] ? url(APPS[app]) : null
}

export const NETWORK_LABELS: Record<string, string> = { VISA: 'Visa', MASTERCARD: 'Mastercard', RUPAY: 'RuPay' }
/** The card network's logo (Visa, Mastercard, RuPay). */
export const networkLogo = (n?: string | null): string | null => (n && NETWORK_LABELS[n] ? url(n.toLowerCase()) : null)

export function bankLogo(bank?: string | null, name?: string | null): string | null {
  const k = (bank === 'Kotak' && name && /\b811\b/.test(name) && 'kotak811')
    || (bank && BANKS[bank])
    || (name && (BANK_NAMES.find(([re]) => re.test(name))?.[1] ?? Object.entries(BANKS).find(([b]) => new RegExp(`\\b${b}\\b`, 'i').test(name))?.[1]))
    || (name && NETWORKS.find(([re]) => re.test(name))?.[1])
  return k ? url(k) : null
}
