import { X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clampPlacement, containRect, type Placement, type SheetSpec } from '../lib/collage'
import type { LoadedFile } from '../lib/types'
import { cx } from './ui'

export interface CollageEditorProps {
  spec: SheetSpec
  /** Sheet size in pixels; only the ratio matters here. */
  sheetWidth: number
  sheetHeight: number
  images: LoadedFile[]
  placements: Placement[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Grid, row and column layouts: the user dropped photo `a` on photo `b`. */
  onSwap: (a: string, b: string) => void
  /** Freeform: a photo was moved or resized. */
  onPlace: (p: Placement) => void
  onRemove: (id: string) => void
}

type Drag =
  | { kind: 'move'; id: string; startX: number; startY: number; origin: Placement; moved: boolean }
  | { kind: 'resize'; id: string; startX: number; startY: number; origin: Placement }
  | { kind: 'swap'; id: string; startX: number; startY: number; dx: number; dy: number; over: string | null }

const NUDGE = 0.01

/**
 * The sheet as it will be exported, drawn with positioned <img> elements so
 * dragging stays cheap. Grid-style layouts swap photos by dropping one on
 * another; freeform lets each photo move and resize.
 */
export function CollageEditor({
  spec,
  sheetWidth,
  sheetHeight,
  images,
  placements,
  selectedId,
  onSelect,
  onSwap,
  onPlace,
  onRemove,
}: CollageEditorProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const [live, setLive] = useState<Placement | null>(null)
  const [previewW, setPreviewW] = useState(0)
  const free = spec.layout === 'free'

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setPreviewW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** Sheet pixels → preview pixels. */
  const k = previewW > 0 ? previewW / sheetWidth : 0
  const byId = new Map(images.map((f) => [f.id, f]))

  /** Pointer position as a fraction of the sheet. */
  const toSheet = (clientX: number, clientY: number) => {
    const el = sheetRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  const hitTest = (x: number, y: number, except: string): string | null => {
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i]
      if (p.id === except) continue
      if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) return p.id
    }
    return null
  }

  const startDrag = (e: ReactPointerEvent, p: Placement, kind: 'move' | 'resize') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointers cannot be captured; the sheet still receives the moves.
    }
    onSelect(p.id)
    const start = toSheet(e.clientX, e.clientY)
    if (!free) {
      setDrag({ kind: 'swap', id: p.id, startX: start.x, startY: start.y, dx: 0, dy: 0, over: null })
      return
    }
    if (kind === 'resize') setDrag({ kind, id: p.id, startX: start.x, startY: start.y, origin: p })
    else setDrag({ kind: 'move', id: p.id, startX: start.x, startY: start.y, origin: p, moved: false })
  }

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const cur = toSheet(e.clientX, e.clientY)
    const dx = cur.x - d.startX
    const dy = cur.y - d.startY
    if (d.kind === 'swap') {
      setDrag({ ...d, dx, dy, over: hitTest(cur.x, cur.y, d.id) })
      return
    }
    if (d.kind === 'move') {
      const next = clampPlacement({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy })
      setLive(next)
      if (!d.moved && (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002)) setDrag({ ...d, moved: true })
      return
    }
    const next = clampPlacement({ ...d.origin, width: d.origin.width + dx, height: d.origin.height + dy })
    setLive(next)
  }

  const endDrag = () => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'swap') {
      if (d.over) onSwap(d.id, d.over)
    } else if (live) {
      onPlace(live)
    }
    setDrag(null)
    setLive(null)
  }

  // Arrow keys nudge the selected photo in freeform mode.
  useEffect(() => {
    if (!free || !selectedId) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const p = placements.find((x) => x.id === selectedId)
      if (!p) return
      const step = e.shiftKey ? NUDGE * 5 : NUDGE
      let next: Placement | null = null
      if (e.key === 'ArrowLeft') next = { ...p, x: p.x - step }
      if (e.key === 'ArrowRight') next = { ...p, x: p.x + step }
      if (e.key === 'ArrowUp') next = { ...p, y: p.y - step }
      if (e.key === 'ArrowDown') next = { ...p, y: p.y + step }
      if (next) {
        e.preventDefault()
        onPlace(clampPlacement(next))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [free, selectedId, placements, onPlace])

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
            const selected = selectedId === p.id
            const dragging = drag?.id === p.id
            const isTarget = drag?.kind === 'swap' && drag.over === p.id
            const shift = drag?.kind === 'swap' && dragging ? { dx: drag.dx, dy: drag.dy } : null
            // Cell and drawn-photo rectangles in preview pixels, so the radius is exact.
            const cellPx = { x: 0, y: 0, width: p.width * sheetWidth * k, height: p.height * sheetHeight * k }
            const inner = spec.fit === 'contain' ? containRect(file.width, file.height, cellPx) : cellPx
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
                  'absolute cursor-grab outline-none',
                  dragging && 'z-20 cursor-grabbing opacity-90',
                  isTarget && 'z-10',
                )}
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: `${p.width * 100}%`,
                  height: `${p.height * 100}%`,
                  transform: shift ? `translate(${(shift.dx / p.width) * 100}%, ${(shift.dy / p.height) * 100}%)` : undefined,
                }}
              >
                <div
                  className="absolute overflow-hidden"
                  style={{
                    left: inner.x,
                    top: inner.y,
                    width: inner.width,
                    height: inner.height,
                    borderRadius: radiusPx,
                  }}
                >
                  <img src={file.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
                </div>
                <div
                  aria-hidden
                  className={cx(
                    'pointer-events-none absolute inset-0 rounded-[1px] ring-inset transition-shadow',
                    selected && 'ring-2 ring-brand-500',
                    isTarget && 'ring-4 ring-brand-400 bg-brand-500/20',
                  )}
                />
                {selected && !dragging && (
                  <>
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(p.id)
                      }}
                      className="absolute right-1 top-1 z-30 rounded-full bg-slate-900/80 p-1 text-white hover:bg-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    {free && (
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
        {free
          ? 'Drag a photo to move it, pull the corner handle to resize, arrow keys nudge.'
          : 'Drag a photo onto another one to swap them.'}
      </p>
    </div>
  )
}
