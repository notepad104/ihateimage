import { MapPin, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FileGrid } from '../components/FileGrid'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, Field, Notice, SectionTitle, Segmented, TextInput, Toggle } from '../components/ui'
import { EMPTY_FORM, formFromParsed, parseExif, rewriteJpeg, type ExifForm, type ParsedExif } from '../lib/exif'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, ProcessResult } from '../lib/types'

const tool = toolById('metadata')

type Mode = 'strip' | 'replace'

const FIELDS: { key: keyof ExifForm; label: string; placeholder?: string }[] = [
  { key: 'description', label: 'Description', placeholder: 'What the photo shows' },
  { key: 'artist', label: 'Author / artist', placeholder: 'Your name' },
  { key: 'copyright', label: 'Copyright', placeholder: '© 2026 Your Name' },
  { key: 'make', label: 'Camera make', placeholder: 'Apple' },
  { key: 'model', label: 'Camera model', placeholder: 'iPhone 16 Pro' },
  { key: 'lensModel', label: 'Lens', placeholder: 'iPhone 16 Pro back camera 6.86mm f/1.78' },
  { key: 'software', label: 'Software', placeholder: 'ihateimage' },
]

export function MetadataPage() {
  const files = useImageFiles()
  const [mode, setMode] = useState<Mode>('strip')
  const [form, setForm] = useState<ExifForm>(EMPTY_FORM)
  const [keepIcc, setKeepIcc] = useState(true)
  const [stripOther, setStripOther] = useState(true)
  const [parsed, setParsed] = useState<ParsedExif | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null)

  const selected = files.selected

  // Read the selected file's metadata for the inspector panel.
  useEffect(() => {
    if (!selected) {
      setParsed(null)
      return
    }
    let cancelled = false
    setParseError(null)
    if (selected.type !== 'image/jpeg') {
      setParsed(null)
      return
    }
    parseExif(selected.file)
      .then((p) => {
        if (cancelled) return
        setParsed(p)
        // Prefill the form once per image so users edit rather than retype.
        if (prefilledFor !== selected.id && isEmpty(form)) {
          setForm(formFromParsed(p))
          setPrefilledFor(selected.id)
        }
      })
      .catch((e) => !cancelled && setParseError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const nonJpeg = files.files.filter((f) => f.type !== 'image/jpeg')

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    let source: Blob = file.file
    let note: string | undefined
    if (file.type !== 'image/jpeg') {
      // EXIF lives in JPEGs; re-encode other formats first (this already drops their metadata).
      const res = await processImage({ source: file.file, ops: [], encode: { format: 'image/jpeg', quality: 0.95 } })
      source = res.blob
      note = 'Converted to JPG'
    }
    const blob = await rewriteJpeg(source, { form: mode === 'replace' ? form : null, keepIcc, stripOther })
    return { blob, name: withExt(file.name, 'image/jpeg'), width: file.width, height: file.height, note }
  }

  const set = (key: keyof ExifForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel={mode === 'strip' ? 'Remove metadata from' : 'Write metadata to'}
      process={process}
      zipName="ihateimage-metadata"
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
                { value: 'strip', label: 'Remove all' },
                { value: 'replace', label: 'Replace' },
              ]}
            />
            <p className="text-xs text-slate-500">
              {mode === 'strip'
                ? 'Deletes EXIF (camera, dates, GPS), embedded thumbnails and other metadata. Pixels are untouched.'
                : 'Writes exactly the fields below and nothing else. Leave a field blank to omit it.'}
            </p>
          </div>

          {mode === 'replace' && (
            <>
              <div className="space-y-2.5">
                <SectionTitle>Details</SectionTitle>
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
                    Clear
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

          {nonJpeg.length > 0 && (
            <Notice tone="info">
              {nonJpeg.length === 1 ? '1 file is' : `${nonJpeg.length} files are`} not JPG. They will be converted to JPG
              (quality 95) so metadata can be written.
            </Notice>
          )}
        </>
      }
    />
  )
}

function isEmpty(f: ExifForm) {
  return Object.values(f).every((v) => !v)
}

function Inspector({ file, parsed, error }: { file: LoadedFile; parsed: ParsedExif | null; error: string | null }) {
  const groups: { title: string; ifd: string }[] = [
    { title: 'Location', ifd: 'gps' },
    { title: 'Camera & exposure', ifd: 'exif' },
    { title: 'General', ifd: 'ifd0' },
  ]
  const hasAny = parsed && parsed.entries.length > 0
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <div className="checker overflow-hidden rounded-xl">
        <img src={file.url} alt={file.name} className="h-full max-h-64 w-full object-contain" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
          {parsed?.gps ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
              <MapPin className="h-3 w-3" /> Contains GPS location
            </span>
          ) : hasAny ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Has metadata</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              <ShieldCheck className="h-3 w-3" /> No EXIF found
            </span>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto px-4 py-3 text-sm">
          {error && <p className="text-red-700">{error}</p>}
          {file.type !== 'image/jpeg' && (
            <p className="text-slate-500">Only JPG metadata is inspected. This file will be converted to JPG on save.</p>
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
          {parsed && parsed.segments.length > 0 && (
            <p className="text-xs text-slate-500">Other segments: {parsed.segments.join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
