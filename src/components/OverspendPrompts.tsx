import { useState } from 'react'
import { TrendingDown } from 'lucide-react'
import { useApp } from '../store'
import { decideOverspend } from '../db/db'
import { CATCHUP_CAP } from '../lib/budgetAdjust'
import { formatMoney } from '../lib/money'
import type { CarryPlan } from '../types'
import { Button, Card } from './ui'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Fun money went $240 over in October — what should this cycle do?" Nothing changes until you choose. */
export function OverspendPrompts() {
  const { overspendPrompts, settings, refresh, notify } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  if (!overspendPrompts.length) return null
  const currency = settings.currency

  return (
    <div className="space-y-2.5">
      {overspendPrompts.map((p) => {
        const month = MONTHS[Number(p.cycleStart.slice(5, 7)) - 1]
        const cap = Math.floor(p.budget.amount * CATCHUP_CAP)
        const nextTake = Math.min(p.over, cap)
        const per3 = Math.min(Math.ceil(p.over / 3), cap)
        const per6 = Math.min(Math.ceil(p.over / 6), cap)
        async function choose(plan: CarryPlan) {
          setBusy(p.budget.id + plan)
          try {
            await decideOverspend(p.budget.id, p.cycleStart, p.over, plan)
            await refresh()
            notify(plan === 'waive' ? `${p.label}: starting fresh` : `${p.label}: catch-up added to this cycle`, 'success')
          } finally {
            setBusy(null)
          }
        }
        return (
          <Card key={p.budget.id} className="border-warn/35 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warn/[0.14] text-warn">
                <TrendingDown className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">
                  {p.label} went {formatMoney(p.over, currency)} over in {month}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                  Take it out of the coming cycles so the total evens out? At most {formatMoney(cap, currency)} (half the budget) comes out of any one
                  cycle; anything above that moves to the next.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => choose('next')} loading={busy === p.budget.id + 'next'}>
                    Take {formatMoney(nextTake, currency)} from this cycle
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => choose('spread3')} loading={busy === p.budget.id + 'spread3'}>
                    {formatMoney(per3, currency)} × 3 cycles
                  </Button>
                  {p.large ? (
                    <Button size="sm" variant="ghost" onClick={() => choose('spread6')} loading={busy === p.budget.id + 'spread6'}>
                      {formatMoney(per6, currency)} × 6 cycles
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => choose('waive')} loading={busy === p.budget.id + 'waive'}>
                    Let it go
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
