import { useMemo, useState } from 'react'
import { PiggyBank, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../store'
import type { Pot, Txn } from '../types'
import { deletePot, savePot, setTxnPot } from '../db/db'
import { addDays, daysBetween, formatDate, todayISO } from '../lib/dates'
import { formatMoney, fromMajorString, majorString } from '../lib/money'
import { cyclesUntil, perCycleFor, rebasePot, type PotStatus } from '../lib/pots'
import { Badge, Button, Card, Confirm, Field, Input, Modal, ProgressBar, Segmented, cn } from './ui'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (iso?: string) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '')

const DISMISS_KEY = 'monetr:pot-suggest-dismissed'
function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]
  } catch {
    return []
  }
}

/** A purchase big enough to be worth spreading: more than half of this cycle's budget. */
export function isBigPurchase(baseAmount: number, cycleLimit: number): boolean {
  return cycleLimit > 0 && baseAmount >= cycleLimit / 2
}

export type PotPreset = { kind: 'payback'; txnIds: string[] } | { kind: 'save' }

export function PotsSection() {
  const { potList, transactions, safe, settings, today } = useApp()
  const currency = settings.currency
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Pot | null>(null)
  const [preset, setPreset] = useState<PotPreset | null>(null)
  const [removing, setRemoving] = useState<PotStatus | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)
  const { refresh, notify } = useApp()

  // Big recent purchases that aren't in a pot yet — a gentle nudge, never automatic.
  const suggestions = useMemo(() => {
    const since = addDays(today, -60)
    return transactions
      .filter((t) => t.type === 'expense' && !t.potId && t.source !== 'bill' && t.date >= since && isBigPurchase(t.baseAmount, safe.limit) && !dismissed.includes(t.id))
      // Rent and other repeat payments aren't one-time buys: skip merchants paid a similar amount before.
      .filter((t) => {
        const m = t.merchant.trim().toLowerCase()
        return !transactions.some(
          (o) => o.id !== t.id && o.type === 'expense' && o.merchant.trim().toLowerCase() === m && Math.abs(o.baseAmount - t.baseAmount) <= t.baseAmount * 0.2 && Math.abs(daysBetween(o.date, t.date)) <= 100,
        )
      })
      .sort((a, b) => b.baseAmount - a.baseAmount)
      .slice(0, 2)
  }, [transactions, safe.limit, today, dismissed])

  function dismiss(id: string) {
    const next = [...dismissed, id]
    setDismissed(next)
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-100)))
    } catch {
      /* private mode */
    }
  }

  function open(p: Pot | null, pre: PotPreset | null) {
    setEditing(p)
    setPreset(pre)
    setEditorOpen(true)
  }

  return (
    <>
      <div className="flex items-center justify-between px-0.5">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Savings pots</h2>
          <p className="text-[10px] text-muted">For one-time buys — a laptop, a phone. Paid from the pot, not one month’s budget.</p>
        </div>
        <Button size="sm" onClick={() => open(null, { kind: 'save' })}>
          <Plus className="h-3.5 w-3.5" /> Pot
        </Button>
      </div>

      {suggestions.map((t) => (
        <Card key={t.id} className="flex flex-wrap items-center gap-2 border-warn/30 bg-warn/[0.06] p-3">
          <p className="min-w-0 flex-1 text-[11px] text-ink">
            <span className="font-semibold">{t.merchant}</span> · {formatMoney(t.baseAmount, currency)} on {formatDate(t.date, 'short')} is more than half
            this cycle’s budget. Pay it back over a few months?
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => dismiss(t.id)}>
              Keep in this cycle
            </Button>
            <Button size="sm" onClick={() => open(null, { kind: 'payback', txnIds: [t.id] })}>
              Pay it back
            </Button>
          </div>
        </Card>
      ))}

      {potList.length ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {potList.map((s) => (
            <PotCard key={s.pot.id} status={s} currency={currency} onEdit={() => open(s.pot, null)} onRemove={() => setRemoving(s)} />
          ))}
        </div>
      ) : !suggestions.length ? (
        <Card className="flex items-center gap-3 p-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface2">
            <PiggyBank className="h-4 w-4 text-ink" />
          </div>
          <p className="flex-1 text-[11px] leading-relaxed text-muted">
            Planning a big buy? Start a pot and Monetr sets a little aside each cycle. Already bought it? Make a pay-back pot and spread it over a few
            months.
          </p>
        </Card>
      ) : null}

      <PotEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        pot={editing}
        preset={preset}
        onSaved={async () => {
          await refresh()
          setEditorOpen(false)
        }}
      />

      <Confirm
        open={Boolean(removing)}
        title="Remove this pot?"
        body={
          removing?.linked.length
            ? 'Its purchases stay in your history, but they count against the budget of the cycle they happened in again.'
            : 'Nothing else changes.'
        }
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deletePot(removing.pot.id)
          await refresh()
          notify('Pot removed', 'info')
          setRemoving(null)
        }}
      />
    </>
  )
}

function PotCard({ status: s, currency, onEdit, onRemove }: { status: PotStatus; currency: string; onEdit: () => void; onRemove: () => void }) {
  const pct = s.need ? (s.setAside / s.need) * 100 : 0
  const badge =
    s.state === 'done'
      ? { tone: 'good' as const, text: 'paid off' }
      : s.state === 'ready'
        ? { tone: 'good' as const, text: 'ready' }
        : s.state === 'paying-back'
          ? { tone: 'warn' as const, text: 'paying back' }
          : { tone: undefined, text: 'saving' }

  let line: string
  if (s.state === 'saving') line = `${formatMoney(s.setAside, currency)} of ${formatMoney(s.need, currency)} saved`
  else if (s.state === 'ready') line = `${formatMoney(s.setAside, currency)} saved — link the purchase when you buy`
  else if (s.state === 'paying-back') line = `${formatMoney(s.setAside, currency)} of ${formatMoney(s.need, currency)} paid back`
  else line = `${formatMoney(s.spent, currency)} fully covered`
  const overGoal = s.pot.kind === 'save' && s.spent > s.pot.target && s.pot.target > 0

  return (
    <Card className="p-3.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-sm">{s.pot.emoji || (s.pot.kind === 'save' ? '🐷' : '↩️')}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold text-ink">{s.pot.name}</p>
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </div>
          <p className="tnum mt-0.5 text-[11px] text-muted">{line}</p>
          <ProgressBar value={pct} tone={s.state === 'paying-back' ? 'warn' : 'accent'} height={6} className="mt-2" />
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted">
            <span>{s.thisCycle ? `${formatMoney(s.thisCycle, currency)} set aside this cycle` : s.state === 'done' || s.state === 'ready' ? 'Nothing set aside now' : 'Starts next cycle'}</span>
            <span>{s.remaining > 0 && s.finishDate ? `${s.state === 'saving' ? 'ready' : 'done'} by ${monthYear(s.finishDate)}` : ''}</span>
          </div>
          {overGoal ? <p className="mt-1 text-[10px] text-warn">Cost {formatMoney(s.spent - s.pot.target, currency)} more than planned — the pot keeps going to cover it.</p> : null}

          {s.linked.length ? (
            <div className="mt-2 space-y-0.5 rounded-lg bg-surface2/70 p-2">
              {s.linked.map((t) => (
                <div key={t.id} className="flex justify-between gap-2 text-[10px]">
                  <span className="truncate text-muted">
                    {t.type === 'refund' ? '↩ ' : ''}
                    {t.merchant} · {formatDate(t.date, 'short')}
                  </span>
                  <span className={cn('tnum', t.type === 'refund' ? 'text-good' : 'text-ink/80')}>
                    {t.type === 'refund' ? '−' : ''}
                    {formatMoney(t.baseAmount, currency)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-1">
            <button type="button" onClick={onEdit} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:text-ink">
              <Pencil className="h-3 w-3" /> Edit
            </button>
            <button type="button" onClick={onRemove} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted hover:text-bad">
              <Trash2 className="h-3 w-3" /> Remove
            </button>
            <span className="ml-auto text-[9px] text-muted/70">{formatMoney(s.pot.perCycle, currency)}/cycle</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function PotEditor({
  open,
  onClose,
  pot,
  preset,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  pot: Pot | null
  preset: PotPreset | null
  onSaved: () => Promise<void>
}) {
  const { transactions, settings, today, notify } = useApp()
  const currency = settings.currency
  const [kind, setKind] = useState<Pot['kind']>('save')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [target, setTarget] = useState('')
  const [byMonth, setByMonth] = useState('')
  const [perCycle, setPerCycle] = useState('')
  const [perTouched, setPerTouched] = useState(false)
  const [months, setMonths] = useState('6')
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  // Forget what was loaded once the editor closes, so reopening ("add" again, or the same item) always starts fresh.
  if (!open && loadedFor !== null) setLoadedFor(null)
  const key = open ? pot?.id ?? `new-${preset?.kind}-${preset?.kind === 'payback' ? preset.txnIds.join() : ''}` : null
  if (key && key !== loadedFor) {
    setLoadedFor(key)
    const k = pot?.kind ?? preset?.kind ?? 'save'
    const pre = preset?.kind === 'payback' ? preset.txnIds : []
    const first = transactions.find((t) => t.id === pre[0])
    setKind(k)
    setName(pot?.name ?? first?.merchant ?? '')
    setEmoji(pot?.emoji ?? '')
    setTarget(pot?.target ? majorString(pot.target, currency) : '')
    setByMonth(pot?.targetDate?.slice(0, 7) ?? '')
    setPerCycle(pot ? majorString(pot.perCycle, currency) : '')
    setPerTouched(Boolean(pot))
    setMonths('6')
    setSelected(pot ? transactions.filter((t) => t.potId === pot.id).map((t) => t.id) : pre)
    setSearch('')
    setError('')
  }

  // Purchases you could pay back: expenses not in another pot, last 12 months, biggest first.
  const candidates = useMemo(() => {
    const since = addDays(today, -365)
    const q = search.trim().toLowerCase()
    return transactions
      .filter((t) => t.type === 'expense' && t.date >= since && (!t.potId || t.potId === pot?.id))
      .filter((t) => !q || t.merchant.toLowerCase().includes(q) || (t.note ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)) || b.baseAmount - a.baseAmount)
      .slice(0, 25)
  }, [transactions, today, search, pot?.id, selected])

  const selectedTxns = transactions.filter((t) => selected.includes(t.id))
  const selectedTotal = selectedTxns.reduce((s, t) => s + t.baseAmount, 0)
  const targetMinor = fromMajorString(target, currency) ?? 0
  const targetDate = byMonth ? `${byMonth}-28` : undefined

  // Suggested per-cycle amount, until you type your own.
  const suggested =
    kind === 'save'
      ? targetMinor && targetDate
        ? perCycleFor(targetMinor, cyclesUntil(targetDate, settings, today))
        : 0
      : selectedTotal
        ? perCycleFor(selectedTotal, Math.max(1, Number(months) || 1))
        : 0
  const perMinor = perTouched ? fromMajorString(perCycle, currency) ?? 0 : suggested

  async function save() {
    setError('')
    if (kind === 'save' && targetMinor <= 0) return setError('How much do you want to save?')
    if (kind === 'payback' && !selected.length) return setError('Pick the purchase(s) to pay back.')
    if (perMinor <= 0) return setError(kind === 'save' ? 'Pick a month to buy by, or enter an amount per cycle.' : 'Enter an amount per cycle.')
    setSaving(true)
    try {
      const base = { name: name.trim() || (kind === 'save' ? 'Savings pot' : selectedTxns[0]?.merchant ?? 'Pay back'), emoji: emoji.trim() || undefined, kind, target: kind === 'save' ? targetMinor : 0, perCycle: perMinor, targetDate: kind === 'save' ? targetDate : undefined }
      // Changing the per-cycle amount only affects this cycle onwards.
      const timing = pot ? (pot.perCycle === perMinor ? { startDate: pot.startDate, carried: pot.carried } : rebasePot(pot, transactions, settings, today)) : { startDate: todayISO() }
      const id = await savePot({ ...base, ...timing }, pot?.id)
      const before = pot ? transactions.filter((t) => t.potId === pot.id).map((t) => t.id) : []
      const removed = before.filter((x) => !selected.includes(x))
      if (removed.length) await setTxnPot(removed, null)
      const added = selected.filter((x) => !before.includes(x))
      if (added.length) await setTxnPot(added, id)
      notify(pot ? 'Pot updated' : kind === 'save' ? 'Pot started' : 'Pay-back pot created', 'success')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the pot')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pot ? 'Edit pot' : kind === 'save' ? 'New savings pot' : 'Pay back a purchase'}
      subtitle={`Amounts are in ${currency}. Set aside each pay cycle.`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-[2]" onClick={save} loading={saving}>
            {pot ? 'Save changes' : 'Create pot'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        {!pot ? (
          <Segmented<Pot['kind']>
            value={kind}
            onChange={(k) => {
              setKind(k)
              setPerTouched(false)
              setError('')
            }}
            options={[
              { value: 'save', label: 'Save up first' },
              { value: 'payback', label: 'Already bought it' },
            ]}
          />
        ) : null}

        <div className="grid grid-cols-[4.5rem_1fr] gap-2">
          <Field label="Icon">
            <Input value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 4))} placeholder={kind === 'save' ? '🐷' : '↩️'} className="text-center" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'save' ? 'e.g. New laptop' : 'e.g. Phone'} />
          </Field>
        </div>

        {kind === 'save' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Goal">
              <Input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Buy by">
              <Input type="month" value={byMonth} min={today.slice(0, 7)} onChange={(e) => setByMonth(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {kind === 'payback' || pot ? (
          <Field
            label={kind === 'save' ? 'Bought it? Pick the purchase' : 'Purchases to pay back'}
            hint={selected.length ? `${selected.length} selected · ${formatMoney(selectedTotal, currency)}` : 'Biggest expenses from the last 12 months.'}
          >
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search merchant or note" className="mb-1.5" />
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {candidates.map((t: Txn) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition',
                    selected.includes(t.id) ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line/70 bg-surface2/40 text-muted hover:text-ink',
                  )}
                >
                  <span className="truncate">
                    {t.merchant} · {formatDate(t.date, 'short')}
                  </span>
                  <span className="tnum shrink-0">{formatMoney(t.baseAmount, currency)}</span>
                </button>
              ))}
              {!candidates.length ? <p className="py-2 text-center text-[11px] text-muted">No matching expenses.</p> : null}
            </div>
          </Field>
        ) : null}

        {kind === 'payback' && !pot ? (
          <Field label="Spread over">
            <div className="flex flex-wrap gap-1.5">
              {['3', '6', '12'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMonths(m)
                    setPerTouched(false)
                  }}
                  className={cn('chip', months === m && !perTouched && 'chip-active')}
                >
                  {m} cycles
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        <Field
          label="Set aside per pay cycle"
          hint={
            perMinor > 0
              ? `${formatMoney(perMinor, currency)} is held back from safe-to-spend each cycle${kind === 'save' && targetMinor ? `, ready in about ${Math.ceil(targetMinor / perMinor)} cycle${Math.ceil(targetMinor / perMinor) === 1 ? '' : 's'}` : kind === 'payback' && selectedTotal ? `, paid back in about ${Math.ceil(selectedTotal / perMinor)} cycle${Math.ceil(selectedTotal / perMinor) === 1 ? '' : 's'}` : ''}.`
              : undefined
          }
        >
          <Input
            value={perTouched ? perCycle : suggested ? majorString(suggested, currency) : ''}
            onChange={(e) => {
              setPerTouched(true)
              setPerCycle(e.target.value)
            }}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>

        {pot && fromMajorString(perCycle, currency) !== pot.perCycle && perTouched ? (
          <p className="text-[10px] text-muted">The new amount applies from this cycle; what’s already set aside stays.</p>
        ) : null}

        {error ? <p className="text-xs font-medium text-bad">{error}</p> : null}
      </div>
    </Modal>
  )
}
