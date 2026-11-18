import { describe, expect, it } from 'vitest'
import { appLogo, bankLogo, merchantBrand, merchantLogo } from './brands'

describe('brand logos', () => {
  it('matches the new merchants', () => {
    expect(merchantLogo('Domino\'s Pizza')).toBe('/brands/dominos.webp')
    expect(merchantLogo('IRCTC UTS')).toBe('/brands/irctc.webp')
    expect(merchantLogo('MakeMyTrip India')).toBe('/brands/makemytrip.webp')
    expect(merchantLogo('Airtel Postpaid')).toBe('/brands/airtel.webp')
    expect(merchantLogo('NYKAA E-RETAIL')).toBe('/brands/nykaa.webp')
    expect(merchantLogo('Reliance Digital')).toBe('/brands/reliancedigital.webp')
    expect(merchantLogo('CROMA ELECTRONICS')).toBe('/brands/croma.webp')
    expect(merchantLogo('Smart Bazaar Mumbai')).toBe('/brands/smartbazaar.webp')
    expect(merchantLogo('Barista Coffee')).toBe('/brands/baristacoffee.webp')
    expect(merchantLogo('Pilgrim Beauty')).toBe('/brands/pilgrim.webp')
    expect(merchantLogo('DOT & KEY WELLNESS')).toBe('/brands/dotandkey.webp')
    expect(merchantLogo('Dot and Key')).toBe('/brands/dotandkey.webp')
    expect(merchantLogo('ROBLOX')).toBe('/brands/roblox.webp')
    expect(merchantLogo('Steam Purchase')).toBe('/brands/steam.webp')
    expect(merchantLogo('EPIC GAMES')).toBe('/brands/epicgames.webp')
    expect(merchantLogo('Google One storage')).toBe('/brands/googleone.webp')
    expect(merchantLogo('GOOGLE PLAY')).toBe('/brands/googleplay.webp')
    expect(merchantLogo('BEWAKOOF BRANDS PVT LTD')).toBe('/brands/bewakoof.webp')
    expect(merchantLogo('The Souled Store')).toBe('/brands/souledstore.webp')
    expect(merchantLogo('SOULED STORE')).toBe('/brands/souledstore.webp')
  })
  it('keeps look-alikes apart', () => {
    expect(merchantLogo('JioMart')).toBe('/brands/jiomart.webp')
    expect(merchantLogo('Jio Recharge')).toBe('/brands/jio.webp')
    expect(merchantLogo('JioHotstar')).toBe('/brands/hotstar.webp')
    expect(merchantLogo('District by Zomato')).toBe('/brands/district.webp')
    expect(merchantLogo('Zomato')).toBe('/brands/zomato.webp')
    expect(merchantLogo('Credit Card Bill')).toBeNull()
    expect(merchantLogo('Navi Mumbai Metro')).toBeNull()
  })
  it('finds bank logos by short name, full name and card network', () => {
    expect(bankLogo('ICICI')).toBe('/brands/icici.webp')
    expect(bankLogo('BoB')).toBe('/brands/bankofbaroda.webp')
    expect(bankLogo(null, 'Union Bank of India savings')).toBe('/brands/unionbank.webp')
    expect(bankLogo(null, 'Visa Signature')).toBe('/brands/visa.webp')
    expect(bankLogo(null, 'Cash wallet')).toBeNull()
  })
  it('has logos for the UPI apps', () => {
    for (const a of ['Google Pay', 'CRED', 'Navi', 'Slice', 'Pop', 'MobiKwik', 'WhatsApp Pay']) expect(appLogo(a)).toMatch(/^\/brands\/.+\.webp$/)
  })
})

import { existsSync } from 'node:fs'
describe('variants share their brand logo', () => {
  it('points Instamart, Dineout, Dinein and Amazon Fresh at the main logos', () => {
    expect(merchantLogo('Swiggy Instamart')).toBe('/brands/instamart.webp')
    expect(merchantLogo('Swiggy Dineout')).toBe('/brands/swiggy.webp')
    expect(merchantLogo('Zomato Dining')).toBe('/brands/zomato.webp')
    expect(merchantLogo('District Dinein')).toBe('/brands/district.webp')
    expect(merchantLogo('Amazon Fresh')).toBe('/brands/amazon.webp')
  })
  it('Amazon Now is its own quick-commerce app, like Flipkart Minutes', () => {
    expect(merchantBrand('AMAZON NOW')?.label).toBe('Amazon Now')
    expect(merchantLogo('Amazon Now')).toBe('/brands/amazon-now.webp')
    expect(merchantLogo('Amazon')).toBe('/brands/amazon.webp')
    expect(guessCategory('Amazon Now')).toBe('Grocery')
    expect(guessCategory('Amazon')).toBe('Shopping')
  })
  it('MyJio is Jio, and every spelling of Smart Bazaar is one brand', () => {
    for (const n of ['MyJio', 'MY JIO', 'Jio Prepaid', 'Reliance Jio Infocomm']) expect(merchantLogo(n), n).toBe('/brands/jio.webp')
    expect(merchantLogo('JioMart')).toBe('/brands/jiomart.webp')
    for (const n of ['Smart Bazaar', 'SMART BAZAR', 'Reliance Smart Bazaar', 'RELIANCE SMARTBAZAR']) expect(merchantBrand(n)?.label, n).toBe('Smart Bazaar')
  })
  it('knows Toing', () => {
    expect(merchantLogo('TOING')).toBe('/brands/toing.webp')
    expect(guessCategory('Toing')).toBe('Food')
  })
  it('every logo the app can show exists as a file', () => {
    for (const n of ['Swiggy Instamart', 'Zomato Dining', 'Amazon Fresh', 'Amazon Now', 'Starbucks', 'WhatsApp', 'Google Play']) {
      const u = merchantLogo(n)!
      expect(existsSync(`public${u}`), u).toBe(true)
    }
  })
})

import { guessCategory } from '../capture/ai'
describe('streaming is entertainment', () => {
  it('files Netflix, Prime, YouTube, YouTube Music, Hotstar and Apple Music there', () => {
    for (const n of ['Netflix', 'Amazon Prime', 'Prime Video', 'YouTube Premium', 'YouTube Music', 'JioHotstar', 'Apple Music']) expect(guessCategory(n), n).toBe('Entertainment')
    expect(guessCategory('Spotify')).toBe('Subscriptions')
    expect(guessCategory('Primerica Rent')).not.toBe('Entertainment')
  })
})

describe('metro, cab and clothing brands', () => {
  it('knows every name Bengaluru metro goes by', () => {
    for (const n of ['Namma Metro', 'NAMMAMETRO', 'Bangalore Metro', 'Bengaluru Metro Rail', 'BMRCL']) expect(merchantLogo(n), n).toBe('/brands/nammametro.webp')
  })
  it('finds the rest', () => {
    expect(merchantLogo('DMRC Delhi Metro')).toBe('/brands/delhimetro.webp')
    expect(merchantLogo('Jaipur Metro')).toBe('/brands/jaipurmetro.webp')
    for (const n of ['Pune Metro', 'Maha Metro', 'PMRDA']) expect(merchantLogo(n), n).toBe('/brands/punemetro.webp')
    expect(merchantLogo('Namma Yatri')).toBe('/brands/nammayatri.webp')
    expect(merchantLogo('ANI Technologies')).toBe('/brands/ola.webp')
    expect(merchantLogo('Avenue Supermarts DMart')).toBe('/brands/dmart.webp')
    expect(merchantLogo('H&M India')).toBe('/brands/hm.webp')
    expect(merchantLogo("Levi's")).toBe('/brands/levis.webp')
    for (const k of ['westside', 'zudio', 'zara', 'decathlon']) expect(merchantLogo(k)).toBe(`/brands/${k}.webp`)
    expect(merchantLogo('CHAAYOS 4421')).toBe('/brands/chaayos.webp')
    expect(merchantLogo("Wendy's Burgers")).toBe('/brands/wendys.webp')
    expect(merchantLogo('Cafe Coffee Day')).toBe('/brands/cafecoffeeday.webp')
    expect(merchantLogo('CCD Koramangala')).toBe('/brands/cafecoffeeday.webp')
    expect(merchantLogo('Bikanerwala')).toBe('/brands/bikanerwala.webp')
    expect(merchantLogo('Burger Singh')).toBe('/brands/burgersingh.webp')
    expect(merchantLogo('Burger King')).toBe('/brands/burgerking.webp')
    expect(merchantLogo('Red Tape')).toBe('/brands/redtape.webp')
    expect(merchantLogo('Zara')).toBe('/brands/zara.webp')
    expect(merchantLogo('Limeroad')).toBe('/brands/limeroad.webp')
    expect(merchantLogo('Max Fashion')).toBe('/brands/maxshopping.webp')
    expect(merchantLogo('VISHAL MEGA MART')).toBe('/brands/vishalmegamart.webp')
    expect(merchantLogo('V-Mart Retail')).toBe('/brands/vmart.webp')
    expect(merchantLogo('Bonkers Corner')).toBe('/brands/bonkerscorner.webp')
    expect(merchantLogo('Glitchez')).toBe('/brands/glitchez.webp')
    expect(merchantLogo('Trends')).toBe('/brands/trends.webp')
    expect(merchantLogo('Reliance Trends')).toBe('/brands/trends.webp')
    expect(merchantLogo('D-Mart')).toBe('/brands/dmart.webp')
    expect(merchantLogo('Coca Cola')).toBeNull()
  })
  it('files them sensibly', () => {
    expect(guessCategory('Bangalore Metro')).toBe('Travel')
    expect(guessCategory('Zudio')).toBe('Shopping')
  })
})

import { FITNESS_WORDS } from '../core/data'
describe('fitness', () => {
  it('files the gym, protein and the like', () => {
    for (const n of ['Gym', 'Cult.fit membership', 'Protein powder', 'protien oats', 'MuscleBlaze whey', 'creatine', 'Gold’s Gym'.replace('’', "'")]) expect(guessCategory(n), n).toBe('Fitness')
    expect(FITNESS_WORDS.test('Protien Oats')).toBe(true)
    expect(guessCategory('Apollo pharmacy')).toBe('Health')
  })
  it('knows Crunchyroll', () => {
    expect(merchantLogo('Crunchyroll')).toBe('/brands/crunchyroll.webp')
    expect(merchantLogo('CRUNCHY ROLL premium')).toBe('/brands/crunchyroll.webp')
    expect(guessCategory('Crunchyroll')).toBe('Entertainment')
  })
})
