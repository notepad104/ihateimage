import { mimeOf } from './format'
import type { LoadedFile } from './types'

let seq = 0

async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const dims = { width: bmp.width, height: bmp.height }
    bmp.close()
    return dims
  } catch {
    // Fall back to <img>, which handles a few more formats (e.g. SVG without size).
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(`Cannot open "${file.name}". The format may not be supported by this browser.`))
      }
      img.src = url
    })
  }
}

export interface LoadOutcome {
  loaded: LoadedFile[]
  errors: { name: string; message: string }[]
}

/** Smallest long side an SVG is drawn at; vectors have no pixels of their own. */
const SVG_MIN_SIDE = 1024
const SVG_MAX_SIDE = 4096

function parseLength(v: string | null): number {
  if (!v) return 0
  const n = parseFloat(v)
  return Number.isFinite(n) && n > 0 && !v.trim().endsWith('%') ? n : 0
}

/**
 * Workers decode with createImageBitmap, which refuses SVG in every browser.
 * Draw the vector once here through an <img> (which does render SVG) and hand
 * the pipeline a PNG. Output size comes from the SVG's width/height, or its
 * viewBox, scaled so the long side is at least SVG_MIN_SIDE.
 */
async function rasterizeSvg(file: File): Promise<{ file: File; width: number; height: number }> {
  const text = await file.text()
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') throw new Error(`"${file.name}" is not a valid SVG file.`)
  let w = parseLength(root.getAttribute('width'))
  let h = parseLength(root.getAttribute('height'))
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w) h = (w * vb[3]) / vb[2]
    else if (h) w = (h * vb[2]) / vb[3]
    else {
      w = vb[2]
      h = vb[3]
    }
  }
  if (!w || !h) {
    w = 1024
    h = 1024
  }
  const scale = Math.min(SVG_MAX_SIDE / Math.max(w, h), Math.max(1, SVG_MIN_SIDE / Math.max(w, h)))
  const width = Math.max(1, Math.round(w * scale))
  const height = Math.max(1, Math.round(h * scale))

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`"${file.name}" could not be rendered.`))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error(`"${file.name}" could not be rendered.`)
    return { file: new File([blob], file.name, { type: 'image/png' }), width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function loadFiles(files: Iterable<File>): Promise<LoadOutcome> {
  const loaded: LoadedFile[] = []
  const errors: { name: string; message: string }[] = []
  await Promise.all(
    Array.from(files).map(async (file) => {
      const type = mimeOf(file)
      if (!type.startsWith('image/')) {
        errors.push({ name: file.name, message: 'Not an image file' })
        return
      }
      try {
        let source = file
        let dims: { width: number; height: number }
        if (type === 'image/svg+xml') {
          const r = await rasterizeSvg(file)
          source = r.file
          dims = r
        } else {
          dims = await readDimensions(file)
        }
        seq += 1
        loaded.push({
          id: `f${seq}-${Date.now().toString(36)}`,
          file: source,
          name: file.name,
          size: file.size,
          type,
          url: URL.createObjectURL(source),
          width: dims.width,
          height: dims.height,
        })
      } catch (e) {
        errors.push({ name: file.name, message: e instanceof Error ? e.message : String(e) })
      }
    }),
  )
  // Keep the user's selection order.
  const order = Array.from(files).map((f) => f.name)
  loaded.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  return { loaded, errors }
}

export function revokeFiles(files: LoadedFile[]) {
  for (const f of files) URL.revokeObjectURL(f.url)
}

/** Pull image files out of a paste or drop event. */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  if (dt.items && dt.items.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  if (!out.length && dt.files) out.push(...Array.from(dt.files))
  return out
}
