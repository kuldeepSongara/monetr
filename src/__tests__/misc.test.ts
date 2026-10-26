import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Bytes } from '../lib/sha256'
import { lockoutMs } from '../lib/pin'
import { ruleCategory, suggestedFxRate } from '../lib/suggest'
import { derToRaw } from '../lib/biometric'
import type { Rule, Txn } from '../types'

describe('sha256 fallback', () => {
  it('matches node crypto', () => {
    for (const input of ['', 'abc', 'x'.repeat(1000), 'salt:1234']) {
      const ours = Buffer.from(sha256Bytes(new TextEncoder().encode(input))).toString('hex')
      expect(ours).toBe(createHash('sha256').update(input).digest('hex'))
    }
  })
})

describe('PIN lockout', () => {
  it('allows 5 attempts then backs off', () => {
    expect(lockoutMs(4)).toBe(0)
    expect(lockoutMs(5)).toBe(30_000)
    expect(lockoutMs(6)).toBe(60_000)
    expect(lockoutMs(50)).toBe(15 * 60_000)
  })
})

describe('rules', () => {
  const rules: Rule[] = [{ id: 'r', merchant: 'starbucks', categoryId: 'cat_dining', hits: 1, updatedAt: '' }]
  it('matches exact and bank-descriptor merchants', () => {
    expect(ruleCategory('Starbucks', rules)).toBe('cat_dining')
    expect(ruleCategory('STARBUCKS 0423 TORONTO ON', rules)).toBe('cat_dining')
    expect(ruleCategory('Starbuckz', rules)).toBeUndefined()
  })
})

describe('suggestedFxRate', () => {
  it('reuses the latest rate for that currency', () => {
    const t = (date: string, fxRate: number) => ({ currency: 'EUR', fxRate, date, createdAt: date }) as Txn
    expect(suggestedFxRate('EUR', 'USD', [t('2026-01-01', 1.05), t('2026-03-01', 1.09)], [])).toBe(1.09)
    expect(suggestedFxRate('GBP', 'USD', [], [])).toBeUndefined()
    expect(suggestedFxRate('USD', 'USD', [], [])).toBe(1)
  })
})

describe('derToRaw', () => {
  it('strips DER padding into 64-byte r||s', () => {
    const r = new Uint8Array(33).fill(1)
    r[0] = 0
    const s = new Uint8Array(32).fill(2)
    const der = new Uint8Array([0x30, 2 + 33 + 2 + 32, 0x02, 33, ...r, 0x02, 32, ...s])
    const raw = derToRaw(der)
    expect(raw.length).toBe(64)
    expect([...raw.slice(0, 32)].every((b) => b === 1)).toBe(true)
    expect([...raw.slice(32)].every((b) => b === 2)).toBe(true)
  })
})
