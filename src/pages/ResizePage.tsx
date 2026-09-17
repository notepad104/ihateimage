import { Link2, Link2Off } from 'lucide-react'
import { useState } from 'react'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, NumberInput, SectionTitle, Segmented, Slider, Toggle } from '../components/ui'
import { withExt } from '../lib/format'
import { resolveResize, type ResizeSpec } from '../lib/geometry'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, ProcessResult } from '../lib/types'
import { anyJpegWithAlpha, anyLossy, flattenOps, outputFormatFor } from './shared'

const tool = toolById('resize')
const WIDTH_PRESETS = [640, 1080, 1280, 1920, 2560]

export function ResizePage() {
  const files = useImageFiles()
  const support = useEncodeSupport()

  const [mode, setMode] = useState<ResizeSpec['mode']>('pixels')
  const [width, setWidth] = useState<number | ''>('')
  const [height, setHeight] = useState<number | ''>('')
  const [lock, setLock] = useState(true)
  const [percent, setPercent] = useState(50)
  const [fitW, setFitW] = useState<number | ''>(1920)
  const [fitH, setFitH] = useState<number | ''>(1080)
  const [noEnlarge, setNoEnlarge] = useState(true)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(90)
  const [bg, setBg] = useState('#ffffff')

  const spec: ResizeSpec =
    mode === 'pixels'
      ? { mode, width: width || undefined, height: height || undefined, lockAspect: lock, noEnlarge }
      : mode === 'percent'
        ? { mode, percent, noEnlarge }
        : { mode, width: fitW || undefined, height: fitH || undefined, noEnlarge }

  const canProcess =
    mode === 'percent' ? percent > 0 : mode === 'pixels' ? Boolean(width || height) : Boolean(fitW && fitH)

  const selected = files.selected
  const previewSize = selected && canProcess ? resolveResize(selected, spec) : null
  const lossy = anyLossy(files.files, format, support)
  const showBg = anyJpegWithAlpha(files.files, format, support)

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const size = resolveResize(file, spec)
    const ops: Op[] = []
    if (size.width !== file.width || size.height !== file.height) ops.push({ type: 'resize', ...size })
    ops.push(...flattenOps(file, out, bg))
    const res = await processImage({ source: file.file, ops, encode: { format: out, quality: quality / 100 } })
    return { blob: res.blob, name: withExt(file.name, out), width: res.width, height: res.height }
  }

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Resize"
      process={process}
      canProcess={canProcess}
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>New size</SectionTitle>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'pixels', label: 'Pixels' },
                { value: 'percent', label: 'Percent' },
                { value: 'fit', label: 'Fit inside' },
              ]}
            />

            {mode === 'pixels' && (
              <>
                <div className="flex items-end gap-2">
                  <Field label="Width">
                    <NumberInput value={width} onChange={setWidth} min={1} suffix="px" placeholder="auto" />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mb-0.5 shrink-0 px-2"
                    title={lock ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                    onClick={() => setLock(!lock)}
                  >
                    {lock ? <Link2 className="h-4 w-4 text-brand-600" /> : <Link2Off className="h-4 w-4 text-slate-400" />}
                  </Button>
                  <Field label="Height">
                    <NumberInput value={height} onChange={setHeight} min={1} suffix="px" placeholder="auto" />
                  </Field>
                </div>
                <p className="text-xs text-slate-500">
                  {lock
                    ? 'Leave one side blank to keep proportions. With both filled, the image fits inside the box.'
                    : 'Both sides are applied exactly. Images may look stretched.'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {WIDTH_PRESETS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => {
                        setWidth(w)
                        setHeight('')
                      }}
                      className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs text-slate-700 hover:border-brand-400 hover:text-brand-700"
                    >
                      {w}w
                    </button>
                  ))}
                </div>
              </>
            )}

            {mode === 'percent' && (
              <Field label="Scale">
                <Slider value={percent} onChange={setPercent} min={1} max={200} format={(v) => `${v}%`} />
              </Field>
            )}

            {mode === 'fit' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Max width">
                  <NumberInput value={fitW} onChange={setFitW} min={1} suffix="px" />
                </Field>
                <Field label="Max height">
                  <NumberInput value={fitH} onChange={setFitH} min={1} suffix="px" />
                </Field>
              </div>
            )}

            <Toggle checked={noEnlarge} onChange={setNoEnlarge} label="Don't enlarge smaller images" />

            {selected && previewSize && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="font-medium text-slate-800">{selected.name}</span>: {selected.width}×{selected.height} →{' '}
                <span className="font-medium text-slate-800">
                  {previewSize.width}×{previewSize.height}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-3">
            <SectionTitle>Output</SectionTitle>
            <FormatPicker value={format} onChange={setFormat} support={support} />
            {lossy && (
              <Field label="Quality">
                <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
              </Field>
            )}
            {showBg && (
              <Field label="Background for transparent areas">
                <ColorInput value={bg} onChange={setBg} />
              </Field>
            )}
          </div>
        </>
      }
    />
  )
}
