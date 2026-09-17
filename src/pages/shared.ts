import type { FormatChoice } from '../components/FormatPicker'
import { FORMATS, nearestOutputFormat } from '../lib/format'
import type { LoadedFile, Op, OutputFormat } from '../lib/types'

const ALPHA_TYPES = new Set(['image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml', 'image/bmp'])

export function mayHaveAlpha(file: LoadedFile): boolean {
  return ALPHA_TYPES.has(file.type)
}

export function isLossy(format: OutputFormat): boolean {
  return FORMATS.find((f) => f.value === format)?.lossy ?? true
}

/** Resolve a user's format choice for a specific file, falling back if the browser can't encode it. */
export function outputFormatFor(
  file: LoadedFile,
  choice: FormatChoice,
  support: Record<OutputFormat, boolean>,
): OutputFormat {
  let f: OutputFormat = choice === 'same' ? nearestOutputFormat(file.type) : choice
  if (!support[f]) f = f === 'image/avif' && support['image/webp'] ? 'image/webp' : mayHaveAlpha(file) ? 'image/png' : 'image/jpeg'
  return f
}

/** JPEG has no alpha channel: composite over a solid color first. */
export function flattenOps(file: LoadedFile, format: OutputFormat, color: string): Op[] {
  if (format === 'image/jpeg' && mayHaveAlpha(file)) return [{ type: 'flatten', color: color || '#ffffff' }]
  return []
}

/** True if at least one loaded file would end up in a lossy format for the given choice. */
export function anyLossy(files: LoadedFile[], choice: FormatChoice, support: Record<OutputFormat, boolean>): boolean {
  if (choice !== 'same') return isLossy(choice)
  return files.some((f) => isLossy(outputFormatFor(f, choice, support)))
}

export function anyJpegWithAlpha(files: LoadedFile[], choice: FormatChoice, support: Record<OutputFormat, boolean>) {
  return files.some((f) => outputFormatFor(f, choice, support) === 'image/jpeg' && mayHaveAlpha(f))
}
