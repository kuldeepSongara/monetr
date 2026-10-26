import { useState } from 'react'
import { Trash2, Wand2 } from 'lucide-react'
import { useApp } from '../../store'
import { deleteRule } from '../../db/db'
import { Card, SectionTitle } from '../ui'

/** Merchant → category rules learned from your choices. Applied automatically to new entries. */
export function RulesCard() {
  const { rules, categoryMap, refresh, notify } = useApp()
  const [showAll, setShowAll] = useState(false)
  const sorted = [...rules].sort((a, b) => b.hits - a.hits || a.merchant.localeCompare(b.merchant))
  const visible = showAll ? sorted : sorted.slice(0, 8)

  return (
    <Card>
      <SectionTitle title="Auto-categorise rules" sub={`${rules.length} learned from your choices`} />
      {rules.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <Wand2 className="h-3.5 w-3.5" /> Pick a category for a merchant once and Monetr will reuse it next time.
        </p>
      ) : (
        <div className="space-y-1">
          {visible.map((r) => {
            const cat = categoryMap.get(r.categoryId)
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-ink">{r.merchant}</span>
                <span className="truncate text-muted">
                  → {cat?.emoji} {cat?.name ?? 'Deleted category'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon h-6 w-6 rounded-md text-muted hover:text-bad"
                  aria-label={`Forget rule for ${r.merchant}`}
                  onClick={async () => {
                    await deleteRule(r.id)
                    await refresh()
                    notify('Rule removed', 'info')
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          {sorted.length > 8 ? (
            <button type="button" onClick={() => setShowAll(!showAll)} className="px-1.5 text-[10px] font-medium text-muted underline underline-offset-2">
              {showAll ? 'Show fewer' : `Show all ${sorted.length}`}
            </button>
          ) : null}
        </div>
      )}
    </Card>
  )
}
