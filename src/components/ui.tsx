import {
  useEffect,
  useMemo,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, X } from 'lucide-react'
import type { Toast } from '../store'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/* ---------------------------------- button --------------------------------- */

type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'plain'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconOnly?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  iconOnly,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'soft' && 'btn-soft',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        variant === 'plain' && 'bg-transparent px-0 py-0 text-muted hover:text-ink',
        size === 'sm' && 'btn-sm',
        size === 'lg' && 'btn-lg',
        iconOnly && 'btn-icon',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  )
}

/* ---------------------------------- inputs --------------------------------- */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      {label ? <label className="label">{label}</label> : null}
      {children}
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('textarea', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('select', className)} {...rest}>
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={cn('flex w-full items-center justify-between gap-3 text-left', disabled && 'opacity-50')}
      disabled={disabled}
    >
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-muted">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition',
          checked ? 'border-accent/60 bg-accent' : 'border-line bg-surface2',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </span>
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-line/70 bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-lg font-medium transition',
            size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------- layout --------------------------------- */

export function Card({
  className,
  children,
  onClick,
}: {
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
        className={cn('card card-pad cursor-pointer transition hover:border-line hover:bg-surface2/50', className)}
      >
        {children}
      </div>
    )
  }
  return <div className={cn('card card-pad', className)}>{children}</div>
}

export function SectionTitle({
  title,
  action,
  sub,
}: {
  title: string
  sub?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3 px-0.5">
      <div>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {sub ? <p className="mt-0.5 text-[11px] text-muted/80">{sub}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon ? <div className="mb-1 text-muted">{icon}</div> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body ? <p className="max-w-xs text-xs leading-relaxed text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ProgressBar({
  value,
  tone = 'accent',
  className,
  height = 8,
}: {
  value: number
  tone?: 'accent' | 'good' | 'warn' | 'bad'
  className?: string
  height?: number
}) {
  const toneClass =
    tone === 'good' ? 'bg-good' : tone === 'warn' ? 'bg-warn' : tone === 'bad' ? 'bg-bad' : 'bg-accent'
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-surface2', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', toneClass)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'
  className?: string
}) {
  const tones = {
    neutral: 'bg-surface2 text-muted',
    good: 'bg-good/12 text-good',
    warn: 'bg-warn/12 text-warn',
    bad: 'bg-bad/12 text-bad',
    accent: 'bg-accent/12 text-accent',
  }
  return <span className={cn('badge', tones[tone], className)}>{children}</span>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} />
}

/* ---------------------------------- modal ---------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  const width = size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line/80 bg-surface shadow-pop sm:rounded-3xl',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/60 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon -mr-1 -mt-1 h-9 w-9 rounded-lg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-line/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  tone = 'danger',
  onConfirm,
  onClose,
  loading,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void
  onClose: () => void
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            className="flex-1"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </Modal>
  )
}

/* ---------------------------------- toasts --------------------------------- */

export function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium shadow-pop animate-slide-up',
            t.kind === 'error'
              ? 'border-bad/40 bg-bad/15 text-ink'
              : t.kind === 'success'
                ? 'border-good/40 bg-good/15 text-ink'
                : 'border-line bg-surface text-ink',
          )}
        >
          {t.kind === 'success' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" /> : null}
          <span className="leading-relaxed">{t.message}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

/* --------------------------------- markdown -------------------------------- */

function inline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
  return tokens.map((tok, i) => {
    if (tok.startsWith('**') && tok.endsWith('**')) {
      return <strong key={i}>{tok.slice(2, -2)}</strong>
    }
    if (tok.startsWith('`') && tok.endsWith('`')) {
      return <code key={i}>{tok.slice(1, -1)}</code>
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 1) {
      return <em key={i}>{tok.slice(1, -1)}</em>
    }
    return <span key={i}>{tok}</span>
  })
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r/g, '').split('\n')
    const out: ReactNode[] = []
    let list: string[] = []
    let ordered = false
    let key = 0

    const flush = () => {
      if (!list.length) return
      const items = list
      out.push(
        ordered ? (
          <ol key={`l${key++}`}>
            {items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={`l${key++}`}>
            {items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ul>
        ),
      )
      list = []
    }

    for (const raw of lines) {
      const line = raw.trimEnd()
      if (!line.trim()) {
        flush()
        continue
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/)
      if (heading) {
        flush()
        const level = heading[1].length
        const content = inline(heading[2])
        out.push(
          level <= 2 ? (
            <h3 key={`h${key++}`}>{content}</h3>
          ) : (
            <h4 key={`h${key++}`} className="text-[13px] font-semibold text-ink">
              {content}
            </h4>
          ),
        )
        continue
      }
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
      if (bullet) {
        if (ordered) flush()
        ordered = false
        list.push(bullet[1])
        continue
      }
      const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
      if (num) {
        if (!ordered) flush()
        ordered = true
        list.push(num[1])
        continue
      }
      flush()
      out.push(<p key={`p${key++}`}>{inline(line)}</p>)
    }
    flush()
    return out
  }, [text])

  return <div className="md">{blocks}</div>
}

/* --------------------------------- helpers --------------------------------- */

export function StatPill({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className={cn('tnum mt-0.5 text-sm font-semibold', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>
        {value}
      </span>
    </div>
  )
}
