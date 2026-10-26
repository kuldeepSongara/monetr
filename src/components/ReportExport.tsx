import { useState } from 'react'
import { FileBarChart } from 'lucide-react'
import { useApp } from '../store'
import { buildReportHtml } from '../lib/report'
import { addDays, addMonths, payCycle, type Range } from '../lib/dates'
import { downloadFile } from '../lib/utils'
import { Button, Modal, Segmented, Toggle } from './ui'

type RangeKey = 'cycle' | '3m' | '6m' | '12m' | 'all'

/** Export the interactive HTML report. On a phone it opens the share sheet so you can send it to your laptop. */
export function ReportExport({ variant = 'ghost', className }: { variant?: 'ghost' | 'soft'; className?: string }) {
  const { transactions, categories, settings, today, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [rangeKey, setRangeKey] = useState<RangeKey>('6m')
  const [notes, setNotes] = useState(true)
  const [busy, setBusy] = useState(false)

  function range(): Range {
    if (rangeKey === 'cycle') return payCycle(today, settings.payCycleStartDay)
    if (rangeKey === 'all') return { start: transactions.reduce((m, t) => (t.date < m ? t.date : m), today), end: today }
    const months = rangeKey === '3m' ? 3 : rangeKey === '6m' ? 6 : 12
    return { start: addDays(addMonths(today, -months), 1), end: today }
  }

  async function exportReport() {
    setBusy(true)
    try {
      const r = range()
      const html = buildReportHtml(transactions, categories, settings, { range: r, includeNotes: notes })
      const name = `monetr-report-${r.start}-to-${r.end}.html`
      const file = new File([html], name, { type: 'text/html' })
      const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent)
      if (mobile && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Monetr report' }).catch(() => undefined)
      } else {
        downloadFile(name, html, 'text/html')
        notify('Report downloaded — open it in any browser', 'success')
      }
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        <FileBarChart className="h-4 w-4" /> Interactive report
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Interactive report"
        subtitle="A single .html file with live charts — filter categories, hover spikes, click a day. Works offline on any laptop or tablet."
        size="sm"
        footer={
          <Button className="w-full" onClick={exportReport} loading={busy}>
            <FileBarChart className="h-4 w-4" /> Create report
          </Button>
        }
      >
        <div className="space-y-3.5">
          <div>
            <p className="label">Period</p>
            <Segmented
              size="sm"
              value={rangeKey}
              onChange={setRangeKey}
              options={[
                { value: 'cycle', label: 'This cycle' },
                { value: '3m', label: '3 mo' },
                { value: '6m', label: '6 mo' },
                { value: '12m', label: '12 mo' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <Toggle checked={notes} onChange={setNotes} label="Include notes" hint="Turn off if you'll share the report with someone." />
        </div>
      </Modal>
    </>
  )
}
