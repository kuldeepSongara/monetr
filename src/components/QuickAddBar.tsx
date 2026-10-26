import { useState } from 'react'
import { ArrowRight, Loader2, ScanLine, Sparkles } from 'lucide-react'
import { useApp } from '../store'
import type { EditorSeed } from './TransactionEditor'
import { fileToDataUrl } from '../lib/image'
import { parseQuickAdd, scanReceipt } from '../ai/tasks'
import { canUseProfile } from '../ai/providers'
import { pickFile } from '../lib/utils'
import { parseQuickLocal } from '../lib/quickParse'
import { cn } from './ui'

export function QuickAddBar({
  onSeed,
  className,
  placeholder = 'Try “coffee 4.50 yesterday” or “uber 18 last friday”',
}: {
  onSeed: (seed: EditorSeed) => void
  className?: string
  placeholder?: string
}) {
  const { categories, settings, profiles, rules, today, notify } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const aiReady = profiles.some(canUseProfile)

  /** Offline fallback so logging a spend never waits on an AI provider. */
  function parseLocally(reason?: string): boolean {
    const local = parseQuickLocal(text, categories, rules, settings.currency, today)
    if (!local) {
      notify(reason ? `${reason} Couldn't find an amount — try “coffee 4.50”.` : 'Couldn\'t find an amount — try “coffee 4.50 yesterday”.', 'error')
      return false
    }
    onSeed({ type: local.type, amountMajor: local.amount, date: local.date, merchant: local.merchant, categoryId: local.categoryId, currency: local.currency, source: 'manual' })
    setText('')
    if (reason) notify(`${reason} Filled in offline — check it before saving.`, 'info')
    return true
  }

  async function handleParse() {
    if (!text.trim() || busy) return
    if (!aiReady) {
      parseLocally()
      return
    }
    setBusy(true)
    try {
      // Don't keep you waiting on an overloaded provider: after 15s fall back to the offline parser.
      const { draft, result } = await Promise.race([
        parseQuickAdd(text, categories, settings.currency),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI is slow right now.')), 15_000)),
      ])
      onSeed({
        type: draft.type,
        amountMajor: draft.amount,
        date: draft.date,
        merchant: draft.merchant,
        categoryId: draft.categoryId,
        note: draft.note,
        currency: draft.currency,
        source: 'ai',
      })
      setText('')
      notify(`Parsed with ${result.profileName}`, 'success')
    } catch (err) {
      const msg = err instanceof Error && /slow/.test(err.message) ? 'AI is slow right now.' : 'AI is unavailable.'
      parseLocally(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleScan() {
    if (scanning) return
    if (!aiReady) {
      notify('Receipt scanning needs an AI profile (Settings → AI profiles).', 'error')
      return
    }
    const file = await pickFile('image/*')
    if (!file) return
    setScanning(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      const { draft, result } = await scanReceipt(dataUrl, categories, settings.currency)
      onSeed({
        type: 'expense',
        amountMajor: draft.total,
        date: draft.date,
        merchant: draft.merchant,
        categoryId: draft.categoryId,
        note: draft.items.length
          ? draft.items.map((i) => `${i.name} ${i.amount}`).join(', ').slice(0, 240)
          : undefined,
        currency: draft.currency,
        source: 'receipt',
      })
      notify(`Receipt read with ${result.profileName}`, 'success')
    } catch (err) {
      // Never leave you stuck: open a blank entry so you can type the receipt in.
      notify(`${err instanceof Error ? err.message : 'Could not read that receipt'} — enter it manually.`, 'error')
      onSeed({ type: 'expense', source: 'receipt', note: 'From receipt' })
    } finally {
      setScanning(false)
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-2xl border border-line/80 bg-surface px-3 py-2 shadow-card',
        className,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-accent" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleParse()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-ink outline-none placeholder:text-muted/70"
        enterKeyHint="done"
      />
      <button
        type="button"
        onClick={handleScan}
        className="btn btn-ghost btn-icon h-9 w-9 rounded-lg"
        title="Scan a receipt"
        aria-label="Scan a receipt"
        disabled={scanning}
      >
        {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={handleParse}
        disabled={busy || !text.trim()}
        className="btn btn-primary btn-icon h-9 w-9 rounded-lg"
        aria-label="Parse with AI"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  )
}
