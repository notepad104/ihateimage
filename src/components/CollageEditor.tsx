import { Check, Crop as CropIcon, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { backgroundCss, clampCrop, clampPlacement, containRect, FULL_CROP, photoView, type Border, type Crop, type Placement, type SheetSpec } from '../lib/collage'
import type { LoadedFile, Rect } from '../lib/types'
import { cx } from './ui'

export interface CollageEditorProps {
  spec: SheetSpec
  /** Sheet size in pixels; only the ratio matters here. */
  sheetWidth: number
  sheetHeight: number
  images: LoadedFile[]
  placements: Placement[]
  /** Ids of photos the user has moved or resized by hand. */
  adjusted: Set<string>
  crops: Record<string, Crop | undefined>
  borders: Record<string, Border | undefined>
  /** Object URL of the background picture, when the sheet uses one. */
  backgroundUrl?: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Photo `a` was dropped on photo `b`: swap their places. */
  onSwap: (a: string, b: string) => void
  /** A photo was moved or resized. */
  onPlace: (p: Placement) => void
  /** A photo's frame goes back to the layout's position. */
  onResetPlace: (id: string) => void
  onCrop: (id: string, crop: Crop | undefined) => void
  onRemove: (id: string) => void
}

/** Which part of the crop box is being dragged. */
type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

type Drag =
  | { kind: 'move'; id: string; startX: number; startY: number; origin: Placement; over: string | null }
  | { kind: 'resize'; id: string; startX: number; startY: number; origin: Placement }

const NUDGE = 0.01
/** Dropping a photo on another swaps them only if it was carried mostly onto it. */
const SWAP_MIN_OVERLAP = 0.5

const CROP_HANDLES: { h: CropHandle; className: string; cursor: string }[] = [
  { h: 'n', className: 'left-1/2 top-0 h-3 w-12 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ns-resize' },
  { h: 's', className: 'bottom-0 left-1/2 h-3 w-12 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-ns-resize' },
  { h: 'w', className: 'left-0 top-1/2 h-12 w-3 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  { h: 'e', className: 'right-0 top-1/2 h-12 w-3 -translate-y-1/2 translate-x-1/2', cursor: 'cursor-ew-resize' },
  { h: 'nw', className: 'left-0 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nwse-resize' },
  { h: 'se', className: 'bottom-0 right-0 h-5 w-5 translate-x-1/2 translate-y-1/2', cursor: 'cursor-nwse-resize' },
  { h: 'ne', className: 'right-0 top-0 h-5 w-5 -translate-y-1/2 translate-x-1/2', cursor: 'cursor-nesw-resize' },
  { h: 'sw', className: 'bottom-0 left-0 h-5 w-5 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-nesw-resize' },
]

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / (a.width * a.height)
}

/** Apply a drag of (dx, dy) photo-fractions to a crop box by the given handle. */
function dragCrop(origin: Crop, handle: CropHandle, dx: number, dy: number): Crop {
  if (handle === 'move') return clampCrop({ ...origin, x: origin.x + dx, y: origin.y + dy })
  let { x, y, width, height } = origin
  const right = x + width
  const bottom = y + height
  if (handle.includes('w')) x = Math.min(right - 0.05, Math.max(0, x + dx))
  if (handle.includes('e')) width = Math.min(1 - x, Math.max(0.05, width + dx))
  if (handle.includes('n')) y = Math.min(bottom - 0.05, Math.max(0, y + dy))
  if (handle.includes('s')) height = Math.min(1 - y, Math.max(0.05, height + dy))
  if (handle.includes('w')) width = right - x
  if (handle.includes('n')) height = bottom - y
  return clampCrop({ x, y, width, height })
}

function isFull(c: Crop): boolean {
  return c.x <= 0.0005 && c.y <= 0.0005 && c.width >= 0.9995 && c.height >= 0.9995
}

/**
 * The sheet as it will be exported, drawn with positioned <img> elements so
 * dragging stays cheap. Drag a photo to move it (drop it on another to
 * swap), pull the corner handle to resize, or open its crop dialog.
 */
export function CollageEditor({
  spec,
  sheetWidth,
  sheetHeight,
  images,
  placements,
  adjusted,
  crops,
  borders,
  backgroundUrl,
  selectedId,
  onSelect,
  onSwap,
  onPlace,
  onResetPlace,
  onCrop,
  onRemove,
}: CollageEditorProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [drag, setDragState] = useState<Drag | null>(null)
  // Mirrored in a ref so a pointerup that lands before the next render still sees the drag.
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const [live, setLive] = useState<Placement | null>(null)
  const [cropMode, setCropMode] = useState<string | null>(null)
  const [previewW, setPreviewW] = useState(0)
  const byId = new Map(images.map((f) => [f.id, f]))

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    // Measure now as well: the observer's first notification is skipped for an element that starts at 0×0.
    setPreviewW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setPreviewW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** Sheet pixels → preview pixels. */
  const k = previewW > 0 ? previewW / sheetWidth : 0

  // Crop mode belongs to the selected photo.
  useEffect(() => {
    if (cropMode && cropMode !== selectedId) setCropMode(null)
  }, [cropMode, selectedId])

  /** Pointer position as a fraction of the sheet. */
  const toSheet = (clientX: number, clientY: number) => {
    const el = sheetRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  const capture = (e: ReactPointerEvent) => {
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointers cannot be captured; the sheet still receives the moves.
    }
  }

  const framePx = (p: Placement): Rect => ({ x: 0, y: 0, width: p.width * sheetWidth * k, height: p.height * sheetHeight * k })

  const startDrag = (e: ReactPointerEvent, p: Placement, kind: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (cropMode === p.id) return
    capture(e)
    onSelect(p.id)
    const start = toSheet(e.clientX, e.clientY)
    if (kind === 'resize') setDrag({ kind, id: p.id, startX: start.x, startY: start.y, origin: p })
    else setDrag({ kind: 'move', id: p.id, startX: start.x, startY: start.y, origin: p, over: null })
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const cur = toSheet(e.clientX, e.clientY)
    const dx = cur.x - d.startX
    const dy = cur.y - d.startY
    if (d.kind === 'move') {
      const next = clampPlacement({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy })
      setLive(next)
      let over: string | null = null
      let best = SWAP_MIN_OVERLAP
      for (const q of placements) {
        if (q.id === d.id) continue
        const o = overlap(next, q)
        if (o > best) {
          best = o
          over = q.id
        }
      }
      if (over !== d.over) setDrag({ ...d, over })
      return
    }
    setLive(clampPlacement({ ...d.origin, width: d.origin.width + dx, height: d.origin.height + dy }))
  }

  const endDrag = () => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'move' && d.over) {
      onSwap(d.id, d.over)
    } else if (live) {
      onPlace(live)
    }
    setDrag(null)
    setLive(null)
  }

  // Arrow keys nudge the selected photo.
  useEffect(() => {
    if (!selectedId || cropMode) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const dir = dirs[e.key]
      if (!dir) return
      const step = (e.shiftKey ? 5 : 1) * NUDGE
      e.preventDefault()
      const p = placements.find((x) => x.id === selectedId)
      if (p) onPlace(clampPlacement({ ...p, x: p.x + dir[0] * step, y: p.y + dir[1] * step }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, cropMode, placements, onPlace])

  const bg = spec.background
  const transparent = bg.kind === 'color' && bg.color === 'transparent'
  const bgBlurPx = bg.kind === 'image' ? bg.blur * previewW : 0

  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-3xl">
        <div
          ref={sheetRef}
          className={cx('relative w-full select-none overflow-hidden rounded-lg border border-slate-200 shadow-sm', transparent && 'checker')}
          style={{
            aspectRatio: `${sheetWidth} / ${sheetHeight}`,
            background: bg.kind === 'image' ? '#ffffff' : backgroundCss(bg),
            touchAction: 'none',
          }}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelect(null)
          }}
        >
          {bg.kind === 'image' && backgroundUrl && (
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <img
                src={backgroundUrl}
                alt=""
                className="absolute h-full w-full object-cover"
                style={
                  bgBlurPx > 0
                    ? { filter: `blur(${bgBlurPx}px)`, inset: -bgBlurPx * 2, width: `calc(100% + ${bgBlurPx * 4}px)`, height: `calc(100% + ${bgBlurPx * 4}px)` }
                    : { inset: 0 }
                }
              />
              {bg.dim > 0 && <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${bg.dim})` }} />}
            </div>
          )}
          {placements.map((base) => {
            const file = byId.get(base.id)
            if (!file) return null
            const p = live && live.id === base.id ? live : base
            const crop = crops[p.id]
            const selected = selectedId === p.id
            const dragging = drag?.id === p.id
            const isTarget = drag?.kind === 'move' && drag.over === p.id
            const cellPx = framePx(p)
            const border = borders[p.id]
            const bw = border ? border.width * sheetWidth * k : 0
            // The kept part of the photo, whole and centred in its frame, with its border around it.
            const view = photoView(file.width, file.height, cellPx, crop, bw)
            const s = view.dest.width / view.src.width
            const radiusPx = spec.radius * Math.min(cellPx.width, cellPx.height)
            const shadow = border?.shadow ? `0 ${Math.max(1, view.outer.height * 0.02)}px ${Math.max(4, Math.min(view.outer.width, view.outer.height) * 0.06)}px rgba(15, 23, 42, 0.35)` : undefined
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`${file.name}${selected ? ', selected' : ''}`}
                onPointerDown={(e) => startDrag(e, base, 'move')}
                onFocus={() => onSelect(p.id)}
                className={cx('absolute cursor-grab outline-none', dragging && 'z-20 cursor-grabbing opacity-95', isTarget && 'z-10')}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.width * 100}%`, height: `${p.height * 100}%` }}
              >
                <div
                  className="absolute"
                  style={{
                    left: view.outer.x,
                    top: view.outer.y,
                    width: view.outer.width,
                    height: view.outer.height,
                    borderRadius: radiusPx,
                    backgroundColor: bw > 0 ? border?.color : undefined,
                    boxShadow: shadow,
                  }}
                >
                  <div
                    className="absolute overflow-hidden"
                    style={{ left: bw, top: bw, width: view.dest.width, height: view.dest.height, borderRadius: Math.max(0, radiusPx - bw) }}
                  >
                    <img
                      src={file.url}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute max-w-none"
                      style={{ left: -view.src.x * s, top: -view.src.y * s, width: file.width * s, height: file.height * s }}
                    />
                  </div>
                </div>
                <div
                  aria-hidden
                  className={cx(
                    'pointer-events-none absolute inset-0 ring-inset',
                    selected && 'ring-2 ring-brand-500',
                    isTarget && 'bg-brand-500/20 ring-4 ring-brand-400',
                  )}
                />
                {selected && !dragging && (
                  <>
                    <div
                      className="absolute left-1 top-1 z-30 flex items-center gap-0.5 rounded-md bg-slate-900/85 p-0.5 text-white"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title="Crop this photo"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCropMode(p.id)
                        }}
                        className="rounded p-1 hover:bg-white/20"
                      >
                        <CropIcon className="h-3.5 w-3.5" />
                      </button>
                      {(adjusted.has(p.id) || crop) && (
                        <button
                          type="button"
                          title="Reset this photo's frame and crop"
                          onClick={(e) => {
                            e.stopPropagation()
                            onResetPlace(p.id)
                            onCrop(p.id, undefined)
                          }}
                          className="rounded p-1 hover:bg-white/20"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemove(p.id)
                        }}
                        className="rounded p-1 hover:bg-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div
                      role="slider"
                      aria-label="Resize photo"
                      aria-valuenow={Math.round(p.width * 100)}
                      onPointerDown={(e) => startDrag(e, base, 'resize')}
                      className="absolute bottom-0 right-0 z-30 h-5 w-5 cursor-nwse-resize rounded-tl-md border-l-2 border-t-2 border-white bg-brand-500 shadow"
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">
        Drag a photo to move it or drop it on another to swap. Pull the corner handle to resize. Use the crop button to trim a photo.
      </p>
      {cropMode && byId.get(cropMode) && (
        <CropDialog
          file={byId.get(cropMode)!}
          crop={crops[cropMode]}
          onChange={(c) => onCrop(cropMode, c)}
          onClose={() => setCropMode(null)}
        />
      )}
    </div>
  )
}

/**
 * Full-size crop editor for one photo. The photo is shown as large as the
 * viewport allows, with a crop box whose handles sit outside the picture,
 * so every edge, including the ones at the photo's border, can be grabbed.
 */
function CropDialog({
  file,
  crop,
  onChange,
  onClose,
}: {
  file: LoadedFile
  crop: Crop | undefined
  onChange: (crop: Crop | undefined) => void
  onClose: () => void
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [box, setBox] = useState<Crop>(crop ?? FULL_CROP)
  const dragRef = useRef<{ handle: CropHandle; startX: number; startY: number; origin: Crop; photo: Rect } | null>(null)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = (width: number, height: number) => setArea({ width, height })
    const r = el.getBoundingClientRect()
    measure(r.width, r.height)
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const photo = containRect(file.width, file.height, { x: 0, y: 0, ...area })
  const pct = (v: number) => `${v * 100}%`

  const start = (e: ReactPointerEvent, handle: CropHandle) => {
    if (e.button !== 0 || photo.width <= 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Synthetic pointers cannot be captured; the area still receives the moves.
    }
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, origin: box, photo }
  }
  const move = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setBox(dragCrop(d.origin, d.handle, (e.clientX - d.startX) / d.photo.width, (e.clientY - d.startY) / d.photo.height))
  }
  const end = () => {
    dragRef.current = null
  }

  const done = () => {
    onChange(isFull(box) ? undefined : box)
    onClose()
  }

  // Escape cancels, Enter confirms, arrows move the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter') done()
      else {
        const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        const dir = dirs[e.key]
        if (!dir) return
        e.preventDefault()
        const step = (e.shiftKey ? 5 : 1) * NUDGE
        setBox((b) => dragCrop(b, 'move', dir[0] * step, dir[1] * step))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box])

  const kept = `${Math.round(box.width * file.width)} × ${Math.round(box.height * file.height)} px`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Crop ${file.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 p-4 sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-slate-300">Keeping {kept}. Drag the edges or corners of the box; drag inside it to move it.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!isFull(box) && (
            <button type="button" onClick={() => setBox(FULL_CROP)} className="rounded-lg px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10">
              <RotateCcw className="mr-1 inline h-4 w-4" /> Whole photo
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10">
            Cancel
          </button>
          <button type="button" onClick={done} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
            <Check className="mr-1 inline h-4 w-4" /> Done
          </button>
        </div>
      </div>
      <div
        ref={areaRef}
        className="relative mx-auto mt-4 w-full max-w-5xl flex-1 select-none"
        style={{ touchAction: 'none' }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {photo.width > 0 && (
          <div className="absolute" style={{ left: photo.x, top: photo.y, width: photo.width, height: photo.height }}>
            <img src={file.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
            {/* Darken what will be cut off. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-slate-950/60"
              style={{
                clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct(box.x)} ${pct(box.y)}, ${pct(box.x)} ${pct(box.y + box.height)}, ${pct(box.x + box.width)} ${pct(box.y + box.height)}, ${pct(box.x + box.width)} ${pct(box.y)}, ${pct(box.x)} ${pct(box.y)})`,
              }}
            />
            <div
              role="group"
              aria-label="Crop box"
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              style={{ left: pct(box.x), top: pct(box.y), width: pct(box.width), height: pct(box.height) }}
              onPointerDown={(e) => start(e, 'move')}
            >
              <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="border border-white/70" />
                ))}
              </div>
              {CROP_HANDLES.map(({ h, className, cursor }) => (
                <div
                  key={h}
                  role="slider"
                  aria-label={`Crop ${h} edge`}
                  aria-valuenow={0}
                  onPointerDown={(e) => start(e, h)}
                  className={cx('absolute rounded-sm border border-slate-700 bg-white shadow', className, cursor)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
