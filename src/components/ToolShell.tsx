import { ArrowLeft, Download, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { downloadAll } from '../lib/download'
import { filesFromDataTransfer, loadFiles, revokeFiles } from '../lib/files'
import { formatBytes, percentChange } from '../lib/format'
import type { ToolDef } from '../lib/tools'
import type { LoadedFile, ProcessResult } from '../lib/types'
import { DropZone } from './DropZone'
import { FileGrid } from './FileGrid'
import { ResultList, SavingsBadge, type JobState } from './ResultList'
import { Button, Notice } from './ui'

/** Shared file state for a tool page. */
export function useImageFiles(multiple = true) {
  const [files, setFiles] = useState<LoadedFile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ name: string; message: string }[]>([])
  const [loading, setLoading] = useState(false)

  const add = useCallback(
    async (incoming: File[]) => {
      if (!incoming.length) return
      setLoading(true)
      const { loaded, errors: errs } = await loadFiles(incoming)
      setLoading(false)
      setErrors(errs)
      if (!loaded.length) return
      setFiles((prev) => {
        if (!multiple) {
          revokeFiles(prev)
          return loaded.slice(0, 1)
        }
        return [...prev, ...loaded]
      })
      setSelectedId((prev) => (multiple && prev ? prev : loaded[0].id))
    },
    [multiple],
  )

  const remove = useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target) revokeFiles([target])
      const next = prev.filter((f) => f.id !== id)
      setSelectedId((sel) => (sel === id ? (next[0]?.id ?? null) : sel))
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setFiles((prev) => {
      revokeFiles(prev)
      return []
    })
    setSelectedId(null)
    setErrors([])
  }, [])

  // Revoke object URLs when the page unmounts (ref so the cleanup sees the latest list).
  const latest = useRef(files)
  latest.current = files
  useEffect(() => () => revokeFiles(latest.current), [])

  const selected = files.find((f) => f.id === selectedId) ?? files[0] ?? null
  return { files, selected, selectedId: selected?.id ?? null, select: setSelectedId, add, remove, clear, errors, loading }
}

export type ImageFiles = ReturnType<typeof useImageFiles>

export interface ToolShellProps {
  tool: ToolDef
  files: ImageFiles
  /** Sidebar contents */
  options: ReactNode
  /** Replaces the file grid when provided (e.g. an interactive crop editor) */
  preview?: ReactNode
  processLabel?: string
  canProcess?: boolean
  /** Runs the tool on one file. Must resolve to a result or throw. */
  process: (file: LoadedFile, onProgress: (p: number) => void) => Promise<ProcessResult>
  /** How many files to run at the same time. Worker-pool tools can be high; heavy ML should be 1. */
  concurrency?: number
  zipName?: string
  multiple?: boolean
  /** Called when the user goes back from results to options (e.g. to clear cached work). */
  onReset?: () => void
}

type Stage = 'ready' | 'processing' | 'done'

export function ToolShell({
  tool,
  files,
  options,
  preview,
  processLabel = 'Process',
  canProcess = true,
  process,
  concurrency = 8,
  zipName,
  multiple = true,
  onReset,
}: ToolShellProps) {
  const [stage, setStage] = useState<Stage>('ready')
  const [jobs, setJobs] = useState<Record<string, JobState>>({})
  const [zipping, setZipping] = useState(false)
  const runId = useRef(0)

  // Global paste + drop so users don't have to aim at the drop zone.
  useEffect(() => {
    if (stage !== 'ready') return
    const onPaste = (e: ClipboardEvent) => {
      const list = filesFromDataTransfer(e.clipboardData)
      if (list.length) {
        e.preventDefault()
        void files.add(list)
      }
    }
    const onDrop = (e: DragEvent) => {
      const list = filesFromDataTransfer(e.dataTransfer)
      if (list.length) {
        e.preventDefault()
        void files.add(list)
      }
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [files, stage])

  const run = async () => {
    const id = ++runId.current
    setStage('processing')
    const initial: Record<string, JobState> = {}
    for (const f of files.files) initial[f.id] = { status: 'queued' }
    setJobs(initial)

    const queue = [...files.files]
    const update = (fid: string, state: JobState) => {
      if (runId.current !== id) return
      setJobs((prev) => ({ ...prev, [fid]: state }))
    }
    const worker = async () => {
      for (;;) {
        const f = queue.shift()
        if (!f) return
        update(f.id, { status: 'working', progress: 0 })
        try {
          const result = await process(f, (p) => update(f.id, { status: 'working', progress: p }))
          update(f.id, { status: 'done', result })
        } catch (err) {
          update(f.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker))
    if (runId.current === id) setStage('done')
  }

  const results = useMemo(
    () =>
      files.files
        .map((f) => jobs[f.id])
        .filter((j): j is Extract<JobState, { status: 'done' }> => j?.status === 'done')
        .map((j) => j.result),
    [files.files, jobs],
  )

  const totals = useMemo(() => {
    let before = 0
    let after = 0
    for (const f of files.files) {
      const j = jobs[f.id]
      if (j?.status === 'done') {
        before += f.size
        after += j.result.blob.size
      }
    }
    return { before, after }
  }, [files.files, jobs])

  const backToOptions = () => {
    runId.current++
    setJobs({})
    setStage('ready')
    onReset?.()
  }

  const startOver = () => {
    backToOptions()
    files.clear()
  }

  const Icon = tool.icon

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tool.tint}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{tool.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{tool.description}</p>
        </div>
      </div>

      {files.errors.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {files.errors.map((e) => (
              <div key={e.name}>
                <span className="font-medium">{e.name}</span>: {e.message}
              </div>
            ))}
          </Notice>
        </div>
      )}

      {files.files.length === 0 ? (
        <DropZone onFiles={(list) => void files.add(list)} multiple={multiple} busy={files.loading} />
      ) : stage === 'ready' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            {preview ?? (
              <FileGrid
                files={files.files}
                selectedId={files.selectedId}
                onSelect={files.select}
                onRemove={files.remove}
              />
            )}
            {multiple && <DropZone compact onFiles={(list) => void files.add(list)} busy={files.loading} />}
            {!multiple && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={startOver}>
                  <RotateCcw className="h-4 w-4" /> Choose another image
                </Button>
              </div>
            )}
          </div>
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {options}
              <Button size="lg" className="w-full" onClick={run} disabled={!canProcess || files.loading}>
                {processLabel}
                {files.files.length > 1 && ` ${files.files.length} images`}
              </Button>
              <p className="text-center text-xs text-slate-500">
                {files.files.length} {files.files.length === 1 ? 'image' : 'images'} ·{' '}
                {formatBytes(files.files.reduce((s, f) => s + f.size, 0))} · stays on your device
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {stage === 'processing' ? (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                Processing {Object.values(jobs).filter((j) => j.status === 'done' || j.status === 'error').length}/
                {files.files.length}…
              </div>
            ) : (
              <div className="text-sm text-slate-700">
                <span className="font-semibold text-slate-900">
                  {results.length} of {files.files.length} done
                </span>
                {totals.before > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1.5 text-slate-600">
                    {formatBytes(totals.before)} → {formatBytes(totals.after)}
                    <SavingsBadge before={totals.before} after={totals.after} />
                    {percentChange(totals.before, totals.after) < 0 && (
                      <span className="text-emerald-700">saved {formatBytes(totals.before - totals.after)}</span>
                    )}
                  </span>
                )}
              </div>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={backToOptions} disabled={stage === 'processing'}>
                <ArrowLeft className="h-4 w-4" /> Adjust settings
              </Button>
              <Button variant="ghost" size="sm" onClick={startOver} disabled={stage === 'processing'}>
                <RotateCcw className="h-4 w-4" /> Start over
              </Button>
              <Button
                size="sm"
                disabled={stage === 'processing' || results.length === 0 || zipping}
                onClick={async () => {
                  setZipping(true)
                  try {
                    await downloadAll(results, zipName ?? `ihateimage-${tool.id}`)
                  } finally {
                    setZipping(false)
                  }
                }}
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {results.length > 1 ? 'Download all (ZIP)' : 'Download'}
              </Button>
            </div>
          </div>
          <ResultList files={files.files} jobs={jobs} />
          {stage === 'done' && (
            <p className="text-center text-sm text-slate-500">
              Want another tool?{' '}
              <Link to="/" className="font-medium text-brand-700 hover:underline">
                Back to all tools
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
