import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, categoryColor, categoryIcon } from './data'
import { guessCategory } from '../capture/ai'

describe('default categories', () => {
  it('include Fuel and Games with their own colour and icon', () => {
    expect(DEFAULT_CATEGORIES).toContain('Fuel')
    expect(DEFAULT_CATEGORIES).toContain('Games')
    expect(DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]).toBe('Others')
    expect(categoryIcon('Fuel')).toBe('fuel')
    expect(categoryIcon('Games')).toBe('gamepad')
    expect(categoryColor('Fuel')).not.toBe(categoryColor('Rent'))
  })
  it('files petrol and gaming payments under them', () => {
    expect(guessCategory('Indian Oil petrol pump')).toBe('Fuel')
    expect(guessCategory('HPCL fuel')).toBe('Fuel')
    expect(guessCategory('Steam purchase')).toBe('Games')
    expect(guessCategory('Roblox robux')).toBe('Games')
    expect(guessCategory('Uber trip')).toBe('Travel')
  })
})
