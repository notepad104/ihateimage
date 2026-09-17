import { useRef, useState } from 'react'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { ColorInput, Field, Notice, SectionTitle, Segmented } from '../components/ui'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, OutputFormat, ProcessResult } from '../lib/types'

const tool = toolById('remove-bg')

type Model = 'isnet_quint8' | 'isnet_fp16' | 'isnet'
const MODEL_INFO: Record<Model, { label: string; size: string }> = {
  isnet_quint8: { label: 'Fast', size: '~40 MB' },
  isnet_fp16: { label: 'Balanced', size: '~80 MB' },
  isnet: { label: 'Best', size: '~170 MB' },
}

export function RemoveBackgroundPage() {
  const files = useImageFiles()
  const [model, setModel] = useState<Model>('isnet_fp16')
  const [bgMode, setBgMode] = useState<'transparent' | 'color'>('transparent')
  const [color, setColor] = useState('#ffffff')
  const [outFormat, setOutFormat] = useState<OutputFormat>('image/png')
  const [status, setStatus] = useState<string | null>(null)
  /** Cache cut-outs so changing only the background color doesn't re-run the model. */
  const cache = useRef(new Map<string, Blob>())

  const process = async (file: LoadedFile, onProgress: (p: number) => void): Promise<ProcessResult> => {
    const cacheKey = `${file.id}:${model}`
    let cutout = cache.current.get(cacheKey)

    if (!cutout) {
      const { removeBackground } = await import('@imgly/background-removal')
      cutout = await removeBackground(file.file, {
        model,
        output: { format: 'image/png', quality: 1 },
        progress: (key, current, total) => {
          const frac = total > 0 ? current / total : 0
          if (key.startsWith('fetch')) {
            setStatus('Downloading AI model (first time only)…')
            onProgress(0.7 * frac)
          } else {
            setStatus('Finding the subject…')
            onProgress(0.7 + 0.3 * frac)
          }
        },
      })
      cache.current.set(cacheKey, cutout)
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
            The first run downloads the AI model ({MODEL_INFO[model].size}) to your browser and caches it. Your photos
            are still processed entirely on this device.
          </Notice>

          <div className="space-y-3">
            <SectionTitle>Model</SectionTitle>
            <Segmented
              value={model}
              onChange={setModel}
              options={(Object.keys(MODEL_INFO) as Model[]).map((m) => ({
                value: m,
                label: MODEL_INFO[m].label,
                title: MODEL_INFO[m].size,
              }))}
            />
            <p className="text-xs text-slate-500">
              {model === 'isnet_quint8' && 'Smallest download, good for simple subjects.'}
              {model === 'isnet_fp16' && 'Good edges on hair and fine detail. Recommended.'}
              {model === 'isnet' && 'Highest fidelity mask. Large download and slower.'}
            </p>
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
