/**
 * Text and signature overlays for the fill & sign tool. Positions and sizes
 * are fractions of the image so the same numbers drive the on-screen editor
 * and the full-resolution export.
 */
import { encode } from './image-ops'
import type { OutputFormat, Rect } from './types'

export interface TextItem {
  id: string
  kind: 'text'
  /** The detected blank this was typed into, if any; the blank stays hidden while the item exists. */
  fieldId?: string
  /** Top-left corner, fractions of the image */
  x: number
  y: number
  /** Font size as a fraction of the image height */
  size: number
  text: string
  color: string
  font: string
  bold: boolean
}

export interface ImageItem extends Rect {
  id: string
  kind: 'image'
  fieldId?: string
  blob: Blob
  url: string
}

export type FillItem = TextItem | ImageItem

export const FILL_FONTS: { label: string; value: string }[] = [
  { label: 'Sans (Helvetica / Arial)', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Serif (Georgia)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono (Menlo / Courier)', value: 'Menlo, Consolas, "Courier New", monospace' },
  { label: 'Handwriting', value: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
  { label: 'Script', value: '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive' },
]

export const SIGNATURE_FONTS: { label: string; value: string }[] = [
  { label: 'Script', value: '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive' },
  { label: 'Handwriting', value: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
  { label: 'Chancery', value: '"Apple Chancery", "URW Chancery L", "Lucida Handwriting", cursive' },
  { label: 'Serif italic', value: 'Georgia, "Times New Roman", serif' },
]

export const INK_COLORS = ['#111827', '#1d4ed8', '#1e3a8a', '#b91c1c']

export const LINE_HEIGHT = 1.2
/** Share of a blank's height the text inside it takes up. */
export const FIELD_TEXT_RATIO = 0.62
export const MIN_TEXT_SIZE = 0.006
export const MAX_TEXT_SIZE = 0.2

export function fontString(item: TextItem, px: number) {
  return `${item.bold ? '700' : '400'} ${px}px ${item.font}`
}

let measurer: OffscreenCanvasRenderingContext2D | null = null

/** Pixel size of a text item's block at a given image pixel height. */
export function textBlockPx(item: TextItem, imageHeight: number): { width: number; height: number; px: number } {
  const px = Math.max(1, item.size * imageHeight)
  if (!measurer) measurer = new OffscreenCanvas(1, 1).getContext('2d')
  const lines = (item.text || ' ').split('\n')
  let width = 0
  if (measurer) {
    measurer.font = fontString(item, px)
    for (const l of lines) width = Math.max(width, measurer.measureText(l || ' ').width)
  } else width = px * 0.55 * Math.max(...lines.map((l) => l.length), 1)
  return { width, height: lines.length * px * LINE_HEIGHT, px }
}

/** Bounding box of an item in image fractions. */
export function itemRect(item: FillItem, imageWidth: number, imageHeight: number): Rect {
  if (item.kind === 'image') return item
  const m = textBlockPx(item, imageHeight)
  return { x: item.x, y: item.y, width: m.width / imageWidth, height: m.height / imageHeight }
}

export function drawItems(ctx: OffscreenCanvasRenderingContext2D, items: FillItem[], bitmaps: Map<string, ImageBitmap>, W: number, H: number) {
  for (const item of items) {
    if (item.kind === 'image') {
      const bmp = bitmaps.get(item.id)
      if (bmp) ctx.drawImage(bmp, item.x * W, item.y * H, item.width * W, item.height * H)
      continue
    }
    if (!item.text.trim()) continue
    const { px } = textBlockPx(item, H)
    ctx.font = fontString(item, px)
    ctx.fillStyle = item.color
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    const lines = item.text.split('\n')
    // Match CSS: each line box is LINE_HEIGHT tall with the glyphs centred, so half the leading sits above.
    const lead = (px * (LINE_HEIGHT - 1)) / 2
    lines.forEach((l, i) => ctx.fillText(l, item.x * W, item.y * H + i * px * LINE_HEIGHT + lead))
  }
}

export interface FillExport {
  blob: Blob
  width: number
  height: number
}

/** Draw the overlays onto the full-resolution image and encode it. */
export async function renderFilled(source: Blob, items: FillItem[], format: OutputFormat, quality: number): Promise<FillExport> {
  const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' })
  const bitmaps = new Map<string, ImageBitmap>()
  try {
    const W = bmp.width
    const H = bmp.height
    for (const item of items) {
      if (item.kind !== 'image') continue
      const target = Math.max(1, Math.round(item.width * W))
      const decoded = await createImageBitmap(item.blob, { resizeWidth: target, resizeQuality: 'high' })
      bitmaps.set(item.id, decoded)
    }
    const canvas = new OffscreenCanvas(W, H)
    const ctx = canvas.getContext('2d')!
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
    }
    ctx.drawImage(bmp, 0, 0)
    drawItems(ctx, items, bitmaps, W, H)
    const { blob } = await encode(canvas, { format, quality })
    return { blob, width: W, height: H }
  } finally {
    bmp.close()
    for (const b of bitmaps.values()) b.close()
  }
}

/** Crop a canvas to its non-transparent pixels, with a small margin. Returns null if it is empty. */
export function trimTransparent(canvas: OffscreenCanvas, margin = 8): OffscreenCanvas | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { width, height } = canvas
  const px = ctx.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - margin)
  y0 = Math.max(0, y0 - margin)
  x1 = Math.min(width - 1, x1 + margin)
  y1 = Math.min(height - 1, y1 + margin)
  const out = new OffscreenCanvas(x1 - x0 + 1, y1 - y0 + 1)
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

/** Make the paper behind a scanned signature transparent, keeping the ink. */
export function knockOutWhite(canvas: OffscreenCanvas): OffscreenCanvas {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    // Fully opaque below 150, fully transparent above 235, ramp between.
    const a = Math.min(1, Math.max(0, (235 - lum) / 85))
    d[i + 3] = Math.round(d[i + 3] * a)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
