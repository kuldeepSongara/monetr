import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Share2 } from 'lucide-react'
import { useApp } from '../store'
import { buildShareData, drawShareImage, rangeLabel, shareRange, type ShareRangeKey } from '../lib/shareImage'
import { Button, Field, Input, Modal, Segmented, cn } from './ui'

/** Share a picture of overall spending (no shops, notes or transactions) with family or friends. */
export function ShareCharts({ variant = 'soft', className, label = 'Share' }: { variant?: 'ghost' | 'soft'; className?: string; label?: string }) {
  const { transactions, categories, settings, today, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [rangeKey, setRangeKey] = useState<ShareRangeKey>('this-month')
  const [customStart, setCustomStart] = useState(`${today.slice(0, 7)}-01`)
  const [customEnd, setCustomEnd] = useState(today)
  const [mode, setMode] = useState<'amount' | 'percent'>('amount')
  const [hidden, setHidden] = useState<string[]>([])
  const [title, setTitle] = useState('My spending')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const range = useMemo(() => shareRange(rangeKey, today, { start: customStart, end: customEnd }), [rangeKey, today, customStart, customEnd])
  const expenseCats = categories.filter((c) => c.kind === 'expense')

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current ?? document.createElement('canvas')
    canvasRef.current = canvas
    const data = buildShareData(transactions, categories, rangeKey, range, new Set(hidden))
    drawShareImage(canvas, data, { title: title.trim() || 'My spending', subtitle: rangeLabel(rangeKey, range), currency: settings.currency, mode })
    setPreview(canvas.toDataURL('image/png'))
  }, [open, transactions, categories, rangeKey, range, hidden, title, mode, settings.currency])

  async function blob(): Promise<Blob | null> {
    const canvas = canvasRef.current
    if (!canvas) return null
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
  }
  const fileName = () => `spending-${range.start}-to-${range.end}.png`

  async function share() {
    setBusy(true)
    try {
      const b = await blob()
      if (!b) return
      const file = new File([b], fileName(), { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: title.trim() || 'My spending' }).catch(() => undefined)
      } else {
        download(b)
      }
    } finally {
      setBusy(false)
    }
  }

  function download(b: Blob) {
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    notify('Image saved', 'success')
  }

  async function copy() {
    const b = await blob()
    if (!b) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
      notify('Image copied — paste it into WhatsApp or Messages', 'success')
    } catch {
      notify('Copying images isn’t supported here — use Save instead', 'error')
    }
  }

  const canCopy = typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write)

  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)} aria-label="Share spending" title="Share spending">
        <Share2 className="h-4 w-4" /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Share your spending"
        subtitle="A picture of totals and charts only — no shops, notes or individual transactions."
        footer={
          <div className="flex gap-2">
            {canCopy ? (
              <Button variant="ghost" onClick={copy} aria-label="Copy image">
                <Copy className="h-4 w-4" />
              </Button>
            ) : null}
            <Button variant="ghost" onClick={async () => { const b = await blob(); if (b) download(b) }} aria-label="Save image">
              <Download className="h-4 w-4" />
            </Button>
            <Button className="flex-1" onClick={share} loading={busy}>
              <Share2 className="h-4 w-4" /> Share
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <div>
            <p className="label">Period</p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['this-month', 'This month'],
                  ['last-month', 'Last month'],
                  ['3m', '3 months'],
                  ['year', 'This year'],
                  ['custom', 'Custom'],
                ] as [ShareRangeKey, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setRangeKey(k)} className={cn('chip', rangeKey === k && 'chip-active')}>
                  {l}
                </button>
              ))}
            </div>
            {rangeKey === 'custom' ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} aria-label="From" />
                <Input type="date" value={customEnd} min={customStart} max={today} onChange={(e) => setCustomEnd(e.target.value)} aria-label="To" />
              </div>
            ) : null}
          </div>

          <div>
            <p className="label">Show</p>
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'amount', label: 'Amounts' },
                { value: 'percent', label: 'Percentages only' },
              ]}
            />
          </div>

          <Field label="Leave out categories" hint={hidden.length ? 'Left out completely — totals and percentages ignore them.' : 'Tap any you’d rather keep private.'}>
            <div className="flex flex-wrap gap-1.5">
              {expenseCats.map((c) => {
                const off = hidden.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setHidden((h) => (off ? h.filter((x) => x !== c.id) : [...h, c.id]))}
                    className={cn('chip', off && 'line-through opacity-50')}
                  >
                    {c.emoji} {c.name}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 40))} placeholder="My spending" />
          </Field>

          {preview ? <img src={preview} alt="Preview of the image you will share" className="w-full rounded-xl border border-line/70" /> : null}
        </div>
      </Modal>
    </>
  )
}
