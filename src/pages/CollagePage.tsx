import { ArrowLeft, Download, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CollageEditor } from '../components/CollageEditor'
import { DropZone } from '../components/DropZone'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolGuide } from '../components/Seo'
import { useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, Notice, NumberInput, SectionTitle, Segmented, Select, Slider, cx } from '../components/ui'
import {
  DEFAULT_SHEET,
  autoPlacements,
  exportSheet,
  sheetSize,
  type CollageLayout,
  type Crop,
  type Placement,
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
  const [sheetIndex, setSheetIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [format, setFormat] = useState<Exclude<FormatChoice, 'same'>>('image/jpeg')
  const [quality, setQuality] = useState(92)
  const [stage, setStage] = useState<'ready' | 'processing' | 'done'>('ready')
  const [jobs, setJobs] = useState<SheetJob[]>([])
  const [zipping, setZipping] = useState(false)

  const set = <K extends keyof SheetSpec>(key: K, value: SheetSpec[K]) => {
    // Hand-placed frames belong to one arrangement; a new arrangement starts clean.
    if (key === 'layout' || key === 'columns' || key === 'aspect' || key === 'gap' || key === 'margin') setCustom({})
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

  const remove = (id: string) => {
    files.remove(id)
    if (selectedId === id) setSelectedId(null)
  }

  const lossy = format !== 'image/png'
  const transparentJpeg = spec.background === 'transparent' && format === 'image/jpeg'

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
                <SectionTitle>Layout</SectionTitle>
                <Segmented<CollageLayout>
                  value={spec.layout}
                  onChange={(v) => set('layout', v)}
                  options={[
                    { value: 'grid', label: 'Grid' },
                    { value: 'row', label: 'Row' },
                    { value: 'column', label: 'Column' },
                  ]}
                />
                <p className="text-xs text-slate-500">Every photo can still be dragged, resized and cropped on the preview.</p>
                {spec.layout === 'grid' && (
                  <Field label="Columns">
                    <Slider value={spec.columns} onChange={(v) => set('columns', v)} min={1} max={6} />
                  </Field>
                )}
                <Field label="Photos per image" hint="Split a big batch into several collages. 0 puts everything on one.">
                  <NumberInput value={perSheet} onChange={(v) => setPerSheet(v === '' ? 0 : Math.max(0, Math.floor(v)))} min={0} max={100} />
                </Field>
              </div>

              {selectedId && (selectedCrop || adjusted.has(selectedId)) && (
                <div className="space-y-3">
                  <SectionTitle>Selected photo</SectionTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      resetPlace(selectedId)
                      setCrop(selectedId, undefined)
                    }}
                  >
                    Reset frame and crop
                  </Button>
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
                      value={spec.width}
                      onChange={(v) => set('width', v === '' ? 16 : Math.min(8000, Math.max(16, Math.round(v))))}
                      min={16}
                      max={8000}
                      suffix="px"
                    />
                    <Select value={WIDTHS.includes(spec.width) ? String(spec.width) : ''} onChange={(e) => e.target.value && set('width', Number(e.target.value))} className="w-28">
                      <option value="">Preset</option>
                      {WIDTHS.map((w) => (
                        <option key={w} value={String(w)}>
                          {w}
                        </option>
                      ))}
                    </Select>
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
                  <ColorInput value={spec.background} onChange={(v) => set('background', v)} allowTransparent />
                </Field>
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

