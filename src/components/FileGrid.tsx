import { X } from 'lucide-react'
import { formatBytes, labelForMime } from '../lib/format'
import type { LoadedFile } from '../lib/types'
import { cx } from './ui'

export function FileGrid({
  files,
  selectedId,
  onSelect,
  onRemove,
  disabled,
}: {
  files: LoadedFile[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  disabled?: boolean
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {files.map((f) => {
        const selected = f.id === selectedId
        return (
          <li key={f.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              className={cx(
                'group block w-full overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                selected ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-slate-200 hover:shadow',
              )}
            >
              <div className="checker aspect-square w-full">
                <img
                  src={f.url}
                  alt={f.name}
                  className="h-full w-full object-contain"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div className="px-2.5 py-2">
                <p className="truncate text-xs font-medium text-slate-800" title={f.name}>
                  {f.name}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {labelForMime(f.type)} · {f.width}×{f.height} · {formatBytes(f.size)}
                </p>
              </div>
            </button>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(f.id)}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
