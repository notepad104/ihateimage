import { Check, Copy, Download, Loader2, PenLine, Plus, RotateCcw, Signature as SignatureIcon, Type, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DropZone } from '../components/DropZone'
import { FillEditor } from '../components/FillEditor'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolGuide } from '../components/Seo'
import { InkSwatches, SignatureDialog, type SignatureBlob } from '../components/SignatureDialog'
import { Button, Field, Notice, SectionTitle, Select, Slider, Toggle } from '../components/ui'
import { downloadBlob } from '../lib/download'
import { filesFromDataTransfer, loadFiles } from '../lib/files'
import {
  FIELD_TEXT_RATIO,
  FILL_FONTS,
  INK_COLORS,
  LINE_HEIGHT,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  renderFilled,
  type FillItem,
  type ImageItem,
  type TextItem,
} from '../lib/fill'
import { detectFields, type FormField } from '../lib/formFields'
import { formatBytes, withExt } from '../lib/format'
import { OCR_SIZE_LABEL, recognizeText, releaseOcr, type OcrResult } from '../lib/ocr'
import { TOOL_SEO } from '../lib/seo'
import { toolById } from '../lib/tools'
import type { LoadedFile } from '../lib/types'
import { outputFormatFor } from './shared'

const tool = toolById('fill')

let seq = 0
const nextId = () => `i${++seq}`

interface TextStyle {
  font: string
  color: string
  bold: boolean
}

export function FillSignPage() {
  const support = useEncodeSupport()
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [ocr, setOcr] = useState<OcrResult | null>(null)
  const [fields, setFields] = useState<FormField[]>([])
  const [items, setItems] = useState<FillItem[]>([])
  const [history, setHistory] = useState<FillItem[][]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showFields, setShowFields] = useState(true)
  const [style, setStyle] = useState<TextStyle>({ font: FILL_FONTS[0].value, color: INK_COLORS[0], bold: false })
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signing, setSigning] = useState(false)
  const [savedSig, setSavedSig] = useState<SignatureBlob | null>(null)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(92)
  const [copied, setCopied] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const urls = useRef(new Set<string>())
  const analysis = useRef(0)

  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u)
      void releaseOcr()
    },
    [],
  )

  const open = useCallback(async (list: File[]) => {
    const { loaded, errors } = await loadFiles(list.slice(0, 1))
    if (errors.length) setError(errors[0].message)
    const f = loaded[0]
    if (!f) return
    setError(null)
    setFile(f)
    setOcr(null)
    setFields([])
    setItems([])
    setHistory([])
    setSelectedId(null)
    const run = ++analysis.current
    setStatus(`Reading the form…`)
    try {
      const result = await recognizeText(
        f.file,
        (frac, stage) => {
          if (run !== analysis.current) return
          setStatus(
            stage === 'download'
              ? `Loading the text recogniser (once, ${OCR_SIZE_LABEL})…`
              : stage === 'load'
                ? 'Starting the text recogniser…'
                : `Reading the form ${Math.round(frac * 100)}%`,
          )
        },
        'form',
      )
      if (run !== analysis.current) return
      setOcr(result)
      setStatus('Looking for blanks…')
      const found = await detectFields(f.file, result)
      if (run !== analysis.current) return
      setFields(found)
    } catch (e) {
      if (run !== analysis.current) return
      setError(`Could not read the form: ${e instanceof Error ? e.message : String(e)}. You can still add text and signatures by hand.`)
    } finally {
      if (run === analysis.current) setStatus(null)
    }
  }, [])

  // Paste or drop anywhere while no file is open.
  useEffect(() => {
    if (file) return
    const onPaste = (e: ClipboardEvent) => {
      const list = filesFromDataTransfer(e.clipboardData)
      if (list.length) {
        e.preventDefault()
        void open(list)
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return // the drop zone already took it
      const list = filesFromDataTransfer(e.dataTransfer)
      if (list.length) {
        e.preventDefault()
        void open(list)
      }
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [file, open])

  /** Replace the items, remembering the previous state for undo. */
  const commitItems = useCallback((next: FillItem[] | ((prev: FillItem[]) => FillItem[])) => {
    setItems((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      if (value !== prev) setHistory((h) => [...h.slice(-49), prev])
      return value
    })
  }, [])

  const snapshot = useRef<FillItem[] | null>(null)
  const change = useCallback((id: string, patch: Partial<TextItem> | Partial<ImageItem>) => {
    setItems((prev) => {
      if (!snapshot.current) snapshot.current = prev
      return prev.map((i) => (i.id === id ? ({ ...i, ...patch } as FillItem) : i))
    })
  }, [])
  const commit = useCallback(() => {
    const before = snapshot.current
    snapshot.current = null
    if (before) setHistory((h) => [...h.slice(-49), before])
  }, [])

  const undo = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1]
      if (!prev) return h
      snapshot.current = null
      setItems(prev)
      setSelectedId((s) => (prev.some((i) => i.id === s) ? s : null))
      return h.slice(0, -1)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const t = e.target as HTMLElement | null
        if (t && t.tagName === 'TEXTAREA' && (t as HTMLTextAreaElement).value) return
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  const removeItem = useCallback(
    (id: string) => {
      commitItems((prev) => prev.filter((i) => i.id !== id))
      setSelectedId((s) => (s === id ? null : s))
    },
    [commitItems],
  )

  const defaultSize = (): number => {
    if (fields.length) {
      const hs = fields.map((f) => f.box.height).sort((a, b) => a - b)
      return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, hs[Math.floor(hs.length / 2)] * FIELD_TEXT_RATIO))
    }
    return 0.022
  }

  const addText = (x: number, y: number, size = defaultSize(), text = '', fieldId?: string) => {
    const item: TextItem = { id: nextId(), kind: 'text', x, y, size, text, fieldId, ...style }
    commitItems((prev) => [...prev, item])
    setSelectedId(item.id)
  }

  const fillField = useCallback(
    (f: FormField, initial = '') => {
      if (!file) return
      const size = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, f.box.height * FIELD_TEXT_RATIO))
      const blockH = size * LINE_HEIGHT
      const padX = (0.25 * f.box.height * file.height) / file.width
      const y = f.kind === 'box' || f.kind === 'gap' ? f.box.y + (f.box.height - blockH) / 2 : f.box.y + f.box.height - blockH - 0.04 * f.box.height
      addText(f.box.x + padX, y, size, initial, f.id)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file, style],
  )

  const changeField = useCallback((id: string, box: FormField['box']) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, box } : f)))
  }, [])
  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id))
    setSelectedId((s) => (s === id ? null : s))
  }, [])

  const placeSignature = (sig: SignatureBlob) => {
    if (!file) return
    const url = URL.createObjectURL(sig.blob)
    urls.current.add(url)
    const aspect = sig.width / sig.height
    const W = file.width
    const H = file.height
    const sel = items.find((i) => i.id === selectedId)
    let rect: { x: number; y: number; width: number; height: number }
    if (sel?.kind === 'text' && !sel.text.trim()) {
      // Replace the empty text box: sit the signature on the same line, a little taller than the blank.
      const fieldH = sel.size / FIELD_TEXT_RATIO
      let h = 1.7 * fieldH
      let w = (h * H * aspect) / W
      if (w > 0.5) {
        w = 0.5
        h = (w * W) / aspect / H
      }
      const bottom = sel.y + sel.size * LINE_HEIGHT + 0.1 * fieldH
      rect = { x: sel.x, y: bottom - h, width: w, height: h }
    } else {
      const w = 0.28
      const h = (w * W) / aspect / H
      rect = { x: 0.5 - w / 2, y: 0.5 - h / 2, width: w, height: h }
    }
    const replacing = sel?.kind === 'text' && !sel.text.trim() ? sel : null
    const item: ImageItem = { id: nextId(), kind: 'image', blob: sig.blob, url, fieldId: replacing?.fieldId, ...rect }
    commitItems((prev) => [...prev.filter((i) => i.id !== replacing?.id), item])
    setSelectedId(item.id)
    setSavedSig(sig)
    setSigning(false)
  }

  const download = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const out = outputFormatFor(file, format, support)
      const { blob } = await renderFilled(file.file, items, out, quality / 100)
      downloadBlob(blob, withExt(file.name, out, '-filled'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startOver = () => {
    analysis.current++
    setFile(null)
    setOcr(null)
    setFields([])
    setItems([])
    setHistory([])
    setSelectedId(null)
    setStatus(null)
    setError(null)
  }

  const copyOcr = async () => {
    if (!ocr) return
    try {
      await navigator.clipboard.writeText(ocr.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setTextOpen(true)
    }
  }

  const selected = items.find((i) => i.id === selectedId) ?? null
  const selectedField = fields.find((f) => f.id === selectedId) ?? null
  const updateStyle = (patch: Partial<TextStyle>) => {
    setStyle((s) => ({ ...s, ...patch }))
    if (selected?.kind === 'text') commitItems((prev) => prev.map((i) => (i.id === selected.id ? { ...i, ...patch } : i)))
  }

  const Icon = tool.icon
  const hasContent = items.some((i) => i.kind === 'image' || i.text.trim())

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
          <Notice tone={file ? 'warn' : 'error'}>{error}</Notice>
        </div>
      )}

      {!file ? (
        <>
          <DropZone onFiles={(l) => void open(l)} multiple={false} camera />
          <ToolGuide page={TOOL_SEO.fill} />
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <FillEditor
              url={file.url}
              width={file.width}
              height={file.height}
              fields={fields}
              showFields={showFields}
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={change}
              onCommit={commit}
              onRemove={removeItem}
              onFieldFill={fillField}
              onFieldChange={changeField}
              onFieldRemove={removeField}
              onAddTextAt={(x, y) => {
                const size = defaultSize()
                addText(x, y - (size * LINE_HEIGHT) / 2, size)
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {file.name} · {file.width}×{file.height} · {formatBytes(file.size)}
              </span>
              <span className="flex items-center gap-2">
                {status ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status}
                  </span>
                ) : (
                  fields.length > 0 && <span>{fields.length} blank{fields.length === 1 ? '' : 's'} found</span>
                )}
                <Button variant="ghost" size="sm" onClick={undo} disabled={!history.length}>
                  <Undo2 className="h-4 w-4" /> Undo
                </Button>
              </span>
            </div>
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-3">
                <SectionTitle>1 · Fill in</SectionTitle>
                <p className="text-xs text-slate-500">
                  {status
                    ? 'The blanks will light up in blue once the form has been read.'
                    : fields.length
                      ? 'Click a blue blank and start typing. Selected blanks can be dragged, resized from the corner or removed. Double-click anywhere else to add text there.'
                      : ocr
                        ? 'No blanks were recognised. Double-click anywhere on the form to add text there.'
                        : 'Double-click anywhere on the form to add text there.'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => addText(0.5 - 0.1, 0.5, defaultSize())}>
                    <Type className="h-4 w-4" /> Add text
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setSigning(true)}>
                    <PenLine className="h-4 w-4" /> Add signature
                  </Button>
                </div>
                {savedSig && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => placeSignature(savedSig)}>
                    <Plus className="h-4 w-4" /> Place the same signature again
                  </Button>
                )}
                {fields.length > 0 && (
                  <Toggle checked={showFields} onChange={setShowFields} label="Show detected blanks" />
                )}
              </div>

              {selectedField && (
                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <SectionTitle>Selected blank</SectionTitle>
                  <p className="text-xs text-slate-500">
                    {selectedField.label ? `“${selectedField.label}”. ` : ''}Start typing to fill it in. Drag it to move, pull the corner to resize, or remove it if it is not a blank.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => fillField(selectedField)}>
                      <Type className="h-4 w-4" /> Type here
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeField(selectedField.id)}>
                      Remove blank
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-3 border-t border-slate-200 pt-4">
                <SectionTitle>{selected?.kind === 'text' ? 'Selected text' : selected ? 'Selected signature' : 'Text style'}</SectionTitle>
                {selected?.kind === 'image' ? (
                  <p className="text-xs text-slate-500">Drag the signature to move it and pull its corner to resize it.</p>
                ) : (
                  <>
                    <Field label="Font">
                      <Select value={selected?.kind === 'text' ? selected.font : style.font} onChange={(e) => updateStyle({ font: e.target.value })}>
                        {FILL_FONTS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Ink">
                      <InkSwatches value={selected?.kind === 'text' ? selected.color : style.color} onChange={(c) => updateStyle({ color: c })} />
                    </Field>
                    <Toggle checked={selected?.kind === 'text' ? selected.bold : style.bold} onChange={(v) => updateStyle({ bold: v })} label="Bold" />
                    {selected?.kind === 'text' && (
                      <Field label="Size" hint="Or drag the corner of the text box">
                        <Slider
                          value={Math.round(selected.size * file.height)}
                          min={Math.max(6, Math.round(MIN_TEXT_SIZE * file.height))}
                          max={Math.round(MAX_TEXT_SIZE * file.height)}
                          onChange={(v) => change(selected.id, { size: v / file.height })}
                          onCommit={commit}
                          format={(v) => `${v}px`}
                        />
                      </Field>
                    )}
                  </>
                )}
                {selected && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => removeItem(selected.id)}>
                    Remove this {selected.kind === 'text' ? 'text' : 'signature'}
                  </Button>
                )}
              </div>

              {ocr && (
                <div className="space-y-2 border-t border-slate-200 pt-4">
                  <SectionTitle>Text on the form</SectionTitle>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => void copyOcr()} disabled={!ocr.text}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copied' : 'Copy the text'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setTextOpen((o) => !o)}>
                      {textOpen ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                  {textOpen && (
                    <textarea
                      readOnly
                      value={ocr.text || 'No text was found.'}
                      rows={8}
                      aria-label="Text recognised on the form"
                      className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs leading-relaxed text-slate-800"
                      onFocus={(e) => e.target.select()}
                    />
                  )}
                </div>
              )}

              <div className="space-y-3 border-t border-slate-200 pt-4">
                <SectionTitle>2 · Save</SectionTitle>
                <FormatPicker value={format} onChange={setFormat} support={support} />
                {outputFormatFor(file, format, support) !== 'image/png' && (
                  <Field label="Quality">
                    <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
                  </Field>
                )}
                <Button size="lg" className="w-full" onClick={() => void download()} disabled={busy || !hasContent}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {busy ? 'Saving…' : 'Download'}
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={startOver} disabled={busy}>
                  <RotateCcw className="h-4 w-4" /> Start over with another form
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {signing && <SignatureDialog onDone={placeSignature} onCancel={() => setSigning(false)} />}
      <span className="hidden">
        <SignatureIcon />
      </span>
    </div>
  )
}
