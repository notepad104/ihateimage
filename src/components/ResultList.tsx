import { AlertTriangle, Download } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { downloadBlob } from '../lib/download'
import { formatBytes, labelForMime, percentChange } from '../lib/format'
import type { LoadedFile, ProcessResult } from '../lib/types'
import { Button, cx } from './ui'

export type JobState =
  | { status: 'queued' }
  | { status: 'working'; progress: number }
  | { status: 'done'; result: ProcessResult }
  | { status: 'error'; error: string }

export function ResultList({ files, jobs }: { files: LoadedFile[]; jobs: Record<string, JobState> }) {
  const urls = useMemo(() => {
    const map: Record<string, string> = {}
    for (const f of files) {
      const j = jobs[f.id]
      if (j?.status === 'done') map[f.id] = URL.createObjectURL(j.result.blob)
    }
    return map
  }, [files, jobs])

  useEffect(() => {
    return () => {
      for (const u of Object.values(urls)) URL.revokeObjectURL(u)
    }
  }, [urls])

  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {files.map((f) => {
        const j = jobs[f.id] ?? { status: 'queued' }
        return (
          <li key={f.id} className="flex items-center gap-4 px-4 py-3">
            <div className="checker h-14 w-14 shrink-0 overflow-hidden rounded-lg">
              <img
                src={j.status === 'done' ? urls[f.id] : f.url}
                alt=""
                className={cx('h-full w-full object-contain', j.status !== 'done' && 'opacity-60')}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">
                {j.status === 'done' ? j.result.name : f.name}
              </p>
              {j.status === 'done' && (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <span>
                    {labelForMime(f.type)} {f.width}×{f.height} · {formatBytes(f.size)}
                  </span>
                  <span aria-hidden>→</span>
                  <span className="text-slate-700">
                    {labelForMime(j.result.blob.type)} {j.result.width}×{j.result.height} ·{' '}
                    {formatBytes(j.result.blob.size)}
                  </span>
                  <SavingsBadge before={f.size} after={j.result.blob.size} />
                  {j.result.note && (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> {j.result.note}
                    </span>
                  )}
                </p>
              )}
              {j.status === 'working' && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-[width]"
                    style={{ width: `${Math.max(4, Math.round(j.progress * 100))}%` }}
                  />
                </div>
              )}
              {j.status === 'queued' && <p className="mt-0.5 text-xs text-slate-500">Waiting…</p>}
              {j.status === 'error' && <p className="mt-0.5 text-xs text-red-600">{j.error}</p>}
            </div>
            {j.status === 'done' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => downloadBlob(j.result.blob, j.result.name)}
                title="Download"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function SavingsBadge({ before, after }: { before: number; after: number }) {
  const pct = percentChange(before, after)
  if (pct === 0) return null
  const smaller = pct < 0
  return (
    <span
      className={cx(
        'rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
        smaller ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600',
      )}
    >
      {smaller ? `−${Math.abs(pct)}%` : `+${pct}%`}
    </span>
  )
}
