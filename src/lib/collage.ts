import type { OutputFormat, Rect } from './types'
import { encode, type EncodeResult } from './image-ops'

export type CollageLayout = 'grid' | 'row' | 'column'

export interface SheetSpec {
  layout: CollageLayout
  /** Grid only. Row and column layouts derive it from the photo count. */
  columns: number
  /** Output width in pixels. */
  width: number
  /** width / height. 0 means "let the layout decide". */
  aspect: number
  /** Gap between photos, as a fraction of the sheet width. */
  gap: number
  /** Outer margin, as a fraction of the sheet width. */
  margin: number
  /** Corner radius on each photo, as a fraction of the shorter cell side. */
  radius: number
  /** CSS colour, or 'transparent'. */
  background: string
}

export interface SheetImage {
  id: string
  width: number
  height: number
}

/**
 * Where one photo goes on the sheet. Units are fractions of sheet width and
 * height so the same placement works for the preview and the export.
 */
export interface Placement extends Rect {
  id: string
}

/** The part of a photo that is kept, as fractions of its width and height. */
export type Crop = Rect

export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 }
/** Smallest crop side, as a fraction of the photo. */
export const MIN_CROP = 0.05

/** Keep a crop inside the photo and no smaller than MIN_CROP on each side. */
export function clampCrop(c: Crop): Crop {
  const width = Math.min(1, Math.max(MIN_CROP, c.width))
  const height = Math.min(1, Math.max(MIN_CROP, c.height))
  const x = Math.min(1 - width, Math.max(0, c.x))
  const y = Math.min(1 - height, Math.max(0, c.y))
  return { x, y, width, height }
}

export const DEFAULT_SHEET: SheetSpec = {
  layout: 'grid',
  columns: 2,
  width: 2000,
  aspect: 0,
  gap: 0.01,
  margin: 0.01,
  radius: 0,
  background: '#ffffff',
}

export function gridShape(layout: CollageLayout, columns: number, count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 }
  if (layout === 'row') return { cols: count, rows: 1 }
  if (layout === 'column') return { cols: 1, rows: count }
  const cols = Math.max(1, Math.min(columns, count))
  return { cols, rows: Math.ceil(count / cols) }
}

/**
 * Sheet height for the given spec and photo count. With aspect 0 the cells
 * are square, so the height follows from the grid shape.
 */
export function sheetSize(spec: SheetSpec, images: SheetImage[]): { width: number; height: number } {
  const w = Math.max(16, Math.round(spec.width))
  if (spec.aspect > 0) return { width: w, height: Math.max(16, Math.round(w / spec.aspect)) }
  const { cols, rows } = gridShape(spec.layout, spec.columns, images.length)
  if (spec.layout !== 'grid' && images.length > 0) {
    // Rows and columns keep each photo's own shape, so the sheet height comes
    // from the photos rather than from square cells.
    const inner = 1 - 2 * spec.margin - spec.gap * (cols - 1)
    if (spec.layout === 'row') {
      const sumAspect = images.reduce((s, i) => s + i.width / i.height, 0)
      const h = inner / sumAspect
      return { width: w, height: Math.max(16, Math.round(w * (h + 2 * spec.margin))) }
    }
    const innerW = 1 - 2 * spec.margin
    const sumInv = images.reduce((s, i) => s + i.height / i.width, 0)
    const h = innerW * sumInv + spec.gap * (rows - 1) + 2 * spec.margin
    return { width: w, height: Math.max(16, Math.round(w * h)) }
  }
  const cellW = (1 - 2 * spec.margin - spec.gap * (cols - 1)) / cols
  const h = cellW * rows + spec.gap * (rows - 1) + 2 * spec.margin
  return { width: w, height: Math.max(16, Math.round(w * h)) }
}

/** Automatic placements for a grid, row or column; the user may move and resize photos afterwards. */
export function autoPlacements(
  spec: SheetSpec,
  images: SheetImage[],
  /** Sheet the placements are for; defaults to the sheet this spec would produce. */
  size?: { width: number; height: number },
): Placement[] {
  const n = images.length
  if (n === 0) return []
  const { width: W, height: H } = size ?? sheetSize(spec, images)
  const ar = W / H
  const { cols, rows } = gridShape(spec.layout, spec.columns, n)
  const m = spec.margin
  const g = spec.gap

  if (spec.layout === 'row' && spec.aspect === 0 && !size) {
    // Every photo shares the row height and keeps its own aspect.
    const innerW = 1 - 2 * m - g * (cols - 1)
    const sumAspect = images.reduce((s, i) => s + i.width / i.height, 0)
    const h = innerW / sumAspect
    let x = m
    return images.map((img) => {
      const w = h * (img.width / img.height)
      const p = { id: img.id, x, y: m * ar, width: w, height: h * ar }
      x += w + g
      return p
    })
  }
  if (spec.layout === 'column' && spec.aspect === 0 && !size) {
    const innerW = 1 - 2 * m
    let y = m * ar
    return images.map((img) => {
      const h = (innerW * (img.height / img.width)) * ar
      const p = { id: img.id, x: m, y, width: innerW, height: h }
      y += h + g * ar
      return p
    })
  }

  // Equal cells. Gap and margin are fractions of the width; scale them for y.
  const cellW = (1 - 2 * m - g * (cols - 1)) / cols
  const cellH = (1 - 2 * m * ar - g * ar * (rows - 1)) / rows
  return images.map((img, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return {
      id: img.id,
      x: m + c * (cellW + g),
      y: m * ar + r * (cellH + g * ar),
      width: cellW,
      height: cellH,
    }
  })
}

/** Clamp a moved or resized placement so it stays at least partly on the sheet. */
export function clampPlacement(p: Placement): Placement {
  const minSize = 0.04
  const width = Math.min(1, Math.max(minSize, p.width))
  const height = Math.min(1, Math.max(minSize, p.height))
  const x = Math.min(1 - minSize, Math.max(minSize - width, p.x))
  const y = Math.min(1 - minSize, Math.max(minSize - height, p.y))
  return { ...p, x, y, width, height }
}

/** Where a picture of w×h lands inside a frame, whole and centred. */
export function containRect(w: number, h: number, cell: Rect): Rect {
  const scale = Math.min(cell.width / w, cell.height / h)
  const dw = w * scale
  const dh = h * scale
  return { x: cell.x + (cell.width - dw) / 2, y: cell.y + (cell.height - dh) / 2, width: dw, height: dh }
}

/**
 * How one photo is drawn: the source window (the crop, or the whole photo)
 * and where it lands in the frame. Nothing is ever cut off beyond the crop
 * the user drew; the window is shown whole and centred.
 */
export function photoView(iw: number, ih: number, cell: Rect, crop: Crop | undefined): { dest: Rect; src: Rect } {
  const c = crop ?? FULL_CROP
  const src = { x: c.x * iw, y: c.y * ih, width: c.width * iw, height: c.height * ih }
  return { dest: containRect(src.width, src.height, cell), src }
}

type Drawable = CanvasImageSource & { width: number; height: number }

function roundedPath(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, r: Rect, radius: number) {
  const rad = Math.min(radius, r.width / 2, r.height / 2)
  ctx.beginPath()
  if (rad <= 0) ctx.rect(r.x, r.y, r.width, r.height)
  else ctx.roundRect(r.x, r.y, r.width, r.height, rad)
  ctx.closePath()
}

/** Draw one photo into its frame on `ctx` (frame in canvas pixels). */
export function drawCell(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  img: Drawable,
  /** Full source size; `img` may be a downscaled decode of it. */
  source: { width: number; height: number },
  cell: Rect,
  crop: Crop | undefined,
  radiusPx: number,
) {
  if (source.width <= 0 || source.height <= 0 || cell.width <= 0 || cell.height <= 0) return
  const { dest, src } = photoView(source.width, source.height, cell, crop)
  const k = img.width / source.width
  ctx.save()
  roundedPath(ctx, dest, radiusPx)
  ctx.clip()
  ctx.drawImage(img, src.x * k, src.y * k, src.width * k, src.height * k, dest.x, dest.y, dest.width, dest.height)
  ctx.restore()
}

export interface ExportInput {
  spec: SheetSpec
  images: SheetImage[]
  placements: Placement[]
  crops: Record<string, Crop | undefined>
  /** Source bytes per image id. */
  sources: Map<string, Blob>
  format: OutputFormat
  quality: number
}

/**
 * Render a sheet at full size and encode it. Each photo is decoded only as
 * large as its cell needs (plus a little headroom), which keeps memory down
 * when a dozen 12-megapixel photos land on a 2000 px sheet.
 */
export async function exportSheet(input: ExportInput): Promise<EncodeResult & { width: number; height: number }> {
  const { spec, images, placements, sources } = input
  const { width: W, height: H } = sheetSize(spec, images)
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  const transparent = spec.background === 'transparent' && input.format !== 'image/jpeg'
  if (!transparent) {
    ctx.fillStyle = spec.background === 'transparent' ? '#ffffff' : spec.background
    ctx.fillRect(0, 0, W, H)
  }
  const radiusPx = spec.radius * Math.min(...placements.map((p) => Math.min(p.width * W, p.height * H)), Infinity)
  const byId = new Map(images.map((i) => [i.id, i]))
  for (const p of placements) {
    const img = byId.get(p.id)
    const blob = sources.get(p.id)
    if (!img || !blob) continue
    const cell: Rect = { x: p.x * W, y: p.y * H, width: p.width * W, height: p.height * H }
    const crop = input.crops[p.id]
    // Decode no larger than the drawn window needs.
    const { dest, src } = photoView(img.width, img.height, cell, crop)
    const scale = Math.min(1, (dest.width / src.width) * 1.05)
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: Math.max(1, Math.round(img.width * scale)),
      resizeHeight: Math.max(1, Math.round(img.height * scale)),
      resizeQuality: 'high',
    })
    try {
      drawCell(ctx, bitmap, img, cell, crop, Number.isFinite(radiusPx) ? radiusPx : 0)
    } finally {
      bitmap.close()
    }
  }
  const res = await encode(canvas, { format: input.format, quality: input.quality })
  return { ...res, width: W, height: H }
}
