import { useEffect, useState } from 'react'
import { Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useApp } from '../../store'
import type { AutoLockDelay } from '../../types'
import { Button, Card, Confirm, Field, Input, Modal, SectionTitle, Segmented, Toggle } from '../ui'
import { biometricLabel, biometricUnavailableReason, registerBiometric, verifyBiometric } from '../../lib/biometric'

const DELAYS: { value: string; label: string }[] = [
  { value: '0', label: 'Immediately' },
  { value: '30', label: '30 sec' },
  { value: '60', label: '1 min' },
  { value: '300', label: '5 min' },
]

export function SecurityCard() {
  const { settings, saveSettings, setPin, removePin, setBiometric, notify } = useApp()
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPinValue] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [bioReason, setBioReason] = useState<string | null>('Checking…')
  const [bioBusy, setBioBusy] = useState(false)
  const bioName = biometricLabel()
  const hasPin = settings.lockEnabled && Boolean(settings.pinHash)
  const hasBio = Boolean(settings.biometricCredentialId)

  useEffect(() => {
    biometricUnavailableReason().then(setBioReason).catch(() => setBioReason('Not available'))
  }, [])

  function openPin() {
    setPinValue('')
    setPinConfirm('')
    setPinError('')
    setPinOpen(true)
  }

  async function savePin() {
    if (!/^\d{4,8}$/.test(pin)) return setPinError('Use 4–8 digits.')
    if (pin !== pinConfirm) return setPinError('The PINs do not match.')
    setPinBusy(true)
    try {
      await setPin(pin)
      setPinOpen(false)
      notify(hasPin ? 'PIN updated' : 'Lock enabled', 'success')
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not save the PIN')
    } finally {
      setPinBusy(false)
    }
  }

  async function toggleBio(next: boolean) {
    if (!next) {
      await setBiometric(null)
      notify(`${bioName} unlock turned off`, 'info')
      return
    }
    setBioBusy(true)
    try {
      const cred = await registerBiometric()
      // Prove it works before relying on it.
      const ok = await verifyBiometric(cred)
      if (!ok) throw new Error(`${bioName} check did not pass. Try again.`)
      await setBiometric(cred)
      notify(`${bioName} unlock is on`, 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : `Could not set up ${bioName}`, 'error')
    } finally {
      setBioBusy(false)
    }
  }

  return (
    <Card>
      <SectionTitle title="Privacy & lock" sub="PIN and fingerprint, locks when you switch away" />
      <div className="space-y-3.5">
        <Toggle
          checked={hasPin}
          onChange={(v) => (v ? openPin() : setConfirmRemove(true))}
          label="App lock"
          hint="Asks for your PIN (or fingerprint) when Monetr opens and when you come back to it."
        />

        {hasPin ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={openPin}>
                <LockKeyhole className="h-3.5 w-3.5" /> Change PIN
              </Button>
            </div>

            <div className="rounded-xl border border-line/70 p-3">
              <Toggle
                checked={hasBio}
                onChange={toggleBio}
                disabled={bioBusy || (!hasBio && Boolean(bioReason))}
                label={`Unlock with ${bioName}`}
                hint={!hasBio && bioReason ? bioReason : 'Your fingerprint never leaves this device. The PIN always works as a fallback.'}
              />
              {bioBusy ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                  <Fingerprint className="h-3.5 w-3.5" /> Follow the {bioName} prompt…
                </p>
              ) : null}
            </div>

            <div>
              <p className="label">Lock after switching away</p>
              <Segmented
                size="sm"
                value={String(settings.autoLockDelay ?? 0)}
                onChange={(v) => saveSettings({ autoLockDelay: Number(v) as AutoLockDelay })}
                options={DELAYS}
              />
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
                Switching tabs on your laptop or opening another app on your phone counts as switching away.
              </p>
            </div>

            <Toggle
              checked={Boolean(settings.lockOnBlur)}
              onChange={(v) => saveSettings({ lockOnBlur: v })}
              label="Also lock when the window loses focus"
              hint="For laptops: locks when you click into another app even if Monetr is still visible."
            />
          </>
        ) : null}

        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
          Your PIN and lock settings sync to linked devices. Fingerprint unlock is turned on per device, since it uses that device's sensor.
        </p>
      </div>

      <Modal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title={hasPin ? 'Change PIN' : 'Set a PIN'}
        subtitle="4–8 digits. After 5 wrong tries the lock screen makes you wait."
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setPinOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={savePin} loading={pinBusy} disabled={pin.length < 4}>
              Save PIN
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="New PIN">
            <Input
              value={pin}
              onChange={(e) => {
                setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))
                setPinError('')
              }}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••"
            />
          </Field>
          <Field label="Confirm PIN">
            <Input
              value={pinConfirm}
              onChange={(e) => {
                setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))
                setPinError('')
              }}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder="••••"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void savePin()
              }}
            />
          </Field>
          {pinError ? <p className="text-[11px] font-medium text-bad">{pinError}</p> : null}
        </div>
      </Modal>

      <Confirm
        open={confirmRemove}
        title="Turn off the app lock?"
        body="Monetr will open without a PIN or fingerprint on this device. Your data is unchanged."
        confirmLabel="Turn off lock"
        onConfirm={async () => {
          await removePin()
          setConfirmRemove(false)
          notify('Lock turned off', 'info')
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </Card>
  )
}
