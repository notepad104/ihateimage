import { Check, Crop as CropIcon, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clampCrop, clampPlacement, containRect, FULL_CROP, photoView, type Crop, type Placement, type SheetSpec } from '../lib/collage'
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
  | { kind: 'crop'; id: string; handle: CropHandle; startX: number; startY: number; origin: Crop; photo: Rect }

const NUDGE = 0.01
/** Dropping a photo on another swaps them only if it was carried mostly onto it. */
const SWAP_MIN_OVERLAP = 0.5

const CROP_HANDLES: { h: CropHandle; className: string; cursor: string }[] = [
  { h: 'n', className: 'left-1/2 top-0 h-2 w-8 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ns-resize' },
  { h: 's', className: 'bottom-0 left-1/2 h-2 w-8 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-ns-resize' },
  { h: 'w', className: 'left-0 top-1/2 h-8 w-2 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  { h: 'e', className: 'right-0 top-1/2 h-8 w-2 -translate-y-1/2 translate-x-1/2', cursor: 'cursor-ew-resize' },
  { h: 'nw', className: 'left-0 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nwse-resize' },
  { h: 'se', className: 'bottom-0 right-0 h-3.5 w-3.5 translate-x-1/2 translate-y-1/2', cursor: 'cursor-nwse-resize' },
  { h: 'ne', className: 'right-0 top-0 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2', cursor: 'cursor-nesw-resize' },
  { h: 'sw', className: 'bottom-0 left-0 h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-nesw-resize' },
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
 * swap), pull the corner handle to resize, or open its crop and drag the
 * edges of the crop box over the whole photo.
 */
export function CollageEditor({
  spec,
  sheetWidth,
  sheetHeight,
  images,
  placements,
  adjusted,
  crops,
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
  const [liveCrop, setLiveCrop] = useState<{ id: string; crop: Crop } | null>(null)
  const [cropMode, setCropMode] = useState<string | null>(null)
  const [previewW, setPreviewW] = useState(0)
  const byId = new Map(images.map((f) => [f.id, f]))

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
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

  const startCrop = (e: ReactPointerEvent, p: Placement, handle: CropHandle) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    const file = byId.get(p.id)
    if (!file) return
    // The whole photo, as shown in crop mode, in preview pixels.
    const photo = containRect(file.width, file.height, framePx(p))
    if (photo.width <= 0 || photo.height <= 0) return
    setDrag({ kind: 'crop', id: p.id, handle, startX: e.clientX, startY: e.clientY, origin: crops[p.id] ?? FULL_CROP, photo })
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'crop') {
      const dx = (e.clientX - d.startX) / d.photo.width
      const dy = (e.clientY - d.startY) / d.photo.height
      setLiveCrop({ id: d.id, crop: dragCrop(d.origin, d.handle, dx, dy) })
      return
    }
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
    if (d.kind === 'crop') {
      if (liveCrop) onCrop(d.id, isFull(liveCrop.crop) ? undefined : liveCrop.crop)
    } else if (d.kind === 'move' && d.over) {
      onSwap(d.id, d.over)
    } else if (live) {
      onPlace(live)
    }
    setDrag(null)
    setLive(null)
    setLiveCrop(null)
  }

  // Arrow keys nudge the selected photo; in crop mode they move the crop box.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const dir = dirs[e.key]
      if (!dir) return
      const step = (e.shiftKey ? 5 : 1) * NUDGE
      e.preventDefault()
      if (cropMode === selectedId) {
        const next = dragCrop(crops[selectedId] ?? FULL_CROP, 'move', dir[0] * step, dir[1] * step)
        onCrop(selectedId, isFull(next) ? undefined : next)
        return
      }
      const p = placements.find((x) => x.id === selectedId)
      if (p) onPlace(clampPlacement({ ...p, x: p.x + dir[0] * step, y: p.y + dir[1] * step }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, cropMode, placements, crops, onPlace, onCrop])

  const transparent = spec.background === 'transparent'

  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-3xl">
        <div
          ref={sheetRef}
          className={cx('relative w-full select-none overflow-hidden rounded-lg border border-slate-200 shadow-sm', transparent && 'checker')}
          style={{
            aspectRatio: `${sheetWidth} / ${sheetHeight}`,
            backgroundColor: transparent ? undefined : spec.background,
            touchAction: 'none',
          }}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelect(null)
          }}
        >
          {placements.map((base) => {
            const file = byId.get(base.id)
            if (!file) return null
            const p = live && live.id === base.id ? live : base
            const crop = liveCrop && liveCrop.id === p.id ? liveCrop.crop : crops[p.id]
            const selected = selectedId === p.id
            const dragging = drag?.id === p.id
            const isTarget = drag?.kind === 'move' && drag.over === p.id
            const cropping = cropMode === p.id
            const cellPx = framePx(p)
            // Normal view: the kept part, whole and centred. Crop mode: the whole photo with the box over it.
            const view = cropping
              ? { dest: containRect(file.width, file.height, cellPx), src: { x: 0, y: 0, width: file.width, height: file.height } }
              : photoView(file.width, file.height, cellPx, crop)
            const s = view.dest.width / view.src.width
            const radiusPx = cropping ? 0 : spec.radius * Math.min(cellPx.width, cellPx.height)
            const box = crop ?? FULL_CROP
            const pct = (v: number) => `${v * 100}%`
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`${file.name}${selected ? ', selected' : ''}`}
                onPointerDown={(e) => startDrag(e, base, 'move')}
                onFocus={() => onSelect(p.id)}
                className={cx(
                  'absolute outline-none',
                  !cropping && 'cursor-grab',
                  dragging && 'z-20',
                  dragging && !cropping && 'cursor-grabbing opacity-95',
                  (isTarget || cropping) && 'z-10',
                )}
                style={{ left: pct(p.x), top: pct(p.y), width: pct(p.width), height: pct(p.height) }}
              >
                <div
                  className="absolute overflow-hidden"
                  style={{ left: view.dest.x, top: view.dest.y, width: view.dest.width, height: view.dest.height, borderRadius: radiusPx }}
                >
                  <img
                    src={file.url}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute max-w-none"
                    style={{ left: -view.src.x * s, top: -view.src.y * s, width: file.width * s, height: file.height * s }}
                  />
                  {cropping && (
                    <>
                      {/* Darken what will be cut off. */}
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-slate-900/60"
                        style={{
                          clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pct(box.x)} ${pct(box.y)}, ${pct(box.x)} ${pct(box.y + box.height)}, ${pct(box.x + box.width)} ${pct(box.y + box.height)}, ${pct(box.x + box.width)} ${pct(box.y)}, ${pct(box.x)} ${pct(box.y)})`,
                        }}
                      />
                      <div
                        role="group"
                        aria-label="Crop box"
                        className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                        style={{ left: pct(box.x), top: pct(box.y), width: pct(box.width), height: pct(box.height) }}
                        onPointerDown={(e) => startCrop(e, base, 'move')}
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
                            onPointerDown={(e) => startCrop(e, base, h)}
                            className={cx('absolute rounded-sm border border-slate-700 bg-white shadow', className, cursor)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div
                  aria-hidden
                  className={cx(
                    'pointer-events-none absolute inset-0 ring-inset',
                    selected && !cropping && 'ring-2 ring-brand-500',
                    cropping && 'ring-2 ring-amber-500',
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
                        title={cropping ? 'Done cropping' : 'Crop: drag the edges of the box over the photo'}
                        aria-pressed={cropping}
                        onClick={(e) => {
                          e.stopPropagation()
                          setCropMode(cropping ? null : p.id)
                        }}
                        className={cx('rounded p-1 hover:bg-white/20', cropping && 'bg-amber-500 text-slate-900 hover:bg-amber-400')}
                      >
                        {cropping ? <Check className="h-3.5 w-3.5" /> : <CropIcon className="h-3.5 w-3.5" />}
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
                    {!cropping && (
                      <div
                        role="slider"
                        aria-label="Resize photo"
                        aria-valuenow={Math.round(p.width * 100)}
                        onPointerDown={(e) => startDrag(e, base, 'resize')}
                        className="absolute bottom-0 right-0 z-30 h-5 w-5 cursor-nwse-resize rounded-tl-md border-l-2 border-t-2 border-white bg-brand-500 shadow"
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">
        {cropMode
          ? 'Drag the edges or corners of the box to choose what to keep, or drag the box to move it. Press the tick when done.'
          : 'Drag a photo to move it or drop it on another to swap. Pull the corner handle to resize. Use the crop button to trim a photo.'}
      </p>
    </div>
  )
}
