import type { OutputFormat, Rect } from './types'
import { encode, type EncodeResult } from './image-ops'

export interface SheetSpec {
  /** Output width in pixels. */
  width: number
  /** width / height. 0 means "let the starting arrangement decide". */
  aspect: number
  /** Gap between photos, as a fraction of the sheet width. */
  gap: number
  /** Outer margin, as a fraction of the sheet width. */
  margin: number
  /** Corner radius on each photo, as a fraction of the shorter cell side. */
  radius: number
  background: SheetBackground
}

/**
 * What sits behind the photos. A solid colour (or none), a two-colour
 * gradient, or a picture that fills the sheet. The picture's bytes live
 * outside the spec, keyed by the page, so the spec stays plain data.
 */
export type SheetBackground =
  | { kind: 'color'; /** CSS colour, or 'transparent'. */ color: string }
  | { kind: 'gradient'; from: string; to: string; /** degrees, CSS convention: 0 = bottom to top, 90 = left to right */ angle: number }
  | { kind: 'image'; /** blur radius as a fraction of the sheet width */ blur: number; /** 0..1 darkening */ dim: number }

export const GRADIENT_PRESETS: { name: string; from: string; to: string }[] = [
  { name: 'Sunset', from: '#f97316', to: '#db2777' },
  { name: 'Ocean', from: '#0ea5e9', to: '#6366f1' },
  { name: 'Mint', from: '#a7f3d0', to: '#38bdf8' },
  { name: 'Dusk', from: '#1e293b', to: '#7c3aed' },
  { name: 'Peach', from: '#fde68a', to: '#fb7185' },
  { name: 'Slate', from: '#f8fafc', to: '#cbd5e1' },
]

/** CSS for a background that needs no picture; undefined for 'image' and transparent. */
export function backgroundCss(bg: SheetBackground): string | undefined {
  if (bg.kind === 'color') return bg.color === 'transparent' ? undefined : bg.color
  if (bg.kind === 'gradient') return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`
  return undefined
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

/** A coloured edge around one photo, drawn just outside the picture. */
export interface Border {
  /** Thickness as a fraction of the sheet width. */
  width: number
  color: string
  /** Soft drop shadow under the photo. */
  shadow: boolean
}

export const DEFAULT_BORDER: Border = { width: 0.01, color: '#ffffff', shadow: false }
export const MAX_BORDER = 0.04

/** Colours offered as one-tap swatches. */
export const BORDER_SWATCHES = [
  '#ffffff',
  '#0f172a',
  '#f8e1e7',
  '#fde68a',
  '#bbf7d0',
  '#bae6fd',
  '#ddd6fe',
  '#fca5a5',
  '#f59e0b',
  '#2563eb',
]

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, width: Math.max(0, r.width - 2 * d), height: Math.max(0, r.height - 2 * d) }
}
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
  width: 2000,
  aspect: 0,
  gap: 0.01,
  margin: 0.01,
  radius: 0,
  background: { kind: 'color', color: '#ffffff' },
}

/** Starting arrangement: the squarest grid that holds every photo. */
export function gridShape(count: number): { cols: number; rows: number } {
  if (count <= 0) return { cols: 1, rows: 1 }
  const cols = Math.ceil(Math.sqrt(count))
  return { cols, rows: Math.ceil(count / cols) }
}

/**
 * Sheet height for the given spec and photo count. With aspect 0 the
 * starting grid has square cells, so the height follows from its shape.
 */
export function sheetSize(spec: SheetSpec, images: SheetImage[]): { width: number; height: number } {
  const w = Math.max(16, Math.round(spec.width))
  if (spec.aspect > 0) return { width: w, height: Math.max(16, Math.round(w / spec.aspect)) }
  const { cols, rows } = gridShape(images.length)
  const cellW = (1 - 2 * spec.margin - spec.gap * (cols - 1)) / cols
  const h = cellW * rows + spec.gap * (rows - 1) + 2 * spec.margin
  return { width: w, height: Math.max(16, Math.round(w * h)) }
}

/**
 * Starting placements: equal cells on the squarest grid. Every photo can be
 * moved and resized from here.
 */
export function autoPlacements(spec: SheetSpec, images: SheetImage[]): Placement[] {
  const n = images.length
  if (n === 0) return []
  const { width: W, height: H } = sheetSize(spec, images)
  const ar = W / H
  const { cols, rows } = gridShape(n)
  const m = spec.margin
  const g = spec.gap
  // Gap and margin are fractions of the width; scale them for y.
  const cellW = (1 - 2 * m - g * (cols - 1)) / cols
  const cellH = (1 - 2 * m * ar - g * ar * (rows - 1)) / rows
  return images.map((img, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return { id: img.id, x: m + c * (cellW + g), y: m * ar + r * (cellH + g * ar), width: cellW, height: cellH }
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
 * How one photo is drawn: the source window (the crop, or the whole photo),
 * where the picture lands in the frame, and the outer edge of its border.
 * The border sits outside the picture but inside the frame, so a thicker
 * border shrinks the picture rather than spilling over its neighbours.
 */
export function photoView(
  iw: number,
  ih: number,
  cell: Rect,
  crop: Crop | undefined,
  borderPx = 0,
): { dest: Rect; src: Rect; outer: Rect } {
  const c = crop ?? FULL_CROP
  const src = { x: c.x * iw, y: c.y * ih, width: c.width * iw, height: c.height * ih }
  const dest = containRect(src.width, src.height, inset(cell, borderPx))
  return { dest, src, outer: inset(dest, -borderPx) }
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
  border: Border | undefined,
  /** Sheet width in canvas pixels, to turn the border fraction into pixels. */
  sheetPx: number,
) {
  if (source.width <= 0 || source.height <= 0 || cell.width <= 0 || cell.height <= 0) return
  const bw = border ? border.width * sheetPx : 0
  const { dest, src, outer } = photoView(source.width, source.height, cell, crop, bw)
  const k = img.width / source.width
  if (border && (bw > 0 || border.shadow)) {
    ctx.save()
    if (border.shadow) {
      const blur = Math.max(4, Math.min(outer.width, outer.height) * 0.06)
      ctx.shadowColor = 'rgba(15, 23, 42, 0.35)'
      ctx.shadowBlur = blur
      ctx.shadowOffsetY = blur / 3
    }
    ctx.fillStyle = bw > 0 ? border.color : 'rgba(0,0,0,0.001)'
    roundedPath(ctx, outer, radiusPx)
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  roundedPath(ctx, dest, Math.max(0, radiusPx - bw))
  ctx.clip()
  ctx.drawImage(img, src.x * k, src.y * k, src.width * k, src.height * k, dest.x, dest.y, dest.width, dest.height)
  ctx.restore()
}

export interface ExportInput {
  spec: SheetSpec
  images: SheetImage[]
  placements: Placement[]
  crops: Record<string, Crop | undefined>
  borders: Record<string, Border | undefined>
  /** Picture for an image background. */
  backgroundImage?: Blob
  /** Source bytes per image id. */
  sources: Map<string, Blob>
  format: OutputFormat
  quality: number
}

/**
 * Paint the sheet background. A transparent colour is left empty unless the
 * output cannot hold transparency, in which case it becomes white.
 */
export async function drawBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  bg: SheetBackground,
  picture: Blob | undefined,
  opaqueOutput: boolean,
) {
  if (bg.kind === 'color') {
    if (bg.color === 'transparent' && !opaqueOutput) return
    ctx.fillStyle = bg.color === 'transparent' ? '#ffffff' : bg.color
    ctx.fillRect(0, 0, W, H)
    return
  }
  if (bg.kind === 'gradient') {
    // CSS angle: 0deg points up, 90deg points right; the line passes through the centre.
    const a = ((bg.angle - 90) * Math.PI) / 180
    const half = (Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))) / 2
    const cx = W / 2
    const cy = H / 2
    const g = ctx.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half)
    g.addColorStop(0, bg.from)
    g.addColorStop(1, bg.to)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    return
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  if (!picture) return
  const blurPx = bg.blur * W
  // Decode only as large as the sheet, and smaller still when it will be blurred anyway.
  const probe = await createImageBitmap(picture, { imageOrientation: 'from-image' })
  try {
    const cover = Math.max(W / probe.width, H / probe.height)
    const scale = Math.min(1, cover / (blurPx > 0 ? 2 : 1))
    const bmp =
      scale < 1
        ? await createImageBitmap(probe, {
            resizeWidth: Math.max(1, Math.round(probe.width * scale)),
            resizeHeight: Math.max(1, Math.round(probe.height * scale)),
            resizeQuality: 'high',
          })
        : probe
    try {
      const dw = bmp.width * (cover / scale)
      const dh = bmp.height * (cover / scale)
      const dx = (W - dw) / 2
      const dy = (H - dh) / 2
      ctx.save()
      if (blurPx > 0 && 'filter' in ctx) {
        ctx.filter = `blur(${blurPx}px)`
        // Overdraw so the blur does not fade towards the edges.
        const pad = blurPx * 2
        ctx.drawImage(bmp, dx - pad, dy - pad, dw + 2 * pad, dh + 2 * pad)
      } else {
        ctx.drawImage(bmp, dx, dy, dw, dh)
      }
      ctx.restore()
    } finally {
      if (bmp !== probe) bmp.close()
    }
  } finally {
    probe.close()
  }
  if (bg.dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${bg.dim})`
    ctx.fillRect(0, 0, W, H)
  }
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
  await drawBackground(ctx, W, H, spec.background, input.backgroundImage, input.format === 'image/jpeg')
  const radiusPx = spec.radius * Math.min(...placements.map((p) => Math.min(p.width * W, p.height * H)), Infinity)
  const byId = new Map(images.map((i) => [i.id, i]))
  for (const p of placements) {
    const img = byId.get(p.id)
    const blob = sources.get(p.id)
    if (!img || !blob) continue
    const cell: Rect = { x: p.x * W, y: p.y * H, width: p.width * W, height: p.height * H }
    const crop = input.crops[p.id]
    const border = input.borders[p.id]
    // Decode no larger than the drawn window needs.
    const { dest, src } = photoView(img.width, img.height, cell, crop, border ? border.width * W : 0)
    const scale = Math.min(1, (dest.width / src.width) * 1.05)
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: Math.max(1, Math.round(img.width * scale)),
      resizeHeight: Math.max(1, Math.round(img.height * scale)),
      resizeQuality: 'high',
    })
    try {
      drawCell(ctx, bitmap, img, cell, crop, Number.isFinite(radiusPx) ? radiusPx : 0, border, W)
    } finally {
      bitmap.close()
    }
  }
  const res = await encode(canvas, { format: input.format, quality: input.quality })
  return { ...res, width: W, height: H }
}
