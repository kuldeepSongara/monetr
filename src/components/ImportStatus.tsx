import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileCheck2, FileWarning, Loader2 } from 'lucide-react'
import { useApp } from '../store'
import type { ImportRecord } from '../types'
import { subscribeImports } from '../lib/importJobs'
import { cn } from './ui'

export function useImports(): ImportRecord[] {
  const [jobs, setJobs] = useState<ImportRecord[]>([])
  useEffect(() => subscribeImports(setJobs), [])
  return jobs
}

/**
 * Header chip visible on every screen while a statement is being read or waits for review, plus a
 * toast when a read finishes — so you can leave flagIt and still know what's happening.
 */
/** Mounted once (in the shell): toasts when a background read finishes, wherever you are in the app. */
export function ImportNotifier() {
  const jobs = useImports()
  const { notify } = useApp()
  const prev = useRef<Map<string, ImportRecord['status']>>(new Map())

  useEffect(() => {
    for (const j of jobs) {
      const before = prev.current.get(j.id)
      if (before && (before === 'processing' || before === 'queued') && before !== j.status) {
        if (j.status === 'review') notify(`${j.fileName ?? 'Statement'} read — ${j.count} transaction${j.count === 1 ? '' : 's'} ready to review in flagIt`, 'success')
        else if (j.status === 'failed') notify(`Couldn't read ${j.fileName ?? 'the statement'}: ${j.error ?? 'unknown error'}`, 'error')
      }
    }
    prev.current = new Map(jobs.map((j) => [j.id, j.status]))
  }, [jobs, notify])
  return null
}

export function ImportStatus({ className }: { className?: string }) {
  const jobs = useImports()

  const active = jobs.filter((j) => j.status === 'processing' || j.status === 'queued')
  const review = jobs.filter((j) => j.status === 'review')
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'interrupted')
  if (!active.length && !review.length && !failed.length) return null

  const label = active.length
    ? `Reading ${active.length === 1 ? 'upload' : `${active.length} uploads`}…`
    : review.length
      ? `${review.length} to review`
      : `${failed.length} import${failed.length === 1 ? '' : 's'} need attention`

  return (
    <Link
      to="/flagit?tab=import"
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        active.length ? 'border-accent/40 bg-accent/10 text-accent' : review.length ? 'border-good/40 bg-good/10 text-good' : 'border-warn/40 bg-warn/10 text-warn',
        className,
      )}
      title="Uploads being read / waiting for review"
    >
      {active.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : review.length ? <FileCheck2 className="h-3.5 w-3.5" /> : <FileWarning className="h-3.5 w-3.5" />}
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  )
}
