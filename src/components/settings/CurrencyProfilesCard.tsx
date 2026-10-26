import { useState } from 'react'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useApp } from '../../store'
import type { CurrencyProfile } from '../../types'
import { deleteCurrencyProfile, saveCurrencyProfile, setDefaultCurrencyProfile } from '../../db/db'
import { CURRENCIES } from '../../lib/money'
import { uid } from '../../lib/utils'
import { Badge, Button, Card, Confirm, Field, Input, Modal, SectionTitle, Select } from '../ui'

interface Form {
  name: string
  code: string
  emoji: string
  country: string
  fxToBase: string
}

export function CurrencyProfilesCard() {
  const { currencyProfiles, settings, refresh, notify } = useApp()
  const [editing, setEditing] = useState<CurrencyProfile | null>(null)
  const [form, setForm] = useState<Form>({ name: '', code: 'USD', emoji: '🌍', country: '', fxToBase: '' })
  const [deleting, setDeleting] = useState<CurrencyProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const base = settings.currency

  function open(profile?: CurrencyProfile) {
    const now = new Date().toISOString()
    const p =
      profile ??
      ({ id: uid('cp_'), name: '', code: CURRENCIES.find((c) => c.code !== base)?.code ?? 'USD', isBase: false, isDefault: false, fxToBase: 1, createdAt: now, updatedAt: now } as CurrencyProfile)
    setEditing(p)
    setForm({ name: p.name, code: p.code, emoji: p.emoji ?? '🌍', country: p.country ?? '', fxToBase: p.isBase ? '1' : profile ? String(p.fxToBase) : '' })
  }

  async function save() {
    if (!editing) return
    const fx = editing.isBase ? 1 : Number(form.fxToBase)
    if (!form.name.trim()) return notify('Give the profile a name, e.g. “Home” or “Canada”.', 'error')
    if (!editing.isBase && (!Number.isFinite(fx) || fx <= 0)) return notify(`Enter how many ${base} one ${form.code} is worth.`, 'error')
    setBusy(true)
    try {
      await saveCurrencyProfile({
        ...editing,
        name: form.name.trim(),
        code: editing.isBase ? base : form.code,
        emoji: form.emoji.trim() || undefined,
        country: form.country.trim() || undefined,
        fxToBase: editing.isBase ? 1 : fx,
      })
      await refresh()
      setEditing(null)
      notify('Currency profile saved', 'success')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <SectionTitle
        title="Currency profiles"
        sub="One per country or account currency — used by Investments and transfers"
        action={
          <Button size="sm" variant="soft" onClick={() => open()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
      <div className="space-y-1.5">
        {currencyProfiles.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-xl border border-line/70 px-2.5 py-2">
            <span className="text-lg leading-none">{p.emoji ?? '🌍'}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-[12px] font-medium text-ink">
                {p.name} <span className="text-muted">· {p.code}</span>
                {p.isBase ? <Badge>base</Badge> : null}
                {p.isDefault ? <Badge tone="accent">default</Badge> : null}
              </p>
              <p className="text-[10px] text-muted">
                {p.isBase ? 'Your base currency' : `1 ${p.code} = ${p.fxToBase} ${base}`}
                {!p.isBase ? ` · updated ${p.updatedAt.slice(0, 10)}` : ''}
              </p>
            </div>
            {!p.isDefault ? (
              <button
                type="button"
                className="btn btn-ghost btn-icon h-7 w-7 rounded-md"
                aria-label={`Make ${p.name} default`}
                onClick={async () => {
                  await setDefaultCurrencyProfile(p.id)
                  await refresh()
                }}
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-icon h-7 w-7 rounded-md" aria-label={`Edit ${p.name}`} onClick={() => open(p)}>
              <Pencil className="h-3 w-3" />
            </button>
            {!p.isBase ? (
              <button type="button" className="btn btn-ghost btn-icon h-7 w-7 rounded-md text-muted hover:text-bad" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing && currencyProfiles.some((p) => p.id === editing.id) ? 'Edit currency profile' : 'New currency profile'}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} loading={busy}>
              Save
            </Button>
          </div>
        }
      >
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[64px_1fr] gap-3">
              <Field label="Emoji">
                <Input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className="text-center text-lg" maxLength={4} />
              </Field>
              <Field label="Name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. India savings" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <Select value={editing.isBase ? base : form.code} disabled={editing.isBase} onChange={(e) => setForm({ ...form, code: e.target.value })}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Country (optional)">
                <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="e.g. India" />
              </Field>
            </div>
            {!editing.isBase ? (
              <Field label={`Rate: 1 ${form.code} = ? ${base}`} hint="Used to show this profile's holdings in your base currency. Update it now and then.">
                <Input value={form.fxToBase} onChange={(e) => setForm({ ...form, fxToBase: e.target.value })} inputMode="decimal" placeholder="e.g. 0.0163" />
              </Field>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Confirm
        open={Boolean(deleting)}
        title={`Delete ${deleting?.name ?? 'profile'}?`}
        body="Anything that belonged to it (investments, transactions) moves to your default profile."
        confirmLabel="Delete profile"
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteCurrencyProfile(deleting.id)
            await refresh()
            notify('Profile deleted', 'info')
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Could not delete', 'error')
          } finally {
            setDeleting(null)
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}
