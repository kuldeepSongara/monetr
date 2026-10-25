import { useState } from 'react'
import {
  BookOpen,
  LayoutDashboard,
  ReceiptText,
  CalendarClock,
  Target,
  Briefcase,
  Flag,
  Sparkles,
  Bot,
  Cloud,
  Settings as SettingsIcon,
  Database,
  Smartphone,
  ShieldCheck,
  Palette,
  Bell,
  FileText,
  ArrowRightLeft,
  ScanText,
  BrainCircuit,
  Lightbulb,
  TrendingUp,
  PieChart,
  Calculator,
  Download,
  Upload,
  Lock,
  Zap,
  Globe,
} from 'lucide-react'
import { Card, Button, SectionTitle, Badge } from '../components/ui'
import { cn } from '../components/ui'

interface FeatureItem {
  icon: any
  title: string
  description: string
  details?: string[]
}

interface FeatureSection {
  id: string
  icon: any
  title: string
  description: string
  items: FeatureItem[]
}

const SECTIONS: FeatureSection[] = [
  {
    id: 'overview',
    icon: LayoutDashboard,
    title: 'Overview & Dashboard',
    description: 'At-a-glance financial summary with customizable widgets',
    items: [
      { icon: Wallet, title: 'Safe to Spend', description: 'Daily spending limit calculated after bills, budgets, and allowances', details: ['Based on pay cycle', 'Accounts for upcoming bills', 'Updates in real-time'] },
      { icon: Target, title: 'Budget Overview', description: 'Quick view of budget progress with rollover support' },
      { icon: CalendarClock, title: 'Upcoming Bills', description: 'See bills due soon or overdue at a glance' },
      { icon: AlertTriangle, title: 'Alerts & Anomalies', description: 'Flags unusual spending, duplicates, and large charges' },
      { icon: TrendingUp, title: 'Spending Trend', description: '30-day spending chart with daily vs 7-day average' },
      { icon: PieChart, title: 'Category Breakdown', description: 'Visual breakdown of where money went this cycle' },
      { icon: ReceiptText, title: 'Recent Activity', description: 'Last 6 transactions for quick access' },
      { icon: LayoutDashboard, title: 'Customizable Widgets', description: 'Reorder dashboard widgets from Settings' },
    ],
  },
  {
    id: 'transactions',
    icon: ReceiptText,
    title: 'Transactions & Spend Tracking',
    description: 'Log, categorize, and manage all spending and income',
    items: [
      { icon: Plus, title: 'Manual Entry', description: 'Add expense/income with amount, date, merchant, category, notes, tags' },
      { icon: Bot, title: 'AI Categorization', description: 'Auto-categorize transactions using your AI profile' },
      { icon: FileText, title: 'Bulk Actions', description: 'Select multiple transactions to categorize in bulk' },
      { icon: Search, title: 'Search & Filter', description: 'Filter by date range, category, type, merchant, or source' },
      { icon: Edit, title: 'Edit & Delete', description: 'Full CRUD on any transaction' },
      { icon: Globe, title: 'Multi-Currency Support', description: 'Track transactions in any currency with FX rates', details: ['Stores original amount + currency', 'Calculates base amount', 'Per-transaction FX rate'] },
      { icon: Tag, title: 'Tags & Notes', description: 'Add tags and notes for better organization' },
      { icon: Zap, title: 'Quick Add', description: 'Fast entry from bottom bar on mobile' },
    ],
  },
  {
    id: 'bills',
    icon: CalendarClock,
    title: 'Bills & Reminders',
    description: 'Never miss a bill with smart prediction and reminders',
    items: [
      { icon: CalendarClock, title: 'Bill Management', description: 'Add recurring bills with frequency, due day, amount' },
      { icon: BrainCircuit, title: 'Smart Prediction', description: 'AI learns payment history to predict next due dates', details: ['Fixed due day or median gap', 'Confidence based on history', 'Handles irregular patterns'] },
      { icon: Bell, title: 'In-App Notifications', description: 'Alerts for bills due soon or overdue while app is open' },
      { icon: CalendarPlus, title: 'ICS Calendar Export', description: 'Export all bills to .ics for Google/Apple/Outlook calendar' },
      { icon: CheckCircle, title: 'Mark as Paid', description: 'Mark bills paid and optionally create matching transaction' },
      { icon: Clock, title: 'Snooze Bills', description: 'Snooze reminders until a specific date' },
      { icon: Repeat, title: 'Multiple Frequencies', description: 'Weekly, biweekly, monthly, quarterly, yearly, or custom intervals' },
      { icon: Wallet, title: 'Auto-Pay Tracking', description: 'Mark bills as auto-pay for better organization' },
    ],
  },
  {
    id: 'budgets',
    icon: Target,
    title: 'Budgets & Safe-to-Spend',
    description: 'Set spending limits and track progress',
    items: [
      { icon: Target, title: 'Category Budgets', description: 'Set budgets per category or overall budget' },
      { icon: Repeat, title: 'Rollover Support', description: 'Unused budget rolls over to next cycle' },
      { icon: Calculator, title: 'Cycle-Based Budgets', description: 'Budgets follow your pay cycle start day' },
      { icon: Calendar, title: 'Weekly Budgets', description: 'Option for weekly budget periods' },
      { icon: TrendingDown, title: 'Progress Tracking', description: 'Visual progress bars with status indicators' },
      { icon: DollarSign, title: 'Monthly Allowance', description: 'Fallback allowance when no budgets set' },
      { icon: PieChart, title: 'Budget vs Actual', description: 'Compare spending against budget in real-time' },
    ],
  },
  {
    id: 'investments',
    icon: Briefcase,
    title: 'Investments & Multi-Currency Profiles',
    description: 'Track investments across countries and currencies',
    items: [
      { icon: Globe, title: 'Currency Profiles', description: 'Create profiles per country/currency (Home, Work Abroad, etc.)', details: ['Set base currency', 'Custom FX rates', 'Mark default profile'] },
      { icon: Briefcase, title: 'Investment Tracking', description: 'Track stocks, ETFs, mutual funds, crypto, FDs, bonds, other' },
      { icon: Plus, title: 'Buy/Sell/Dividend Tracking', description: 'Log all investment transactions with quantity, price, fees' },
      { icon: ArrowRightLeft, title: 'Transfer Between Profiles', description: 'Move money/investments between currency profiles with FX tracking', details: ['Preserves full history', 'Records actual bank FX rate', 'Tracks fees separately', 'Creates linked transactions', 'No delete/recreate needed'] },
      { icon: Calculator, title: 'Per-Profile Currency', description: 'Each investment belongs to a profile with its currency' },
      { icon: TrendingUp, title: 'Holdings Overview', description: 'View all holdings across all profiles' },
    ],
  },
  {
    id: 'flagit',
    icon: Flag,
    title: 'flagIt - AI Smart Flags',
    description: 'AI-powered spending intelligence and pre-purchase checks',
    items: [
      { icon: Sparkles, title: 'AI Weekly/Daily Review', description: 'Get AI analysis of spending, investments, forex fees, savings opportunities' },
      { icon: Lightbulb, title: 'Pre-Spend Check', description: 'Check before buying - find better prices, deals, card benefits', details: ['Enter product + price + store', 'AI finds alternatives', 'Considers Reddit/forums insights'] },
      { icon: BrainCircuit, title: 'Spending Habits & Prevention', description: 'AI predicts next likely spend and suggests healthier alternatives', details: ['Pattern recognition', 'Actionable prevention tips', 'e.g. park walk + home meal instead of dining out'] },
      { icon: ScanText, title: 'Statement/Screenshot Import', description: 'Upload credit card/bank statement images/PDFs/text', details: ['AI extracts transactions', 'Editable review screen before importing', 'Handles missing year', 'Flags ambiguous items for clarification'] },
      { icon: Flag, title: 'Smart Flags', description: 'Get flagged for unusual expenses with explanations' },
      { icon: DollarSign, title: 'Forex Fee Detection', description: 'Identifies high forex fees and suggests better platforms' },
    ],
  },
  {
    id: 'insights',
    icon: Sparkles,
    title: 'Insights & Analytics',
    description: 'Deep dive into spending patterns and trends',
    items: [
      { icon: PieChart, title: 'Spending by Category', description: 'Detailed breakdown with percentages and trends' },
      { icon: Store, title: 'Top Merchants', description: 'See where you spend most frequently' },
      { icon: Calendar, title: 'Spending by Day of Week', description: 'Identify your spending patterns by weekday' },
      { icon: TrendingUp, title: 'Month-over-Month', description: 'Compare spending across months' },
      { icon: BrainCircuit, title: 'AI Digest', description: 'AI-generated monthly summary with insights and recommendations' },
      { icon: AlertTriangle, title: 'Anomaly Detection', description: 'Deterministic detection of category spikes, duplicates, large charges' },
      { icon: Repeat, title: 'Subscription Audit', description: 'Find recurring subscriptions with price change tracking', details: ['Detects recurring charges', 'Flags price increases', 'Keep/review/cancel suggestions'] },
      { icon: Sparkles, title: 'AI Subscription Audit', description: 'AI verdicts on whether to keep/review/cancel subscriptions' },
    ],
  },
  {
    id: 'ai',
    icon: Bot,
    title: 'AI Integration',
    description: 'Multi-provider AI with failover and smart features',
    items: [
      { icon: Bot, title: 'Multiple Providers', description: 'Google Gemini, OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, Custom' },
      { icon: Bot, title: 'Multiple AI Profiles', description: 'Save multiple profiles with different keys/models' },
      { icon: ArrowRight, title: 'Auto-Failover', description: 'Automatically switches to next profile on error with cooldown' },
      { icon: Activity, title: 'Health Tracking', description: 'Track profile health, latency, success/failure' },
      { icon: TestTube, title: 'Test Connection', description: 'Test any profile before using' },
      { icon: ArrowUpDown, title: 'Priority & Ordering', description: 'Reorder profiles by drag priority' },
      { icon: Zap, title: 'Per-Task Usage', description: 'Different tasks can use different profiles' },
      { icon: Key, title: 'API Keys in IndexedDB', description: 'Keys stored locally, sent directly to providers (no proxy)' },
    ],
  },
  {
    id: 'sync',
    icon: Cloud,
    title: 'Cloud Sync (QR Pairing)',
    description: 'Sync between devices with privacy-first approach',
    items: [
      { icon: QrCode, title: 'QR Code Pairing', description: 'Start on laptop, scan QR with phone to link - no copy/paste needed' },
      { icon: Key, title: 'Sync ID Namespace', description: 'Private room in shared DB - only devices with same Sync ID can sync' },
      { icon: Database, title: 'Compressed Snapshots', description: 'All data gzipped and base64url encoded for efficiency' },
      { icon: RefreshCw, title: 'Auto-Sync', description: 'Debounced sync on changes + manual sync/pull' },
      { icon: WifiOff, title: 'Offline-First', description: 'Works fully offline, syncs when online' },
      { icon: Shield, title: 'Vercel + Neon', description: 'Serverless functions with Postgres, stays on free tier' },
      { icon: Database, title: 'All Data Synced', description: 'Transactions, bills, budgets, investments, profiles, flags, etc.' },
    ],
  },
  {
    id: 'settings',
    icon: SettingsIcon,
    title: 'Settings & Customization',
    description: 'Personalize every aspect of the app',
    items: [
      { icon: DollarSign, title: 'Currency & Money', description: 'Base currency, pay cycle start day, week start, monthly allowance' },
      { icon: Palette, title: 'Appearance', description: 'Theme (light/dark/system), accent colors, dashboard widget order' },
      { icon: Tag, title: 'Categories', description: 'Create/edit/delete custom categories with emoji and color' },
      { icon: Bell, title: 'Notifications', description: 'Bill reminders (in-app only)' },
      { icon: Lock, title: 'PIN Lock', description: 'Privacy curtain with PIN (data stays unencrypted locally)' },
      { icon: Bot, title: 'AI Profiles', description: 'Full AI profile management with failover settings' },
      { icon: Globe, title: 'Currency Profiles', description: 'Manage multi-currency profiles and FX rates' },
      { icon: CalendarPlus, title: 'Bill Reminders', description: 'Configure default lead days' },
    ],
  },
  {
    id: 'data',
    icon: Database,
    title: 'Data Management & Backup',
    description: 'Full control over your data',
    items: [
      { icon: Download, title: 'JSON Backup', description: 'Export complete backup of all data' },
      { icon: Upload, title: 'Import Backup', description: 'Merge or replace from backup file' },
      { icon: FileText, title: 'CSV Export', description: 'Export all transactions to CSV' },
      { icon: CalendarPlus, title: 'ICS Export', description: 'Export bills to calendar file' },
      { icon: Beaker, title: 'Sample Data', description: 'Load/remove demo data for testing' },
      { icon: Trash2, title: 'Erase All Data', description: 'Factory reset (keeps nothing or keeps profiles)' },
      { icon: HardDrive, title: 'Storage Estimate', description: 'See IndexedDB usage and quota' },
      { icon: ShieldCheck, title: 'Local-First', description: 'All data in IndexedDB, never leaves unless you sync/export' },
    ],
  },
  {
    id: 'pwa',
    icon: Smartphone,
    title: 'PWA & Platform',
    description: 'Install as app on any device',
    items: [
      { icon: Smartphone, title: 'Installable PWA', description: 'Add to home screen on iOS/Android/Desktop' },
      { icon: WifiOff, title: 'Offline Support', description: 'Service worker caches app shell for offline use' },
      { icon: Globe, title: 'Cross-Platform', description: 'Works on mobile, tablet, desktop' },
      { icon: Zap, title: 'Fast & Responsive', description: 'Mobile-first design with desktop optimization' },
      { icon: Hash, title: 'Hash Routing', description: 'Works on static hosting without server rewrites' },
      { icon: Code, title: 'Static Build', description: 'Can be hosted anywhere or opened as file' },
      { icon: Package, title: 'APK Generation', description: 'Use PWA Builder to create Android APK/AAB' },
    ],
  },
]

function Icon({ icon: IconComp, className }: { icon: any; className?: string }) {
  return <IconComp className={className} />
}

export default function Features() {
  const [active, setActive] = useState('overview')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4 md:px-6">
      <header>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-ink" />
          <h1 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">Features Guide</h1>
        </div>
        <p className="mt-1 text-sm text-muted">Complete overview of everything Monetr can do</p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={active === s.id ? 'primary' : 'ghost'}
            onClick={() => setActive(s.id)}
            className="gap-1.5"
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.title}
          </Button>
        ))}
      </div>

      {SECTIONS.map((section) => {
        if (section.id !== active) return null
        return (
          <Card key={section.id} className="card-pad">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-bg">
                <section.icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-ink">{section.title}</h2>
                <p className="text-sm text-muted">{section.description}</p>
              </div>
              <Badge tone="neutral">{section.items.length} features</Badge>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {section.items.map((item, idx) => (
                <div key={idx} className="rounded-md border border-line p-3 transition hover:bg-surface2/50">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface2">
                      <item.icon className="h-4 w-4 text-ink" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted leading-relaxed">{item.description}</p>
                      {item.details && (
                        <ul className="mt-1.5 space-y-0.5">
                          {item.details.map((d, i) => (
                            <li key={i} className="text-[11px] text-muted">• {d}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      })}

      <Card className="card-pad bg-surface2/30">
        <div className="text-center">
          <p className="text-sm font-medium text-ink">All features are local-first by default</p>
          <p className="mt-1 text-xs text-muted">Data stays in your browser. Cloud sync is completely optional.</p>
        </div>
      </Card>
    </div>
  )
}

// Missing imports
import { Wallet, AlertTriangle, Plus, Search, Edit, Tag, CalendarPlus, CheckCircle, Clock, Repeat, DollarSign, Calendar, TrendingDown, Store, ArrowRight, Activity, TestTube, ArrowUpDown, Key, QrCode, RefreshCw, WifiOff, Shield, Hash, Code, Package, HardDrive, Trash2, Beaker } from 'lucide-react'
