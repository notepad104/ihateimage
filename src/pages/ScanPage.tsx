import { Loader2, RotateCcw, RotateCw, ScanSearch, Sparkles, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileGrid } from '../components/FileGrid'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { LivePreview } from '../components/LivePreview'
import { QuadEditor } from '../components/QuadEditor'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, Field, Notice, SectionTitle, Segmented, Slider, cx } from '../components/ui'
import { DOC_MODEL, detectDocumentAi, isDocModelCached } from '../lib/docDetect'
import { withExt } from '../lib/format'
import { detectDocumentFast, processImage, refineDocumentQuad } from '../lib/process'
import { defaultQuad, estimateAspect, scaleQuad } from '../lib/scan'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, ProcessResult, Quad } from '../lib/types'
import { anyLossy, outputFormatFor } from './shared'

const tool = toolById('scan')

type Engine = 'ai' | 'fast'
type CornerSource = 'ai' | 'fast' | 'manual' | 'none'
type Rotation = 0 | 90 | 180 | 270

interface ScanState {
  /** Corners in source pixels, TL/TR/BR/BL */
  quad: Quad
  source: CornerSource
  rotation: Rotation
  busy: boolean
  note?: string
}

function opsFor(file: LoadedFile, st: ScanState | undefined, strength: number): Op[] {
  const quad = st?.quad ?? defaultQuad(file.width, file.height)
  const ops: Op[] = [
    {
      type: 'warp',
      quad: scaleQuad(quad, 1 / file.width, 1 / file.height),
      aspect: estimateAspect(quad, file.width, file.height),
    },
  ]
  if (strength > 0) ops.push({ type: 'scanFilter', strength: strength / 100 })
  if (st && st.rotation !== 0) ops.push({ type: 'rotate', degrees: st.rotation })
  return ops
}

function Pill({ tone, children }: { tone: 'emerald' | 'sky' | 'amber' | 'slate'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm',
        tone === 'emerald' && 'bg-emerald-100 text-emerald-800',
        tone === 'sky' && 'bg-sky-100 text-sky-800',
        tone === 'amber' && 'bg-amber-100 text-amber-800',
        tone === 'slate' && 'bg-white/90 text-slate-700',
      )}
    >
      {children}
    </span>
  )
}

function StatusBadge({ state }: { state?: ScanState }) {
  if (!state || state.busy) {
    return (
      <Pill tone="slate">
        <Loader2 className="h-3 w-3 animate-spin" /> Detecting
      </Pill>
    )
  }
  switch (state.source) {
    case 'ai':
      return <Pill tone="emerald">AI corners</Pill>
    case 'fast':
      return <Pill tone="emerald">Auto corners</Pill>
    case 'manual':
      return <Pill tone="sky">Adjusted</Pill>
    default:
      return <Pill tone="amber">Check corners</Pill>
  }
}

export function ScanPage() {
  const files = useImageFiles()
  const support = useEncodeSupport()
  const [engine, setEngine] = useState<Engine>('ai')
  const [strength, setStrength] = useState(70)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(90)
  const [states, setStates] = useState<Record<string, ScanState>>({})
  const [modelCached, setModelCached] = useState<boolean | null>(null)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const inflight = useRef(new Set<string>())
  const engineRef = useRef(engine)
  engineRef.current = engine

  useEffect(() => {
    void isDocModelCached().then(setModelCached)
  }, [])

  const patch = useCallback((id: string, p: Partial<ScanState>) => {
    setStates((s) => (s[id] ? { ...s, [id]: { ...s[id], ...p } } : s))
  }, [])

  /** Run the selected detector on one file, falling back Fast → manual corners. */
  const detect = useCallback(async (file: LoadedFile) => {
    const fallback = defaultQuad(file.width, file.height)
    setStates((s) => ({
      ...s,
      [file.id]: {
        quad: s[file.id]?.quad ?? fallback,
        source: s[file.id]?.source ?? 'none',
        rotation: s[file.id]?.rotation ?? 0,
        busy: true,
        note: undefined,
      },
    }))
    let quad: Quad | null = null
    let source: CornerSource = 'none'
    let note: string | undefined
    try {
      if (engineRef.current === 'ai') {
        try {
          quad = await detectDocumentAi(file.file, (frac, stage) => {
            if (stage === 'download') setAiStatus(`Downloading AI model ${Math.round(frac * 100)}% (once, ${DOC_MODEL.sizeLabel})…`)
            else if (stage === 'load') setAiStatus('Starting AI model…')
            else setAiStatus(null)
          })
          setModelCached(true)
          if (quad) {
            const refined = await refineDocumentQuad(file.file, quad)
            quad = refined.quad
            source = refined.source === 'seed' ? 'ai' : 'fast'
          } else {
            note = 'The AI model did not see a page in this photo. Used the fast detector instead.'
          }
        } catch (e) {
          note = `AI detection unavailable (${e instanceof Error ? e.message : String(e)}). Used the fast detector instead.`
        }
      }
      if (!quad) {
        quad = await detectDocumentFast(file.file)
        if (quad) source = 'fast'
      }
    } catch (e) {
      note = e instanceof Error ? e.message : String(e)
    } finally {
      setAiStatus(null)
    }
    setStates((s) => ({
      ...s,
      [file.id]: {
        quad: quad ?? fallback,
        source: quad ? source : 'none',
        rotation: s[file.id]?.rotation ?? 0,
        busy: false,
        note: quad ? (source === 'fast' && engineRef.current === 'ai' ? note : undefined) : (note ?? 'Could not find the page edges. Drag the corners onto the page.'),
        // note stays undefined when the fast outline simply out-scored the AI one
      },
    }))
  }, [])

  // Detect newly added files, one at a time.
  useEffect(() => {
    const pending = files.files.filter((f) => !states[f.id] && !inflight.current.has(f.id))
    if (!pending.length) return
    for (const f of pending) inflight.current.add(f.id)
    void (async () => {
      for (const f of pending) {
        try {
          await detect(f)
        } finally {
          inflight.current.delete(f.id)
        }
      }
    })()
  }, [files.files, states, detect])

  // Switching engines re-detects everything the user has not adjusted by hand.
  const firstEngine = useRef(true)
  useEffect(() => {
    if (firstEngine.current) {
      firstEngine.current = false
      return
    }
    const targets = files.files.filter((f) => states[f.id] && states[f.id].source !== 'manual' && !states[f.id].busy)
    void (async () => {
      for (const f of targets) await detect(f)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  const selected = files.selected
  const st = selected ? states[selected.id] : undefined
  const previewOps = useMemo(() => (selected ? opsFor(selected, st, strength) : []), [selected, st, strength])
  const anyBusy = files.files.some((f) => !states[f.id] || states[f.id].busy)
  const lossy = anyLossy(files.files, format, support)

  const rotate = (delta: 90 | 270) => {
    if (!selected || !st) return
    patch(selected.id, { rotation: ((st.rotation + delta) % 360) as Rotation })
  }

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const res = await processImage({
      source: file.file,
      ops: opsFor(file, states[file.id], strength),
      encode: { format: out, quality: quality / 100 },
    })
    return { blob: res.blob, name: withExt(file.name, out, '-scan'), width: res.width, height: res.height }
  }

  return (
    <ToolShell
      tool={tool}
      files={files}
      camera
      processLabel="Scan"
      process={process}
      canProcess={!anyBusy}
      zipName="ihateimage-scans"
      preview={
        selected && (
          <div className="space-y-4">
            <QuadEditor
              key={selected.id}
              file={selected}
              quad={st?.quad ?? defaultQuad(selected.width, selected.height)}
              onChange={(q) => patch(selected.id, { quad: q, source: 'manual', note: undefined })}
              disabled={!st || st.busy}
              badge={<StatusBadge state={st} />}
            />
            {(!st || st.busy) && (
              <p className="flex items-center justify-center gap-2 text-xs text-slate-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
                {aiStatus ?? 'Finding the page edges…'}
              </p>
            )}
            {st?.note && !st.busy && <Notice tone="warn">{st.note}</Notice>}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Drag the handles onto the four corners of the page.
                {files.files.length > 1 && ' Each photo keeps its own corners.'}
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => void detect(selected)} disabled={!st || st.busy}>
                  <ScanSearch className="h-4 w-4" /> Detect again
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => patch(selected.id, { quad: defaultQuad(selected.width, selected.height), source: 'manual', note: undefined })}
                  disabled={!st || st.busy}
                >
                  Reset corners
                </Button>
              </span>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Result preview</p>
              <LivePreview file={selected} ops={previewOps} maxHeight={340} />
            </div>
            {files.files.length > 1 && (
              <FileGrid
                files={files.files}
                selectedId={files.selectedId}
                onSelect={files.select}
                onRemove={files.remove}
                badge={(f) => <StatusBadge state={states[f.id]} />}
              />
            )}
          </div>
        )
      }
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>1 · Find the page</SectionTitle>
            <Segmented
              value={engine}
              onChange={setEngine}
              options={[
                {
                  value: 'ai',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" /> AI
                    </span>
                  ),
                },
                {
                  value: 'fast',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" /> Fast
                    </span>
                  ),
                },
              ]}
            />
            <p className="text-xs text-slate-500">
              {engine === 'ai'
                ? `A small neural network (DocAligner) locates the four corners, even on busy backgrounds. ${
                    modelCached ? 'Model is already downloaded.' : `Downloads a ${DOC_MODEL.sizeLabel} model once; runs on your device.`
                  }`
                : 'Classic edge and brightness analysis. Instant and offline, best on plain backgrounds.'}
            </p>
          </div>

          <div className="space-y-3">
            <SectionTitle>2 · Scan look</SectionTitle>
            <Field label="Strength" hint="Evens out lighting and shadows, whitens the paper and sets the exposure. 0 keeps the photo as shot.">
              <Slider value={strength} onChange={setStrength} min={0} max={100} format={(v) => `${v}%`} />
            </Field>
          </div>

          <div className="space-y-3">
            <SectionTitle>3 · Rotate result</SectionTitle>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => rotate(270)} disabled={!st || st.busy}>
                <RotateCcw className="h-4 w-4" /> Left
              </Button>
              <Button variant="secondary" size="sm" onClick={() => rotate(90)} disabled={!st || st.busy}>
                <RotateCw className="h-4 w-4" /> Right
              </Button>
              <span className="ml-auto text-xs tabular-nums text-slate-500">{st?.rotation ?? 0}°</span>
            </div>
            <p className="text-xs text-slate-500">Applies to the selected photo only.</p>
          </div>

          <div className="space-y-3">
            <SectionTitle>4 · Output</SectionTitle>
            <FormatPicker value={format} onChange={setFormat} support={support} />
            {lossy && (
              <Field label="Quality">
                <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
              </Field>
            )}
          </div>
        </>
      }
    />
  )
}
