import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { getPreviewWorker } from '../lib/process'
import type { LoadedFile, Op } from '../lib/types'
import { cx } from './ui'

const PREVIEW_MAX = 1400
let keySeq = 0

/**
 * Renders `ops` applied to `file` through the preview worker, re-rendering
 * whenever ops change (latest request wins, never more than one in flight).
 * Optional drag reporting in normalized image coordinates.
 */
export function LivePreview({
  file,
  ops,
  onDrag,
  dragging = false,
  overlay,
  maxHeight = 520,
}: {
  file: LoadedFile
  ops: Op[]
  /** Called with 0..1 coordinates while the user drags on the preview */
  onDrag?: (x: number, y: number, phase: 'start' | 'move' | 'end') => void
  dragging?: boolean
  overlay?: ReactNode
  maxHeight?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const queued = useRef<Op[] | null>(null)
  const keyRef = useRef('')
  const down = useRef(false)

  useEffect(() => {
    let cancelled = false
    const worker = getPreviewWorker()
    const key = `${file.id}-live-${++keySeq}`
    keyRef.current = key
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        await worker.cache(key, file.file, PREVIEW_MAX)
        if (!cancelled) setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      worker.evict(key)
    }
  }, [file])

  useEffect(() => {
    if (!ready) return
    const run = async (o: Op[]) => {
      inFlight.current = true
      const key = keyRef.current
      try {
        const bmp = await getPreviewWorker().render(key, o)
        const canvas = canvasRef.current
        if (keyRef.current === key && canvas) {
          canvas.width = bmp.width
          canvas.height = bmp.height
          canvas.getContext('2d')?.drawImage(bmp, 0, 0)
        }
        bmp.close()
      } catch (e) {
        // A render that lost the race against a source switch is not an error;
        // the new source re-renders on its own once cached.
        if (keyRef.current === key) setError(e instanceof Error ? e.message : String(e))
      } finally {
        inFlight.current = false
        const next = queued.current
        queued.current = null
        if (next && keyRef.current === key) void run(next)
      }
    }
    if (inFlight.current) queued.current = ops
    else void run(ops)
  }, [ops, ready])

  const norm = (e: ReactPointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ]
  }

  return (
    <div
      className={cx('checker relative flex justify-center overflow-hidden rounded-xl', onDrag && 'touch-none', dragging && 'cursor-grabbing')}
      style={{ cursor: onDrag && !dragging ? 'grab' : undefined }}
      onPointerDown={(e) => {
        if (!onDrag || !ready) return
        down.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        onDrag(...norm(e), 'start')
      }}
      onPointerMove={(e) => {
        if (!onDrag || !down.current) return
        onDrag(...norm(e), 'move')
      }}
      onPointerUp={(e) => {
        if (!onDrag || !down.current) return
        down.current = false
        onDrag(...norm(e), 'end')
      }}
      onPointerCancel={() => {
        down.current = false
      }}
    >
      <canvas ref={canvasRef} className="block max-w-full" style={{ maxHeight, width: 'auto', height: 'auto' }} />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-slate-600">Preparing preview…</div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-4 text-center text-sm text-red-700">{error}</div>
      )}
      {overlay}
    </div>
  )
}
