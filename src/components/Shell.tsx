import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BookOpen,
  MoreHorizontal,
  Briefcase,
  CalendarClock,
  Download,
  Flag,
  LayoutDashboard,
  Lock,
  Plus,
  ReceiptText,
  Settings as SettingsIcon,
  Sparkles,
  Target,
} from 'lucide-react'
import { useApp } from '../store'
import { cn } from './ui'
import { TransactionEditor, type EditorSeed } from './TransactionEditor'
import { formatDate } from '../lib/dates'
import { getSyncState } from '../lib/sync'
import { ImportNotifier, ImportStatus } from './ImportStatus'

const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard, title: 'Overview' },
  { to: '/transactions', label: 'Spend', icon: ReceiptText, title: 'Transactions' },
  { to: '/bills', label: 'Bills', icon: CalendarClock, title: 'Bills & reminders' },
  { to: '/budgets', label: 'Budgets', icon: Target, title: 'Budgets' },
  { to: '/investments', label: 'Invest', icon: Briefcase, title: 'Investments' },
  { to: '/flagit', label: 'flagIt', icon: Flag, title: 'flagIt' },
  { to: '/insights', label: 'Insights', icon: Sparkles, title: 'Insights' },
  { to: '/features', label: 'Guide', icon: BookOpen, title: 'Features Guide' },
] as const

/** Phone bottom bar: four main tabs plus “More” — eight tabs don't fit in one row. */
const MOBILE_PRIMARY = ['/', '/transactions', '/bills', '/budgets'] as const
const MOBILE_MORE = [
  ...NAV.filter((n) => !(MOBILE_PRIMARY as readonly string[]).includes(n.to)),
  { to: '/settings', label: 'Settings', icon: SettingsIcon, title: 'Settings' },
] as const

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink text-bg"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3L4 7V17L12 21L20 17V7L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 12L20 7M12 12L4 7M12 12V21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function Shell() {
  const { settings, bills, schedules, canInstall, installApp, lock, today } = useApp()
  const location = useLocation()
  const [editorOpen, setEditorOpen] = useState(false)
  const [seed, setSeed] = useState<EditorSeed | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MOBILE_MORE.some((m) => m.to === location.pathname)

  const current = NAV.find((n) => n.to === location.pathname)
  const title = current?.title ?? (location.pathname === '/settings' ? 'Settings' : 'Monetr')
  const dueCount = bills.filter((b) => {
    if (!b.active || b.archived) return false
    const s = schedules.get(b.id)
    return s && !s.snoozed && (s.status === 'due-soon' || s.status === 'overdue')
  }).length

  const openAdd = (initial?: EditorSeed) => {
    setSeed(initial ?? null)
    setEditorOpen(true)
  }

  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line/70 bg-surface/70 p-4 backdrop-blur lg:flex">
        <div className="flex items-center gap-2.5 px-1.5 py-2">
          <BrandMark size={38} />
          <div>
            <p className="text-sm font-semibold leading-tight text-ink">Monetr</p>
            <p className="text-[10px] leading-tight text-muted">Personal finance</p>
          </div>
        </div>

        <nav className="mt-5 flex-1 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-surface2 hover:text-ink',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.title}</span>
              {item.to === '/bills' && dueCount > 0 ? (
                <span className="rounded-full bg-bad/15 px-1.5 py-0.5 text-[10px] font-bold text-bad">{dueCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-line/70 pt-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-surface2 hover:text-ink',
              )
            }
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
            Settings
          </NavLink>
          <button
            type="button"
            onClick={() => openAdd()}
            className="btn btn-primary mt-2 w-full"
          >
            <Plus className="h-4 w-4" /> Add transaction
          </button>
          <p className="pt-2 text-center text-[10px] leading-relaxed text-muted/70">
            {getSyncState() ? 'Saved on this device · end-to-end encrypted sync on' : 'Saved only on this device · sync off'} · v1.0
          </p>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line/60 bg-bg/85 px-3 py-2.5 backdrop-blur lg:hidden">
          <BrandMark size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-ink">{title}</p>
            <p className="text-[10px] leading-tight text-muted">{formatDate(today, 'long')}</p>
          </div>
          <ImportStatus />
          {canInstall ? (
            <button type="button" onClick={installApp} className="btn btn-ghost btn-icon h-9 w-9 rounded-lg" aria-label="Install app">
              <Download className="h-4 w-4" />
            </button>
          ) : null}
          {settings.lockEnabled ? (
            <button type="button" onClick={lock} className="btn btn-ghost btn-icon h-9 w-9 rounded-lg" aria-label="Lock app">
              <Lock className="h-4 w-4" />
            </button>
          ) : null}
          <NavLink to="/settings" className="btn btn-ghost btn-icon h-9 w-9 rounded-lg" aria-label="Settings">
            <SettingsIcon className="h-4 w-4" />
          </NavLink>
        </header>

        <main className="mx-auto w-full max-w-6xl px-3 pb-28 pt-3 sm:px-5 lg:pb-12 lg:pt-8">
          <div className="mb-4 hidden items-end justify-between gap-4 lg:flex">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
              <p className="mt-0.5 text-xs text-muted">
                {formatDate(today, 'long')} · pay cycle day {settings.payCycleStartDay}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ImportStatus />
              {settings.lockEnabled ? (
                <button type="button" onClick={lock} className="btn btn-ghost btn-sm">
                  <Lock className="h-3.5 w-3.5" /> Lock
                </button>
              ) : null}
              <NavLink to="/insights" className="btn btn-ghost btn-sm">
                <Sparkles className="h-3.5 w-3.5" /> Ask AI
              </NavLink>
            </div>
          </div>
          <Outlet context={{ openAdd }} />
        </main>
      </div>

      {/* Mobile FAB */}
      <button
        type="button"
        onClick={() => openAdd()}
        className={cn(moreOpen && 'hidden', 'fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-[0_16px_40px_-12px_rgb(var(--accent)/0.9)] transition active:scale-95 lg:hidden')}
        aria-label="Add transaction"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 px-1.5 py-1.5">
          {NAV.filter((n) => (MOBILE_PRIMARY as readonly string[]).includes(n.to)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) => cn('nav-item relative', isActive && !moreOpen && 'nav-item-active')}
            >
              <item.icon className="h-[21px] w-[21px]" strokeWidth={2} />
              <span>{item.label}</span>
              {item.to === '/bills' && dueCount > 0 ? (
                <span className="absolute right-[24%] top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
                  {dueCount}
                </span>
              ) : null}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn('nav-item', (moreOpen || moreActive) && 'nav-item-active')}
            aria-expanded={moreOpen}
            aria-label="More"
          >
            <MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={2} />
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-[29] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-x-2 bottom-[calc(64px+env(safe-area-inset-bottom))] grid grid-cols-3 gap-1.5 rounded-2xl border border-line/70 bg-surface p-2 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            {MOBILE_MORE.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-[11px] font-medium transition',
                    isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-surface2 hover:text-ink',
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                {item.title === 'Features Guide' ? 'Guide' : item.title}
              </NavLink>
            ))}
          </div>
        </div>
      ) : null}

      <ImportNotifier />
      <TransactionEditor open={editorOpen} onClose={() => setEditorOpen(false)} seed={seed} />
    </div>
  )
}
