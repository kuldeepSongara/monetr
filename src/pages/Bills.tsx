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
  setLastPaidDate,
  verifyPayment,
  collectSplit,
  waiveSplit,
} from '../db/db'
import type { BillPayment } from '../types'
import { addDays, dueLabel, formatDate, todayISO } from '../lib/dates'
import { CURRENCIES, formatMoney, fromMajorString, majorString, toBaseMinor } from '../lib/money'
import { confidenceLabel, expectedAmount, frequencyLabel } from '../lib/bills'
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
  const [removingPayment, setRemovingPayment] = useState<BillPayment | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [paying, setPaying] = useState<Bill | null>(null)
  const [snoozing, setSnoozing] = useState<Bill | null>(null)
  const [deleting, setDeleting] = useState<Bill | null>(null)
  const [payDate, setPayDate] = useState(todayISO())
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [createTxn, setCreateTxn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState<BillPayment | null>(null)
  const [fixAmount, setFixAmount] = useState('')

  const owed = payments.filter((p) => p.splitAmount && !p.splitCollectedAt)
  const owedByPerson = owed.reduce<Record<string, number>>((acc, p) => {
    const k = p.splitName ?? 'Split'
    acc[k] = (acc[k] ?? 0) + toBaseMinor(p.splitAmount ?? 0, p.currency, p.fxRate, currency)
    return acc
  }, {})

  async function remind(p: BillPayment, billName: string) {
    const text = `Hi ${p.splitName ?? ''}, your share of ${billName} for ${formatDate(p.paidDate, 'short')} is ${formatMoney(p.splitAmount ?? 0, p.currency)}. Thanks!`
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        notify('Reminder message copied', 'success')
      }
    } catch {
      /* share sheet dismissed */
    }
  }

  async function collect(p: BillPayment) {
    await collectSplit(p.id, currency)
    await refresh()
    notify(`Got ${formatMoney(p.splitAmount ?? 0, p.currency)} from ${p.splitName ?? 'them'} — your spend on this bill is now just your share`, 'success')
  }

  async function confirmAuto(p: BillPayment, amountMinor?: number) {
    await verifyPayment(p.id, currency, amountMinor)
    await refresh()
    notify(amountMinor !== undefined && amountMinor !== p.amount ? 'Amount corrected' : 'Autopay confirmed', 'success')
  }

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
          return sum + ((s?.typicalAmount || b.baseAmount) * 30.44) / Math.max(1, cadence)
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
    // Variable bills: ask for the real amount instead of pre-filling a guess.
    setPayAmount(bill.variable || !bill.amount ? '' : majorString(bill.amount, bill.currency))
    setPayNote('')
    setCreateTxn(true)
  }

  async function confirmPay() {
    if (!paying) return
    const minor = fromMajorString(payAmount, paying.currency) ?? 0
    if (!minor || minor <= 0) {
      notify('Enter the amount you paid', 'error')
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
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <Repeat className="h-3.5 w-3.5" /> Recurring bills
          </p>
          <p className="tnum mt-1 text-2xl font-bold tracking-tight text-ink">{formatMoney(Math.round(monthlyTotal), currency)}</p>
          <p className="text-xs text-muted">
            per month · {dueThisWeek} due in 7 days
            {overdue ? <span className="font-semibold text-bad"> · {overdue} overdue</span> : null}
          </p>
          {Object.keys(owedByPerson).length ? (
            <p className="mt-1 text-xs font-semibold text-good">
              Owed to you:{' '}
              {Object.entries(owedByPerson)
                .map(([name, amt]) => `${name} ${formatMoney(amt, currency)}`)
                .join(' · ')}
            </p>
          ) : null}
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
          hint="Shown while Monetr is open. Export .ics for alarms that fire even when it's closed. Autopay bills are recorded automatically on their due date for you to confirm."
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
                          {bill.split ? ` · split with ${bill.split.name}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tnum text-sm font-bold text-ink">
                          {(() => {
                            const e = expectedAmount(bill, schedule)
                            return e ? `${e.approx ? '~' : ''}${formatMoney(e.amount, currency)}` : 'Varies'
                          })()}
                        </p>
                        {schedule.status === 'overdue' ? (
                          <p className="text-[10px] font-bold text-bad">
                            {schedule.missed > 1 ? `${schedule.missed} payments missed` : `${schedule.overdueDays}d overdue`}
                          </p>
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
                      <Button size="sm" variant="plain" onClick={() => startEdit(bill)} className="px-1.5 text-muted" aria-label={`Edit ${bill.name}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="plain" onClick={() => setDeleting(bill)} className="px-1.5 text-muted" aria-label={`Delete ${bill.name}`}>
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

                    {history
                      .filter((p) => p.splitAmount && !p.splitCollectedAt && (!p.autoRecorded || p.verified))
                      .map((p) => (
                        <div key={`split-${p.id}`} className="mt-2.5 rounded-xl border border-good/30 bg-good/[0.06] px-3 py-2">
                          <p className="text-[11px] text-ink">
                            Collect <span className="font-semibold">{formatMoney(p.splitAmount ?? 0, p.currency)}</span> from{' '}
                            {p.splitName} for {formatDate(p.paidDate, 'short')}.
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Button size="sm" variant="soft" onClick={() => collect(p)}>
                              <Check className="h-3 w-3" /> Got it
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remind(p, bill.name)}>
                              Send reminder
                            </Button>
                            <Button
                              size="sm"
                              variant="plain"
                              className="px-1.5 text-muted"
                              onClick={async () => {
                                await waiveSplit(p.id)
                                await refresh()
                              }}
                            >
                              Not needed
                            </Button>
                          </div>
                        </div>
                      ))}

                    {history
                      .filter((p) => p.autoRecorded && !p.verified)
                      .map((p) => (
                        <div key={p.id} className="mt-2.5 rounded-xl border border-accent/30 bg-accent/[0.06] px-3 py-2">
                          <p className="text-[11px] text-ink">
                            Autopay recorded {formatMoney(p.amount, p.currency)} on {formatDate(p.paidDate, 'short')}. Was that the amount taken?
                            {p.splitAmount ? ` Then collect ${formatMoney(p.splitAmount, p.currency)} from ${p.splitName}.` : ''}
                          </p>
                          <div className="mt-1.5 flex gap-1.5">
                            <Button size="sm" variant="soft" onClick={() => confirmAuto(p)}>
                              <Check className="h-3 w-3" /> Looks right
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setFixing(p)
                                setFixAmount(majorString(p.amount, p.currency))
                              }}
                            >
                              Different amount
                            </Button>
                          </div>
                        </div>
                      ))}
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
                            {p.autoRecorded ? <Badge tone={p.verified ? 'good' : 'accent'}>{p.verified ? 'autopay ✓' : 'autopay'}</Badge> : null}
                            <span className="tnum ml-auto font-semibold text-ink">{p.amountUnknown ? <span className="font-normal text-muted">amount not noted</span> : formatMoney(p.baseAmount, currency)}</span>
                            <button
                              type="button"
                              onClick={() => setRemovingPayment(p)}
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
            body="Add a recurring bill once — Monetr learns the rhythm from your payments and predicts the next due date."
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
              <Input
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                inputMode="decimal"
                autoFocus={Boolean(paying?.variable)}
                placeholder={paying && schedules.get(paying.id)?.typicalAmount ? `last ~${majorString(schedules.get(paying.id)!.typicalAmount, currency)}` : '0.00'}
              />
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
        open={Boolean(fixing)}
        onClose={() => setFixing(null)}
        title="What did autopay take?"
        subtitle="Updates the payment and the matching expense."
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setFixing(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                if (!fixing) return
                const minor = fromMajorString(fixAmount, fixing.currency)
                if (!minor || minor <= 0) return notify('Enter the amount that was deducted', 'error')
                await confirmAuto(fixing, minor)
                setFixing(null)
              }}
            >
              Save
            </Button>
          </div>
        }
      >
        <Field label={`Amount (${fixing?.currency ?? currency})`}>
          <Input value={fixAmount} onChange={(e) => setFixAmount(e.target.value)} inputMode="decimal" autoFocus />
        </Field>
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
        open={Boolean(removingPayment)}
        title="Remove this payment?"
        body={
          removingPayment?.txnId
            ? 'The payment and the expense logged with it are removed. The next due date is worked out again from the payments left.'
            : 'The next due date is worked out again from the payments left.'
        }
        confirmLabel="Remove"
        onClose={() => setRemovingPayment(null)}
        onConfirm={async () => {
          if (!removingPayment) return
          await deletePayment(removingPayment.id)
          await refresh()
          notify('Payment removed', 'info')
          setRemovingPayment(null)
        }}
      />

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
  const { categories, settings, notify, payments } = useApp()
  const latestPayment = bill
    ? payments.filter((p) => p.billId === bill.id).sort((a, b) => a.paidDate.localeCompare(b.paidDate)).at(-1)
    : undefined
  /** 'paid' = the date is when you last paid it; 'due' = not paid yet, the date is when it's first due. */
  const [dateMode, setDateMode] = useState<'paid' | 'due'>('paid')
  const [variable, setVariable] = useState(false)
  const [lastAmount, setLastAmount] = useState('')
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
  const [splitOn, setSplitOn] = useState(false)
  const [splitName, setSplitName] = useState('')
  const [splitMode, setSplitMode] = useState<'percent' | 'amount'>('percent')
  const [splitValue, setSplitValue] = useState('50')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  // Forget what was loaded once the editor closes, so reopening ("add" again, or the same item) always starts fresh.
  if (!open && loadedFor !== null) setLoadedFor(null)

  // Reset form whenever the modal opens for a different bill.
  const key = open ? (bill?.id ?? 'new') : null
  if (key && key !== loadedFor) {
    setLoadedFor(key)
    if (bill) {
      setName(bill.name)
      setMerchant(bill.merchant ?? '')
      setVariable(Boolean(bill.variable))
      setLastAmount('')
      setAmount(bill.amount ? majorString(bill.amount, bill.currency) : '')
      setCurrency(bill.currency)
      setCategoryId(bill.categoryId)
      setFrequency(bill.frequency)
      setIntervalDays(String(bill.intervalDays ?? 30))
      setDueDay(bill.dueDay ? String(bill.dueDay) : '')
      setDateMode(latestPayment ? 'paid' : 'due')
      setAnchorDate(latestPayment?.paidDate ?? bill.anchorDate)
      setLeadDays(String(bill.leadDays))
      setAutoPay(bill.autoPay)
      setNotes(bill.notes ?? '')
      setSplitOn(Boolean(bill.split))
      setSplitName(bill.split?.name ?? '')
      setSplitMode(bill.split?.mode ?? 'percent')
      setSplitValue(bill.split ? (bill.split.mode === 'percent' ? String(bill.split.value) : majorString(bill.split.value, bill.currency)) : '50')
    } else {
      setName('')
      setMerchant('')
      setVariable(false)
      setLastAmount('')
      setAmount('')
      setCurrency(settings.currency)
      setCategoryId('cat_utilities')
      setFrequency('monthly')
      setIntervalDays('30')
      setDueDay('')
      setDateMode('paid')
      setAnchorDate('')
      setLeadDays(String(settings.defaultBillLeadDays))
      setAutoPay(false)
      setNotes('')
      setSplitOn(false)
      setSplitName('')
      setSplitMode('percent')
      setSplitValue('50')
    }
    setError('')
  }

  async function save() {
    const minor = amount.trim() ? fromMajorString(amount, currency) ?? 0 : 0
    if (!name.trim()) {
      setError('Give the bill a name.')
      return
    }
    if (!variable && (!minor || minor <= 0)) {
      setError('Enter the amount — or turn on “Amount changes each time”.')
      return
    }
    if (!anchorDate) {
      setError(dateMode === 'paid' ? 'When did you last pay it?' : 'When is the first payment due?')
      return
    }
    if (dateMode === 'paid' && anchorDate > todayISO()) {
      setError('The last payment date can’t be in the future — switch to “Not paid yet”.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const input = {
        name,
        merchant,
        categoryId,
        variable,
        amount: Math.max(0, minor),
        currency,
        fxRate: 1,
        frequency,
        intervalDays: frequency === 'custom' ? Math.max(1, Number(intervalDays) || 30) : undefined,
        dueDay:
          frequency === 'monthly' || frequency === 'quarterly' || frequency === 'yearly'
            ? dueDay
              ? Math.min(31, Math.max(1, Number(dueDay)))
              : undefined
            : undefined,
        anchorDate,
        autoPay,
        leadDays: Math.max(0, Math.min(30, Number(leadDays) || 0)),
        notes,
        split:
          splitOn && splitName.trim() && Number(splitValue) > 0
            ? {
                name: splitName.trim(),
                mode: splitMode,
                value: splitMode === 'percent' ? Math.min(100, Number(splitValue)) : (fromMajorString(splitValue, currency) ?? 0),
              }
            : null,
      }
      if (bill) {
        await updateBill(bill.id, input, settings.currency)
        // Editing the last payment moves that payment, so the next due date follows it.
        if (dateMode === 'paid') await setLastPaidDate(bill.id, anchorDate)
      } else {
        await addBill(input, settings.currency, {
          seedPayment: dateMode === 'paid',
          lastAmount: variable && lastAmount.trim() ? fromMajorString(lastAmount, currency) ?? undefined : undefined,
        })
      }
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

        <Toggle
          checked={variable}
          onChange={setVariable}
          label="Amount changes each time"
          hint="For electricity, water, phone usage… Monetr just reminds you, and asks what you paid when you mark it paid."
        />

        <div className="flex gap-2">
          <Field label={variable ? 'Usual amount (optional)' : 'Amount'} className="flex-1" hint={variable ? 'A rough guess helps safe-to-spend until a few payments are logged.' : undefined}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={variable ? 'e.g. 90' : '0.00'} />
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
          <Field
            label={dateMode === 'paid' ? 'Last paid on' : 'First due on'}
            hint={
              <span className="flex flex-wrap gap-x-2">
                {!latestPayment ? (
                  <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => setDateMode(dateMode === 'paid' ? 'due' : 'paid')}>
                    {dateMode === 'paid' ? 'Not paid yet?' : 'Already paid it?'}
                  </button>
                ) : (
                  <span>Moves your last recorded payment</span>
                )}
              </span>
            }
          >
            <Input type="date" value={anchorDate} max={dateMode === 'paid' ? todayISO() : undefined} onChange={(e) => setAnchorDate(e.target.value)} />
          </Field>
          {!bill && variable && dateMode === 'paid' ? (
            <Field label="Paid last time (optional)">
              <Input value={lastAmount} onChange={(e) => setLastAmount(e.target.value)} inputMode="decimal" placeholder="if you know it" />
            </Field>
          ) : null}
          <Field label="Remind me N days before">
            <Input value={leadDays} onChange={(e) => setLeadDays(e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        <Toggle checked={autoPay} onChange={setAutoPay} label="On autopay" hint="Shows the autopay tag and uses a shorter default lead time." />

        <div className="rounded-xl border border-line/70 p-3">
          <Toggle checked={splitOn} onChange={setSplitOn} label="Split with someone" hint="e.g. a roommate pays you back part of this bill each time it's paid." />
          {splitOn ? (
            <div className="mt-3 grid grid-cols-[1fr_auto_90px] items-end gap-2">
              <Field label="Who">
                <Input value={splitName} onChange={(e) => setSplitName(e.target.value)} placeholder="e.g. Riya" />
              </Field>
              <Select value={splitMode} onChange={(e) => setSplitMode(e.target.value as 'percent' | 'amount')} className="h-[42px]">
                <option value="percent">%</option>
                <option value="amount">{currency}</option>
              </Select>
              <Input value={splitValue} onChange={(e) => setSplitValue(e.target.value)} inputMode="decimal" />
            </div>
          ) : null}
        </div>

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
