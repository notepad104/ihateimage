import type { OutputFormat } from './types'

export const FORMATS: { value: OutputFormat; label: string; ext: string; lossy: boolean }[] = [
  { value: 'image/jpeg', label: 'JPG', ext: 'jpg', lossy: true },
  { value: 'image/png', label: 'PNG', ext: 'png', lossy: false },
  { value: 'image/webp', label: 'WebP', ext: 'webp', lossy: true },
  { value: 'image/avif', label: 'AVIF', ext: 'avif', lossy: true },
]

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

export function extForMime(mime: string): string {
  const f = FORMATS.find((x) => x.value === mime)
  if (f) return f.ext
  const map: Record<string, string> = {
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/tiff': 'tiff',
    'image/svg+xml': 'svg',
  }
  return map[mime] ?? 'img'
}

export function labelForMime(mime: string): string {
  const f = FORMATS.find((x) => x.value === mime)
  if (f) return f.label
  return extForMime(mime).toUpperCase()
}

/** Best-effort MIME type from a File; some OSes leave `file.type` empty. */
export function mimeOf(file: File): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    bmp: 'image/bmp',
    heic: 'image/heic',
    heif: 'image/heif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
  }
  return map[ext] ?? 'application/octet-stream'
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

export function withExt(name: string, mime: string, suffix = ''): string {
  return `${stripExt(name)}${suffix}.${extForMime(mime)}`
}

/** Map an arbitrary input MIME to the closest format we can encode. */
export function nearestOutputFormat(mime: string): OutputFormat {
  if (mime === 'image/png' || mime === 'image/webp' || mime === 'image/avif') return mime
  if (mime === 'image/gif' || mime === 'image/svg+xml' || mime === 'image/bmp') return 'image/png'
  return 'image/jpeg'
}

const encodeSupport = new Map<OutputFormat, Promise<boolean>>()

/** Detects whether this browser can *encode* the given format via canvas. */
export function canEncode(format: OutputFormat): Promise<boolean> {
  let p = encodeSupport.get(format)
  if (!p) {
    p = (async () => {
      try {
        const c = new OffscreenCanvas(2, 2)
        const ctx = c.getContext('2d')
        if (!ctx) return false
        ctx.fillStyle = '#f00'
        ctx.fillRect(0, 0, 2, 2)
        const blob = await c.convertToBlob({ type: format, quality: 0.5 })
        return blob.type === format
      } catch {
        return false
      }
    })()
    encodeSupport.set(format, p)
  }
  return p
}

export function percentChange(before: number, after: number): number {
  if (before <= 0) return 0
  return Math.round(((after - before) / before) * 100)
}
