import { useState } from 'react'
import { FormatPicker, useEncodeSupport } from '../components/FormatPicker'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { ColorInput, Field, Notice, SectionTitle, Slider } from '../components/ui'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, OutputFormat, ProcessResult } from '../lib/types'
import { anyJpegWithAlpha, flattenOps, isLossy } from './shared'

const tool = toolById('convert')

const FORMAT_TIPS: Record<OutputFormat, string> = {
  'image/jpeg': 'Best for photos. Small files, no transparency, universally supported.',
  'image/png': 'Lossless with transparency. Ideal for logos, screenshots and graphics.',
  'image/webp': 'Modern format: 25–35% smaller than JPG at the same quality, supports transparency.',
  'image/avif': 'Newest and smallest, with transparency. Slower to encode; not supported by very old browsers.',
}

export function ConvertPage() {
  const files = useImageFiles()
  const support = useEncodeSupport()
  const [format, setFormat] = useState<OutputFormat>('image/webp')
  const [quality, setQuality] = useState(90)
  const [bg, setBg] = useState('#ffffff')

  const showBg = anyJpegWithAlpha(files.files, format, support)
  const unsupported = !support[format]

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const res = await processImage({
      source: file.file,
      ops: flattenOps(file, format, bg),
      encode: { format, quality: quality / 100 },
    })
    return { blob: res.blob, name: withExt(file.name, format), width: res.width, height: res.height }
  }

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Convert"
      process={process}
      canProcess={!unsupported}
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>Convert to</SectionTitle>
            <FormatPicker value={format} onChange={(v) => v !== 'same' && setFormat(v)} allowSame={false} support={support} />
            <p className="text-xs text-slate-500">{FORMAT_TIPS[format]}</p>
            {unsupported && <Notice tone="warn">This browser can't encode that format. Try Chrome or Edge.</Notice>}
          </div>
          {isLossy(format) && (
            <div className="space-y-3">
              <SectionTitle>Quality</SectionTitle>
              <Slider value={quality} onChange={setQuality} min={1} max={100} format={(v) => `${v}%`} />
            </div>
          )}
          {showBg && (
            <Field label="Background for transparent areas" hint="JPG can't store transparency.">
              <ColorInput value={bg} onChange={setBg} />
            </Field>
          )}
        </>
      }
    />
  )
}
