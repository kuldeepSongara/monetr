import { useState } from 'react'
import {
  ArrowRightLeft,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle,
  Cloud,
  Database,
  FileUp,
  Fingerprint,
  Flag,
  Globe,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  KeyRound,
  Lock,
  PiggyBank,
  QrCode,
  ReceiptText,
  Repeat,
  ScanLine,
  Settings as SettingsIcon,
  Share2,
  Smartphone,
  Sparkles,
  Target,
  Undo2,
  Users,
  Wallet,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { Badge, Card, cn } from '../components/ui'

interface FeatureItem {
  icon: LucideIcon
  title: string
  description: string
  details?: string[]
  /** Needs an AI profile / https / the sync server. */
  needs?: string
}

interface FeatureSection {
  id: string
  icon: LucideIcon
  title: string
  items: FeatureItem[]
}

/* Keep this list honest: only describe what the app actually does. */
const SECTIONS: FeatureSection[] = [
  {
    id: 'overview',
    icon: LayoutDashboard,
    title: 'Home',
    items: [
      { icon: Wallet, title: 'Safe to spend', description: 'A daily number for the rest of your pay cycle, after budgets and the bills still due.' },
      { icon: Bell, title: 'Alerts', description: 'Bills due or overdue, autopay amounts to confirm, spending spikes, duplicate-looking and unusually large charges.' },
      { icon: LineChart, title: 'Charts', description: '30-day trend vs 7-day average, category breakdown, budgets, upcoming bills and recent activity.' },
      { icon: SettingsIcon, title: 'Your layout', description: 'Show, hide and reorder dashboard widgets in Settings → Appearance.' },
    ],
  },
  {
    id: 'spend',
    icon: ReceiptText,
    title: 'Spending',
    items: [
      { icon: ReceiptText, title: 'Expense, income or transfer', description: 'Transfers (card payments, moves between your own accounts) are listed but never counted as spending.' },
      { icon: Globe, title: 'Any currency', description: 'Stores the original amount and the rate. The rate is prefilled from the last one you used for that currency and required for foreign entries.' },
      { icon: Wand2, title: 'Learned rules', description: 'Choose a category for a merchant once and new entries from that merchant get it automatically. Manage rules in Settings.' },
      { icon: Undo2, title: 'Refunds & returns', description: 'Open any expense → Refund / return. Full or partial; the money comes off that category’s spending instead of counting as income.' },
      { icon: Sparkles, title: 'Quick add', description: '“coffee 4.50 yesterday” becomes a filled-in entry. Uses AI when available and an offline parser when it isn’t, so it never blocks.' },
      { icon: ScanLine, title: 'Receipt scan', description: 'Photo of a receipt → merchant, total, date and items.', needs: 'Vision-capable AI profile' },
      { icon: Bot, title: 'AI categorise', description: 'Suggests categories for entries you have not categorised yourself; you approve each change.', needs: 'AI profile' },
    ],
  },
  {
    id: 'bills',
    icon: CalendarClock,
    title: 'Bills',
    items: [
      { icon: CalendarClock, title: 'Due-date prediction', description: 'Fixed-day bills follow their calendar day; others use the gap between your actual payments. Early or late payments never shift or duplicate a cycle, and missed payments are counted, not hidden.' },
      { icon: Bell, title: 'Bills that change', description: 'Electricity, water and the like: turn on “Amount changes each time” and the bill is just a reminder. Mark paid asks what you paid and the date, and adds it to your spending. The usual amount is learned from recent payments.' },
      { icon: Repeat, title: 'Autopay', description: 'On the due date the payment and expense are recorded for you, then flagged so you can confirm or correct the amount that was actually taken.' },
      { icon: Users, title: 'Split with a roommate', description: 'Set a share (percent or fixed) on a bill. Each payment shows what to collect, a ready-to-send reminder, and “Got it” records their share as a refund so your spend is just your part.' },
      { icon: CheckCircle, title: 'Mark paid & snooze', description: 'Log a payment (optionally as an expense) or snooze a reminder.' },
      { icon: Bell, title: 'Reminders', description: 'Browser notifications while Monetr is open, and an .ics export for calendar alarms that fire when it is closed.' },
    ],
  },
  {
    id: 'budgets',
    icon: Target,
    title: 'Budgets',
    items: [
      { icon: Target, title: 'Per category or overall', description: 'Per pay cycle or per week, with optional one-cycle rollover.' },
      { icon: PiggyBank, title: 'Savings pots', description: 'For one-time buys like a laptop or phone. Save up first, or — if you already bought it — pay it back over a few cycles. The purchase is paid from the pot, not one month’s budget; the pot’s per-cycle amount is held back from safe-to-spend. History and charts still show the real spend.' },
      { icon: Users, title: 'Budget groups', description: 'Put several categories under one shared limit — e.g. Shopping + Dining as “Fun money”. The card shows how much each category used.' },
      { icon: Wallet, title: 'Allowance fallback', description: 'No budgets yet? A monthly allowance drives safe-to-spend instead.' },
    ],
  },
  {
    id: 'investments',
    icon: LineChart,
    title: 'Investments',
    items: [
      { icon: LineChart, title: 'Holdings from transactions', description: 'Buys, sells, dividends, interest and fees → quantity, average cost, realised and unrealised profit.', details: ['Enter a current price (or value for FDs/cash) to see P/L', 'Each holding keeps its own currency'] },
      { icon: Globe, title: 'Currency profiles', description: 'One per country or account currency, each with its rate to your base currency. Set them up in Settings.' },
      { icon: ArrowRightLeft, title: 'Transfers between profiles', description: 'Record what the bank actually debited and credited; Monetr shows the effective rate and keeps both sides linked.' },
    ],
  },
  {
    id: 'flagit',
    icon: Flag,
    title: 'flagIt',
    items: [
      { icon: Flag, title: 'Spending review', description: 'An AI read of this cycle: rises, duplicates, subscriptions, likely FX fees on foreign charges, budget pressure.', needs: 'AI profile' },
      { icon: Lightbulb, title: 'Before you buy', description: 'Checks a planned purchase against safe-to-spend, budgets, bills and similar past purchases. It cannot browse or see live prices — it tells you what to check.', needs: 'AI profile' },
      { icon: Sparkles, title: 'Habits', description: 'Predicts your next likely discretionary spends and cheaper swaps.', needs: 'AI profile' },
      { icon: FileUp, title: 'Statement import', description: 'CSV exports are read on your device with no AI. Screenshots, PDFs and text go through AI. Every line lands in an editable review list; duplicates and low-confidence lines are unticked.', needs: 'AI for PDFs and screenshots' },
    ],
  },
  {
    id: 'sync',
    icon: Cloud,
    title: 'Sync',
    items: [
      { icon: QrCode, title: 'Link with a QR', description: 'Show the QR on one device, scan it in Monetr (or with the phone camera app) on the other.' },
      { icon: Lock, title: 'End-to-end encrypted', description: 'Data is encrypted on your device with a key that is only in the QR. The server stores ciphertext and cannot read it.' },
      { icon: Repeat, title: 'Everything, both ways', description: 'Transactions, bills, budgets, investments, appearance, AI profiles and your PIN. Change anything on either device and it shows up on the other.' },
      { icon: KeyRound, title: 'Recovery kit', description: 'Your sync key locked with a password you choose — email it to yourself or keep it in cloud storage. If every device is wiped, scan it, enter the password, and everything comes back.' },
      { icon: Fingerprint, title: 'Per-device fingerprint', description: 'Fingerprint / Touch ID is the one thing set up on each device, because it uses that device’s sensor.' },
    ],
  },
  {
    id: 'security',
    icon: Lock,
    title: 'Lock',
    items: [
      { icon: Lock, title: 'Auto-lock', description: 'Locks when you switch tabs on your laptop or switch apps on your phone — immediately or after 30 s, 1 min or 5 min.' },
      { icon: Fingerprint, title: 'Fingerprint / Touch ID', description: 'Unlock with the sensor on your MacBook or Android phone; the PIN always works as a fallback.', needs: 'https or localhost' },
      { icon: CheckCircle, title: 'Brute-force protection', description: 'After 5 wrong PINs the lock screen makes you wait, doubling each time.' },
    ],
  },
  {
    id: 'ai',
    icon: Bot,
    title: 'AI',
    items: [
      { icon: Bot, title: 'Any provider', description: 'Gemini, OpenAI, Claude, OpenRouter, Groq, Cerebras, Mistral, DeepSeek, xAI, Together, Ollama or any OpenAI-compatible endpoint.' },
      { icon: Repeat, title: 'Never stuck on “overloaded”', description: 'Busy or rate-limited calls are retried with backoff, then your backup models on the same key, then your next profile.' },
      { icon: Sparkles, title: 'Free backups', description: 'Settings suggests free providers (Groq, OpenRouter :free models, Cerebras) to add next to Gemini.' },
    ],
  },
  {
    id: 'data',
    icon: Database,
    title: 'Data',
    items: [
      { icon: Database, title: 'Backup & restore', description: 'JSON backup of everything (including investments and flags); merge or replace.' },
      { icon: Share2, title: 'Share charts', description: 'Send family or friends a picture of your spending — total, category split and a daily chart. Pick the period (this month by default), show amounts or percentages only, and leave out categories. Never includes shops, notes or transactions.' },
      { icon: LineChart, title: 'Interactive report', description: 'One .html file with live charts — filter categories, hover spending spikes, click a day, read monthly cash flow. Opens offline on any laptop or tablet.' },
      { icon: ReceiptText, title: 'CSV & calendar export', description: 'Transactions to CSV, bills to .ics.' },
      { icon: Smartphone, title: 'Installable app', description: 'Add to your home screen on Android or install on your Mac; works offline.' },
    ],
  },
]

export default function Features() {
  const [active, setActive] = useState(SECTIONS[0].id)
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]

  return (
    <div className="space-y-3.5">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => setActive(s.id)} className={cn('chip flex items-center gap-1.5 whitespace-nowrap', active === s.id && 'chip-active')}>
            <s.icon className="h-3.5 w-3.5" /> {s.title}
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {section.items.map((item) => (
          <Card key={item.title} className="p-3">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2">
                <item.icon className="h-4 w-4 text-ink" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.description}</p>
                {item.details ? (
                  <ul className="mt-1 space-y-0.5">
                    {item.details.map((d) => (
                      <li key={d} className="text-[10px] text-muted">
                        • {d}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.needs ? <Badge className="mt-1.5">Needs: {item.needs}</Badge> : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-center text-[10px] text-muted">Everything works offline on this device. AI and sync are optional.</p>
    </div>
  )
}
