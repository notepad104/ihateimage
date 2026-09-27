import { Check, Copy, Download, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DropZone } from '../components/DropZone'
import { ToolGuide } from '../components/Seo'
import { useImageFiles } from '../components/ToolShell'
import { Button, Notice, Segmented, cx } from '../components/ui'
import { downloadBlob, safeFileName } from '../lib/download'
import { filesFromDataTransfer } from '../lib/files'
import { formatBytes } from '../lib/format'
import { flowParagraphs, OCR_SIZE_LABEL, recognizeText, releaseOcr, type OcrResult } from '../lib/ocr'
import { TOOL_SEO } from '../lib/seo'
import { toolById } from '../lib/tools'

const tool = toolById('ocr')

type Job =
  | { state: 'queued' }
  | { state: 'running'; status: string }
  | { state: 'done'; result: OcrResult; text: string }
  | { state: 'error'; message: string }

type Breaks = 'lines' | 'flow'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, '')
}

export function OcrPage() {
  const files = useImageFiles(true)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [breaks, setBreaks] = useState<Breaks>('lines')
  const [copied, setCopied] = useState<string | null>(null)
  const started = useRef(new Set<string>())

  useEffect(() => () => void releaseOcr(), [])

  // Paste or drop anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const list = filesFromDataTransfer(e.clipboardData)
      if (list.length) {
        e.preventDefault()
        void files.add(list)
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return // the drop zone already took it
      const list = filesFromDataTransfer(e.dataTransfer)
      if (list.length) {
        e.preventDefault()
        void files.add(list)
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
  }, [files])

  // Recognise every new file, one at a time.
  useEffect(() => {
    for (const f of files.files) {
      if (started.current.has(f.id)) continue
      started.current.add(f.id)
      setJobs((j) => ({ ...j, [f.id]: { state: 'queued' } }))
      void recognizeText(f.file, (frac, stage) => {
        const status =
          stage === 'download'
            ? `Loading the recogniser (once, ${OCR_SIZE_LABEL})…`
            : stage === 'load'
              ? 'Starting the recogniser…'
              : `Reading text ${Math.round(frac * 100)}%`
        setJobs((j) => (j[f.id]?.state === 'done' ? j : { ...j, [f.id]: { state: 'running', status } }))
      })
        .then((result) => setJobs((j) => ({ ...j, [f.id]: { state: 'done', result, text: result.text } })))
        .catch((e: unknown) => setJobs((j) => ({ ...j, [f.id]: { state: 'error', message: e instanceof Error ? e.message : String(e) } })))
    }
  }, [files.files])

  const remove = (id: string) => {
    files.remove(id)
    started.current.delete(id)
    setJobs((j) => {
      const next = { ...j }
      delete next[id]
      return next
    })
  }

  const shown = (id: string): string => {
    const j = jobs[id]
    if (j?.state !== 'done') return ''
    return breaks === 'flow' ? flowParagraphs(j.text) : j.text
  }

  const flash = (key: string) => {
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
  }

  const allText = files.files
    .map((f) => shown(f.id))
    .filter(Boolean)
    .join('\n\n')
  const doneCount = files.files.filter((f) => jobs[f.id]?.state === 'done').length
  const anyRunning = files.files.some((f) => jobs[f.id]?.state === 'queued' || jobs[f.id]?.state === 'running')

  const Icon = tool.icon

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
        <div className="mb-4 space-y-2">
          {files.errors.map((e) => (
            <Notice key={e.name} tone="warn">
              {e.name}: {e.message}
            </Notice>
          ))}
        </div>
      )}

      {files.files.length === 0 ? (
        <>
          <DropZone onFiles={(l) => void files.add(l)} multiple camera busy={files.loading} />
          <ToolGuide page={TOOL_SEO.ocr} />
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-600">Line breaks</span>
              <Segmented
                value={breaks}
                onChange={setBreaks}
                size="sm"
                fill={false}
                options={[
                  { value: 'lines', label: 'As in the image', title: 'One line of text per line in the image' },
                  { value: 'flow', label: 'Flow into paragraphs', title: 'Join the lines of each paragraph, handy for pasting into a document' },
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!allText}
                onClick={() => void copyText(allText).then((ok) => ok && flash('all'))}
              >
                {copied === 'all' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === 'all' ? 'Copied' : files.files.length > 1 ? 'Copy all' : 'Copy text'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!allText}
                onClick={() =>
                  downloadBlob(
                    new Blob([allText], { type: 'text/plain;charset=utf-8' }),
                    files.files.length === 1 ? `${safeFileName(stripExt(files.files[0].name), 'text')}.txt` : 'text.txt',
                  )
                }
              >
                <Download className="h-4 w-4" /> Save as .txt
              </Button>
              <Button variant="ghost" size="sm" onClick={files.clear} disabled={anyRunning}>
                <Trash2 className="h-4 w-4" /> Clear
              </Button>
            </div>
          </div>

          <ul className="space-y-4">
            {files.files.map((f) => {
              const job = jobs[f.id]
              const text = shown(f.id)
              return (
                <li key={f.id} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[220px_1fr]">
                  <div className="space-y-2">
                    <div className="checker overflow-hidden rounded-lg border border-slate-200">
                      <img src={f.url} alt={f.name} className="max-h-64 w-full object-contain" />
                    </div>
                    <p className="truncate text-xs text-slate-500" title={f.name}>
                      {f.name} · {f.width}×{f.height} · {formatBytes(f.size)}
                    </p>
                    {job?.state === 'done' && (
                      <p className={cx('text-xs', job.result.confidence < 60 ? 'text-amber-700' : 'text-slate-500')}>
                        Confidence {Math.round(job.result.confidence)}%
                        {job.result.confidence < 60 && ' · low; try a sharper, straighter photo'}
                      </p>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    {job?.state === 'done' ? (
                      <>
                        <textarea
                          readOnly
                          value={text || 'No text was found in this image.'}
                          aria-label={`Text found in ${f.name}`}
                          className="min-h-40 w-full flex-1 resize-y rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-sm leading-relaxed text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                          rows={Math.min(18, Math.max(6, text.split('\n').length + 1))}
                          onFocus={(e) => e.target.select()}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-500">
                            {text ? `${text.split(/\s+/).filter(Boolean).length} words` : ''}
                          </span>
                          <div className="flex gap-2">
                            <Button size="sm" disabled={!text} onClick={() => void copyText(text).then((ok) => ok && flash(f.id))}>
                              {copied === f.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              {copied === f.id ? 'Copied' : 'Copy'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => remove(f.id)} aria-label={`Remove ${f.name}`}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : job?.state === 'error' ? (
                      <Notice tone="error">{job.message}</Notice>
                    ) : (
                      <div className="flex flex-1 items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {job?.state === 'running' ? job.status : 'Waiting…'}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <DropZone onFiles={(l) => void files.add(l)} multiple compact camera busy={files.loading} />
          {doneCount > 0 && (
            <p className="text-center text-xs text-slate-500">
              Text is recognised on your device with Tesseract. English only for now; printed text works far better than handwriting.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
