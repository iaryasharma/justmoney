import { describe, it, expect, beforeEach } from 'vitest'
import { write, read, KEYS } from '../core/storage'
import { restoreBackup } from './backup'

const backup = (kv: Record<string, unknown>) => JSON.stringify({ app: 'JustMoney', version: 3, exportedAt: new Date().toISOString(), transactions: [], kv })

describe('restoring a backup file', () => {
  beforeEach(() => { for (const k of [KEYS.appLock, KEYS.geminiKey, KEYS.session, KEYS.onboardingCompleted, KEYS.privacyScreen, KEYS.notifSound]) write(k, undefined as unknown as string) })

  it('never sets the passcode, API keys or per-device state, even if the file carries them', () => {
    restoreBackup(backup({ [KEYS.appLock]: 'pbkdf2$1$aa$bb', [KEYS.geminiKey]: 'attacker-key', [KEYS.session]: 'x', [KEYS.onboardingCompleted]: true }))
    expect(read(KEYS.appLock, undefined)).toBeUndefined()
    expect(read(KEYS.geminiKey, undefined)).toBeUndefined()
    expect(read(KEYS.session, undefined)).toBeUndefined()
  })

  it('still brings back ordinary settings that are not set yet', () => {
    restoreBackup(backup({ [KEYS.notifSound]: 'chime' }))
    expect(read(KEYS.notifSound, undefined)).toBe('chime')
  })

  it('does not overwrite a setting that is already there', () => {
    write(KEYS.notifSound, 'bell')
    restoreBackup(backup({ [KEYS.notifSound]: 'chime' }))
    expect(read(KEYS.notifSound, undefined)).toBe('bell')
  })
})
