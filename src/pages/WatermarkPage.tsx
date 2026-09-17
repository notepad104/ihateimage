import { ImagePlus, Move, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileGrid } from '../components/FileGrid'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { LivePreview } from '../components/LivePreview'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, Notice, SectionTitle, Segmented, Select, Slider, Toggle, cx } from '../components/ui'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { Gravity, LoadedFile, Op, ProcessResult, WatermarkSpec } from '../lib/types'
import { anyJpegWithAlpha, anyLossy, flattenOps, outputFormatFor } from './shared'

const tool = toolById('watermark')

const FONTS: { label: string; value: string }[] = [
  { label: 'Sans (Helvetica / Arial)', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Serif (Georgia)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono (Menlo / Courier)', value: 'Menlo, Consolas, "Courier New", monospace' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Rounded (Verdana)', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Script (Brush / cursive)', value: '"Brush Script MT", "Snell Roundhand", cursive' },
]

const GRID: { g: Gravity; x: number; y: number }[] = [
  { g: 'top-left', x: 0, y: 0 },
  { g: 'top', x: 0.5, y: 0 },
  { g: 'top-right', x: 1, y: 0 },
  { g: 'left', x: 0, y: 0.5 },
  { g: 'center', x: 0.5, y: 0.5 },
  { g: 'right', x: 1, y: 0.5 },
  { g: 'bottom-left', x: 0, y: 1 },
  { g: 'bottom', x: 0.5, y: 1 },
  { g: 'bottom-right', x: 1, y: 1 },
]

const DEFAULT_SPEC: WatermarkSpec = {
  kind: 'text',
  text: '© ihateimage',
  font: FONTS[0].value,
  bold: true,
  color: '#ffffff',
  size: 5,
  opacity: 0.7,
  rotation: 0,
  x: 1,
  y: 1,
  tile: false,
  tileGap: 1,
  shadow: true,
}

export function WatermarkPage() {
  const files = useImageFiles()
  const support = useEncodeSupport()
  const [spec, setSpec] = useState<WatermarkSpec>(DEFAULT_SPEC)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(92)
  const [bg, setBg] = useState('#ffffff')
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (logoUrl) URL.revokeObjectURL(logoUrl)
  }, [logoUrl])

  const set = <K extends keyof WatermarkSpec>(key: K, value: WatermarkSpec[K]) => setSpec((s) => ({ ...s, [key]: value }))

  const ops = useMemo<Op[]>(() => {
    if (spec.kind === 'text' && !spec.text.trim()) return []
    if (spec.kind === 'image' && !spec.image) return []
    return [{ type: 'watermark', spec }]
  }, [spec])

  const pickLogo = (file: File | undefined) => {
    if (!file) return
    if (logoUrl) URL.revokeObjectURL(logoUrl)
    setLogoUrl(URL.createObjectURL(file))
    setSpec((s) => ({ ...s, kind: 'image', image: file, size: s.kind === 'image' ? s.size : 22 }))
  }

  const lossy = anyLossy(files.files, format, support)
  const showBg = anyJpegWithAlpha(files.files, format, support)
  const selected = files.selected

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const all: Op[] = [...ops, ...flattenOps(file, out, bg)]
    const res = await processImage({ source: file.file, ops: all, encode: { format: out, quality: quality / 100 } })
    return { blob: res.blob, name: withExt(file.name, out), width: res.width, height: res.height }
  }

  const activeGrid = GRID.find((p) => Math.abs(p.x - spec.x) < 0.02 && Math.abs(p.y - spec.y) < 0.02)?.g

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Add watermark to"
      process={process}
      canProcess={ops.length > 0}
      preview={
        selected && (
          <div className="space-y-3">
            <LivePreview
              file={selected}
              ops={ops}
              dragging={dragging}
              onDrag={
                spec.tile
                  ? undefined
                  : (x, y, phase) => {
                      if (phase === 'start') setDragging(true)
                      if (phase === 'end') setDragging(false)
                      setSpec((s) => ({ ...s, x, y }))
                    }
              }
              overlay={
                !spec.tile && (
                  <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-white">
                    <Move className="h-3.5 w-3.5" /> Drag anywhere to place the watermark
                  </div>
                )
              }
            />
            {files.files.length > 1 && (
              <FileGrid files={files.files} selectedId={files.selectedId} onSelect={files.select} onRemove={files.remove} />
            )}
          </div>
        )
      }
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>Watermark</SectionTitle>
            <Segmented
              value={spec.kind}
              onChange={(v) => set('kind', v)}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'image', label: 'Logo' },
              ]}
            />
            {spec.kind === 'text' ? (
              <>
                <Field label="Text" hint="Use a new line for a second row.">
                  <textarea
                    value={spec.text}
                    onChange={(e) => set('text', e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </Field>
                <Field label="Font">
                  <Select value={spec.font} onChange={(e) => set('font', e.target.value)}>
                    {FONTS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Toggle checked={spec.bold} onChange={(v) => set('bold', v)} label="Bold" />
                  <Toggle checked={spec.shadow} onChange={(v) => set('shadow', v)} label="Shadow" />
                </div>
                <Field label="Color">
                  <ColorInput value={spec.color} onChange={(v) => set('color', v)} />
                </Field>
                <Field label="Size" hint="Relative to the image, so it looks the same on every photo.">
                  <Slider value={spec.size} onChange={(v) => set('size', v)} min={1} max={40} step={0.5} format={(v) => `${v}%`} />
                </Field>
              </>
            ) : (
              <>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    pickLogo(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                {spec.image && logoUrl ? (
                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                    <div className="checker h-12 w-12 shrink-0 overflow-hidden rounded-md">
                      <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
                    </div>
                    <div className="min-w-0 flex-1 text-xs text-slate-600">
                      <p className="truncate font-medium text-slate-800">{(spec.image as File).name ?? 'Logo'}</p>
                      <p>PNG with transparency works best.</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => logoInput.current?.click()}>
                      Change
                    </Button>
                    <button
                      type="button"
                      aria-label="Remove logo"
                      className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      onClick={() => {
                        if (logoUrl) URL.revokeObjectURL(logoUrl)
                        setLogoUrl(null)
                        setSpec((s) => ({ ...s, image: undefined }))
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button variant="secondary" className="w-full" onClick={() => logoInput.current?.click()}>
                    <ImagePlus className="h-4 w-4" /> Choose logo image
                  </Button>
                )}
                <Field label="Width" hint="Percent of the image width.">
                  <Slider value={spec.size} onChange={(v) => set('size', v)} min={2} max={100} step={1} format={(v) => `${v}%`} />
                </Field>
              </>
            )}
            <Field label="Opacity">
              <Slider value={Math.round(spec.opacity * 100)} onChange={(v) => set('opacity', v / 100)} min={5} max={100} format={(v) => `${v}%`} />
            </Field>
            <Field label="Rotation">
              <Slider value={spec.rotation} onChange={(v) => set('rotation', v)} min={-90} max={90} format={(v) => `${v}°`} />
            </Field>
          </div>

          <div className="space-y-3">
            <SectionTitle>Position</SectionTitle>
            <Toggle
              checked={spec.tile}
              onChange={(v) => set('tile', v)}
              label="Repeat across the whole image"
              hint="Hard to crop out. Common for stock previews."
            />
            {spec.tile ? (
              <Field label="Spacing">
                <Slider value={spec.tileGap} onChange={(v) => set('tileGap', v)} min={0} max={4} step={0.1} format={(v) => `${v.toFixed(1)}×`} />
              </Field>
            ) : (
              <div className="flex items-center gap-4">
                <div className="grid shrink-0 grid-cols-3 gap-1">
                  {GRID.map((p) => (
                    <button
                      key={p.g}
                      type="button"
                      aria-label={p.g}
                      title={p.g.replace('-', ' ')}
                      onClick={() => setSpec((s) => ({ ...s, x: p.x, y: p.y }))}
                      className={cx(
                        'h-8 w-8 rounded-md border',
                        activeGrid === p.g ? 'border-brand-500 bg-brand-500' : 'border-slate-300 bg-white hover:bg-slate-100',
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Pick a corner or drag the watermark directly on the preview. The position is kept for every image in
                  the batch.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <SectionTitle>Output</SectionTitle>
            <FormatPicker value={format} onChange={setFormat} support={support} />
            {lossy && (
              <Field label="Quality">
                <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
              </Field>
            )}
            {showBg && (
              <Field label="Background for transparent areas">
                <ColorInput value={bg} onChange={setBg} />
              </Field>
            )}
          </div>
          {ops.length === 0 && <Notice tone="info">{spec.kind === 'text' ? 'Type some text to preview it.' : 'Choose a logo to preview it.'}</Notice>}
        </>
      }
    />
  )
}
