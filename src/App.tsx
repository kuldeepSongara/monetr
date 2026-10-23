import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './store'
import { BrandMark, Shell } from './components/Shell'
import { LockScreen } from './components/LockScreen'
import { Onboarding } from './components/Onboarding'
import { ToastHost } from './components/ui'
import { Dashboard } from './pages/Dashboard'
import { Transactions } from './pages/Transactions'
import { Bills } from './pages/Bills'
import { Budgets } from './pages/Budgets'
import { Insights } from './pages/Insights'
import { Settings } from './pages/Settings'

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg">
      <div className="animate-pop-in">
        <BrandMark size={52} />
      </div>
      <p className="text-sm font-semibold text-ink">Spendwise</p>
      <p className="text-[11px] text-muted">Opening your local data…</p>
    </div>
  )
}

function Gate() {
  const { ready, locked, settings, toasts, dismissToast } = useApp()

  if (!ready) return <Splash />

  if (locked) {
    return (
      <>
        <LockScreen />
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  if (!settings.onboarded) {
    return (
      <>
        <Onboarding />
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="bills" element={<Bills />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="insights" element={<Insights />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </HashRouter>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  )
}
