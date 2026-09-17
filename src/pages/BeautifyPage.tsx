import { Pipette, RotateCcw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BeautifyPreview, PresetStrip, opsFor } from '../components/BeautifyPreview'
import { FileGrid } from '../components/FileGrid'
import { FormatPicker, useEncodeSupport, type FormatChoice } from '../components/FormatPicker'
import { ToolShell, useImageFiles } from '../components/ToolShell'
import { Button, ColorInput, Field, SectionTitle, Slider, Toggle, cx } from '../components/ui'
import {
  applyPreset,
  DEFAULT_ADJUST,
  PRESETS,
  type AdjustParams,
  type Preset,
  type RecolorRule,
  type SliderKey,
} from '../lib/adjust'
import { withExt } from '../lib/format'
import { processImage } from '../lib/process'
import { toolById } from '../lib/tools'
import type { LoadedFile, Op, ProcessResult } from '../lib/types'
import { anyJpegWithAlpha, anyLossy, flattenOps, outputFormatFor } from './shared'

const tool = toolById('beautify')

const GROUPS: { title: string; sliders: { key: SliderKey; label: string; min?: number; max?: number }[] }[] = [
  {
    title: 'Light',
    sliders: [
      { key: 'exposure', label: 'Exposure' },
      { key: 'brightness', label: 'Brightness' },
      { key: 'contrast', label: 'Contrast' },
      { key: 'highlights', label: 'Highlights' },
      { key: 'shadows', label: 'Shadows' },
    ],
  },
  {
    title: 'Color',
    sliders: [
      { key: 'temperature', label: 'Temperature' },
      { key: 'tint', label: 'Tint' },
      { key: 'saturation', label: 'Saturation' },
      { key: 'vibrance', label: 'Vibrance' },
      { key: 'hue', label: 'Hue shift', min: -180, max: 180 },
    ],
  },
  {
    title: 'Detail & effects',
    sliders: [
      { key: 'sharpen', label: 'Sharpen', min: 0 },
      { key: 'blur', label: 'Soften', min: 0 },
      { key: 'vignette', label: 'Vignette', min: 0 },
      { key: 'grain', label: 'Grain', min: 0 },
    ],
  },
]

let ruleSeq = 0

export function BeautifyPage() {
  const files = useImageFiles()
  const support = useEncodeSupport()
  const [params, setParams] = useState<AdjustParams>(DEFAULT_ADJUST)
  const [presetId, setPresetId] = useState<string | null>('original')
  const [pickMode, setPickMode] = useState(false)
  const [format, setFormat] = useState<FormatChoice>('same')
  const [quality, setQuality] = useState(92)
  const [bg, setBg] = useState('#ffffff')

  const set = (key: SliderKey, value: number) => {
    setPresetId(null)
    setParams((p) => ({ ...p, [key]: value }))
  }

  const choosePreset = (preset: Preset) => {
    setPresetId(preset.id)
    setParams((p) => applyPreset(p, preset))
  }

  const addRule = (hex: string) => {
    setPickMode(false)
    ruleSeq += 1
    const rule: RecolorRule = { id: `r${ruleSeq}`, from: hex, to: hex, tolerance: 35 }
    setParams((p) => ({ ...p, recolor: [...p.recolor, rule] }))
  }
  const updateRule = (id: string, patch: Partial<RecolorRule>) =>
    setParams((p) => ({ ...p, recolor: p.recolor.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  const removeRule = (id: string) => setParams((p) => ({ ...p, recolor: p.recolor.filter((r) => r.id !== id) }))

  const lossy = anyLossy(files.files, format, support)
  const showBg = anyJpegWithAlpha(files.files, format, support)
  const selected = files.selected
  const ops = useMemo(() => opsFor(params), [params])

  const process = async (file: LoadedFile): Promise<ProcessResult> => {
    const out = outputFormatFor(file, format, support)
    const all: Op[] = [...ops, ...flattenOps(file, out, bg)]
    const res = await processImage({ source: file.file, ops: all, encode: { format: out, quality: quality / 100 } })
    return { blob: res.blob, name: withExt(file.name, out), width: res.width, height: res.height }
  }

  return (
    <ToolShell
      tool={tool}
      files={files}
      processLabel="Apply to"
      process={process}
      canProcess={ops.length > 0}
      preview={
        selected && (
          <div className="space-y-4">
            <BeautifyPreview
              file={selected}
              params={params}
              pickMode={pickMode}
              onPick={addRule}
              onCancelPick={() => setPickMode(false)}
            />
            <PresetStrip file={selected} activeId={presetId} onSelect={choosePreset} />
            {files.files.length > 1 && (
              <FileGrid files={files.files} selectedId={files.selectedId} onSelect={files.select} onRemove={files.remove} />
            )}
          </div>
        )
      }
      options={
        <>
          <div className="flex items-center justify-between">
            <SectionTitle>Adjustments</SectionTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => choosePreset(PRESETS[0])}
              disabled={ops.length === 0}
              title="Reset all"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          </div>
          <Toggle
            checked={params.auto}
            onChange={(v) => {
              setPresetId(null)
              setParams((p) => ({ ...p, auto: v }))
            }}
            label="Auto levels"
            hint="Stretches the histogram so blacks are black and whites are white."
          />
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-2.5">
              <SectionTitle>{g.title}</SectionTitle>
              {g.sliders.map((s) => (
                <AdjustSlider
                  key={s.key}
                  label={s.label}
                  value={params[s.key]}
                  min={s.min ?? -100}
                  max={s.max ?? 100}
                  onChange={(v) => set(s.key, v)}
                />
              ))}
            </div>
          ))}

          <div className="space-y-3">
            <SectionTitle>Recolor</SectionTitle>
            <p className="text-xs text-slate-500">
              Change one color into another, e.g. a red shirt to blue. Shading and texture are kept.
            </p>
            {params.recolor.map((r) => (
              <div key={r.id} className="space-y-2 rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 shrink-0 rounded-md border border-slate-300" style={{ background: r.from }} title={r.from} />
                  <span className="text-slate-400">→</span>
                  <div className="flex-1">
                    <ColorInput value={r.to} onChange={(v) => updateRule(r.id, { to: v })} />
                  </div>
                  <button
                    type="button"
                    aria-label="Remove rule"
                    onClick={() => removeRule(r.id)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Field label={<span className="text-xs font-normal text-slate-600">Range of similar shades</span>}>
                  <Slider value={r.tolerance} onChange={(v) => updateRule(r.id, { tolerance: v })} min={0} max={100} />
                </Field>
              </div>
            ))}
            <Button
              variant={pickMode ? 'primary' : 'secondary'}
              size="sm"
              className="w-full"
              onClick={() => setPickMode(!pickMode)}
              disabled={!selected}
            >
              <Pipette className="h-4 w-4" /> {pickMode ? 'Click the image… (cancel)' : 'Pick a color to change'}
            </Button>
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

function AdjustSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cx('tabular-nums', value !== 0 ? 'text-brand-700 hover:underline' : 'text-slate-400')}
          title="Reset"
        >
          {value > 0 ? `+${value}` : value}
        </button>
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
      />
    </div>
  )
}
