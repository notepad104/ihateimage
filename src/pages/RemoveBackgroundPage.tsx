import { useEffect, useRef, useState } from 'react'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { ColorInput, Field, Notice, SectionTitle, Segmented } from '../components/ui'
import { BG_MODELS, isBgModelCached, removeBackgroundLocal, type BgModel } from '../lib/bgRemove'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, OutputFormat, ProcessResult } from '../lib/types'

const tool = toolById('remove-bg')

export function RemoveBackgroundPage() {
  const files = useImageFiles()
  const [model, setModel] = useState<BgModel>('fast')
  const [cached, setCached] = useState<Record<BgModel, boolean>>({ fast: false, best: false })
  const [bgMode, setBgMode] = useState<'transparent' | 'color'>('transparent')
  const [color, setColor] = useState('#ffffff')
  const [outFormat, setOutFormat] = useState<OutputFormat>('image/png')
  const [status, setStatus] = useState<string | null>(null)
  /** Cache cut-outs so changing only the background color doesn't re-run the model. */
  const cache = useRef(new Map<string, Blob>())

  useEffect(() => {
    void Promise.all([isBgModelCached('fast'), isBgModelCached('best')]).then(([fast, best]) => setCached({ fast, best }))
  }, [])

  const process = async (file: LoadedFile, onProgress: (p: number) => void): Promise<ProcessResult> => {
    const cacheKey = `${file.id}:${model}`
    let cutout = cache.current.get(cacheKey)

    if (!cutout) {
      cutout = await removeBackgroundLocal(file.file, model, (frac, stage) => {
        if (stage === 'download') {
          setStatus(`Downloading AI model ${Math.round(frac * 100)}% (once, ${BG_MODELS[model].sizeLabel})…`)
          onProgress(0.6 * frac)
        } else if (stage === 'load') {
          setStatus('Starting AI model…')
          onProgress(0.6)
        } else {
          setStatus('Finding the subject…')
          onProgress(0.65 + 0.35 * frac)
        }
      })
      cache.current.set(cacheKey, cutout)
      setCached((c) => ({ ...c, [model]: true }))
    }
    setStatus(null)

    const ops: Op[] = []
    let format: OutputFormat = 'image/png'
    if (bgMode === 'color') {
      ops.push({ type: 'flatten', color })
      format = outFormat
    }
    const res = await processImage({ source: cutout, ops, encode: { format, quality: 0.92 } })
    return { blob: res.blob, name: withExt(file.name, format, '-no-bg'), width: res.width, height: res.height }
  }

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Remove background"
      process={process}
      concurrency={1}
      statusText={status}
      options={
        <>
          <Notice tone="info">
            {cached[model]
              ? 'The AI model is already on this device. Your photos are processed entirely in your browser.'
              : `The first run downloads the AI model (${BG_MODELS[model].sizeLabel}) to your browser and keeps it. Your photos are still processed entirely on this device.`}
          </Notice>

          <div className="space-y-3">
            <SectionTitle>Model</SectionTitle>
            <Segmented
              value={model}
              onChange={setModel}
              options={(Object.keys(BG_MODELS) as BgModel[]).map((m) => ({
                value: m,
                label: BG_MODELS[m].label,
                title: BG_MODELS[m].sizeLabel,
              }))}
            />
            <p className="text-xs text-slate-500">{BG_MODELS[model].blurb}</p>
          </div>

          <div className="space-y-3">
            <SectionTitle>New background</SectionTitle>
            <Segmented
              value={bgMode}
              onChange={setBgMode}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'color', label: 'Solid color' },
              ]}
            />
            {bgMode === 'color' && (
              <>
                <ColorInput value={color} onChange={setColor} />
                <Field label="Save as">
                  <Segmented
                    value={outFormat}
                    onChange={setOutFormat}
                    options={[
                      { value: 'image/png', label: 'PNG' },
                      { value: 'image/jpeg', label: 'JPG' },
                      { value: 'image/webp', label: 'WebP' },
                    ]}
                  />
                </Field>
              </>
            )}
            {bgMode === 'transparent' && <p className="text-xs text-slate-500">Saved as PNG to keep transparency.</p>}
          </div>
        </>
      }
    />
  )
}
