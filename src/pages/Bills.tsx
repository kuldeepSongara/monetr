import { useMemo, useState } from 'react'
import {
  BellOff,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Download,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react'
import { useApp } from '../store'
import type { Bill, BillFrequency } from '../types'
import {
  addBill,
  deleteBill,
  deletePayment,
  exportBillsIcs,
  markBillPaid,
  snoozeBill,
  updateBill,
} from '../db/db'
import { addDays, dueLabel, formatDate, todayISO } from '../lib/dates'
import { CURRENCIES, formatMoney, fromMajorString, majorString, toBaseMinor } from '../lib/money'
import { confidenceLabel, frequencyLabel } from '../lib/bills'
import {
  Badge,
  Button,
  Card,
  Confirm,
  EmptyState,
  Field,
  Input,
  Modal,
  ProgressBar,
  SectionTitle,
  Select,
  Textarea,
  Toggle,
  cn,
} from '../components/ui'

type FilterKey = 'all' | 'due' | 'overdue' | 'autopay'

export function Bills() {
  const { bills, payments, schedules, categories, categoryMap, settings, today, refresh, notify, saveSettings } = useApp()
  const currency = settings.currency

  const [filter, setFilter] = useState<FilterKey>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Bill | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [paying, setPaying] = useState<Bill | null>(null)
  const [snoozing, setSnoozing] = useState<Bill | null>(null)
  const [deleting, setDeleting] = useState<Bill | null>(null)
  const [payDate, setPayDate] = useState(todayISO())
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [createTxn, setCreateTxn] = useState(true)
  const [busy, setBusy] = useState(false)

  const list = useMemo(() => {
    const enriched = bills
      .filter((b) => !b.archived)
      .map((b) => ({ bill: b, schedule: schedules.get(b.id)! }))
      .filter((x) => Boolean(x.schedule))

    const rank = { overdue: 0, 'due-soon': 1, upcoming: 2, paid: 3, inactive: 4 } as const
    const filtered = enriched.filter(({ bill, schedule }) => {
      if (filter === 'autopay') return bill.autoPay
      if (filter === 'overdue') return schedule.status === 'overdue'
      if (filter === 'due') return schedule.status === 'overdue' || schedule.status === 'due-soon'
      return true
    })
    return filtered.sort(
      (a, b) =>
        rank[a.schedule.status] - rank[b.schedule.status] ||
        (a.schedule.nextDue ?? '9999').localeCompare(b.schedule.nextDue ?? '9999'),
    )
  }, [bills, schedules, filter])

  const monthlyTotal = useMemo(
    () =>
      bills
        .filter((b) => b.active && !b.archived)
        .reduce((sum, b) => {
          const s = schedules.get(b.id)
          const cadence = s?.cadenceDays ?? 30.44
          return sum + (b.baseAmount * 30.44) / Math.max(1, cadence)
        }, 0),
    [bills, schedules],
  )

  const dueThisWeek = list.filter(
    ({ schedule }) => schedule.nextDue && schedule.daysUntil !== null && schedule.daysUntil <= 7,
  ).length
  const overdue = list.filter(({ schedule }) => schedule.status === 'overdue').length

  function startAdd() {
    setEditing(null)
    setEditorOpen(true)
  }

  function startEdit(bill: Bill) {
    setEditing(bill)
    setEditorOpen(true)
  }

  function startPay(bill: Bill) {
    setPaying(bill)
    setPayDate(todayISO())
    setPayAmount(majorString(bill.amount, bill.currency))
    setPayNote('')
    setCreateTxn(true)
  }

  async function confirmPay() {
    if (!paying) return
    const minor = fromMajorString(payAmount, paying.currency) ?? paying.amount
    if (!minor || minor <= 0) {
      notify('Enter a valid amount', 'error')
      return
    }
    setBusy(true)
    try {
      await markBillPaid(paying, currency, {
        paidDate: payDate,
        amountMinor: minor,
        createTxn,
        note: payNote.trim() || undefined,
      })
      await refresh()
      notify(`${paying.name} marked paid`, 'success')
      setPaying(null)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not record payment', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleNotifications(next: boolean) {
    if (next) {
      if (typeof Notification === 'undefined') {
        notify('This browser cannot show notifications', 'error')
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        notify('Notification permission was declined. In-app alerts still work.', 'error')
        return
      }
    }
    await saveSettings({ notifications: next })
  }

  return (
    <div className="space-y-3.5">
      <Card className="flex flex-col gap-3 border-accent/20 bg-gradient-to-br from-accent/[0.08] to-surface sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
            <Repeat className="h-3.5 w-3.5" /> Recurring bills
          </p>
          <p className="tnum mt-1 text-2xl font-bold tracking-tight text-ink">{formatMoney(Math.round(monthlyTotal), currency)}</p>
          <p className="text-xs text-muted">
            per month · {dueThisWeek} due in 7 days
            {overdue ? <span className="font-semibold text-bad"> · {overdue} overdue</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={startAdd}>
            <Plus className="h-4 w-4" /> Add bill
          </Button>
          <Button variant="ghost" onClick={() => exportBillsIcs()} title="Export reminders to your calendar">
            <Download className="h-4 w-4" /> .ics
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <Toggle
          checked={settings.notifications}
          onChange={toggleNotifications}
          label="Bill notifications"
          hint="Shown when you open the app — no server, so nothing runs in the background. Export .ics for real calendar alarms."
        />
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-surface2/50 px-3 py-2 text-[11px] text-muted">
          <span>Reminders are predicted from actual payment dates.</span>
          <Badge tone="accent">{settings.defaultBillLeadDays}d lead</Badge>
        </div>
      </Card>

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {(
          [
            ['all', 'All bills'],
            ['due', 'Due soon'],
            ['overdue', 'Overdue'],
            ['autopay', 'Autopay'],
          ] as [FilterKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn('chip whitespace-nowrap', filter === key && 'chip-active')}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length ? (
        <div className="space-y-2.5">
          {list.map(({ bill, schedule }) => {
            const cat = categoryMap.get(bill.categoryId)
            const history = payments
              .filter((p) => p.billId === bill.id)
              .sort((a, b) => b.paidDate.localeCompare(a.paidDate))
            const isOpen = expanded === bill.id
            return (
              <Card key={bill.id} className="p-0">
                <div className="flex items-start gap-3 p-3.5">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base"
                    style={{ background: `${cat?.color ?? '#64748B'}1f` }}
                  >
                    {cat?.emoji ?? '🧾'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{bill.name}</p>
                        <p className="mt-0.5 truncate text-[10px] text-muted">
                          {bill.merchant && bill.merchant !== bill.name ? `${bill.merchant} · ` : ''}
                          {frequencyLabel(bill)}
                          {bill.dueDay ? ` · day ${bill.dueDay}` : ''}
                          {bill.autoPay ? ' · autopay' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tnum text-sm font-bold text-ink">
                          {formatMoney(schedule.typicalAmount || bill.baseAmount, currency)}
                        </p>
                        {schedule.status === 'overdue' ? (
                          <p className="text-[10px] font-bold text-bad">{schedule.overdueDays}d overdue</p>
                        ) : schedule.status === 'due-soon' ? (
                          <p className="text-[10px] font-bold text-warn">
                            {schedule.daysUntil === 0 ? 'Due today' : dueLabel(schedule.nextDue!)}
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted">{schedule.nextDue ? dueLabel(schedule.nextDue) : 'No date'}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar
                        value={schedule.confidence * 100}
                        tone={schedule.confidence >= 0.7 ? 'good' : schedule.confidence >= 0.45 ? 'accent' : 'warn'}
                        height={4}
                        className="max-w-[120px]"
                      />
                      <span className="text-[9px] text-muted">
                        {confidenceLabel(schedule.confidence)}
                        {schedule.basis === 'history' ? ' · from history' : schedule.basis === 'fixed-day' ? ' · fixed day' : ''}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="soft" onClick={() => startPay(bill)}>
                        <Check className="h-3 w-3" /> Mark paid
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSnoozing(bill)}>
                        <BellOff className="h-3 w-3" /> Snooze
                      </Button>
                      <Button size="sm" variant="plain" onClick={() => startEdit(bill)} className="px-1.5 text-muted">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="plain" onClick={() => setDeleting(bill)} className="px-1.5 text-muted">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : bill.id)}
                        className="ml-auto flex items-center gap-1 text-[10px] font-medium text-muted"
                      >
                        {history.length} payment{history.length === 1 ? '' : 's'}
                        <ChevronDown className={cn('h-3 w-3 transition', isOpen && 'rotate-180')} />
                      </button>
                    </div>
                  </div>
                </div>

                {isOpen ? (
                  <div className="border-t border-line/60 bg-surface2/30 px-3.5 py-3">
                    <p className="label mb-2">Payment history</p>
                    {history.length ? (
                      <div className="space-y-1.5">
                        {history.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 text-[11px]">
                            <CalendarClock className="h-3 w-3 text-muted" />
                            <span className="text-ink">{formatDate(p.paidDate, 'medium')}</span>
                            <span className="tnum ml-auto font-semibold text-ink">{formatMoney(p.baseAmount, currency)}</span>
                            <button
                              type="button"
                              onClick={async () => {
                                await deletePayment(p.id)
                                await refresh()
                                notify('Payment removed', 'info')
                              }}
                              className="text-muted hover:text-bad"
                              aria-label="Delete payment"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted">No payments logged yet. Mark it paid to start building a pattern.</p>
                    )}
                    {bill.notes ? <p className="mt-2 text-[11px] italic text-muted">“{bill.notes}”</p> : null}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" />}
            title={filter === 'all' ? 'No bills yet' : 'Nothing in this filter'}
            body="Add a recurring bill once — Spendwise learns the rhythm from your payments and predicts the next due date."
            action={
              <Button size="sm" onClick={startAdd}>
                <Plus className="h-3.5 w-3.5" /> Add your first bill
              </Button>
            }
          />
        </Card>
      )}

      <BillEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        bill={editing}
        onSaved={async () => {
          await refresh()
          setEditorOpen(false)
        }}
      />

      <Modal
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        title={`Mark ${paying?.name ?? 'bill'} paid`}
        subtitle="This logs a payment and can add an expense to your history."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button className="flex-[2]" onClick={confirmPay} loading={busy}>
              Save payment
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid on">
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </Field>
            <Field label={`Amount (${paying?.currency ?? currency})`}>
              <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
          <Field label="Note (optional)">
            <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. paid early" />
          </Field>
          <Toggle
            checked={createTxn}
            onChange={setCreateTxn}
            label="Also add to transactions"
            hint="Keeps your spending charts and budgets accurate."
          />
          {paying ? (
            <div className="rounded-xl border border-line/70 bg-surface2/50 px-3 py-2">
              <p className="text-[11px] text-muted">
                Next due is predicted from this payment date and your previous payments ({frequencyLabel(paying)}).
              </p>
              {payAmount ? (
                <p className="tnum mt-1 text-[11px] text-ink">
                  {formatMoney(
                    toBaseMinor(fromMajorString(payAmount, paying.currency) ?? 0, paying.currency, paying.fxRate, currency),
                    currency,
                  )}{' '}
                  in {currency}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(snoozing)}
        onClose={() => setSnoozing(null)}
        title={`Snooze ${snoozing?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-2">
          {[
            { label: '1 day', days: 1 },
            { label: '3 days', days: 3 },
            { label: '1 week', days: 7 },
            { label: '2 weeks', days: 14 },
          ].map((o) => (
            <Button
              key={o.days}
              variant="ghost"
              className="w-full justify-between"
              onClick={async () => {
                if (!snoozing) return
                await snoozeBill(snoozing.id, addDays(today, o.days))
                await refresh()
                notify(`Reminders paused for ${o.label}`, 'success')
                setSnoozing(null)
              }}
            >
              <span>{o.label}</span>
              <span className="text-[10px] text-muted">{formatDate(addDays(today, o.days), 'short')}</span>
            </Button>
          ))}
          {snoozing?.snoozedUntil ? (
            <Button
              variant="soft"
              className="w-full"
              onClick={async () => {
                await snoozeBill(snoozing.id, addDays(today, -1))
                await refresh()
                notify('Reminders resumed', 'info')
                setSnoozing(null)
              }}
            >
              Resume reminders now
            </Button>
          ) : null}
        </div>
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? 'bill'}?`}
        body="This removes the bill and its payment history. Transactions already logged are kept."
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteBill(deleting.id)
          await refresh()
          notify('Bill deleted', 'info')
          setDeleting(null)
        }}
      />
    </div>
  )
}

/* ------------------------------- bill editor ------------------------------- */

function BillEditor({
  open,
  onClose,
  bill,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  bill: Bill | null
  onSaved: () => Promise<void>
}) {
  const { categories, settings, notify } = useApp()
  const [name, setName] = useState('')
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(settings.currency)
  const [categoryId, setCategoryId] = useState('cat_utilities')
  const [frequency, setFrequency] = useState<BillFrequency>('monthly')
  const [intervalDays, setIntervalDays] = useState('30')
  const [dueDay, setDueDay] = useState('')
  const [anchorDate, setAnchorDate] = useState(todayISO())
  const [leadDays, setLeadDays] = useState(String(settings.defaultBillLeadDays))
  const [autoPay, setAutoPay] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Reset form whenever the modal opens for a different bill.
  const key = open ? (bill?.id ?? 'new') : null
  if (key && key !== loadedFor) {
    setLoadedFor(key)
    if (bill) {
      setName(bill.name)
      setMerchant(bill.merchant ?? '')
      setAmount(majorString(bill.amount, bill.currency))
      setCurrency(bill.currency)
      setCategoryId(bill.categoryId)
      setFrequency(bill.frequency)
      setIntervalDays(String(bill.intervalDays ?? 30))
      setDueDay(bill.dueDay ? String(bill.dueDay) : '')
      setAnchorDate(bill.anchorDate)
      setLeadDays(String(bill.leadDays))
      setAutoPay(bill.autoPay)
      setNotes(bill.notes ?? '')
    } else {
      setName('')
      setMerchant('')
      setAmount('')
      setCurrency(settings.currency)
      setCategoryId('cat_utilities')
      setFrequency('monthly')
      setIntervalDays('30')
      setDueDay('')
      setAnchorDate(todayISO())
      setLeadDays(String(settings.defaultBillLeadDays))
      setAutoPay(false)
      setNotes('')
    }
    setError('')
  }

  async function save() {
    const minor = fromMajorString(amount, currency) ?? 0
    if (!name.trim()) {
      setError('Give the bill a name.')
      return
    }
    if (!minor || minor <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const input = {
        name,
        merchant,
        categoryId,
        amount: minor,
        currency,
        fxRate: 1,
        frequency,
        intervalDays: frequency === 'custom' ? Math.max(1, Number(intervalDays) || 30) : undefined,
        dueDay:
          frequency === 'monthly' || frequency === 'quarterly' || frequency === 'yearly'
            ? dueDay
              ? Math.min(28, Math.max(1, Number(dueDay)))
              : undefined
            : undefined,
        anchorDate,
        autoPay,
        leadDays: Math.max(0, Math.min(30, Number(leadDays) || 0)),
        notes,
      }
      if (bill) await updateBill(bill.id, input, settings.currency)
      else await addBill(input, settings.currency)
      notify(bill ? 'Bill updated' : 'Bill added', 'success')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that bill')
    } finally {
      setSaving(false)
    }
  }

  const expenseCategories = categories.filter((c) => c.kind === 'expense')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bill ? 'Edit bill' : 'Add a bill'}
      subtitle="Predictions get sharper with each payment you log."
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-[2]" onClick={save} loading={saving}>
            {bill ? 'Save changes' : 'Add bill'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bill name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Electricity" />
          </Field>
          <Field label="Paid to (optional)">
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. City Power" />
          </Field>
        </div>

        <div className="flex gap-2">
          <Field label="Amount" className="flex-1">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Currency" className="w-28">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Category">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeats">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as BillFrequency)}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          {frequency === 'custom' ? (
            <Field label="Every N days">
              <Input value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} inputMode="numeric" />
            </Field>
          ) : (
            <Field label="Preferred due day (optional)" hint="1–28, for fixed-date bills.">
              <Input value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="e.g. 12" />
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Last payment / start date">
            <Input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
          </Field>
          <Field label="Remind me N days before">
            <Input value={leadDays} onChange={(e) => setLeadDays(e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        <Toggle checked={autoPay} onChange={setAutoPay} label="On autopay" hint="Shows the autopay tag and uses a shorter default lead time." />

        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Account number, who to call…" />
        </Field>

        <div className="rounded-xl border border-line/70 bg-surface2/50 p-3 text-[11px] leading-relaxed text-muted">
          <p className="font-semibold text-ink">How reminders work</p>
          <p className="mt-1">
            Due dates are predicted from the median gap between your last payments, so a bill that drifts (weekends, holidays)
            still lands close. Fixed-day bills use the day you set.
          </p>
        </div>

        {error ? <p className="text-xs font-medium text-bad">{error}</p> : null}
      </div>
    </Modal>
  )
}
