import { useState } from 'react'
import { Copy, Download, LifeBuoy, Mail, Share2, ShieldCheck } from 'lucide-react'
import { useApp } from '../../store'
import { getSyncState } from '../../lib/sync'
import { drawKitImage, kitUrl, sealKit } from '../../lib/recovery'
import { Badge, Button, Field, Input, Modal } from '../ui'
import { relativeTime } from '../../lib/dates'

/** Create a password-protected recovery kit you can email to yourself or keep in cloud storage. */
export function RecoveryKit() {
  const { settings, saveSettings, notify } = useApp()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kit, setKit] = useState('')
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null)

  function reset() {
    setPassword('')
    setConfirm('')
    setError('')
    setKit('')
    setImage(null)
  }

  async function create() {
    setError('')
    if (password.length < 10) return setError('Use at least 10 characters — a short phrase you’ll remember works well.')
    if (password !== confirm) return setError('The two passwords don’t match.')
    const state = getSyncState()
    if (!state) return setError('Turn on sync first.')
    setBusy(true)
    try {
      const sealed = await sealKit({ syncId: state.syncId, key: state.key, server: state.server }, password)
      const canvas = await drawKitImage(sealed)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) throw new Error('Could not draw the kit')
      setKit(sealed)
      setImage({ url: canvas.toDataURL('image/png'), blob })
      setPassword('')
      setConfirm('')
      await saveSettings({ recoveryKitAt: new Date().toISOString() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the kit')
    } finally {
      setBusy(false)
    }
  }

  const fileName = 'monetr-recovery-kit.png'
  function save() {
    if (!image) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(image.blob)
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    notify('Recovery kit saved', 'success')
  }
  async function share() {
    if (!image) return
    const file = new File([image.blob], fileName, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Monetr recovery kit' }).catch(() => undefined)
    else save()
  }
  function email() {
    const body = [
      'My Monetr recovery kit. If all my devices are wiped:',
      '',
      `1. Open this link on the new device: ${kitUrl(kit)}`,
      '2. Enter my recovery password (not in this email).',
      '',
      'Recovery code (if the link doesn’t work, paste it in Settings → Cloud sync):',
      kit,
    ].join('\n')
    location.href = `mailto:?subject=${encodeURIComponent('Monetr recovery kit')}&body=${encodeURIComponent(body)}`
  }
  async function copy() {
    await navigator.clipboard.writeText(kit).then(
      () => notify('Recovery code copied', 'success'),
      () => notify('Could not copy', 'error'),
    )
  }

  const canShareFiles = typeof navigator !== 'undefined' && Boolean(navigator.canShare)

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line/70 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <LifeBuoy className="h-3.5 w-3.5" /> Recovery kit
          </p>
          <p className="text-[11px] text-muted">
            {settings.recoveryKitAt ? `Created ${relativeTime(settings.recoveryKitAt)}. ` : ''}
            Gets your data back if every device is wiped.
          </p>
        </div>
        {settings.recoveryKitAt ? null : <Badge tone="warn">not saved</Badge>}
        <Button
          size="sm"
          variant={settings.recoveryKitAt ? 'ghost' : 'primary'}
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          {settings.recoveryKitAt ? 'New kit' : 'Create'}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => {
          reset()
          setOpen(false)
        }}
        title="Recovery kit"
        subtitle="Your sync key, locked with a password. Safe to email to yourself or keep in Google Drive / iCloud."
        size="sm"
        footer={
          kit ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={copy} aria-label="Copy recovery code">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={save} aria-label="Save image">
                <Download className="h-4 w-4" />
              </Button>
              <Button variant="ghost" className="flex-1" onClick={email}>
                <Mail className="h-4 w-4" /> Email
              </Button>
              {canShareFiles ? (
                <Button className="flex-1" onClick={share}>
                  <Share2 className="h-4 w-4" /> Share
                </Button>
              ) : null}
            </div>
          ) : (
            <Button className="w-full" onClick={create} loading={busy}>
              <ShieldCheck className="h-4 w-4" /> Create recovery kit
            </Button>
          )
        }
      >
        {kit && image ? (
          <div className="space-y-3">
            <img src={image.url} alt="Recovery kit" className="w-full rounded-xl border border-line/70" />
            <p className="text-[11px] leading-relaxed text-muted">
              Email it to yourself, or save the image somewhere you’ll still have if your phone and laptop are lost. The password is not in the kit
              — keep it in your head or a password manager.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Recovery password" hint="At least 10 characters. You’ll need it to use the kit — it can’t be reset.">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Type it again">
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            <p className="text-[11px] leading-relaxed text-muted">
              Making a new kit doesn’t cancel older ones — each opens with the password it was made with. Unlinking every device and starting
              sync again creates a new key, and old kits stop working.
            </p>
            {error ? <p className="text-xs font-medium text-bad">{error}</p> : null}
          </div>
        )}
      </Modal>
    </>
  )
}
