import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle,
  Cloud,
  Coins,
  Copy,
  Database,
  FileUp,
  Fingerprint,
  GitCompareArrows,
  Flag,
  Globe,
  History,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  KeyRound,
  Lock,
  Palette,
  PiggyBank,
  QrCode,
  ReceiptText,
  Repeat,
  ScanLine,
  Settings as SettingsIcon,
  Share2,
  Smartphone,
  Sparkles,
  Sunrise,
  Target,
  TrendingDown,
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
      { icon: Wallet, title: 'Safe to spend today', description: 'What you can spend today and still finish the pay cycle on budget — after bills still due, savings pots and any catch-up. Under it, the whole cycle drawn day by day, with bills, rent and subscriptions in amber so everyday spending stands apart. Hover a day (or tap it on a phone) for the date, the total and what it went on. One line points out what changed against last month or which everyday day ran heaviest.' },
      { icon: History, title: 'Look back at earlier months', description: 'Step back with ‹ › to see how a finished month went — total, budget, biggest day, charts and what you spent on. “Add expense to October” dates the entry inside that month, for when you catch up on the 1st.' },
      { icon: BarChart3, title: 'Charts your way', description: 'Where it went: ranked bars, a share strip or a donut. Spending trend: a line with the 7-day average, daily bars, or a running total. Pick with the small switch in each card’s corner; it follows you to your other devices.' },
      { icon: AlertTriangle, title: 'Alerts', description: 'Budgets running fast or already over, bills due or overdue, autopay amounts to confirm, money to collect, possible double charges and unusual spending.' },
      { icon: SettingsIcon, title: 'Your layout', description: 'Show, hide and reorder the Home cards in Settings → Appearance.' },
    ],
  },
  {
    id: 'reminders',
    icon: Bell,
    title: 'Reminders',
    items: [
      { icon: Sunrise, title: 'Morning check', description: 'Around 10–11 am, even with Monetr closed, your device looks at your numbers and tells you what matters: “Slow down on Shopping — 52% used, a quarter of the cycle gone, about $12 a day keeps you on track”, a budget already over, a bill due, or simply what you can spend today. The server only sends a wake-up; your numbers never leave the device.', needs: 'Server push keys set up' },
      { icon: Bell, title: 'Through the day', description: 'Bills the morning before and on the day, a heads-up when a budget is heading over, a Friday amount for the weekend, and an evening summary (or a nudge if nothing was logged).' },
      { icon: CheckCircle, title: 'Never nagging', description: 'At most 4 notifications a day per device, most important first, and each one only once. Turn reminders on separately on each device — Home asks until you do.' },
      { icon: CalendarClock, title: 'Calendar export', description: 'Bills as an .ics file for calendar alarms that always fire.' },
    ],
  },
  {
    id: 'spend',
    icon: ReceiptText,
    title: 'Spending',
    items: [
      { icon: Sparkles, title: 'Quick add', description: '“coffee 4.50 yesterday” becomes a filled-in entry. Uses AI when available and an offline parser when it isn’t, so it never blocks. Long-press the app icon for Quick add, Add expense, Scan receipt or Bills.' },
      { icon: ScanLine, title: 'Receipts and screenshots', description: 'Photo of a receipt → merchant, total, date. A screenshot of a statement or card app → every spending on it, for review.', needs: 'AI profile' },
      { icon: ReceiptText, title: 'Expense, income or transfer', description: 'Transfers (card payments, moves between your own accounts) are listed but never counted as spending.' },
      { icon: Globe, title: 'Any currency', description: 'Stores the original amount and the rate. The rate is prefilled from the last one you used for that currency and required for foreign entries.' },
      { icon: Undo2, title: 'Refunds & returns', description: 'Open any expense → Refund / return. Full or partial; the money comes off that category’s spending instead of counting as income.' },
      { icon: Copy, title: 'Double charges', description: 'Two similar charges close together are flagged for you to check. You delete one (with a confirmation) or mark both as real — nothing is ever removed on its own.' },
      { icon: Wand2, title: 'Learned rules', description: 'Choose a category for a merchant once and new entries from that merchant get it automatically. Manage rules in Settings.' },
      { icon: Bot, title: 'AI categorise', description: 'Suggests categories for entries you have not categorised yourself; you approve each change.', needs: 'AI profile' },
    ],
  },
  {
    id: 'bills',
    icon: CalendarClock,
    title: 'Bills',
    items: [
      { icon: CalendarClock, title: 'Due-date prediction', description: 'From your last payment date (or the first due date for a new bill). Fixed-day bills follow their calendar day; early or late payments never shift a cycle, and missed payments are counted, not hidden.' },
      { icon: Bell, title: 'Bills that change', description: 'Electricity, water and the like: turn on “Amount changes each time” and the bill is just a reminder. Mark paid asks what you paid and when, and adds it to your spending. The usual amount is learned from recent payments.' },
      { icon: Repeat, title: 'Autopay', description: 'On the due date the payment and expense are recorded for you, then flagged so you can confirm or correct the amount actually taken.' },
      { icon: Users, title: 'Split with a roommate', description: 'Set a share (percent or fixed) on a bill. Each payment shows what to collect, a ready-to-send reminder, and “Got it” records their share as a refund so your spend is just your part.' },
      { icon: CheckCircle, title: 'Edits that stick', description: 'Change a bill’s last payment date, or the date or amount of the expense logged with it, and the next due date follows. Removing a payment always asks first.' },
    ],
  },
  {
    id: 'budgets',
    icon: Target,
    title: 'Budgets',
    items: [
      { icon: Target, title: 'Per category, group or overall', description: 'Per pay cycle or per week, with optional rollover of unspent money. Groups put several categories under one limit — e.g. Shopping + Dining as “Fun money” — and show what each used.' },
      { icon: PiggyBank, title: 'Savings pots', description: 'For one-time buys like a laptop or phone. Save up first, or — if you already bought it — pay it back over a few cycles. The pot’s amount comes out of the budget you choose each cycle (shown on the budget card), so the purchase never wrecks one month. History and charts still show the real spend.' },
      { icon: TrendingDown, title: 'Catching up after going over', description: 'When a budget ends a cycle over, Monetr asks: take it from the next cycle, spread it over 3 (or 6) cycles, or let it go. Never more than half a budget comes out of one cycle. Set a default per budget if you’d rather not be asked.' },
      { icon: Wallet, title: 'Allowance fallback', description: 'No budgets yet? A monthly allowance drives safe-to-spend instead.' },
    ],
  },
  {
    id: 'insights',
    icon: LineChart,
    title: 'Insights',
    items: [
      { icon: GitCompareArrows, title: 'Compare periods', description: 'This period against the previous one, the same time last year, or dates you pick. A month in progress is compared with the same number of days, with a running-total chart and the change in each category.' },
      { icon: AlertTriangle, title: 'Anomalies & subscriptions', description: 'Spending spikes by category or merchant, and recurring charges (weekly to yearly) with price changes — plus an AI audit of which to keep.' },
      { icon: Sparkles, title: 'Digest & questions', description: 'A short written read of the period, and answers to questions like “how much did I spend on food?” using only your numbers.', needs: 'AI profile' },
    ],
  },
  {
    id: 'flagit',
    icon: Flag,
    title: 'flagIt',
    items: [
      { icon: FileUp, title: 'Statement import', description: 'CSV exports are read on your device with no AI. Screenshots, PDFs and text go through AI. Imports keep running if you leave the screen, the same file isn’t read twice, and every line lands in an editable review list — amounts, categories and notes — with likely duplicates and unsure lines unticked.', needs: 'AI for PDFs and screenshots' },
      { icon: Flag, title: 'Spending review', description: 'An AI read of this cycle: rises, duplicates, subscriptions, likely FX fees on foreign charges, budget pressure.', needs: 'AI profile' },
      { icon: Lightbulb, title: 'Before you buy', description: 'Checks a planned purchase against safe-to-spend, budgets, bills and similar past purchases. It cannot browse or see live prices — it tells you what to check.', needs: 'AI profile' },
      { icon: Sparkles, title: 'Habits', description: 'Predicts your next likely discretionary spends and cheaper swaps.', needs: 'AI profile' },
    ],
  },
  {
    id: 'investments',
    icon: Coins,
    title: 'Investments',
    items: [
      { icon: LineChart, title: 'Holdings from transactions', description: 'Buys, sells, dividends, interest and fees → quantity, average cost, realised and unrealised profit.', details: ['Enter a current price (or value for FDs/cash) to see P/L', 'Each holding keeps its own currency'] },
      { icon: Globe, title: 'Currency profiles', description: 'One per country or account currency, each with its rate to your base currency. Set them up in Settings.' },
      { icon: ArrowRightLeft, title: 'Transfers between profiles', description: 'Record what the bank actually debited and credited; Monetr shows the effective rate and keeps both sides linked.' },
    ],
  },
  {
    id: 'sync',
    icon: Cloud,
    title: 'Sync',
    items: [
      { icon: QrCode, title: 'Link with a QR', description: 'Show the QR on one device, scan it in Monetr (or with the phone camera app) on the other.' },
      { icon: Lock, title: 'End-to-end encrypted', description: 'Data is encrypted on your device with a key that is only in the QR. The server stores ciphertext and cannot read it.' },
      { icon: Repeat, title: 'Everything, both ways', description: 'Transactions, bills, budgets, pots, investments, appearance, AI profiles and your PIN. Change anything on either device and it shows up on the other.' },
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
      { icon: Repeat, title: 'Never stuck on “overloaded”', description: 'Busy or rate-limited calls are retried with backoff, then your backup models on the same key, then your next profile. Retired model names are swapped for their replacements automatically.' },
      { icon: ScanLine, title: 'Images go where they can be read', description: 'Screenshots only go to models that can see images (Settings shows which). If none can, the text is read on your device and sent to a text-only model instead.' },
      { icon: Sparkles, title: 'Free backups', description: 'Settings suggests free providers (Groq, OpenRouter :free models, Cerebras) to add next to Gemini.' },
    ],
  },
  {
    id: 'data',
    icon: Database,
    title: 'Data & look',
    items: [
      { icon: Database, title: 'Backup & restore', description: 'JSON backup of everything; merge or replace.' },
      { icon: Share2, title: 'Share charts', description: 'Send family or friends a picture of your spending — total, category split and a daily chart. Pick the period (this month by default), show amounts or percentages only, and leave out categories. Never includes shops, notes or transactions.' },
      { icon: LineChart, title: 'Interactive report', description: 'One .html file with live charts — filter categories, hover spending spikes, click a day, read monthly cash flow. Opens offline on any laptop or tablet.' },
      { icon: ReceiptText, title: 'CSV & calendar export', description: 'Transactions to CSV, bills to .ics.' },
      { icon: Palette, title: 'Light, dark and your accent', description: 'Any accent colour stays readable: if it would vanish against the background (white on light, black on dark), Monetr uses the theme’s text colour instead.' },
      { icon: Smartphone, title: 'Installable app', description: 'Add to your home screen on Android or install on your Mac; works offline. Long-press the icon for shortcuts.' },
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
