import { Eye, Pipette } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { isIdentity, PRESETS, rgbToHex, type AdjustParams, type Preset } from '../lib/adjust'
import { getPreviewWorker } from '../lib/process'
import type { LoadedFile, Op } from '../lib/types'
import { cx } from './ui'

const PREVIEW_MAX = 1400
let keySeq = 0

export function opsFor(params: AdjustParams): Op[] {
  return isIdentity(params) ? [] : [{ type: 'adjust', params }]
}

/**
 * Live preview of adjustments. The worker keeps a downscaled copy of the
 * image; every params change asks it for a fresh render (latest wins).
 */
export function BeautifyPreview({
  file,
  params,
  pickMode,
  onPick,
  onCancelPick,
}: {
  file: LoadedFile
  params: AdjustParams
  pickMode: boolean
  onPick: (hex: string) => void
  onCancelPick: () => void
}) {
  const liveRef = useRef<HTMLCanvasElement>(null)
  const origRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [rendering, setRendering] = useState(false)
  const inFlight = useRef(false)
  const queued = useRef<AdjustParams | null>(null)
  const fileKey = useRef<string>('')

  // Load / cache the selected file in the preview worker.
  useEffect(() => {
    let cancelled = false
    const worker = getPreviewWorker()
    // Unique per effect run: StrictMode mounts twice and the first cleanup must not evict the second run's source.
    const key = `${file.id}-${++keySeq}`
    fileKey.current = key
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        await worker.cache(key, file.file, PREVIEW_MAX)
        const bmp = await worker.render(key, [])
        if (cancelled) {
          bmp.close()
          return
        }
        draw(origRef.current, bmp, false)
        draw(liveRef.current, bmp, true)
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      worker.evict(key)
    }
  }, [file])

  // Re-render when params change (coalesced so the worker never backs up).
  useEffect(() => {
    if (!ready) return
    const run = async (p: AdjustParams) => {
      inFlight.current = true
      setRendering(true)
      const key = fileKey.current
      try {
        const bmp = await getPreviewWorker().render(key, opsFor(p))
        if (fileKey.current === key) draw(liveRef.current, bmp, true)
        else bmp.close()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        inFlight.current = false
        setRendering(false)
        const next = queued.current
        queued.current = null
        if (next) void run(next)
      }
    }
    if (inFlight.current) queued.current = params
    else void run(params)
  }, [params, ready, file.id])

  const onClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pickMode) return
    const canvas = origRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const r = 2
    const x0 = Math.max(0, x - r)
    const y0 = Math.max(0, y - r)
    const w = Math.min(canvas.width - x0, r * 2 + 1)
    const h = Math.min(canvas.height - y0, r * 2 + 1)
    const d = ctx.getImageData(x0, y0, w, h).data
    let rr = 0
    let gg = 0
    let bb = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
      rr += d[i]
      gg += d[i + 1]
      bb += d[i + 2]
    }
    onPick(rgbToHex(rr / n, gg / n, bb / n))
  }

  const showOriginal = comparing || pickMode

  return (
    <div className="space-y-2">
      <div
        className={cx('checker relative flex justify-center overflow-hidden rounded-xl', pickMode && 'cursor-crosshair')}
        onClick={onClick}
        onKeyDown={(e) => e.key === 'Escape' && onCancelPick()}
      >
        <canvas
          ref={origRef}
          className={cx('block max-h-[520px] max-w-full', showOriginal ? 'opacity-100' : 'opacity-0 absolute')}
          style={{ width: 'auto', height: 'auto' }}
        />
        <canvas
          ref={liveRef}
          className={cx('block max-h-[520px] max-w-full', showOriginal && 'absolute opacity-0')}
          style={{ width: 'auto', height: 'auto' }}
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-slate-600">
            Preparing preview…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-4 text-center text-sm text-red-700">
            {error}
          </div>
        )}
        {pickMode && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white">
            <Pipette className="h-3.5 w-3.5" /> Click a color in the image to recolor it
          </div>
        )}
        {ready && !pickMode && (
          <button
            type="button"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            className="absolute bottom-3 right-3 flex select-none items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
          >
            <Eye className="h-3.5 w-3.5" /> {comparing ? 'Original' : 'Hold to compare'}
          </button>
        )}
        {rendering && <div className="absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-brand-500" />}
      </div>
    </div>
  )
}

function draw(canvas: HTMLCanvasElement | null, bmp: ImageBitmap, close: boolean) {
  if (!canvas) {
    if (close) bmp.close()
    return
  }
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')?.drawImage(bmp, 0, 0)
  if (close) bmp.close()
}

/** One-tap looks rendered as thumbnails of the current image. */
export function PresetStrip({
  file,
  activeId,
  onSelect,
}: {
  file: LoadedFile
  activeId: string | null
  onSelect: (preset: Preset) => void
}) {
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const worker = getPreviewWorker()
    const key = `${file.id}-thumb-${++keySeq}`
    ;(async () => {
      try {
        await worker.cache(key, file.file, 160)
        for (const preset of PRESETS) {
          if (cancelled) break
          const params = { ...defaultParams(), ...preset.params }
          const bmp = await worker.render(key, opsFor(params))
          const c = refs.current[preset.id]
          if (c && !cancelled) {
            c.width = bmp.width
            c.height = bmp.height
            c.getContext('2d')?.drawImage(bmp, 0, 0)
          }
          bmp.close()
        }
        if (!cancelled) setVersion((v) => v + 1)
      } catch (e) {
        console.warn('Preset thumbnails failed', e)
      } finally {
        worker.evict(key)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" data-version={version}>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p)}
          className={cx(
            'flex w-[84px] shrink-0 flex-col items-center gap-1 rounded-lg border p-1 text-[11px] font-medium',
            activeId === p.id
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
          )}
        >
          <canvas
            ref={(el) => {
              refs.current[p.id] = el
            }}
            className="checker h-[56px] w-[76px] rounded object-cover"
            style={{ objectFit: 'cover' }}
          />
          {p.name}
        </button>
      ))}
    </div>
  )
}

function defaultParams(): AdjustParams {
  return {
    auto: false,
    exposure: 0,
    brightness: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 0,
    tint: 0,
    hue: 0,
    sharpen: 0,
    blur: 0,
    vignette: 0,
    grain: 0,
    recolor: [],
  }
}
