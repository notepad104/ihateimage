import { Brush, Download, Eraser, Eye, Loader2, RotateCcw, Sparkles, Trash2, Undo2, Wand2, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DropZone } from '../components/DropZone'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { MaskEditor, type MaskEditorHandle, type Stroke } from '../components/MaskEditor'
import { Button, Field, Notice, SectionTitle, Segmented, Slider } from '../components/ui'
import { aiInpaint, blobToImageData, imageDataToBlob, isModelCached, MODEL_SIZE_LABEL } from '../lib/aiInpaint'
import { downloadBlob } from '../lib/download'
import { loadFiles } from '../lib/files'
import { formatBytes, withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile } from '../lib/types'
import { outputFormatFor } from './shared'

const tool = toolById('remove-objects')

interface Source {
  blob: Blob
  url: string
  width: number
  height: number
}

type Method = 'ai' | 'fast'

export function RemoveObjectsPage() {
  const support = useEncodeSupport()
  const editor = useRef<MaskEditorHandle>(null)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [history, setHistory] = useState<Source[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [brush, setBrush] = useState(40)
  const [mode, setMode] = useState<'paint' | 'erase'>('paint')
  const [method, setMethod] = useState<Method>('ai')
  const [modelCached, setModelCached] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(92)

  useEffect(() => {
    void isModelCached().then(setModelCached)
  }, [])

  // Revoke object URLs on unmount.
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url)
      for (const h of history) URL.revokeObjectURL(h.url)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const open = async (list: File[]) => {
    const { loaded, errors } = await loadFiles(list.slice(0, 1))
    if (errors.length) setError(errors[0].message)
    const f = loaded[0]
    if (!f) return
    setError(null)
    setFile(f)
    setSource({ blob: f.file, url: f.url, width: f.width, height: f.height })
    setHistory([])
    setStrokes([])
    setBrush(Math.max(12, Math.round(Math.max(f.width, f.height) / 35)))
  }

  const remove = async () => {
    if (!source) return
    const mask = editor.current?.getMask()
    if (!mask) {
      setError('Mark the object you want to remove first.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      let blob: Blob
      if (method === 'ai') {
        setStatus('Reading image…')
        const img = await blobToImageData(source.blob)
        const out = await aiInpaint(img, mask, (frac, stage) => {
          if (stage === 'download') setStatus(`Downloading AI model ${Math.round(frac * 100)}% (once, ${MODEL_SIZE_LABEL})…`)
          else if (stage === 'load') setStatus('Starting AI model…')
          else setStatus('Reconstructing background…')
        })
        setModelCached(true)
        setStatus('Encoding…')
        blob = await imageDataToBlob(out)
      } else {
        setStatus('Matching surrounding patterns…')
        const res = await processImage({
          source: source.blob,
          ops: [{ type: 'inpaint', mask, width: source.width, height: source.height }],
          encode: { format: 'image/png' },
        })
        blob = res.blob
      }
      setHistory((h) => [...h, source])
      setSource({ blob, url: URL.createObjectURL(blob), width: source.width, height: source.height })
      setStrokes([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }

  const undoRemoval = () => {
    const prev = history[history.length - 1]
    if (!prev || !source) return
    URL.revokeObjectURL(source.url)
    setSource(prev)
    setHistory((h) => h.slice(0, -1))
    setStrokes([])
  }

  const download = async () => {
    if (!source || !file) return
    setBusy(true)
    try {
      const out = outputFormatFor(file, format, support)
      const res = await processImage({ source: source.blob, ops: [], encode: { format: out, quality: quality / 100 } })
      downloadBlob(res.blob, withExt(file.name, out, '-cleaned'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startOver = () => {
    if (source) URL.revokeObjectURL(source.url)
    for (const h of history) URL.revokeObjectURL(h.url)
    setFile(null)
    setSource(null)
    setHistory([])
    setStrokes([])
    setError(null)
  }

  const Icon = tool.icon
  const original = history[0] ?? null

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

      {error && (
        <div className="mb-4">
          <Notice tone={source ? 'warn' : 'error'}>{error}</Notice>
        </div>
      )}

      {!source || !file ? (
        <DropZone onFiles={(l) => void open(l)} multiple={false} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <MaskEditor
              ref={editor}
              src={source}
              compareUrl={comparing && original ? original.url : null}
              strokes={strokes}
              onStroke={(s) => setStrokes((prev) => [...prev, s])}
              brushSize={brush}
              mode={mode}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {file.name} · {source.width}×{source.height} · {formatBytes(file.size)}
                {history.length > 0 && ` · ${history.length} removal${history.length === 1 ? '' : 's'} applied`}
              </span>
              <span className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length || busy}>
                  <Undo2 className="h-4 w-4" /> Undo stroke
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStrokes([])} disabled={!strokes.length || busy}>
                  <Trash2 className="h-4 w-4" /> Clear
                </Button>
                {original && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onPointerDown={() => setComparing(true)}
                    onPointerUp={() => setComparing(false)}
                    onPointerLeave={() => setComparing(false)}
                  >
                    <Eye className="h-4 w-4" /> Hold to see original
                  </Button>
                )}
              </span>
            </div>
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-3">
                <SectionTitle>1 · Mark the object</SectionTitle>
                <Segmented
                  value={mode}
                  onChange={setMode}
                  options={[
                    {
                      value: 'paint',
                      label: (
                        <span className="inline-flex items-center gap-1.5">
                          <Brush className="h-3.5 w-3.5" /> Mark
                        </span>
                      ),
                      title: 'Paint red over what you want removed',
                    },
                    {
                      value: 'erase',
                      label: (
                        <span className="inline-flex items-center gap-1.5">
                          <Eraser className="h-3.5 w-3.5" /> Unmark
                        </span>
                      ),
                      title: 'Rub out part of your red marking',
                    },
                  ]}
                />
                <p className="text-xs text-slate-500">
                  {mode === 'paint'
                    ? 'Paint red over the object and its shadow. Cover it generously.'
                    : 'Unmark only removes your red marking. It does not change the photo.'}
                </p>
                <Field label="Brush size">
                  <Slider
                    value={brush}
                    onChange={setBrush}
                    min={4}
                    max={Math.max(60, Math.round(Math.max(source.width, source.height) / 6))}
                    format={(v) => `${v}px`}
                  />
                </Field>
              </div>

              <div className="space-y-3">
                <SectionTitle>2 · Fill method</SectionTitle>
                <Segmented
                  value={method}
                  onChange={setMethod}
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
                  {method === 'ai'
                    ? `A neural network (MI-GAN) invents plausible background from the surroundings. Best for complex scenes. ${
                        modelCached ? 'Model is already downloaded.' : `Downloads a ${MODEL_SIZE_LABEL} model once; runs on your device.`
                      }`
                    : 'Copies matching patches from nearby pixels. Instant, works offline, great for textures and small blemishes.'}
                </p>
              </div>

              <Button size="lg" className="w-full" onClick={remove} disabled={busy || strokes.length === 0}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {busy ? 'Working…' : 'Remove marked area'}
              </Button>
              {busy && status && <p className="-mt-3 text-center text-xs text-slate-500">{status}</p>}

              {history.length > 0 && (
                <Button variant="secondary" size="sm" className="w-full" onClick={undoRemoval} disabled={busy}>
                  <RotateCcw className="h-4 w-4" /> Undo last removal
                </Button>
              )}

              <div className="space-y-3 border-t border-slate-200 pt-4">
                <SectionTitle>3 · Save</SectionTitle>
                <FormatPicker value={format} onChange={setFormat} support={support} />
                {outputFormatFor(file, format, support) !== 'image/png' && (
                  <Field label="Quality">
                    <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
                  </Field>
                )}
                <Button variant="secondary" className="w-full" onClick={download} disabled={busy || history.length === 0}>
                  <Download className="h-4 w-4" /> Download
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={startOver} disabled={busy}>
                  Start over with another image
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
