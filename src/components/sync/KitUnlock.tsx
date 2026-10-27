import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { openKit } from '../../lib/recovery'
import type { ParsedPairing } from '../../lib/sync'
import { Button, Field, Input, Modal } from '../ui'

/** Asks for the recovery password, then hands back the sync pairing inside the kit. */
export function KitUnlock({ kit, onClose, onUnlocked }: { kit: string | null; onClose: () => void; onUnlocked: (p: ParsedPairing) => Promise<void> | void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function unlock() {
    if (!kit) return
    setBusy(true)
    setError('')
    try {
      const pairing = await openKit(kit, password)
      setPassword('')
      await onUnlocked(pairing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the kit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(kit)}
      onClose={() => {
        setPassword('')
        setError('')
        onClose()
      }}
      title="Restore from recovery kit"
      subtitle="Enter the password you chose when you made the kit. This device will link to your sync and download your data."
      size="sm"
      footer={
        <Button className="w-full" onClick={unlock} loading={busy} disabled={!password}>
          <KeyRound className="h-4 w-4" /> Restore my data
        </Button>
      }
    >
      <Field label="Recovery password">
        <Input
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password) void unlock()
          }}
        />
      </Field>
      {error ? <p className="mt-2 text-xs font-medium text-bad">{error}</p> : null}
    </Modal>
  )
}
