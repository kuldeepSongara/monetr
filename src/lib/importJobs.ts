import type { ImportLine, ImportRecord } from '../types'
import { db, makeDefaultSettings } from '../db/db'
import { extractStatement } from '../ai/tasks'
import { canUseProfile } from '../ai/providers'
import { parseStatementCsv } from './csvImport'
import { fileToDataUrl } from './image'
import { findDuplicate, ruleCategory, suggestedFxRate } from './suggest'
import { toMinor } from './money'
import { todayISO } from './dates'
import { uid } from './utils'

/*
 * Statement imports run as background jobs:
 *  - the job and its result live in IndexedDB, so leaving the screen (or the app) never loses them;
 *  - jobs run one at a time, in order, so several uploads don't hammer the AI provider;
 *  - the same file (by content hash) is never processed twice at once, and re-importing a file you
 *    already imported asks first.
 */

const listeners = new Set<(jobs: ImportRecord[]) => void>()
let cache: ImportRecord[] = []
let running = false

async function reload(): Promise<ImportRecord[]> {
  const all = await db.imports.orderBy('createdAt').reverse().toArray()
  cache = all
  listeners.forEach((l) => l(all))
  return all
}

export function subscribeImports(fn: (jobs: ImportRecord[]) => void): () => void {
  listeners.add(fn)
  fn(cache)
  void reload()
  return () => listeners.delete(fn)
}

export function getImports(): ImportRecord[] {
  return cache
}

async function patch(id: string, p: Partial<ImportRecord>): Promise<void> {
  const cur = await db.imports.get(id)
  if (cur) await db.imports.put({ ...cur, ...p })
  await reload()
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  if (crypto.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  const { sha256Bytes } = await import('./sha256')
  return Array.from(sha256Bytes(new Uint8Array(buf)), (b) => b.toString(16).padStart(2, '0')).join('')
}

export type StartResult =
  | { kind: 'started'; job: ImportRecord }
  | { kind: 'in-progress'; job: ImportRecord }
  | { kind: 'already-imported'; job: ImportRecord }
  | { kind: 'awaiting-review'; job: ImportRecord }

const ACTIVE: ImportRecord['status'][] = ['queued', 'processing']

/** Queue a file. Checks for the same file already running, waiting for review, or imported before. */
export async function startImport(file: File, opts: { force?: boolean } = {}): Promise<StartResult> {
  const fileHash = await sha256(await file.arrayBuffer())
  const existing = (await db.imports.toArray()).filter((j) => j.fileHash === fileHash)
  const active = existing.find((j) => ACTIVE.includes(j.status))
  if (active) return { kind: 'in-progress', job: active }
  const waiting = existing.find((j) => j.status === 'review')
  if (waiting) return { kind: 'awaiting-review', job: waiting }
  const done = existing.find((j) => j.status === 'imported')
  if (done && !opts.force) return { kind: 'already-imported', job: done }

  let source: ImportRecord['source']
  const name = file.name.toLowerCase()
  if (file.type.startsWith('image/')) source = { kind: 'image', dataUrl: await fileToDataUrl(file, 2000, 0.85) }
  else if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    if (file.size > 15 * 1024 * 1024) throw new Error('That PDF is over 15 MB. Export a shorter date range.')
    source = { kind: 'pdf', dataUrl: await fileToDataUrl(file) }
  } else source = { kind: 'text', text: await file.text() }

  const job: ImportRecord = {
    id: uid('imp_'),
    status: 'queued',
    fileName: file.name,
    fileSize: file.size,
    fileHash,
    source,
    count: 0,
    createdAt: new Date().toISOString(),
  }
  await db.imports.put(job)
  await reload()
  void pump()
  return { kind: 'started', job }
}

export async function retryImport(id: string): Promise<void> {
  await patch(id, { status: 'queued', error: undefined })
  void pump()
}

export async function discardImport(id: string): Promise<void> {
  await patch(id, { status: 'discarded', source: undefined, lines: undefined, finishedAt: new Date().toISOString() })
}

export async function saveReview(id: string, lines: ImportLine[], rates: Record<string, string>): Promise<void> {
  const cur = await db.imports.get(id)
  if (cur) await db.imports.put({ ...cur, lines, rates })
  // No reload broadcast: the review screen owns these edits; this just makes them survive navigation.
  const i = cache.findIndex((j) => j.id === id)
  if (i >= 0) cache[i] = { ...cache[i], lines, rates }
}

export async function markImported(id: string, importedCount: number): Promise<void> {
  await patch(id, { status: 'imported', importedCount, source: undefined, finishedAt: new Date().toISOString() })
}

/**
 * On app start: a read that was in progress when the app closed can't still be running, so mark it
 * interrupted (retry is one tap — the file is stored). Queued ones simply start.
 */
export async function resumeImports(): Promise<void> {
  const stale = (await db.imports.toArray()).filter((j) => j.status === 'processing')
  for (const j of stale) await db.imports.put({ ...j, status: 'interrupted', error: 'Monetr was closed while this was being read.' })
  // Old finished jobs: drop the stored file to save space.
  const old = (await db.imports.toArray()).filter((j) => (j.status === 'imported' || j.status === 'discarded') && j.source)
  for (const j of old) await db.imports.put({ ...j, source: undefined })
  await reload()
  void pump()
}

/** Process queued jobs one at a time. */
async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (;;) {
      const next = (await db.imports.where('status').equals('queued').sortBy('createdAt'))[0]
      if (!next) break
      await process(next)
    }
  } finally {
    running = false
  }
}

async function process(job: ImportRecord): Promise<void> {
  await patch(job.id, { status: 'processing', startedAt: new Date().toISOString(), error: undefined })
  try {
    if (!job.source) throw new Error('The original file is no longer stored — upload it again.')
    const [settings, categories, rules, transactions, profiles, currencyProfiles] = await Promise.all([
      db.settings.get('settings'),
      db.categories.toArray(),
      db.rules.toArray(),
      db.transactions.toArray(),
      db.profiles.toArray(),
      db.currencyProfiles.toArray(),
    ])
    const base = (settings ?? makeDefaultSettings()).currency
    const today = todayISO()
    const source = job.source
    const local = source.kind === 'text' ? parseStatementCsv(source.text, base, rules, today) : null
    if (!local && !profiles.some(canUseProfile)) {
      throw new Error('This file needs an AI profile to read. CSV exports with a header row work offline.')
    }
    let readBy = 'device'
    let raw = local
    if (!raw) {
      const res = await extractStatement(source, categories.filter((c) => !c.archived), base)
      raw = res.lines
      readBy = `${res.result.profileName} · ${res.result.model}`
    }
    if (!raw.length) throw new Error('No transactions found in that file.')
    const lines: ImportLine[] = raw.map((l) => {
      const ruled = l.type !== 'transfer' ? ruleCategory(l.merchant, rules) : undefined
      const dup = findDuplicate({ date: l.date, merchant: l.merchant, amount: toMinor(l.amount, l.currency), currency: l.currency }, transactions)
      return {
        ...l,
        categoryId: ruled ?? l.categoryId,
        key: uid('r_'),
        // Lines that look already recorded or were hard to read start unticked — you can tick them back.
        include: !dup && l.confidence >= 0.5,
        duplicateOf: dup?.id,
      }
    })
    const foreign = [...new Set(lines.map((r) => r.currency).filter((c) => c !== base))]
    const rates = Object.fromEntries(foreign.map((c) => [c, String(suggestedFxRate(c, base, transactions, currencyProfiles) ?? '')]))
    await patch(job.id, { status: 'review', lines, rates, count: lines.length, readBy, finishedAt: new Date().toISOString() })
  } catch (err) {
    await patch(job.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Could not read that file',
      finishedAt: new Date().toISOString(),
    })
  }
}
