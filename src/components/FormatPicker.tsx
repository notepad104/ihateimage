import { useEffect, useState } from 'react'
import { canEncode, FORMATS } from '../lib/format'
import type { OutputFormat } from '../lib/types'
import { Segmented } from './ui'

export type FormatChoice = OutputFormat | 'same'

/** Async-detects which formats this browser can encode. */
export function useEncodeSupport() {
  const [support, setSupport] = useState<Record<OutputFormat, boolean>>({
    'image/jpeg': true,
    'image/png': true,
    'image/webp': true,
    'image/avif': true,
  })
  useEffect(() => {
    let cancelled = false
    Promise.all(FORMATS.map((f) => canEncode(f.value).then((ok) => [f.value, ok] as const))).then((pairs) => {
      if (cancelled) return
      setSupport(Object.fromEntries(pairs) as Record<OutputFormat, boolean>)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return support
}

export function FormatPicker({
  value,
  onChange,
  allowSame = true,
  support,
}: {
  value: FormatChoice
  onChange: (v: FormatChoice) => void
  allowSame?: boolean
  support: Record<OutputFormat, boolean>
}) {
  const options: { value: FormatChoice; label: string; disabled?: boolean; title?: string }[] = []
  if (allowSame) options.push({ value: 'same', label: 'Same' })
  for (const f of FORMATS) {
    options.push({
      value: f.value,
      label: f.label,
      disabled: !support[f.value],
      title: support[f.value] ? undefined : `${f.label} encoding is not supported by this browser`,
    })
  }
  return <Segmented options={options} value={value} onChange={onChange} />
}
