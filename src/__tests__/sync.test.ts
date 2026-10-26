import { describe, expect, it } from 'vitest'
import { mergeSnapshots, parsePairing, pairingCode, snapshotFingerprint, type Snapshot } from '../lib/sync'

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  v: 2,
  exportedAt: '',
  deviceId: 'd',
  settings: { values: {}, updatedAt: '' },
  tables: {},
  tombstones: [],
  ...over,
})
const now = new Date('2026-10-25T12:00:00Z')

describe('mergeSnapshots', () => {
  it('keeps records from both sides and the newest version of each', () => {
    const local = snap({ tables: { transactions: [{ id: 'a', updatedAt: '2026-10-02', merchant: 'L' }, { id: 'b', updatedAt: '2026-10-01' }] } })
    const remote = snap({ tables: { transactions: [{ id: 'a', updatedAt: '2026-10-03', merchant: 'R' }, { id: 'c', updatedAt: '2026-10-01' }] } })
    const merged = mergeSnapshots(local, remote, now)
    const rows = merged.tables.transactions!
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
    expect(rows.find((r) => r.id === 'a')!.merchant).toBe('R')
  })

  it('propagates deletions via tombstones', () => {
    const local = snap({ tables: { bills: [] }, tombstones: [{ id: 'bills:x', table: 'bills', recordId: 'x', deletedAt: '2026-10-10T00:00:00Z' }] })
    const remote = snap({ tables: { bills: [{ id: 'x', updatedAt: '2026-10-01' }] } })
    expect(mergeSnapshots(local, remote, now).tables.bills).toEqual([])
  })

  it('keeps a record edited after it was deleted elsewhere', () => {
    const local = snap({ tables: { bills: [{ id: 'x', updatedAt: '2026-10-20T00:00:00Z' }] } })
    const remote = snap({ tables: { bills: [] }, tombstones: [{ id: 'bills:x', table: 'bills', recordId: 'x', deletedAt: '2026-10-10T00:00:00Z' }] })
    expect(mergeSnapshots(local, remote, now).tables.bills).toHaveLength(1)
  })

  it('passes through tables this device does not sync (AI profiles opted out)', () => {
    const local = snap({ tables: { transactions: [] } })
    const remote = snap({ tables: { transactions: [], profiles: [{ id: 'p1', updatedAt: '1' }] } })
    expect(mergeSnapshots(local, remote, now).tables.profiles).toEqual([{ id: 'p1', updatedAt: '1' }])
  })

  it('takes the newer shared settings', () => {
    const local = snap({ settings: { values: { currency: 'USD' }, updatedAt: '2026-01-01' } })
    const remote = snap({ settings: { values: { currency: 'CAD' }, updatedAt: '2026-05-01' } })
    expect(mergeSnapshots(local, remote, now).settings.values.currency).toBe('CAD')
  })

  it('fingerprint changes when a record is edited', () => {
    const a = snap({ tables: { transactions: [{ id: 'a', updatedAt: '1' }] } })
    const b = snap({ tables: { transactions: [{ id: 'a', updatedAt: '2' }] } })
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b))
  })
})

describe('pairing codes', () => {
  const state = { syncId: `mtr_${'a'.repeat(32)}`, key: 'A'.repeat(43) }
  it('round-trips a raw code', () => {
    expect(parsePairing(pairingCode(state))).toMatchObject(state)
  })
  it('reads a code from a link URL, with server', () => {
    const url = `https://monetr.example/#/link?code=${encodeURIComponent(pairingCode(state))}&server=${encodeURIComponent('https://x.vercel.app')}`
    expect(parsePairing(url)).toMatchObject({ ...state, server: 'https://x.vercel.app' })
  })
  it('rejects junk', () => {
    expect(parsePairing('hello')).toBeNull()
    expect(parsePairing('mtr1.mtr_123.abc')).toBeNull()
  })
})
