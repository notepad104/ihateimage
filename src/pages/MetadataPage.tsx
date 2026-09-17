import { MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FileGrid } from '../components/FileGrid'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, Field, Notice, NumberInput, SectionTitle, Segmented, Slider, TextInput, Toggle } from '../components/ui'
import {
  EDITABLE_TYPES,
  EMPTY_FORM,
  formFromParsed,
  parseExif,
  rewriteMetadata,
  type ExifForm,
  type ParsedExif,
} from '../lib/exif'
import { labelForMime, withExt } from '../lib/format'
import { resolveResize } from '../lib/geometry'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, ProcessResult } from '../lib/types'
import { flattenOps } from './shared'

const tool = toolById('metadata')

type Mode = 'edit' | 'strip'
type Editable = 'image/jpeg' | 'image/png' | 'image/webp'
type OutChoice = 'same' | Editable

const FIELDS: { key: keyof ExifForm; label: string; placeholder?: string }[] = [
  { key: 'description', label: 'Description', placeholder: 'What the photo shows' },
  { key: 'artist', label: 'Author / artist', placeholder: 'Your name' },
  { key: 'copyright', label: 'Copyright', placeholder: '© 2026 Your Name' },
  { key: 'make', label: 'Camera make', placeholder: 'Apple' },
  { key: 'model', label: 'Camera model', placeholder: 'iPhone 16 Pro' },
  { key: 'lensModel', label: 'Lens', placeholder: 'iPhone 16 Pro back camera 6.86mm f/1.78' },
  { key: 'software', label: 'Software', placeholder: 'ihateimage' },
]

function sameForm(a: ExifForm, b: ExifForm) {
  return (Object.keys(a) as (keyof ExifForm)[]).every((k) => a[k] === b[k])
}

export function MetadataPage() {
  const files = useImageFiles()
  const [mode, setMode] = useState<Mode>('edit')
  const [form, setForm] = useState<ExifForm>(EMPTY_FORM)
  const [keepIcc, setKeepIcc] = useState(true)
  const [stripOther, setStripOther] = useState(true)
  const [parsed, setParsed] = useState<ParsedExif | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  /** What the form looked like right after the last prefill, to detect user edits. */
  const prefilled = useRef<ExifForm>(EMPTY_FORM)

  // Output options, shown on the results page. Changing them re-runs the batch.
  const [outChoice, setOutChoice] = useState<OutChoice>('same')
  const [reencode, setReencode] = useState(false)
  const [quality, setQuality] = useState(85)
  const [limitDims, setLimitDims] = useState(false)
  const [maxSide, setMaxSide] = useState<number | ''>(2048)
  const [rerunTick, setRerunTick] = useState(0)
  const rerunRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (rerunTick > 0) rerunRef.current?.()
  }, [rerunTick])
  const queueRerun = () => setRerunTick((t) => t + 1)

  const selected = files.selected
  const dirty = !sameForm(form, prefilled.current)

  // Read the selected file's metadata. Prefill the form from it unless the user has already typed.
  useEffect(() => {
    if (!selected) {
      setParsed(null)
      return
    }
    let cancelled = false
    setParseError(null)
    parseExif(selected.file)
      .then((p) => {
        if (cancelled) return
        setParsed(p)
        if (!dirty) {
          const next = formFromParsed(p)
          prefilled.current = next
          setForm(next)
        }
      })
      .catch((e) => !cancelled && setParseError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const loadFromImage = () => {
    if (!parsed) return
    const next = formFromParsed(parsed)
    prefilled.current = next
    setForm(next)
  }

  const unsupported = files.files.filter((f) => !EDITABLE_TYPES.has(f.type))

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const nativeOk = EDITABLE_TYPES.has(file.type)
    const target: Editable = outChoice === 'same' ? (nativeOk ? (file.type as Editable) : 'image/jpeg') : outChoice
    const needsResize = reencode && limitDims && !!maxSide && (file.width > maxSide || file.height > maxSide)
    const mustReencode = target !== file.type || reencode || !nativeOk

    let source: Blob = file.file
    let width = file.width
    let height = file.height
    let note: string | undefined
    if (mustReencode) {
      // Re-encoding drops all metadata, so it happens first and the EXIF block is written afterwards.
      const ops: Op[] = []
      if (needsResize && maxSide) {
        ops.push({ type: 'resize', ...resolveResize(file, { mode: 'fit', width: maxSide, height: maxSide, noEnlarge: true }) })
      }
      ops.push(...flattenOps(file, target, '#ffffff'))
      const res = await processImage({
        source: file.file,
        ops,
        encode: { format: target, quality: reencode ? quality / 100 : 0.95 },
      })
      source = res.blob
      width = res.width
      height = res.height
      note = target !== file.type ? `Converted to ${labelForMime(target)}` : 'Re-encoded'
    }
    const blob = await rewriteMetadata(source, {
      form: mode === 'edit' ? form : null,
      keepIcc,
      stripOther,
      size: { width, height },
    })
    return { blob, name: withExt(file.name, target), width, height, note }
  }

  const set = (key: keyof ExifForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel={mode === 'strip' ? 'Remove metadata from' : 'Save metadata to'}
      process={process}
      zipName="ihateimage-metadata"
      resultsPanel={({ rerun, busy }) => {
        rerunRef.current = rerun
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <SectionTitle>Output format</SectionTitle>
              <Segmented<OutChoice>
                value={outChoice}
                onChange={(v) => {
                  setOutChoice(v)
                  queueRerun()
                }}
                options={[
                  { value: 'same', label: 'Same', disabled: busy },
                  { value: 'image/jpeg', label: 'JPG', disabled: busy },
                  { value: 'image/png', label: 'PNG', disabled: busy },
                  { value: 'image/webp', label: 'WebP', disabled: busy },
                ]}
              />
              <p className="text-xs text-slate-500">
                {outChoice === 'same'
                  ? 'Kept as-is. JPG, PNG and WebP are edited in place; other types become JPG.'
                  : 'Pixels are re-encoded to the new type, then your metadata is written into it.'}
              </p>
            </div>
            <div className="space-y-2">
              <Toggle
                checked={reencode}
                onChange={(v) => {
                  setReencode(v)
                  queueRerun()
                }}
                disabled={busy}
                label="Compress"
                hint="Re-encodes the pixels for a smaller file. Metadata is added afterwards, so nothing is lost."
              />
              {reencode && (
                <>
                  <Field label="Quality" hint={outChoice === 'image/png' ? 'PNG is lossless; quality has no effect.' : undefined}>
                    <Slider
                      value={quality}
                      onChange={setQuality}
                      onCommit={() => queueRerun()}
                      min={1}
                      max={100}
                      format={(v) => `${v}%`}
                      disabled={busy}
                    />
                  </Field>
                  <Toggle
                    checked={limitDims}
                    onChange={(v) => {
                      setLimitDims(v)
                      queueRerun()
                    }}
                    disabled={busy}
                    label="Limit longest side"
                  />
                  {limitDims && (
                    <div onBlur={() => queueRerun()}>
                      <NumberInput value={maxSide} onChange={setMaxSide} min={16} step={10} suffix="px" disabled={busy} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )
      }}
      preview={
        selected && (
          <div className="space-y-4">
            <Inspector file={selected} parsed={parsed} error={parseError} />
            {files.files.length > 1 && (
              <FileGrid files={files.files} selectedId={files.selectedId} onSelect={files.select} onRemove={files.remove} />
            )}
          </div>
        )
      }
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>Action</SectionTitle>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'edit', label: 'Edit' },
                { value: 'strip', label: 'Remove all' },
              ]}
            />
            <p className="text-xs text-slate-500">
              {mode === 'strip'
                ? 'Deletes EXIF (camera, dates, GPS), embedded thumbnails and other metadata. Pixels are untouched.'
                : 'The fields are prefilled from the selected image. Change what you like, clear a field to drop it. Only these fields are written.'}
            </p>
          </div>

          {mode === 'edit' && (
            <>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <SectionTitle>Details</SectionTitle>
                  {dirty && parsed && (
                    <Button variant="ghost" size="sm" onClick={loadFromImage} title="Discard edits and reload this image's values">
                      <RefreshCw className="h-3.5 w-3.5" /> Reload from image
                    </Button>
                  )}
                </div>
                {FIELDS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <TextInput value={form[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
                  </Field>
                ))}
                <Field label="Date taken">
                  <TextInput type="datetime-local" value={form.dateTaken} onChange={(e) => set('dateTaken', e.target.value)} />
                </Field>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <SectionTitle>Location</SectionTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, lat: '', lon: '', alt: '' }))}
                    disabled={!form.lat && !form.lon}
                  >
                    Remove location
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Latitude">
                    <TextInput inputMode="decimal" placeholder="48.858370" value={form.lat} onChange={(e) => set('lat', e.target.value)} />
                  </Field>
                  <Field label="Longitude">
                    <TextInput inputMode="decimal" placeholder="2.294481" value={form.lon} onChange={(e) => set('lon', e.target.value)} />
                  </Field>
                </div>
                <Field label="Altitude (m)">
                  <TextInput inputMode="decimal" placeholder="optional" value={form.alt} onChange={(e) => set('alt', e.target.value)} />
                </Field>
                <p className="text-xs text-slate-500">Decimal degrees. South and west are negative.</p>
              </div>
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setForm(EMPTY_FORM)}>
                Clear all fields
              </Button>
            </>
          )}

          <div className="space-y-3">
            <SectionTitle>Also</SectionTitle>
            <Toggle
              checked={keepIcc}
              onChange={setKeepIcc}
              label="Keep color profile"
              hint="ICC profiles affect how colors render. Safe to keep; contains no personal data."
            />
            <Toggle
              checked={stripOther}
              onChange={setStripOther}
              label="Remove XMP, IPTC and comments"
              hint="Editing-app metadata that can also contain names, locations and history."
            />
          </div>

          {unsupported.length > 0 && (
            <Notice tone="info">
              {unsupported.length === 1 ? '1 file is' : `${unsupported.length} files are`} not JPG, PNG or WebP (
              {Array.from(new Set(unsupported.map((f) => labelForMime(f.type)))).join(', ')}). They will be converted to
              JPG at quality 95 so metadata can be written.
            </Notice>
          )}
        </>
      }
    />
  )
}

function Inspector({ file, parsed, error }: { file: LoadedFile; parsed: ParsedExif | null; error: string | null }) {
  const groups: { title: string; ifd: string }[] = [
    { title: 'Location', ifd: 'gps' },
    { title: 'Camera & exposure', ifd: 'exif' },
    { title: 'General', ifd: 'ifd0' },
  ]
  const hasAny = parsed && parsed.entries.length > 0
  const editable = EDITABLE_TYPES.has(file.type)
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <div className="checker overflow-hidden rounded-xl">
        <img src={file.url} alt={file.name} className="h-full max-h-64 w-full object-contain" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          <p className="truncate text-sm font-medium text-slate-800">
            {file.name} <span className="font-normal text-slate-400">· {labelForMime(file.type)}</span>
          </p>
          {parsed?.gps ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
              <MapPin className="h-3 w-3" /> Contains GPS location
            </span>
          ) : hasAny ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Has metadata
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              <ShieldCheck className="h-3 w-3" /> No EXIF found
            </span>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto px-4 py-3 text-sm">
          {error && <p className="text-red-700">{error}</p>}
          {!editable && (
            <p className="mb-2 text-slate-500">
              {labelForMime(file.type)} metadata can't be edited in place. The image will be saved as JPG with your values.
            </p>
          )}
          {parsed?.gps && (
            <p className="mb-3 text-slate-700">
              {parsed.gps.lat.toFixed(6)}, {parsed.gps.lon.toFixed(6)}
              {parsed.gps.alt !== undefined && ` · ${parsed.gps.alt.toFixed(0)} m`}{' '}
              <a
                className="font-medium text-brand-700 hover:underline"
                href={`https://www.openstreetmap.org/?mlat=${parsed.gps.lat}&mlon=${parsed.gps.lon}#map=15/${parsed.gps.lat}/${parsed.gps.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                View on map ↗
              </a>
            </p>
          )}
          {groups.map((g) => {
            const rows = parsed?.entries.filter((e) => e.ifd === g.ifd) ?? []
            if (!rows.length) return null
            return (
              <div key={g.ifd} className="mb-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
                <dl className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-3 gap-y-1">
                  {rows.map((e) => (
                    <div key={`${e.ifd}-${e.tag}`} className="contents">
                      <dt className="truncate text-slate-500">{e.name}</dt>
                      <dd className="break-words text-slate-800">{e.display || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}
          {parsed && !hasAny && editable && (
            <p className="text-slate-500">This image carries no EXIF block. You can still add one with the form.</p>
          )}
          {parsed && parsed.segments.length > 0 && (
            <p className="text-xs text-slate-500">Other metadata present: {parsed.segments.join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
