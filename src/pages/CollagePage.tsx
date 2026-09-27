import { ArrowLeft, Download, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CollageEditor } from '../components/CollageEditor'
import { DropZone } from '../components/DropZone'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolGuide } from '../components/Seo'
import { useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, Notice, NumberInput, SectionTitle, Segmented, Select, Slider, Toggle, cx } from '../components/ui'
import {
  BORDER_SWATCHES,
  DEFAULT_BORDER,
  DEFAULT_SHEET,
  GRADIENT_PRESETS,
  MAX_BORDER,
  autoPlacements,
  exportSheet,
  sheetSize,
  type Border,
  type Crop,
  type Placement,
  type SheetBackground,
  type SheetSpec,
} from '../lib/collage'
import { downloadAll, downloadBlob } from '../lib/download'
import { formatBytes } from '../lib/format'
import { TOOL_SEO } from '../lib/seo'
import { toolById } from '../lib/tools'
import type { LoadedFile, OutputFormat, ProcessResult } from '../lib/types'

const tool = toolById('collage')

const ASPECTS: { label: string; value: number }[] = [
  { label: 'Auto', value: 0 },
  { label: 'Square 1:1', value: 1 },
  { label: 'Landscape 4:3', value: 4 / 3 },
  { label: 'Landscape 3:2', value: 3 / 2 },
  { label: 'Wide 16:9', value: 16 / 9 },
  { label: 'Portrait 4:5', value: 4 / 5 },
  { label: 'Portrait 3:4', value: 3 / 4 },
  { label: 'Story 9:16', value: 9 / 16 },
  { label: 'A4 portrait', value: 210 / 297 },
  { label: 'A4 landscape', value: 297 / 210 },
]

const WIDTHS = [1080, 1600, 2000, 3000, 4000]

type SheetJob = { status: 'working' } | { status: 'done'; result: ProcessResult } | { status: 'error'; error: string }

/** Split the ordered photos into sheets of `perSheet` (0 = one sheet). */
function chunk<T>(items: T[], perSheet: number): T[][] {
  if (perSheet <= 0 || items.length <= perSheet) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += perSheet) out.push(items.slice(i, i + perSheet))
  return out
}

export function CollagePage() {
  const files = useImageFiles()
  const support = useEncodeSupport()
  const [spec, setSpec] = useState<SheetSpec>(DEFAULT_SHEET)
  const [perSheet, setPerSheet] = useState(0)
  const [order, setOrder] = useState<string[]>([])
  /** Frames the user moved or resized, by photo id. */
  const [custom, setCustom] = useState<Record<string, Placement>>({})
  const [crops, setCrops] = useState<Record<string, Crop | undefined>>({})
  const [borders, setBorders] = useState<Record<string, Border | undefined>>({})
  const [bgImage, setBgImage] = useState<{ file: File; url: string } | null>(null)
  const bgInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => {
    if (bgImage) URL.revokeObjectURL(bgImage.url)
  }, [bgImage])
  const pickBackground = (file: File | undefined) => {
    if (!file) return
    setBgImage({ file, url: URL.createObjectURL(file) })
    setSpec((s) => ({ ...s, background: s.background.kind === 'image' ? s.background : { kind: 'image', blur: 0, dim: 0 } }))
  }
  const bg = spec.background
  const setBg = (b: SheetBackground) => set('background', b)
  const bgMode = (kind: SheetBackground['kind']) => {
    if (kind === bg.kind) return
    if (kind === 'color') setBg({ kind, color: '#ffffff' })
    else if (kind === 'gradient') setBg({ kind, ...GRADIENT_PRESETS[0], angle: 135 } as SheetBackground)
    else setBg({ kind, blur: 0, dim: 0 })
  }
  const [sheetIndex, setSheetIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [format, setFormat] = useState<Exclude<FormatChoice, 'same'>>('image/jpeg')
  const [quality, setQuality] = useState(92)
  const [stage, setStage] = useState<'ready' | 'processing' | 'done'>('ready')
  const [jobs, setJobs] = useState<SheetJob[]>([])
  const [zipping, setZipping] = useState(false)

  const set = <K extends keyof SheetSpec>(key: K, value: SheetSpec[K]) => {
    // Hand-placed frames belong to one arrangement; a new arrangement starts clean.
    if (key === 'aspect' || key === 'gap' || key === 'margin') setCustom({})
    setSpec((s) => ({ ...s, [key]: value }))
  }

  // Keep the photo order in step with the loaded files: new files go to the end, removed ones drop out.
  useEffect(() => {
    setOrder((prev) => {
      const ids = new Set(files.files.map((f) => f.id))
      const kept = prev.filter((id) => ids.has(id))
      const known = new Set(kept)
      for (const f of files.files) if (!known.has(f.id)) kept.push(f.id)
      return kept
    })
  }, [files.files])

  const byId = useMemo(() => new Map(files.files.map((f) => [f.id, f])), [files.files])
  const ordered = useMemo(() => order.map((id) => byId.get(id)).filter((f): f is LoadedFile => !!f), [order, byId])
  const sheets = useMemo(() => chunk(ordered, perSheet), [ordered, perSheet])
  const safeIndex = Math.min(sheetIndex, Math.max(0, sheets.length - 1))
  const current = sheets[safeIndex] ?? []

  const placementsFor = useCallback(
    (imgs: LoadedFile[]): Placement[] => autoPlacements(spec, imgs).map((p) => custom[p.id] ?? p),
    [spec, custom],
  )

  const placements = useMemo(() => placementsFor(current), [placementsFor, current])
  const size = useMemo(() => sheetSize(spec, current), [spec, current])

  const swap = (a: string, b: string) => {
    setOrder((prev) => {
      const ia = prev.indexOf(a)
      const ib = prev.indexOf(b)
      if (ia < 0 || ib < 0) return prev
      const next = [...prev]
      next[ia] = b
      next[ib] = a
      return next
    })
  }

  const place = useCallback((p: Placement) => setCustom((prev) => ({ ...prev, [p.id]: p })), [])
  const resetPlace = useCallback(
    (id: string) =>
      setCustom((prev) => {
        const { [id]: _drop, ...rest } = prev
        return rest
      }),
    [],
  )
  const setCrop = useCallback((id: string, crop: Crop | undefined) => setCrops((prev) => ({ ...prev, [id]: crop })), [])
  const adjusted = useMemo(() => new Set(Object.keys(custom)), [custom])
  const selectedCrop = selectedId ? crops[selectedId] : undefined
  const selectedBorder = selectedId ? borders[selectedId] : undefined
  const setBorder = (id: string, b: Border | undefined) => setBorders((prev) => ({ ...prev, [id]: b }))
  const editBorder = (patch: Partial<Border>) => {
    if (!selectedId) return
    const id = selectedId
    setBorders((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { ...DEFAULT_BORDER, width: 0 }), ...patch } }))
  }

  const remove = (id: string) => {
    files.remove(id)
    if (selectedId === id) setSelectedId(null)
  }

  const lossy = format !== 'image/png'
  const transparentJpeg = bg.kind === 'color' && bg.color === 'transparent' && format === 'image/jpeg'

  const run = async () => {
    setStage('processing')
    setJobs(sheets.map(() => ({ status: 'working' })))
    const results: SheetJob[] = []
    for (let i = 0; i < sheets.length; i++) {
      const imgs = sheets[i]
      try {
        const res = await exportSheet({
          spec,
          images: imgs,
          placements: placementsFor(imgs),
          crops,
          borders,
          backgroundImage: bg.kind === 'image' ? bgImage?.file : undefined,
          sources: new Map(imgs.map((f) => [f.id, f.file])),
          format: format as OutputFormat,
          quality: quality / 100,
        })
        const ext = format === 'image/jpeg' ? 'jpg' : format.replace('image/', '')
        const name = sheets.length > 1 ? `collage-${i + 1}.${ext}` : `collage.${ext}`
        results.push({ status: 'done', result: { blob: res.blob, name, width: res.width, height: res.height } })
      } catch (err) {
        results.push({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
      setJobs([...results, ...sheets.slice(i + 1).map((): SheetJob => ({ status: 'working' }))])
    }
    setStage('done')
  }

  const results = jobs.filter((j): j is Extract<SheetJob, { status: 'done' }> => j.status === 'done').map((j) => j.result)

  const Icon = tool.icon
  const seo = TOOL_SEO[tool.id]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tool.tint}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{tool.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{tool.description}</p>
        </div>
      </div>

      {files.errors.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {files.errors.map((e) => (
              <div key={e.name}>
                <span className="font-medium">{e.name}</span>: {e.message}
              </div>
            ))}
          </Notice>
        </div>
      )}

      {files.files.length === 0 ? (
        <DropZone onFiles={(list) => void files.add(list)} busy={files.loading} />
      ) : stage === 'ready' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            {sheets.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">Sheet</span>
                {sheets.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSheetIndex(i)}
                    className={cx(
                      'rounded-md px-3 py-1 text-sm font-medium',
                      i === safeIndex ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <span className="text-xs text-slate-500">
                  {sheets.length} images will be made
                </span>
              </div>
            )}
            <CollageEditor
              spec={spec}
              sheetWidth={size.width}
              sheetHeight={size.height}
              images={current}
              placements={placements}
              adjusted={adjusted}
              crops={crops}
              borders={borders}
              backgroundUrl={bgImage?.url}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSwap={swap}
              onPlace={place}
              onResetPlace={resetPlace}
              onCrop={setCrop}
              onRemove={remove}
            />
            <DropZone compact onFiles={(list) => void files.add(list)} busy={files.loading} />
          </div>
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-3">
                <SectionTitle>Photos</SectionTitle>
                <p className="text-xs text-slate-500">
                  Photos start on a grid. Drag any of them to move it, drop it on another to swap, pull the corner to resize, or use the crop button.
                </p>
                {adjusted.size > 0 && (
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => setCustom({})}>
                    Tidy up into a grid
                  </Button>
                )}
                <Field label="Photos per image" hint="Split a big batch into several collages. 0 puts everything on one.">
                  <NumberInput value={perSheet} onChange={(v) => setPerSheet(v === '' ? 0 : Math.max(0, Math.floor(v)))} min={0} max={100} />
                </Field>
              </div>

              {selectedId && (
                <div className="space-y-3">
                  <SectionTitle>Selected photo</SectionTitle>
                  <Field label="Border" hint="A coloured edge around this photo.">
                    <Slider
                      value={Math.round((selectedBorder?.width ?? 0) * 400) / 4}
                      onChange={(v) => editBorder({ width: v / 100 })}
                      min={0}
                      max={MAX_BORDER * 100}
                      step={0.25}
                      format={(v) => (v === 0 ? 'None' : `${v}%`)}
                    />
                  </Field>
                  {(selectedBorder?.width ?? 0) > 0 && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {BORDER_SWATCHES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Border colour ${c}`}
                            onClick={() => editBorder({ color: c })}
                            className={cx(
                              'h-7 w-7 rounded-full border shadow-sm',
                              selectedBorder?.color.toLowerCase() === c ? 'border-brand-600 ring-2 ring-brand-500/40' : 'border-slate-300',
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <ColorInput value={selectedBorder?.color ?? DEFAULT_BORDER.color} onChange={(v) => editBorder({ color: v })} />
                    </>
                  )}
                  <Toggle checked={selectedBorder?.shadow ?? false} onChange={(v) => editBorder({ shadow: v })} label="Soft shadow" />
                  {selectedBorder && files.files.length > 1 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => setBorders(Object.fromEntries(files.files.map((f) => [f.id, selectedBorder])))}
                    >
                      Use this border on every photo
                    </Button>
                  )}
                  {(selectedCrop || adjusted.has(selectedId) || selectedBorder) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        resetPlace(selectedId)
                        setCrop(selectedId, undefined)
                        setBorder(selectedId, undefined)
                      }}
                    >
                      Reset this photo
                    </Button>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <SectionTitle>Sheet</SectionTitle>
                <Field label="Shape">
                  <Select value={String(spec.aspect)} onChange={(e) => set('aspect', Number(e.target.value))}>
                    {ASPECTS.map((a) => (
                      <option key={a.label} value={String(a.value)}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Width" hint={`Output ${size.width} × ${size.height} px`}>
                  <div className="flex gap-2">
                    <NumberInput
                      className="min-w-0 flex-1"
                      value={spec.width}
                      onChange={(v) => set('width', v === '' ? 16 : Math.min(8000, Math.max(16, Math.round(v))))}
                      min={16}
                      max={8000}
                      suffix="px"
                    />
                    <div className="w-28 shrink-0">
                      <Select value={WIDTHS.includes(spec.width) ? String(spec.width) : ''} onChange={(e) => e.target.value && set('width', Number(e.target.value))}>
                        <option value="">Preset</option>
                        {WIDTHS.map((w) => (
                          <option key={w} value={String(w)}>
                            {w}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </Field>
                <Field label="Gap">
                  <Slider value={Math.round(spec.gap * 1000) / 10} onChange={(v) => set('gap', v / 100)} min={0} max={10} step={0.5} format={(v) => `${v}%`} />
                </Field>
                <Field label="Margin">
                  <Slider value={Math.round(spec.margin * 1000) / 10} onChange={(v) => set('margin', v / 100)} min={0} max={15} step={0.5} format={(v) => `${v}%`} />
                </Field>
                <Field label="Rounded corners">
                  <Slider value={Math.round(spec.radius * 100)} onChange={(v) => set('radius', v / 100)} min={0} max={50} format={(v) => `${v}%`} />
                </Field>
                <Field label="Background">
                  <Segmented<SheetBackground['kind']>
                    value={bg.kind}
                    onChange={bgMode}
                    options={[
                      { value: 'color', label: 'Solid' },
                      { value: 'gradient', label: 'Gradient' },
                      { value: 'image', label: 'Picture' },
                    ]}
                  />
                </Field>
                {bg.kind === 'color' && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {BORDER_SWATCHES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Background colour ${c}`}
                          onClick={() => setBg({ kind: 'color', color: c })}
                          className={cx('h-7 w-7 rounded-full border shadow-sm', bg.color.toLowerCase() === c ? 'border-brand-600 ring-2 ring-brand-500/40' : 'border-slate-300')}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <ColorInput value={bg.color} onChange={(v) => setBg({ kind: 'color', color: v })} allowTransparent />
                  </>
                )}
                {bg.kind === 'gradient' && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {GRADIENT_PRESETS.map((g) => (
                        <button
                          key={g.name}
                          type="button"
                          title={g.name}
                          aria-label={`Gradient ${g.name}`}
                          onClick={() => setBg({ ...bg, from: g.from, to: g.to })}
                          className={cx(
                            'h-7 w-7 rounded-full border shadow-sm',
                            bg.from === g.from && bg.to === g.to ? 'border-brand-600 ring-2 ring-brand-500/40' : 'border-slate-300',
                          )}
                          style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                        />
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="From">
                        <ColorInput value={bg.from} onChange={(v) => setBg({ ...bg, from: v })} />
                      </Field>
                      <Field label="To">
                        <ColorInput value={bg.to} onChange={(v) => setBg({ ...bg, to: v })} />
                      </Field>
                    </div>
                    <Field label="Angle">
                      <Slider value={bg.angle} onChange={(v) => setBg({ ...bg, angle: v })} min={0} max={360} step={5} format={(v) => `${v}°`} />
                    </Field>
                  </>
                )}
                {bg.kind === 'image' && (
                  <>
                    <input
                      ref={bgInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        pickBackground(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    {bgImage ? (
                      <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                        <div className="checker h-12 w-12 shrink-0 overflow-hidden rounded-md">
                          <img src={bgImage.url} alt="Background" className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0 flex-1 text-xs text-slate-600">
                          <p className="truncate font-medium text-slate-800">{bgImage.file.name}</p>
                          <p>Fills the sheet, cropped to fit.</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => bgInput.current?.click()}>
                          Change
                        </Button>
                        <button
                          type="button"
                          aria-label="Remove background picture"
                          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                          onClick={() => {
                            setBgImage(null)
                            setBg({ kind: 'color', color: '#ffffff' })
                          }}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <Button variant="secondary" className="w-full" onClick={() => bgInput.current?.click()}>
                        <ImagePlus className="h-4 w-4" /> Choose a picture
                      </Button>
                    )}
                    <Field label="Blur">
                      <Slider value={Math.round(bg.blur * 1000) / 10} onChange={(v) => setBg({ ...bg, blur: v / 100 })} min={0} max={4} step={0.25} format={(v) => (v === 0 ? 'None' : `${v}%`)} />
                    </Field>
                    <Field label="Darken">
                      <Slider value={Math.round(bg.dim * 100)} onChange={(v) => setBg({ ...bg, dim: v / 100 })} min={0} max={80} step={5} format={(v) => `${v}%`} />
                    </Field>
                  </>
                )}
              </div>

              <div className="space-y-3">
                <SectionTitle>Output</SectionTitle>
                <FormatPicker value={format} onChange={(v) => v !== 'same' && setFormat(v)} allowSame={false} support={support} />
                {lossy && (
                  <Field label="Quality">
                    <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
                  </Field>
                )}
                {transparentJpeg && <Notice tone="warn">JPG has no transparency; the background will be white. Pick PNG or WebP to keep it.</Notice>}
              </div>

              <Button size="lg" className="w-full" onClick={run} disabled={files.loading || sheets.length === 0}>
                Combine {files.files.length} {files.files.length === 1 ? 'photo' : 'photos'}
                {sheets.length > 1 && ` into ${sheets.length} images`}
              </Button>
              <p className="text-center text-xs text-slate-500">
                {files.files.length} {files.files.length === 1 ? 'image' : 'images'} · {formatBytes(files.files.reduce((s, f) => s + f.size, 0))} · stays on your device
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              {stage === 'processing' ? (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                  <span>
                    Combining {jobs.filter((j) => j.status !== 'working').length}/{sheets.length}…
                  </span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-slate-900">
                  {results.length} of {sheets.length} done
                </div>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setStage('ready')} disabled={stage === 'processing'}>
                  <ArrowLeft className="h-4 w-4" /> Adjust settings
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStage('ready')
                    setJobs([])
                    setCustom({})
                    setCrops({})
                    setBorders({})
                    files.clear()
                  }}
                  disabled={stage === 'processing'}
                >
                  <RotateCcw className="h-4 w-4" /> Start over
                </Button>
                <Button
                  size="sm"
                  disabled={stage === 'processing' || results.length === 0 || zipping}
                  onClick={async () => {
                    setZipping(true)
                    try {
                      await downloadAll(results, 'ihateimage-collage')
                    } finally {
                      setZipping(false)
                    }
                  }}
                >
                  {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {results.length > 1 ? 'Download all (ZIP)' : 'Download'}
                </Button>
              </div>
            </div>
          </div>
          <SheetResults jobs={jobs} />
          {stage === 'done' && (
            <p className="text-center text-sm text-slate-500">
              Want another tool?{' '}
              <Link to="/" className="font-medium text-brand-700 hover:underline">
                Back to all tools
              </Link>
            </p>
          )}
        </div>
      )}
      {seo && files.files.length === 0 && <ToolGuide page={seo} />}
    </div>
  )
}

function SheetResults({ jobs }: { jobs: SheetJob[] }) {
  const urls = useMemo(() => jobs.map((j) => (j.status === 'done' ? URL.createObjectURL(j.result.blob) : null)), [jobs])
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((j, i) => (
        <li key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="checker flex aspect-[4/3] items-center justify-center">
            {j.status === 'done' && urls[i] ? (
              <img src={urls[i]} alt={`Collage ${i + 1}`} className="h-full w-full object-contain" />
            ) : j.status === 'working' ? (
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            ) : null}
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 text-sm">
              {j.status === 'done' && (
                <>
                  <p className="truncate font-medium text-slate-800">{j.result.name}</p>
                  <p className="text-xs text-slate-500">
                    {j.result.width}×{j.result.height} · {formatBytes(j.result.blob.size)}
                  </p>
                </>
              )}
              {j.status === 'working' && <p className="text-slate-500">Rendering…</p>}
              {j.status === 'error' && <p className="text-red-600">{j.error}</p>}
            </div>
            {j.status === 'done' && (
              <Button variant="secondary" size="sm" onClick={() => downloadBlob(j.result.blob, j.result.name)}>
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

