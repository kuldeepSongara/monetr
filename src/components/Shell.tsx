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
import { daysBetween, formatDate, payCycle } from '../lib/dates'
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

  const cycle = payCycle(today, settings.payCycleStartDay)
  const cycleDay = daysBetween(cycle.start, today) + 1
  const cycleLength = daysBetween(cycle.start, cycle.end) + 1
  const cycleLine = `${formatDate(today, 'long')} — day ${cycleDay} of ${cycleLength} in this pay cycle`

  const openAdd = (initial?: EditorSeed) => {
    setSeed(initial ?? null)
    setEditorOpen(true)
  }

  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line/60 bg-bg p-4 lg:flex">
        <div className="flex items-center gap-2.5 px-1.5 py-2">
          <BrandMark size={38} />
          <div>
            <p className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">Monetr</p>
            <p className="text-[11px] leading-tight text-muted">Your money, on your devices</p>
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
                  'relative flex items-center gap-3 rounded-[11px] px-3 py-2 text-[14px] font-medium transition',
                  isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.08),0_0_0_1px_rgb(var(--line)/0.9)] before:absolute before:-left-4 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-accent' : 'text-muted hover:bg-surface/60 hover:text-ink',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.title}</span>
              {item.to === '/bills' && dueCount > 0 ? (
                <span className="tnum rounded-full bg-bad px-1.5 text-[11px] font-semibold leading-[18px] text-white">{dueCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1 border-t border-line/70 pt-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-3 rounded-[11px] px-3 py-2 text-[14px] font-medium transition',
                isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(var(--shadow)/0.08),0_0_0_1px_rgb(var(--line)/0.9)] before:absolute before:-left-4 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-accent' : 'text-muted hover:bg-surface/60 hover:text-ink',
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
          <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-[11px] leading-relaxed text-muted">
            <span className={cn('h-1.5 w-1.5 rounded-full', getSyncState() ? 'bg-good' : 'bg-muted/50')} />
            {getSyncState() ? 'Encrypted sync on' : 'Only on this device'}
          </p>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line/50 bg-bg/80 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
          <BrandMark size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</p>
            <p className="text-[11px] leading-tight text-muted">{cycleLine}</p>
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

        <main className="mx-auto w-full max-w-6xl px-3 pb-28 pt-3 sm:px-5 lg:px-8 lg:pb-12 lg:pt-9">
          <div className="mb-6 hidden items-end justify-between gap-4 lg:flex">
            <div>
              <h1 className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink">{title}</h1>
              <p className="mt-2 text-[13px] text-muted">{cycleLine}</p>
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
        className={cn(moreOpen && 'hidden', 'fixed bottom-[calc(78px+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-[18px] bg-accent text-accent-fg shadow-[0_12px_32px_-10px_rgb(0_0_0/0.45),0_0_0_1px_rgb(255_255_255/0.06)_inset] transition active:scale-95 lg:hidden')}
        aria-label="Add transaction"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 px-1.5 pb-1 pt-1.5">
          {NAV.filter((n) => (MOBILE_PRIMARY as readonly string[]).includes(n.to)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) => cn('nav-item relative', isActive && !moreOpen && 'nav-item-active')}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && !moreOpen && 'bg-ink/[0.08]')}>
                    <item.icon className="h-[20px] w-[20px]" strokeWidth={isActive && !moreOpen ? 2.2 : 1.8} />
                  </span>
                  <span>{item.label}</span>
                  {item.to === '/bills' && dueCount > 0 ? (
                    <span className="absolute right-[22%] top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-semibold text-white ring-2 ring-surface">
                      {dueCount}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn('nav-item', (moreOpen || moreActive) && 'nav-item-active')}
            aria-expanded={moreOpen}
            aria-label="More"
          >
            <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', (moreOpen || moreActive) && 'bg-ink/[0.08]')}>
              <MoreHorizontal className="h-[20px] w-[20px]" strokeWidth={1.8} />
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-[29] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]" />
          <div
            className="absolute inset-x-2 bottom-[calc(66px+env(safe-area-inset-bottom))] grid animate-sheet-up grid-cols-3 gap-1 rounded-[20px] border border-line/70 bg-surface p-1.5 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            {MOBILE_MORE.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1.5 rounded-[14px] px-2 py-3 text-[12px] font-medium transition',
                    isActive ? 'bg-ink/[0.07] text-ink' : 'text-muted hover:bg-surface2 hover:text-ink',
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
