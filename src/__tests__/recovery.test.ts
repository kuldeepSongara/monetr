import { describe, expect, it } from 'vitest'
import { openKit, parseKit, sealKit, WrongPasswordError } from '../lib/recovery'

const pairing = { syncId: 'mtr_' + 'a1'.repeat(16), key: 'A'.repeat(43), server: 'https://x.vercel.app' }

describe('recovery kit', () => {
  it('opens with the right password and restores the pairing', async () => {
    const kit = await sealKit(pairing, 'correct horse battery')
    expect(parseKit(kit)).toBe(kit)
    expect(parseKit(`https://m.app/#/link?kit=${encodeURIComponent(kit)}`)).toBe(kit)
    const p = await openKit(kit, 'correct horse battery')
    expect(p.syncId).toBe(pairing.syncId)
    expect(p.key).toBe(pairing.key)
    expect(p.server).toBe(pairing.server)
  }, 20000)
  it('refuses a wrong password and never contains the key in clear', async () => {
    const kit = await sealKit(pairing, 'correct horse battery')
    expect(kit.includes(pairing.key)).toBe(false)
    await expect(openKit(kit, 'wrong password!!')).rejects.toBeInstanceOf(WrongPasswordError)
  }, 20000)
})
