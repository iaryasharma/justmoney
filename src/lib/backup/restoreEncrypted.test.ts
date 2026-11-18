import { describe, expect, it } from 'vitest'
import { restoreFromText } from './backup'

describe('restoring a backup file', () => {
  it('refuses a plain JSON backup, without asking for a password', async () => {
    let asked = false
    const plain = JSON.stringify({ app: 'JustMoney', transactions: [] })
    await expect(restoreFromText(plain, async () => { asked = true; return 'pw' })).rejects.toThrow(/not encrypted/)
    expect(asked).toBe(false)
  })
})
