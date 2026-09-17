import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export interface Stroke {
  mode: 'paint' | 'erase'
  /** Diameter in image pixels */
  size: number
  /** Points in image pixel coordinates */
  points: [number, number][]
}

export interface MaskEditorHandle {
  /** width*height bytes, 1 where painted. null when nothing is painted. */
  getMask(): Uint8Array | null
}

interface Props {
  src: { url: string; width: number; height: number }
  /** Shown instead of `src` while true (before/after) */
  compareUrl?: string | null
  strokes: Stroke[]
  onStroke: (stroke: Stroke) => void
  brushSize: number
  mode: 'paint' | 'erase'
  disabled?: boolean
  maxHeight?: number
}

const MASK_COLOR = '#ff2d55'

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, fromIndex = 0) {
  ctx.save()
  ctx.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = MASK_COLOR
  ctx.fillStyle = MASK_COLOR
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = s.size
  if (s.points.length === 1) {
    const [x, y] = s.points[0]
    ctx.beginPath()
    ctx.arc(x, y, s.size / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    const start = Math.max(0, fromIndex - 1)
    ctx.moveTo(s.points[start][0], s.points[start][1])
    for (let i = start + 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1])
    ctx.stroke()
  }
  ctx.restore()
}

export const MaskEditor = forwardRef<MaskEditorHandle, Props>(function MaskEditor(
  { src, compareUrl, strokes, onStroke, brushSize, mode, disabled, maxHeight = 560 },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const compareImgRef = useRef<HTMLImageElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [imgReady, setImgReady] = useState(0)
  const current = useRef<Stroke | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const scale = containerWidth > 0 ? Math.min(containerWidth / src.width, maxHeight / src.height) : 0
  const dispW = Math.max(1, Math.round(src.width * scale))
  const dispH = Math.max(1, Math.round(src.height * scale))

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Load the source image (and the compare image, if any).
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setImgReady((v) => v + 1)
    }
    img.src = src.url
    return () => {
      img.onload = null
    }
  }, [src.url])

  useEffect(() => {
    if (!compareUrl) {
      compareImgRef.current = null
      return
    }
    const img = new Image()
    img.onload = () => {
      compareImgRef.current = img
      setImgReady((v) => v + 1)
    }
    img.src = compareUrl
  }, [compareUrl])

  // Mask canvas lives at full image resolution.
  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = src.width
    c.height = src.height
    maskRef.current = c
  }, [src.width, src.height])

  // Rebuild mask from committed strokes whenever they change.
  useEffect(() => {
    const c = maskRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    for (const s of strokes) paintStroke(ctx, s)
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, src.width, src.height])

  const redraw = useCallback(() => {
    const canvas = displayRef.current
    const mask = maskRef.current
    if (!canvas || !mask) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = dispW
    canvas.height = dispH
    const showCompare = compareUrl && compareImgRef.current
    const img = showCompare ? compareImgRef.current : imgRef.current
    ctx.clearRect(0, 0, dispW, dispH)
    if (img) ctx.drawImage(img, 0, 0, dispW, dispH)
    if (!showCompare) {
      ctx.globalAlpha = 0.55
      ctx.drawImage(mask, 0, 0, dispW, dispH)
      ctx.globalAlpha = 1
    }
  }, [dispW, dispH, compareUrl])

  useEffect(() => {
    redraw()
  }, [redraw, imgReady])

  useImperativeHandle(ref, () => ({
    getMask() {
      const c = maskRef.current
      if (!c) return null
      const ctx = c.getContext('2d')
      if (!ctx) return null
      const { data } = ctx.getImageData(0, 0, c.width, c.height)
      const out = new Uint8Array(c.width * c.height)
      let any = false
      for (let i = 0, j = 3; i < out.length; i++, j += 4) {
        if (data[j] > 64) {
          out[i] = 1
          any = true
        }
      }
      return any ? out : null
    },
  }))

  const toImage = (e: ReactPointerEvent): [number, number] => {
    const rect = displayRef.current!.getBoundingClientRect()
    return [((e.clientX - rect.left) / rect.width) * src.width, ((e.clientY - rect.top) / rect.height) * src.height]
  }

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toImage(e)
    current.current = { mode, size: brushSize, points: [p] }
    const ctx = maskRef.current?.getContext('2d')
    if (ctx) paintStroke(ctx, current.current)
    redraw()
  }

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    const s = current.current
    if (!s) return
    s.points.push(toImage(e))
    const ctx = maskRef.current?.getContext('2d')
    if (ctx) paintStroke(ctx, s, s.points.length - 1)
    redraw()
  }

  const onUp = () => {
    const s = current.current
    current.current = null
    if (s) onStroke(s)
  }

  const cursorSize = brushSize * scale

  return (
    <div ref={containerRef} className="w-full select-none">
      <div className="checker relative mx-auto overflow-hidden rounded-xl" style={{ width: dispW || '100%', height: dispH || 240 }}>
        <canvas
          ref={displayRef}
          className="block touch-none"
          style={{ width: dispW, height: dispH, cursor: disabled ? 'progress' : 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => {
            setCursor(null)
            onUp()
          }}
        />
        {cursor && !disabled && (
          <div
            className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{
              left: cursor.x - cursorSize / 2,
              top: cursor.y - cursorSize / 2,
              width: cursorSize,
              height: cursorSize,
              background: mode === 'paint' ? 'rgba(255,45,85,0.25)' : 'rgba(255,255,255,0.25)',
            }}
          />
        )}
      </div>
    </div>
  )
})
