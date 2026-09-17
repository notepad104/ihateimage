import { useEffect, useMemo, useState } from 'react'
import { CropEditor } from '../components/CropEditor'
import { FileGrid } from '../components/FileGrid'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, Notice, NumberInput, SectionTitle, Segmented, Slider, cx } from '../components/ui'
import { withExt } from '../lib/format'
import { cropToRatio, padToRatio, parseRatio } from '../lib/geometry'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { Gravity, LoadedFile, Op, ProcessResult, Rect } from '../lib/types'
import { anyJpegWithAlpha, anyLossy, flattenOps, outputFormatFor } from './shared'

const tool = toolById('aspect')

const PRESETS: { id: string; label: string; ratio: string; hint: string }[] = [
  { id: 'free', label: 'Free', ratio: '', hint: 'Any crop' },
  { id: '1:1', label: '1:1', ratio: '1:1', hint: 'Square · Instagram post' },
  { id: '4:5', label: '4:5', ratio: '4:5', hint: 'Instagram portrait' },
  { id: '9:16', label: '9:16', ratio: '9:16', hint: 'Stories · Reels · TikTok' },
  { id: '16:9', label: '16:9', ratio: '16:9', hint: 'YouTube · widescreen' },
  { id: '4:3', label: '4:3', ratio: '4:3', hint: 'Classic photo' },
  { id: '3:2', label: '3:2', ratio: '3:2', hint: 'DSLR · 6×4 print' },
  { id: '3:4', label: '3:4', ratio: '3:4', hint: 'Portrait' },
  { id: '2:3', label: '2:3', ratio: '2:3', hint: 'Pinterest · 4×6 print' },
  { id: '1.91:1', label: '1.91:1', ratio: '1.91:1', hint: 'Facebook / LinkedIn link' },
  { id: 'custom', label: 'Custom', ratio: '', hint: 'Your own W:H' },
]

const GRAVITIES: Gravity[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']

export function AspectRatioPage() {
  const files = useImageFiles()
  const support = useEncodeSupport()

  const [mode, setMode] = useState<'crop' | 'pad'>('crop')
  const [presetId, setPresetId] = useState('1:1')
  const [customW, setCustomW] = useState<number | ''>(5)
  const [customH, setCustomH] = useState<number | ''>(4)
  const [gravity, setGravity] = useState<Gravity>('center')
  const [padColor, setPadColor] = useState('#ffffff')
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(92)
  const [bg, setBg] = useState('#ffffff')
  /** Manual crop rectangles per file, overriding the gravity-based default. */
  const [manual, setManual] = useState<Record<string, Rect>>({})

  const ratio: number | null = useMemo(() => {
    if (presetId === 'free') return null
    if (presetId === 'custom') return customW && customH ? customW / customH : null
    return parseRatio(PRESETS.find((p) => p.id === presetId)!.ratio)
  }, [presetId, customW, customH])

  // Any change to the geometry settings invalidates manual adjustments.
  useEffect(() => setManual({}), [ratio, gravity, mode])

  const effectivePad = mode === 'pad' && ratio === null ? false : true
  const canProcess = mode === 'crop' ? true : ratio !== null

  const defaultRect = (file: LoadedFile): Rect =>
    ratio === null ? { x: 0, y: 0, width: file.width, height: file.height } : cropToRatio(file, ratio, gravity)
  const rectFor = (file: LoadedFile): Rect => manual[file.id] ?? defaultRect(file)

  const lossy = anyLossy(files.files, format, support)
  const showBg = anyJpegWithAlpha(files.files, format, support)
  const outIsJpeg = files.files.length > 0 && files.files.every((f) => outputFormatFor(f, format, support) === 'image/jpeg')

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const ops: Op[] = []
    if (mode === 'crop') {
      const r = rectFor(file)
      if (r.x !== 0 || r.y !== 0 || r.width !== file.width || r.height !== file.height) ops.push({ type: 'crop', ...r })
    } else if (ratio !== null) {
      const size = padToRatio(file, ratio)
      const color = out === 'image/jpeg' && padColor === 'transparent' ? '#ffffff' : padColor
      if (size.width !== file.width || size.height !== file.height) ops.push({ type: 'pad', ...size, color })
    }
    ops.push(...flattenOps(file, out, bg))
    const res = await processImage({ source: file.file, ops, encode: { format: out, quality: quality / 100 } })
    return { blob: res.blob, name: withExt(file.name, out), width: res.width, height: res.height }
  }

  const selected = files.selected
  const preset = PRESETS.find((p) => p.id === presetId)!

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel={mode === 'crop' ? 'Crop' : 'Add borders'}
      process={process}
      canProcess={canProcess}
      onReset={() => setManual({})}
      preview={
        selected && (
          <div className="space-y-4">
            {mode === 'crop' ? (
              <>
                <CropEditor
                  key={`${selected.id}-${ratio}-${gravity}`}
                  file={selected}
                  rect={rectFor(selected)}
                  ratio={ratio}
                  onChange={(r) => setManual((m) => ({ ...m, [selected.id]: r }))}
                />
                <p className="text-center text-xs text-slate-500">
                  Drag the frame or its handles to choose what to keep.{' '}
                  {files.files.length > 1 && 'Other images use the position picked on the right unless you adjust them here.'}
                  {manual[selected.id] && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="font-medium text-brand-700 hover:underline"
                        onClick={() =>
                          setManual((m) => {
                            const { [selected.id]: _, ...rest } = m
                            return rest
                          })
                        }
                      >
                        Reset this crop
                      </button>
                    </>
                  )}
                </p>
              </>
            ) : (
              <PadPreview file={selected} ratio={ratio} color={padColor} />
            )}
            {files.files.length > 1 && (
              <FileGrid files={files.files} selectedId={files.selectedId} onSelect={files.select} onRemove={files.remove} />
            )}
          </div>
        )
      }
      options={
        <>
          <div className="space-y-3">
            <SectionTitle>Method</SectionTitle>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'crop', label: 'Crop' },
                { value: 'pad', label: 'Add borders' },
              ]}
            />
            <p className="text-xs text-slate-500">
              {mode === 'crop'
                ? 'Cuts away the edges to reach the new ratio. Nothing is stretched.'
                : 'Keeps the whole image and fills the extra space with a color. Nothing is cut off.'}
            </p>
          </div>

          <div className="space-y-3">
            <SectionTitle>Aspect ratio</SectionTitle>
            <div className="grid grid-cols-4 gap-1.5">
              {PRESETS.filter((p) => mode === 'crop' || p.id !== 'free').map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => setPresetId(p.id)}
                  className={cx(
                    'rounded-lg border px-2 py-1.5 text-xs font-medium',
                    presetId === p.id
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">{preset.hint}</p>
            {presetId === 'custom' && (
              <div className="flex items-center gap-2">
                <NumberInput value={customW} onChange={setCustomW} min={1} step={1} placeholder="W" />
                <span className="text-slate-500">:</span>
                <NumberInput value={customH} onChange={setCustomH} min={1} step={1} placeholder="H" />
              </div>
            )}
            {!effectivePad && <Notice tone="warn">Pick a ratio to add borders.</Notice>}
          </div>

          {mode === 'crop' && ratio !== null && (
            <div className="space-y-3">
              <SectionTitle>Keep which part</SectionTitle>
              <div className="flex items-center gap-4">
                <div className="grid shrink-0 grid-cols-3 gap-1">
                  {GRAVITIES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-label={g}
                      title={g.replace('-', ' ')}
                      onClick={() => setGravity(g)}
                      className={cx(
                        'h-8 w-8 rounded-md border',
                        gravity === g ? 'border-brand-500 bg-brand-500' : 'border-slate-300 bg-white hover:bg-slate-100',
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Default anchor for every image. Fine-tune any single image by dragging its frame.
                </p>
              </div>
            </div>
          )}

          {mode === 'pad' && (
            <Field label="Border color" hint={outIsJpeg ? 'JPG output can’t be transparent.' : undefined}>
              <ColorInput value={padColor} onChange={setPadColor} allowTransparent={!outIsJpeg} />
            </Field>
          )}

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
          {selected && mode === 'crop' && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setManual({})}
              disabled={Object.keys(manual).length === 0}
            >
              Reset all manual crops
            </Button>
          )}
        </>
      }
    />
  )
}

function PadPreview({ file, ratio, color }: { file: LoadedFile; ratio: number | null; color: string }) {
  const size = ratio === null ? { width: file.width, height: file.height } : padToRatio(file, ratio)
  const transparent = color === 'transparent'
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cx('flex max-h-[520px] w-full items-center justify-center overflow-hidden rounded-xl', transparent && 'checker')}
        style={{ aspectRatio: `${size.width} / ${size.height}`, backgroundColor: transparent ? undefined : color }}
      >
        <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" />
      </div>
      <p className="text-xs text-slate-500">
        {file.width}×{file.height} → {size.width}×{size.height}
      </p>
    </div>
  )
}
