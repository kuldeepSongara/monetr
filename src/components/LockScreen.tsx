import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, Fingerprint, LockKeyhole } from 'lucide-react'
import { useApp } from '../store'
import { BrandMark } from './Shell'
import { Button, Confirm, cn } from './ui'
import { biometricLabel } from '../lib/biometric'

function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s}s`
}

export function LockScreen() {
  const { unlock, unlockWithBiometric, resetDevice, settings, notify } = useApp()
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  const [waitUntil, setWaitUntil] = useState(settings.pinLockedUntil ? Date.parse(settings.pinLockedUntil) : 0)
  const [now, setNow] = useState(Date.now())
  const [forgot, setForgot] = useState(false)
  const triedAuto = useRef(false)
  const hasBio = Boolean(settings.biometricCredentialId)
  const bioName = biometricLabel()
  const waiting = waitUntil > now

  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [waiting])

  const submit = useCallback(
    async (value: string) => {
      if (value.length < 4 || busy) return
      setBusy(true)
      const res = await unlock(value)
      setBusy(false)
      if (res.ok) return
      setShake(true)
      setPin('')
      window.setTimeout(() => setShake(false), 420)
      if (res.retryInMs) {
        setWaitUntil(Date.now() + res.retryInMs)
        setNow(Date.now())
        notify(`Too many wrong PINs. Try again in ${formatWait(res.retryInMs)}.`, 'error')
      } else notify('Wrong PIN', 'error')
    },
    [unlock, busy, notify],
  )

  const tryBiometric = useCallback(async () => {
    if (!hasBio || bioBusy) return
    setBioBusy(true)
    try {
      const ok = await unlockWithBiometric()
      if (!ok) notify(`${bioName} didn't unlock. Use your PIN.`, 'info')
    } catch (err) {
      notify(err instanceof Error ? err.message : `${bioName} failed`, 'error')
    } finally {
      setBioBusy(false)
    }
  }, [hasBio, bioBusy, unlockWithBiometric, notify, bioName])

  // Offer the fingerprint prompt straight away when the lock screen appears in a focused window.
  useEffect(() => {
    if (!hasBio || triedAuto.current) return
    const attempt = () => {
      if (triedAuto.current || document.visibilityState !== 'visible' || !document.hasFocus()) return
      triedAuto.current = true
      unlockWithBiometric().catch(() => false)
    }
    const t = window.setTimeout(attempt, 350)
    window.addEventListener('focus', attempt)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('focus', attempt)
    }
  }, [hasBio, unlockWithBiometric])

  function press(digit: string) {
    if (waiting) return
    setPin((p) => (p.length >= 8 ? p : p + digit))
  }

  // Physical keyboard on the laptop: digits, Backspace, Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (forgot) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter') void submit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-[100] flex min-h-dvh flex-col items-center justify-center overflow-y-auto bg-bg px-6 py-10">
      <div className="flex w-full max-w-xs flex-col items-center">
        <BrandMark size={54} />
        <h1 className="mt-4 text-lg font-bold text-ink">Monetr is locked</h1>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <LockKeyhole className="h-3 w-3" /> {hasBio ? `Use ${bioName} or your PIN` : 'Enter your PIN to continue'}
        </p>

        {hasBio ? (
          <Button className="mt-6 w-full" size="lg" variant="soft" onClick={tryBiometric} loading={bioBusy}>
            <Fingerprint className="h-5 w-5" /> Unlock with {bioName}
          </Button>
        ) : null}

        <div className={cn('mt-7 flex min-h-8 items-center gap-2.5', shake && 'animate-[shake_0.4s_ease]')}>
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span
              key={i}
              className={cn('h-3 w-3 rounded-full border transition', i < pin.length ? 'border-accent bg-accent' : 'border-line bg-transparent')}
            />
          ))}
        </div>

        {waiting ? <p className="mt-3 text-[11px] font-medium text-warn">Too many attempts — try again in {formatWait(waitUntil - now)}</p> : null}

        <div className="mt-6 grid w-full grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <Key key={d} onClick={() => press(d)} disabled={waiting}>
              {d}
            </Key>
          ))}
          <div />
          <Key onClick={() => press('0')} disabled={waiting}>
            0
          </Key>
          <Key onClick={() => setPin((p) => p.slice(0, -1))} muted>
            <Delete className="h-5 w-5" />
          </Key>
        </div>

        <Button className="mt-6 w-full" size="lg" onClick={() => submit(pin)} loading={busy} disabled={pin.length < 4 || waiting}>
          Unlock
        </Button>

        <button type="button" onClick={() => setForgot(true)} className="mt-5 text-[11px] font-medium text-muted underline underline-offset-4">
          Forgot PIN?
        </button>
      </div>

      <Confirm
        open={forgot}
        title="Forgot your PIN?"
        body={
          (hasBio ? `Use ${bioName} to unlock, then change the PIN in Settings.\n\n` : '') +
          'Otherwise the only way in is to erase Monetr on this device. If this device is linked to cloud sync, unlink happens first and your other devices keep everything — link again afterwards to get your data back. Without sync, restore from a backup file.'
        }
        confirmLabel="Erase this device"
        onConfirm={async () => {
          await resetDevice()
          setForgot(false)
          notify('Monetr was reset on this device.', 'info')
        }}
        onClose={() => setForgot(false)}
      />
    </div>
  )
}

function Key({ children, onClick, muted, disabled }: { children: React.ReactNode; onClick: () => void; muted?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-14 items-center justify-center rounded-2xl border border-line/70 bg-surface text-xl font-semibold text-ink transition active:scale-95 disabled:opacity-40',
        muted ? 'text-muted' : 'hover:bg-surface2',
      )}
    >
      {children}
    </button>
  )
}
