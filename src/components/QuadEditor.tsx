import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clamp } from '../lib/geometry'
import type { LoadedFile, Point, Quad } from '../lib/types'

const LOUPE = 132
const LOUPE_ZOOM = 2.5

/**
 * Photo with a draggable four-corner outline. Corners are in source pixels;
 * `onChange` fires when a drag ends. A magnifier follows the active corner so
 * it can be placed exactly on the paper edge.
 */
export function QuadEditor({
  file,
  quad,
  onChange,
  disabled = false,
  badge,
  maxHeight = 520,
}: {
  file: LoadedFile
  quad: Quad
  onChange: (quad: Quad) => void
  disabled?: boolean
  /** Small status pill drawn in the top-left corner */
  badge?: ReactNode
  maxHeight?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [live, setLive] = useState<Quad>(quad)
  const [drag, setDrag] = useState<{ index: number; dx: number; dy: number } | null>(null)

  useEffect(() => {
    if (!drag) setLive(quad)
  }, [quad, drag])

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

  const toImage = (e: ReactPointerEvent): Point => {
    const rect = boxRef.current!.getBoundingClientRect()
    return {
      x: clamp((e.clientX - rect.left) / scale, 0, file.width),
      y: clamp((e.clientY - rect.top) / scale, 0, file.height),
    }
  }

  const begin = (e: ReactPointerEvent, index: number) => {
    if (disabled || scale === 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toImage(e)
    setDrag({ index, dx: live[index].x - p.x, dy: live[index].y - p.y })
  }

  const move = (e: ReactPointerEvent) => {
    if (!drag || scale === 0) return
    const p = toImage(e)
    const next: Quad = [...live] as Quad
    next[drag.index] = {
      x: clamp(p.x + drag.dx, 0, file.width),
      y: clamp(p.y + drag.dy, 0, file.height),
    }
    setLive(next)
  }

  const end = () => {
    if (!drag) return
    setDrag(null)
    onChange(live.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) as Quad)
  }

  // Magnifier: redraw around the active corner on every move.
  useEffect(() => {
    if (!drag) return
    const canvas = loupeRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete || scale === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const p = live[drag.index]
    const region = LOUPE / (scale * LOUPE_ZOOM)
    // Natural image coordinates; the <img> is already orientation-corrected.
    const nx = img.naturalWidth / file.width
    const ny = img.naturalHeight / file.height
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, LOUPE, LOUPE)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(img, (p.x - region / 2) * nx, (p.y - region / 2) * ny, region * nx, region * ny, 0, 0, LOUPE, LOUPE)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LOUPE / 2, 0)
    ctx.lineTo(LOUPE / 2, LOUPE)
    ctx.moveTo(0, LOUPE / 2)
    ctx.lineTo(LOUPE, LOUPE / 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(99,102,241,0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(LOUPE / 2, LOUPE / 2, 6, 0, Math.PI * 2)
    ctx.stroke()
  }, [drag, live, scale, file.width, file.height])

  const disp = live.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  const polyPoints = disp.map((p) => `${p.x},${p.y}`).join(' ')
  const polyPath = disp.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') + ' Z'

  let loupeStyle: { left: number; top: number } | null = null
  if (drag) {
    const h = disp[drag.index]
    const left = clamp(h.x - LOUPE / 2, 0, Math.max(0, dispW - LOUPE))
    const above = h.y - LOUPE / 2 - 96
    const top = above >= 0 ? above : Math.min(dispH - LOUPE, h.y + 40)
    loupeStyle = { left, top: Math.max(0, top) }
  }

  const labels = ['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner']

  return (
    <div ref={containerRef} className="w-full select-none">
      <div
        ref={boxRef}
        className="relative mx-auto overflow-visible rounded-xl bg-slate-100 touch-none"
        style={{ width: dispW || '100%', height: dispH || 200 }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {scale > 0 && (
          <>
            <img
              ref={imgRef}
              src={file.url}
              alt={file.name}
              draggable={false}
              className="absolute inset-0 rounded-xl"
              style={{ width: dispW, height: dispH }}
            />
            <svg
              className="absolute inset-0 overflow-visible"
              width={dispW}
              height={dispH}
              viewBox={`0 0 ${dispW} ${dispH}`}
              aria-hidden
            >
              <path d={`M0 0H${dispW}V${dispH}H0Z ${polyPath}`} fill="rgba(15,23,42,0.5)" fillRule="evenodd" />
              <polygon points={polyPoints} fill="none" stroke="#fff" strokeWidth={2} />
              <polygon points={polyPoints} fill="none" stroke="rgba(99,102,241,0.9)" strokeWidth={1} strokeDasharray="4 4" />
              {disp.map((p, i) => (
                <g
                  key={i}
                  role="slider"
                  aria-label={labels[i]}
                  aria-valuetext={`${Math.round(live[i].x)}, ${Math.round(live[i].y)}`}
                  tabIndex={disabled ? -1 : 0}
                  onPointerDown={(e) => begin(e, i)}
                  onKeyDown={(e) => {
                    if (disabled) return
                    const step = e.shiftKey ? 10 : 1
                    const d: Record<string, [number, number]> = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    }
                    const delta = d[e.key]
                    if (!delta) return
                    e.preventDefault()
                    const next: Quad = [...quad] as Quad
                    next[i] = { x: clamp(quad[i].x + delta[0], 0, file.width), y: clamp(quad[i].y + delta[1], 0, file.height) }
                    onChange(next)
                  }}
                  className={disabled ? 'cursor-not-allowed' : 'cursor-move outline-none focus-visible:[&>circle:last-child]:stroke-brand-700'}
                >
                  <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={9} fill="#fff" stroke="rgb(99,102,241)" strokeWidth={3} />
                </g>
              ))}
            </svg>
            {badge && <div className="pointer-events-none absolute left-2 top-2">{badge}</div>}
            {drag && loupeStyle && (
              <div
                className="pointer-events-none absolute z-10 overflow-hidden rounded-full border-2 border-white shadow-lg"
                style={{ left: loupeStyle.left, top: loupeStyle.top, width: LOUPE, height: LOUPE }}
              >
                <canvas ref={loupeRef} width={LOUPE} height={LOUPE} className="block" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
