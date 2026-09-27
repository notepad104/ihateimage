import { Eraser, PenLine, Type, Undo2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { INK_COLORS, knockOutWhite, SIGNATURE_FONTS, trimTransparent } from '../lib/fill'
import { Button, Field, Notice, Segmented, Select, TextInput, Toggle, cx } from './ui'

export interface SignatureBlob {
  blob: Blob
  width: number
  height: number
}

type Mode = 'draw' | 'type' | 'upload'
type Stroke = { color: string; width: number; points: [number, number][] }

const PAD_W = 720
const PAD_H = 240

function strokePath(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, s: Stroke, scale = 1) {
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.width * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const p = s.points
  ctx.beginPath()
  if (p.length === 1) {
    ctx.arc(p[0][0] * scale, p[0][1] * scale, (s.width * scale) / 2, 0, Math.PI * 2)
    ctx.fillStyle = s.color
    ctx.fill()
    return
  }
  ctx.moveTo(p[0][0] * scale, p[0][1] * scale)
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2
    const my = (p[i][1] + p[i + 1][1]) / 2
    ctx.quadraticCurveTo(p[i][0] * scale, p[i][1] * scale, mx * scale, my * scale)
  }
  const last = p[p.length - 1]
  ctx.lineTo(last[0] * scale, last[1] * scale)
  ctx.stroke()
}

async function toBlob(canvas: OffscreenCanvas): Promise<SignatureBlob | null> {
  const trimmed = trimTransparent(canvas)
  if (!trimmed) return null
  return { blob: await trimmed.convertToBlob({ type: 'image/png' }), width: trimmed.width, height: trimmed.height }
}

export function SignatureDialog({ onDone, onCancel }: { onDone: (sig: SignatureBlob) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>('draw')
  const [color, setColor] = useState(INK_COLORS[0])
  const [pen, setPen] = useState(3)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [name, setName] = useState('')
  const [font, setFont] = useState(SIGNATURE_FONTS[0].value)
  const [upload, setUpload] = useState<{ file: File; url: string } | null>(null)
  const [knockOut, setKnockOut] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Stroke | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  useEffect(
    () => () => {
      if (upload) URL.revokeObjectURL(upload.url)
    },
    [upload],
  )

  // Redraw the pad whenever the strokes change.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    for (const s of strokes) strokePath(ctx, s)
    if (drawing.current) strokePath(ctx, drawing.current)
  }, [strokes])

  const padPoint = (e: PointerEvent): [number, number] => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * PAD_W, ((e.clientY - r.top) / r.height) * PAD_H]
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    drawing.current = { color, width: pen, points: [padPoint(e)] }
  }
  const onMove = (e: PointerEvent) => {
    const s = drawing.current
    if (!s) return
    const p = padPoint(e)
    const last = s.points[s.points.length - 1]
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return
    s.points.push(p)
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.clearRect(0, 0, PAD_W, PAD_H)
    for (const k of strokes) strokePath(ctx, k)
    strokePath(ctx, s)
  }
  const onUp = () => {
    const s = drawing.current
    if (!s) return
    drawing.current = null
    setStrokes((prev) => [...prev, s])
  }

  const finish = async () => {
    setError(null)
    setBusy(true)
    try {
      let out: SignatureBlob | null = null
      if (mode === 'draw') {
        if (!strokes.length) throw new Error('Draw your signature first.')
        const scale = 2
        const c = new OffscreenCanvas(PAD_W * scale, PAD_H * scale)
        const ctx = c.getContext('2d')!
        for (const s of strokes) strokePath(ctx, s, scale)
        out = await toBlob(c)
      } else if (mode === 'type') {
        if (!name.trim()) throw new Error('Type your name first.')
        const px = 160
        const probe = new OffscreenCanvas(1, 1).getContext('2d')!
        probe.font = `${px}px ${font}`
        const w = Math.ceil(probe.measureText(name.trim()).width) + px
        const c = new OffscreenCanvas(Math.max(w, 10), px * 2)
        const ctx = c.getContext('2d')!
        ctx.font = `${px}px ${font}`
        ctx.fillStyle = color
        ctx.textBaseline = 'middle'
        ctx.fillText(name.trim(), px / 2, px)
        out = await toBlob(c)
      } else {
        if (!upload) throw new Error('Choose an image of your signature first.')
        const bmp = await createImageBitmap(upload.file, { imageOrientation: 'from-image' })
        const long = Math.max(bmp.width, bmp.height)
        const scale = Math.min(1, 1600 / long)
        const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)))
        c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
        bmp.close()
        out = await toBlob(knockOut ? knockOutWhite(c) : c)
      }
      if (!out) throw new Error('The signature came out empty. Try again with darker ink.')
      onDone(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a signature"
        className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Add a signature</h2>
          <Segmented
            value={mode}
            onChange={setMode}
            fill={false}
            size="sm"
            options={[
              { value: 'draw', label: <span className="inline-flex items-center gap-1.5"><PenLine className="h-3.5 w-3.5" /> Draw</span> },
              { value: 'type', label: <span className="inline-flex items-center gap-1.5"><Type className="h-3.5 w-3.5" /> Type</span> },
              { value: 'upload', label: <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload</span> },
            ]}
          />
        </div>

        {error && (
          <div className="mb-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        {mode === 'draw' && (
          <div className="space-y-3">
            <canvas
              ref={canvasRef}
              width={PAD_W}
              height={PAD_H}
              className="w-full touch-none rounded-xl border border-slate-300 bg-[linear-gradient(to_top,#e2e8f0_1px,transparent_1px)] bg-[length:100%_25%] bg-white"
              style={{ aspectRatio: `${PAD_W} / ${PAD_H}`, cursor: 'crosshair' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              aria-label="Signature pad"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <InkSwatches value={color} onChange={setColor} />
                <Select value={pen} onChange={(e) => setPen(Number(e.target.value))} className="!w-auto">
                  <option value={2}>Fine pen</option>
                  <option value={3}>Medium pen</option>
                  <option value={5}>Thick pen</option>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
                  <Undo2 className="h-4 w-4" /> Undo
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStrokes([])} disabled={!strokes.length}>
                  <Eraser className="h-4 w-4" /> Clear
                </Button>
              </div>
            </div>
            <p className="text-xs text-slate-500">Sign with your mouse, finger or pen. A trackpad works too, just go slowly.</p>
          </div>
        )}

        {mode === 'type' && (
          <div className="space-y-3">
            <Field label="Your name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoFocus />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Style">
                <Select value={font} onChange={(e) => setFont(e.target.value)}>
                  {SIGNATURE_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ink">
                <InkSwatches value={color} onChange={setColor} />
              </Field>
            </div>
            <div
              className="flex h-28 items-center justify-center overflow-hidden rounded-xl border border-slate-300 bg-white px-4"
              style={{ fontFamily: font, color, fontSize: 48, fontStyle: font.startsWith('Georgia') ? 'italic' : undefined }}
            >
              {name.trim() || <span className="text-base text-slate-400" style={{ fontFamily: 'inherit' }}>Preview</span>}
            </div>
          </div>
        )}

        {mode === 'upload' && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-slate-400">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setUpload((prev) => {
                    if (prev) URL.revokeObjectURL(prev.url)
                    return { file: f, url: URL.createObjectURL(f) }
                  })
                }}
              />
              {upload ? (
                <img src={upload.url} alt="Your signature" className="max-h-32 max-w-full object-contain" />
              ) : (
                <>
                  <Upload className="h-6 w-6 text-slate-400" />
                  <span className="text-sm text-slate-600">Choose a photo or scan of your signature</span>
                </>
              )}
            </label>
            <Toggle
              checked={knockOut}
              onChange={setKnockOut}
              label="Make the paper transparent"
              hint="Keeps the ink and removes the white or light background so the signature sits cleanly on the form."
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void finish()} disabled={busy}>
            Use this signature
          </Button>
        </div>
      </div>
    </div>
  )
}

export function InkSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Ink colour">
      {INK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx(
            'h-7 w-7 rounded-full border-2 transition-transform',
            value === c ? 'scale-110 border-brand-500' : 'border-white shadow ring-1 ring-slate-300',
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}
