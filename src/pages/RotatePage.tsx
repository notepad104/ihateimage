import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { FileGrid } from '../components/FileGrid'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, SectionTitle, Slider, cx } from '../components/ui'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, ProcessResult } from '../lib/types'
import { anyJpegWithAlpha, anyLossy, flattenOps, outputFormatFor } from './shared'

const tool = toolById('rotate')

export function RotatePage() {
  const files = useImageFiles()
  const support = useEncodeSupport()
  const [degrees, setDegrees] = useState<0 | 90 | 180 | 270>(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(92)
  const [bg, setBg] = useState('#ffffff')

  const lossy = anyLossy(files.files, format, support)
  const showBg = anyJpegWithAlpha(files.files, format, support)
  const changed = degrees !== 0 || flipH || flipV

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const ops: Op[] = []
    if (flipH || flipV) ops.push({ type: 'flip', horizontal: flipH, vertical: flipV })
    if (degrees !== 0) ops.push({ type: 'rotate', degrees })
    ops.push(...flattenOps(file, out, bg))
    const res = await processImage({ source: file.file, ops, encode: { format: out, quality: quality / 100 } })
    return { blob: res.blob, name: withExt(file.name, out), width: res.width, height: res.height }
  }

  const selected = files.selected
  const transform = `rotate(${degrees}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Apply"
      process={process}
      canProcess={changed}
      preview={
        selected && (
          <div className="space-y-4">
            <div className="checker flex h-[420px] items-center justify-center overflow-hidden rounded-xl">
              <img
                src={selected.url}
                alt={selected.name}
                className="max-h-[400px] max-w-full object-contain transition-transform duration-300"
                style={{ transform, maxWidth: degrees === 90 || degrees === 270 ? 400 : undefined }}
              />
            </div>
            <FileGrid files={files.files} selectedId={files.selectedId} onSelect={files.select} onRemove={files.remove} />
          </div>
        )
      }
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>Rotate</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setDegrees(((degrees + 270) % 360) as typeof degrees)}>
                <RotateCcw className="h-4 w-4" /> 90° left
              </Button>
              <Button variant="secondary" onClick={() => setDegrees(((degrees + 90) % 360) as typeof degrees)}>
                <RotateCw className="h-4 w-4" /> 90° right
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
              {([0, 90, 180, 270] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDegrees(d)}
                  className={cx(
                    'rounded-md py-1 font-medium',
                    degrees === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  {d}°
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <SectionTitle>Flip</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={flipH ? 'primary' : 'secondary'} onClick={() => setFlipH(!flipH)}>
                <FlipHorizontal2 className="h-4 w-4" /> Horizontal
              </Button>
              <Button variant={flipV ? 'primary' : 'secondary'} onClick={() => setFlipV(!flipV)}>
                <FlipVertical2 className="h-4 w-4" /> Vertical
              </Button>
            </div>
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
