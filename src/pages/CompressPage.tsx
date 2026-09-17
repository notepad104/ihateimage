import { useState } from 'react'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { ColorInput, Field, Notice, NumberInput, SectionTitle, Segmented, Slider, Toggle } from '../components/ui'
import { withExt } from '../lib/format'
import { resolveResize } from '../lib/geometry'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, ProcessResult } from '../lib/types'
import { anyJpegWithAlpha, anyLossy, flattenOps, outputFormatFor } from './shared'

const tool = toolById('compress')

export function CompressPage() {
  const files = useImageFiles()
  const support = useEncodeSupport()

  const [mode, setMode] = useState<'quality' | 'target'>('quality')
  const [quality, setQuality] = useState(80)
  const [targetKb, setTargetKb] = useState<number | ''>(500)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [limitDims, setLimitDims] = useState(false)
  const [maxSide, setMaxSide] = useState<number | ''>(1920)
  const [keepSmaller, setKeepSmaller] = useState(true)
  const [bg, setBg] = useState('#ffffff')

  const lossy = anyLossy(files.files, format, support)
  const pngOnly = format === 'same' && files.files.length > 0 && files.files.every((f) => f.type === 'image/png')
  const showBg = anyJpegWithAlpha(files.files, format, support)

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const ops: Op[] = []
    if (limitDims && maxSide && (file.width > maxSide || file.height > maxSide)) {
      const size = resolveResize(file, { mode: 'fit', width: maxSide, height: maxSide, noEnlarge: true })
      ops.push({ type: 'resize', ...size })
    }
    ops.push(...flattenOps(file, out, bg))

    const res = await processImage({
      source: file.file,
      ops,
      encode: {
        format: out,
        quality: mode === 'quality' ? quality / 100 : 0.95,
        targetBytes: mode === 'target' && targetKb ? targetKb * 1024 : undefined,
      },
    })

    const untouched = ops.length === 0 && out === file.type
    if (keepSmaller && untouched && res.blob.size >= file.size) {
      return {
        blob: file.file,
        name: file.name,
        width: file.width,
        height: file.height,
        note: 'Already well compressed, kept original',
      }
    }
    return {
      blob: res.blob,
      name: withExt(file.name, out),
      width: res.width,
      height: res.height,
      note: res.missedTarget ? `Could not reach ${targetKb} KB even at minimum quality` : undefined,
    }
  }

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Compress"
      process={process}
      canProcess={mode === 'quality' || (typeof targetKb === 'number' && targetKb > 0)}
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>Compression</SectionTitle>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'quality', label: 'By quality' },
                { value: 'target', label: 'Target size' },
              ]}
            />
            {mode === 'quality' ? (
              <Field label="Quality" hint={lossy ? 'Lower = smaller file. 70–85 is usually invisible.' : undefined}>
                <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} disabled={!lossy} />
              </Field>
            ) : (
              <Field label="Max file size" hint="Quality is searched automatically to fit under this size.">
                <NumberInput value={targetKb} onChange={setTargetKb} min={1} step={10} suffix="KB" />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <SectionTitle>Output format</SectionTitle>
            <FormatPicker value={format} onChange={setFormat} support={support} />
            {pngOnly && (
              <Notice tone="info">
                PNG is lossless, so savings are limited. Choose <b>WebP</b> or <b>JPG</b> for much smaller files.
              </Notice>
            )}
            {showBg && (
              <Field label="Background for transparent areas" hint="JPG can't store transparency.">
                <ColorInput value={bg} onChange={setBg} />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <SectionTitle>Dimensions</SectionTitle>
            <Toggle
              checked={limitDims}
              onChange={setLimitDims}
              label="Limit longest side"
              hint="Downscale huge photos; the biggest win for file size."
            />
            {limitDims && <NumberInput value={maxSide} onChange={setMaxSide} min={16} step={10} suffix="px" />}
            <Toggle
              checked={keepSmaller}
              onChange={setKeepSmaller}
              label="Keep original if it's already smaller"
              hint="Avoids making well-optimized files bigger."
            />
          </div>
        </>
      }
    />
  )
}
