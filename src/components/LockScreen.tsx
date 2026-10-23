import { useState } from 'react'
import { Delete, LockKeyhole } from 'lucide-react'
import { useApp } from '../store'
import { BrandMark } from './Shell'
import { Button, cn } from './ui'

export function LockScreen() {
  const { unlock, removePin, notify } = useApp()
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (pin.length < 4) return
    setBusy(true)
    const ok = await unlock(pin)
    setBusy(false)
    if (!ok) {
      setShake(true)
      setPin('')
      window.setTimeout(() => setShake(false), 420)
      notify('Wrong PIN', 'error')
    }
  }

  function press(digit: string) {
    if (pin.length >= 8) return
    setPin((p) => p + digit)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10">
      <div className="flex w-full max-w-xs flex-col items-center">
        <BrandMark size={54} />
        <h1 className="mt-4 text-lg font-bold text-ink">Spendwise is locked</h1>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <LockKeyhole className="h-3 w-3" /> Enter your PIN to continue
        </p>

        <div className={cn('mt-7 flex min-h-8 items-center gap-2.5', shake && 'animate-[shake_0.4s_ease]')}>
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-3 w-3 rounded-full border transition',
                i < pin.length ? 'border-accent bg-accent' : 'border-line bg-transparent',
              )}
            />
          ))}
        </div>

        <div className="mt-8 grid w-full grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <Key key={d} onClick={() => press(d)}>
              {d}
            </Key>
          ))}
          <div />
          <Key onClick={() => press('0')}>0</Key>
          <Key onClick={() => setPin((p) => p.slice(0, -1))} muted>
            <Delete className="h-5 w-5" />
          </Key>
        </div>

        <Button className="mt-6 w-full" size="lg" onClick={submit} loading={busy} disabled={pin.length < 4}>
          Unlock
        </Button>

        <button
          type="button"
          onClick={async () => {
            await removePin()
            notify('PIN removed. Your data is unchanged.', 'info')
          }}
          className="mt-5 text-[11px] font-medium text-muted underline underline-offset-4"
        >
          Forgot PIN? Remove the lock
        </button>
        <p className="mt-2 max-w-[230px] text-center text-[10px] leading-relaxed text-muted/60">
          This is a privacy screen, not encryption. Your data stays in this browser either way.
        </p>
      </div>
    </div>
  )
}

function Key({
  children,
  onClick,
  muted,
}: {
  children: React.ReactNode
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-14 items-center justify-center rounded-2xl border border-line/70 bg-surface text-xl font-semibold text-ink transition active:scale-95',
        muted ? 'text-muted' : 'hover:bg-surface2',
      )}
    >
      {children}
    </button>
  )
}
