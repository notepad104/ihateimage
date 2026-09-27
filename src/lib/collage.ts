import type { OutputFormat, Rect } from './types'
import { encode, type EncodeResult } from './image-ops'

export type CollageLayout = 'grid' | 'row' | 'column' | 'free'

/** How a photo sits inside its cell. */
export type CellFit = 'cover' | 'contain'

export interface SheetSpec {
  layout: CollageLayout
  /** Grid only. Row and column layouts derive it from the photo count. */
  columns: number
  /** Output width in pixels. */
  width: number
  /** width / height. 0 means "let the grid decide" (square cells). */
  aspect: number
  /** Gap between photos, as a fraction of the sheet width. */
  gap: number
  /** Outer margin, as a fraction of the sheet width. */
  margin: number
  /** Corner radius on each photo, as a fraction of the shorter cell side. */
  radius: number
  fit: CellFit
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

export const DEFAULT_SHEET: SheetSpec = {
  layout: 'grid',
  columns: 2,
  width: 2000,
  aspect: 0,
  gap: 0.01,
  margin: 0.01,
  radius: 0,
  fit: 'contain',
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
 * are square, so the height follows from the grid shape; freeform sheets
 * default to 4:3.
 */
export function sheetSize(spec: SheetSpec, images: SheetImage[]): { width: number; height: number } {
  const w = Math.max(16, Math.round(spec.width))
  if (spec.aspect > 0) return { width: w, height: Math.max(16, Math.round(w / spec.aspect)) }
  if (spec.layout === 'free') return { width: w, height: Math.round(w * 0.75) }
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

/**
 * Automatic placements for a grid, row or column. Freeform sheets keep the
 * user's placements, so this is only called for the other layouts and as a
 * starting point when switching to freeform.
 */
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

/**
 * Carry placements from one sheet to another of a different shape: scale the
 * whole arrangement uniformly so it fits, and centre it.
 */
export function fitPlacements(
  placements: Placement[],
  from: { width: number; height: number },
  to: { width: number; height: number },
): Placement[] {
  const s = Math.min(to.width / from.width, to.height / from.height)
  const offX = (to.width - from.width * s) / 2
  const offY = (to.height - from.height * s) / 2
  return placements.map((p) => ({
    id: p.id,
    x: (p.x * from.width * s + offX) / to.width,
    y: (p.y * from.height * s + offY) / to.height,
    width: (p.width * from.width * s) / to.width,
    height: (p.height * from.height * s) / to.height,
  }))
}

/** Clamp a freeform placement so it stays at least partly on the sheet. */
export function clampPlacement(p: Placement): Placement {
  const minSize = 0.04
  const width = Math.min(1, Math.max(minSize, p.width))
  const height = Math.min(1, Math.max(minSize, p.height))
  const x = Math.min(1 - minSize, Math.max(minSize - width, p.x))
  const y = Math.min(1 - minSize, Math.max(minSize - height, p.y))
  return { ...p, x, y, width, height }
}

/** The source rectangle to draw for a photo of iw×ih into a cell of cw×ch. */
export function sourceRect(iw: number, ih: number, cw: number, ch: number, fit: CellFit): Rect {
  if (fit === 'contain') return { x: 0, y: 0, width: iw, height: ih }
  const scale = Math.max(cw / iw, ch / ih)
  const w = cw / scale
  const h = ch / scale
  return { x: (iw - w) / 2, y: (ih - h) / 2, width: w, height: h }
}

/** The destination rectangle inside a cell for 'contain'. */
export function containRect(iw: number, ih: number, cell: Rect): Rect {
  const scale = Math.min(cell.width / iw, cell.height / ih)
  const w = iw * scale
  const h = ih * scale
  return { x: cell.x + (cell.width - w) / 2, y: cell.y + (cell.height - h) / 2, width: w, height: h }
}

type Drawable = CanvasImageSource & { width: number; height: number }

function roundedPath(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, r: Rect, radius: number) {
  const rad = Math.min(radius, r.width / 2, r.height / 2)
  ctx.beginPath()
  if (rad <= 0) {
    ctx.rect(r.x, r.y, r.width, r.height)
  } else {
    ctx.roundRect(r.x, r.y, r.width, r.height, rad)
  }
  ctx.closePath()
}

/**
 * Draw one photo into its cell on `ctx`. `cell` is in canvas pixels. Used by
 * the preview canvas and the exporter so both look the same.
 */
export function drawCell(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  img: Drawable,
  cell: Rect,
  fit: CellFit,
  radiusPx: number,
) {
  const iw = img.width
  const ih = img.height
  if (iw <= 0 || ih <= 0 || cell.width <= 0 || cell.height <= 0) return
  const dest = fit === 'contain' ? containRect(iw, ih, cell) : cell
  ctx.save()
  roundedPath(ctx, dest, radiusPx)
  ctx.clip()
  if (fit === 'contain') {
    ctx.drawImage(img, 0, 0, iw, ih, dest.x, dest.y, dest.width, dest.height)
  } else {
    const s = sourceRect(iw, ih, cell.width, cell.height, fit)
    ctx.drawImage(img, s.x, s.y, s.width, s.height, cell.x, cell.y, cell.width, cell.height)
  }
  ctx.restore()
}

export interface ExportInput {
  spec: SheetSpec
  images: SheetImage[]
  placements: Placement[]
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
    // Decode no larger than the cell needs at the chosen fit.
    const pick = spec.fit === 'contain' ? Math.min : Math.max
    const scale = Math.min(1, pick(cell.width / img.width, cell.height / img.height) * 1.05)
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: Math.max(1, Math.round(img.width * scale)),
      resizeHeight: Math.max(1, Math.round(img.height * scale)),
      resizeQuality: 'high',
    })
    try {
      drawCell(ctx, bitmap, cell, spec.fit, Number.isFinite(radiusPx) ? radiusPx : 0)
    } finally {
      bitmap.close()
    }
  }
  const res = await encode(canvas, { format: input.format, quality: input.quality })
  return { ...res, width: W, height: H }
}
