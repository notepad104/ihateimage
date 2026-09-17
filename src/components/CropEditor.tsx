import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clamp } from '../lib/geometry'
import type { LoadedFile, Rect } from '../lib/types'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Drag =
  | { kind: 'move'; startX: number; startY: number; start: Rect }
  | { kind: 'resize'; handle: Handle; startX: number; startY: number; start: Rect }

const MIN = 16

function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  bounds: { width: number; height: number },
): Rect {
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  const hasE = handle.includes('e')
  const hasW = handle.includes('w')
  const right = start.x + start.width
  const bottom = start.y + start.height

  let nx = start.x
  let ny = start.y
  let nr = right
  let nb = bottom
  if (hasW) nx = clamp(start.x + dx, 0, right - MIN)
  if (hasE) nr = clamp(right + dx, start.x + MIN, bounds.width)
  if (hasN) ny = clamp(start.y + dy, 0, bottom - MIN)
  if (hasS) nb = clamp(bottom + dy, start.y + MIN, bounds.height)

  if (!ratio) return { x: nx, y: ny, width: nr - nx, height: nb - ny }

  let w = nr - nx
  let h = nb - ny
  const horizontal = hasE || hasW
  const vertical = hasN || hasS
  if (horizontal && vertical) {
    const dw = Math.abs(w - start.width) / start.width
    const dh = Math.abs(h - start.height) / start.height
    if (dw >= dh) h = w / ratio
    else w = h * ratio
  } else if (horizontal) {
    h = w / ratio
  } else {
    w = h * ratio
  }

  // Anchor is the opposite edge/corner (or the center line for single-edge drags).
  const ax = hasW ? right : hasE ? start.x : start.x + start.width / 2
  const ay = hasN ? bottom : hasS ? start.y : start.y + start.height / 2
  const maxW = hasW ? ax : hasE ? bounds.width - ax : 2 * Math.min(ax, bounds.width - ax)
  const maxH = hasN ? ay : hasS ? bounds.height - ay : 2 * Math.min(ay, bounds.height - ay)
  const s = Math.min(1, maxW / w, maxH / h)
  w = Math.max(MIN, w * s)
  h = w / ratio
  if (h < MIN) {
    h = MIN
    w = h * ratio
  }
  const x = hasW ? ax - w : hasE ? ax : ax - w / 2
  const y = hasN ? ay - h : hasS ? ay : ay - h / 2
  return { x, y, width: w, height: h }
}

function roundRect(r: Rect, bounds: { width: number; height: number }): Rect {
  const x = clamp(Math.round(r.x), 0, bounds.width - 1)
  const y = clamp(Math.round(r.y), 0, bounds.height - 1)
  const width = clamp(Math.round(r.width), 1, bounds.width - x)
  const height = clamp(Math.round(r.height), 1, bounds.height - y)
  return { x, y, width, height }
}

export function CropEditor({
  file,
  rect,
  ratio,
  onChange,
  maxHeight = 520,
}: {
  file: LoadedFile
  rect: Rect
  /** Locked aspect ratio (w/h) or null for free-form */
  ratio: number | null
  onChange: (rect: Rect) => void
  maxHeight?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [live, setLive] = useState<Rect>(rect)

  useEffect(() => {
    if (!drag) setLive(rect)
  }, [rect, drag])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const scale = containerWidth > 0 ? Math.min(containerWidth / file.width, maxHeight / file.height) : 0
  const dispW = file.width * scale
  const dispH = file.height * scale
  const bounds = { width: file.width, height: file.height }

  const begin = (e: ReactPointerEvent, d: { kind: 'move' } | { kind: 'resize'; handle: Handle }) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const base = { startX: e.clientX, startY: e.clientY, start: live }
    setDrag(d.kind === 'move' ? { kind: 'move', ...base } : { kind: 'resize', handle: d.handle, ...base })
  }

  const onMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!drag || scale === 0) return
      const dx = (e.clientX - drag.startX) / scale
      const dy = (e.clientY - drag.startY) / scale
      if (drag.kind === 'move') {
        const x = clamp(drag.start.x + dx, 0, bounds.width - drag.start.width)
        const y = clamp(drag.start.y + dy, 0, bounds.height - drag.start.height)
        setLive({ ...drag.start, x, y })
      } else {
        setLive(resizeRect(drag.start, drag.handle, dx, dy, ratio, bounds))
      }
    },
    [drag, scale, ratio, bounds.width, bounds.height],
  )

  const end = () => {
    if (!drag) return
    setDrag(null)
    onChange(roundRect(live, bounds))
  }

  const box = {
    left: live.x * scale,
    top: live.y * scale,
    width: live.width * scale,
    height: live.height * scale,
  }

  const handles: { h: Handle; cls: string; cursor: string }[] = [
    { h: 'nw', cls: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
    { h: 'ne', cls: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
    { h: 'sw', cls: '-left-1.5 -bottom-1.5', cursor: 'nesw-resize' },
    { h: 'se', cls: '-right-1.5 -bottom-1.5', cursor: 'nwse-resize' },
    { h: 'n', cls: 'left-1/2 -top-1.5 -translate-x-1/2', cursor: 'ns-resize' },
    { h: 's', cls: 'left-1/2 -bottom-1.5 -translate-x-1/2', cursor: 'ns-resize' },
    { h: 'w', cls: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'ew-resize' },
    { h: 'e', cls: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'ew-resize' },
  ]

  const shown = roundRect(live, bounds)

  return (
    <div ref={containerRef} className="w-full select-none">
      <div
        className="checker relative mx-auto overflow-hidden rounded-xl touch-none"
        style={{ width: dispW || '100%', height: dispH || 200 }}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {scale > 0 && (
          <>
            <img
              src={file.url}
              alt={file.name}
              draggable={false}
              className="absolute inset-0 h-full w-full"
              style={{ width: dispW, height: dispH }}
            />
            <div
              role="presentation"
              className="absolute cursor-move border border-white/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]"
              style={box}
              onPointerDown={(e) => begin(e, { kind: 'move' })}
            >
              {/* rule-of-thirds guides */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
              </div>
              {handles.map(({ h, cls, cursor }) => (
                <div
                  key={h}
                  role="presentation"
                  onPointerDown={(e) => begin(e, { kind: 'resize', handle: h })}
                  className={`absolute h-3 w-3 rounded-sm border border-slate-700 bg-white ${cls}`}
                  style={{ cursor }}
                />
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/80 px-2 py-1 text-xs font-medium text-white tabular-nums">
              {shown.width} × {shown.height}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
