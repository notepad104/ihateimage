import { Crop as CropIcon, Move, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clampPlacement, DEFAULT_CROP, MAX_ZOOM, photoView, type Crop, type Placement, type SheetSpec } from '../lib/collage'
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

type Drag =
  | { kind: 'move'; id: string; startX: number; startY: number; origin: Placement; over: string | null }
  | { kind: 'resize'; id: string; startX: number; startY: number; origin: Placement }
  | { kind: 'pan'; id: string; startX: number; startY: number; origin: Crop; srcScale: number }

const NUDGE = 0.01
/** Dropping a photo on another swaps them only if it was carried mostly onto it. */
const SWAP_MIN_OVERLAP = 0.5

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / (a.width * a.height)
}

/**
 * The sheet as it will be exported, drawn with positioned <img> elements so
 * dragging stays cheap. Drag a photo to move it (drop it on another to
 * swap), pull the corner handle to resize, or switch a photo to crop mode
 * and drag the picture inside its frame.
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

  const startDrag = (e: ReactPointerEvent, p: Placement, kind: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    onSelect(p.id)
    const start = toSheet(e.clientX, e.clientY)
    if (kind === 'move' && cropMode === p.id) {
      const file = byId.get(p.id)
      if (!file) return
      // Preview pixels per source pixel for this photo's current view.
      const cellPx = { x: 0, y: 0, width: p.width * sheetWidth * k, height: p.height * sheetHeight * k }
      const { dest, src } = photoView(file.width, file.height, cellPx, spec.fit, crops[p.id] ?? DEFAULT_CROP)
      setDrag({ kind: 'pan', id: p.id, startX: e.clientX, startY: e.clientY, origin: crops[p.id] ?? DEFAULT_CROP, srcScale: dest.width / src.width })
      return
    }
    if (kind === 'resize') setDrag({ kind, id: p.id, startX: start.x, startY: start.y, origin: p })
    else setDrag({ kind: 'move', id: p.id, startX: start.x, startY: start.y, origin: p, over: null })
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'pan') {
      const file = byId.get(d.id)
      if (!file) return
      const dx = (e.clientX - d.startX) / d.srcScale / file.width
      const dy = (e.clientY - d.startY) / d.srcScale / file.height
      const crop = { ...d.origin, cx: Math.min(1, Math.max(0, d.origin.cx - dx)), cy: Math.min(1, Math.max(0, d.origin.cy - dy)) }
      setLiveCrop({ id: d.id, crop })
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
    if (d.kind === 'pan') {
      if (liveCrop) onCrop(d.id, liveCrop.crop)
    } else if (d.kind === 'move' && d.over) {
      onSwap(d.id, d.over)
    } else if (live) {
      onPlace(live)
    }
    setDrag(null)
    setLive(null)
    setLiveCrop(null)
  }

  // Arrow keys nudge the selected photo; in crop mode they pan the picture.
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
        const c = crops[selectedId] ?? DEFAULT_CROP
        onCrop(selectedId, { ...c, cx: Math.min(1, Math.max(0, c.cx + dir[0] * step)), cy: Math.min(1, Math.max(0, c.cy + dir[1] * step)) })
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
          onWheel={(e) => {
            // Wheel over a photo in crop mode zooms the picture inside its frame.
            if (!cropMode) return
            e.preventDefault()
            const c = crops[cropMode] ?? DEFAULT_CROP
            const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
            onCrop(cropMode, { ...c, zoom })
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
            // Frame and drawn picture in preview pixels, so radius and crop are exact.
            const cellPx = { x: 0, y: 0, width: p.width * sheetWidth * k, height: p.height * sheetHeight * k }
            const { dest, src } = photoView(file.width, file.height, cellPx, spec.fit, crop)
            const s = dest.width / src.width
            const radiusPx = spec.radius * Math.min(cellPx.width, cellPx.height)
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
                  cropping ? 'cursor-move' : 'cursor-grab',
                  dragging && 'z-20 opacity-95',
                  dragging && !cropping && 'cursor-grabbing',
                  isTarget && 'z-10',
                )}
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: `${p.width * 100}%`,
                  height: `${p.height * 100}%`,
                }}
              >
                <div
                  className="absolute overflow-hidden"
                  style={{ left: dest.x, top: dest.y, width: dest.width, height: dest.height, borderRadius: radiusPx }}
                >
                  <img
                    src={file.url}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute max-w-none"
                    style={{ left: -src.x * s, top: -src.y * s, width: file.width * s, height: file.height * s }}
                  />
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
                        title={cropping ? 'Move the frame' : 'Crop: drag the picture inside its frame'}
                        aria-pressed={cropping}
                        onClick={(e) => {
                          e.stopPropagation()
                          // Cropping means filling the frame, so show that straight away.
                          if (!cropping && !crop) onCrop(p.id, DEFAULT_CROP)
                          setCropMode(cropping ? null : p.id)
                        }}
                        className={cx('rounded p-1 hover:bg-white/20', cropping && 'bg-amber-500 text-slate-900 hover:bg-amber-400')}
                      >
                        {cropping ? <Move className="h-3.5 w-3.5" /> : <CropIcon className="h-3.5 w-3.5" />}
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
          ? 'Drag the picture to choose what shows; scroll or use the zoom slider to magnify. Arrow keys pan.'
          : 'Drag a photo to move it or drop it on another to swap. Pull the corner handle to resize. Use the crop button to choose what shows inside the frame.'}
      </p>
    </div>
  )
}
