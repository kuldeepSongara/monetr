import { useState } from 'react'
import { ArrowRight, Loader2, ScanLine, Sparkles } from 'lucide-react'
import { useApp } from '../store'
import type { EditorSeed } from './TransactionEditor'
import { fileToDataUrl } from '../lib/image'
import { parseQuickAdd, scanReceipt } from '../ai/tasks'
import { canUseProfile } from '../ai/providers'
import { pickFile } from '../lib/utils'
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
  const { categories, settings, profiles, notify } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const aiReady = profiles.some(canUseProfile)

  async function handleParse() {
    if (!text.trim() || busy) return
    if (!aiReady) {
      notify('Add an AI profile in Settings → AI profiles first.', 'error')
      return
    }
    setBusy(true)
    try {
      const { draft, result } = await parseQuickAdd(text, categories, settings.currency)
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
      notify(err instanceof Error ? err.message : 'Could not parse that', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleScan() {
    if (scanning) return
    if (!aiReady) {
      notify('Add an AI profile in Settings → AI profiles first.', 'error')
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
      notify(err instanceof Error ? err.message : 'Could not read that receipt', 'error')
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
