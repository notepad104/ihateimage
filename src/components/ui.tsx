import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export { cx }

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  )
}

export function Field({
  label,
  hint,
  children,
  inline = false,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  inline?: boolean
}) {
  return (
    <label className={cx('block', inline && 'flex items-center justify-between gap-3')}>
      <span className="block">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
      <span className={cx('block', !inline && 'mt-1.5')}>{children}</span>
    </label>
  )
}

const inputBase =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-50 disabled:text-slate-400'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />
}

export function NumberInput({
  value,
  onChange,
  suffix,
  min,
  max,
  step,
  placeholder,
  disabled,
  className,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  suffix?: string
  min?: number
  max?: number
  step?: number
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <input
        type="number"
        inputMode="numeric"
        className={cx(inputBase, suffix && 'pr-10')}
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') onChange('')
          else {
            const n = Number(raw)
            if (Number.isFinite(n)) onChange(n)
          }
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-500">
          {suffix}
        </span>
      )}
    </div>
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, 'pr-8', props.className)} />
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  format,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  /** Fires when the user lets go of the handle (pointer up / key up). */
  onCommit?: (v: number) => void
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-slate-700">
        {format ? format(value) : value}
      </span>
    </div>
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
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cx('flex items-start justify-between gap-3', disabled && 'opacity-50')}>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cx(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fill = true,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  fill?: boolean
}) {
  return (
    <div
      className={cx(
        'inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1',
        fill && 'w-full',
      )}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          title={o.title}
          aria-selected={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            fill && 'flex-1',
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            o.value === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorInput({
  value,
  onChange,
  allowTransparent = false,
}: {
  value: string
  onChange: (v: string) => void
  allowTransparent?: boolean
}) {
  const isTransparent = value === 'transparent'
  return (
    <div className="flex items-center gap-2">
      <span
        className={cx(
          'relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-slate-300',
          isTransparent && 'checker',
        )}
        style={isTransparent ? undefined : { backgroundColor: value }}
      >
        <input
          type="color"
          aria-label="Pick color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={isTransparent ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="font-mono uppercase"
      />
      {allowTransparent && (
        <Button
          type="button"
          size="sm"
          variant={isTransparent ? 'primary' : 'secondary'}
          onClick={() => onChange(isTransparent ? '#ffffff' : 'transparent')}
          title="Transparent background (PNG/WebP only)"
        >
          None
        </Button>
      )}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-lg border px-3 py-2 text-sm',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
      )}
    >
      {children}
    </div>
  )
}
