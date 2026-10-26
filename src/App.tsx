import { lazy, Suspense, useEffect, useRef } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './store'
import { BrandMark, Shell } from './components/Shell'
import { LockScreen } from './components/LockScreen'
import { Onboarding } from './components/Onboarding'
import { PendingLink } from './components/sync/PendingLink'
import { Spinner, ToastHost } from './components/ui'
import { Dashboard } from './pages/Dashboard'

// Less-used screens load on demand so the first paint on a phone stays fast.
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })))
const Bills = lazy(() => import('./pages/Bills').then((m) => ({ default: m.Bills })))
const Budgets = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.Budgets })))
const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })))
const Investments = lazy(() => import('./pages/Investments'))
const FlagIt = lazy(() => import('./pages/FlagIt'))
const Features = lazy(() => import('./pages/Features'))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg">
      <div className="animate-pop-in">
        <BrandMark size={52} />
      </div>
      <p className="text-sm font-semibold text-ink">Monetr</p>
      <p className="text-[11px] text-muted">Opening your local data…</p>
    </div>
  )
}

function PageFallback() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}

function Gate() {
  const { ready, locked, settings, toasts, dismissToast } = useApp()
  const appRef = useRef<HTMLDivElement>(null)

  // While locked the app stays mounted underneath (so a half-filled form survives an auto-lock),
  // but it is hidden from view, focus and screen readers.
  useEffect(() => {
    const el = appRef.current
    if (!el) return
    if (locked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }, [locked])

  if (!ready) return <Splash />

  if (!settings.onboarded) {
    return (
      <>
        <Onboarding />
        <PendingLink />
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  return (
    <>
      <div ref={appRef} aria-hidden={locked || undefined} className={locked ? 'invisible' : undefined}>
        <HashRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<Dashboard />} />
                <Route path="transactions" element={<Transactions />} />
                <Route path="bills" element={<Bills />} />
                <Route path="budgets" element={<Budgets />} />
                <Route path="investments" element={<Investments />} />
                <Route path="flagit" element={<FlagIt />} />
                <Route path="insights" element={<Insights />} />
                <Route path="features" element={<Features />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </HashRouter>
        {!locked ? <PendingLink /> : null}
      </div>
      {locked ? <LockScreen /> : null}
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  )
}
