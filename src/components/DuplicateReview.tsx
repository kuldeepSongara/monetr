import { useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { useApp } from '../store'
import type { Txn } from '../types'
import { deleteTransaction, markNotDuplicate } from '../db/db'
import { formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { DuplicatePair } from '../lib/duplicates'
import { Badge, Button, Card, Confirm, Modal } from './ui'

const SOURCE: Record<Txn['source'], string> = {
  manual: 'Entered by you',
  ai: 'Quick add',
  receipt: 'Receipt scan',
  import: 'Statement import',
  bill: 'Bill / autopay',
}

/** Banner + review dialog for possible duplicates. Nothing is removed without your confirmation. */
export function DuplicateBanner() {
  const { duplicates } = useApp()
  const [open, setOpen] = useState(false)
  if (!duplicates.length) return null
  return (
    <>
      <Card className="flex items-center gap-3 border-warn/30 bg-warn/[0.06]">
        <Copy className="h-4 w-4 shrink-0 text-warn" />
        <p className="min-w-0 flex-1 text-[12px] text-ink">
          {duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'} — check whether you were charged twice.
        </p>
        <Button size="sm" variant="soft" onClick={() => setOpen(true)}>
          Review
        </Button>
      </Card>
      <DuplicateReview open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function DuplicateReview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { duplicates, categoryMap, refresh, notify } = useApp()
  const [toDelete, setToDelete] = useState<{ pair: DuplicatePair; txn: Txn } | null>(null)

  async function keepBoth(pair: DuplicatePair) {
    await markNotDuplicate(pair.a.id, pair.b.id)
    await refresh()
    notify('Marked as two separate payments', 'success')
    if (duplicates.length <= 1) onClose()
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Possible duplicates" subtitle="Same amount, close dates. Decide for each pair — nothing is changed until you choose.">
        {duplicates.length ? (
          <div className="space-y-3">
            {duplicates.map((pair) => (
              <div key={pair.id} className="rounded-xl border border-line/70 p-3">
                <p className="mb-2 text-[11px] text-muted">{pair.reason}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[pair.a, pair.b].map((t) => (
                    <div key={t.id} className="rounded-lg border border-line/60 bg-surface2/40 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-ink">{t.merchant}</p>
                          <p className="text-[10px] text-muted">
                            {formatDate(t.date, 'medium')} · {categoryMap.get(t.categoryId)?.name ?? 'Other'}
                          </p>
                        </div>
                        <p className="tnum text-[12px] font-bold text-ink">{formatMoney(t.amount, t.currency)}</p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Badge>{SOURCE[t.source]}</Badge>
                        {t.note ? <span className="truncate text-[10px] text-muted">{t.note}</span> : null}
                      </div>
                      <Button size="sm" variant="ghost" className="mt-2 w-full text-bad" onClick={() => setToDelete({ pair, txn: t })}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete this one
                      </Button>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="soft" className="mt-2 w-full" onClick={() => keepBoth(pair)}>
                  Both are real — keep both
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-[12px] text-muted">No possible duplicates left.</p>
        )}
      </Modal>

      <Confirm
        open={Boolean(toDelete)}
        title="Delete this transaction?"
        body={
          toDelete
            ? `${toDelete.txn.merchant} · ${formatMoney(toDelete.txn.amount, toDelete.txn.currency)} on ${formatDate(toDelete.txn.date, 'medium')} (${SOURCE[toDelete.txn.source]}). The other one is kept. This can't be undone.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!toDelete) return
          await deleteTransaction(toDelete.txn.id)
          await refresh()
          setToDelete(null)
          notify('Duplicate removed', 'success')
        }}
        onClose={() => setToDelete(null)}
      />
    </>
  )
}
