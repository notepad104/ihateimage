/**
 * Pure canvas operations. This module is imported by the Web Worker and must
 * not touch the DOM. Everything here works on OffscreenCanvas.
 */
import type { EncodeOptions, Op, OutputFormat } from './types'

type Ctx2D = OffscreenCanvasRenderingContext2D

function makeCanvas(width: number, height: number): [OffscreenCanvas, Ctx2D] {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return [canvas, ctx]
}

export async function decode(source: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(
      `This browser cannot decode "${source.type || 'this file type'}". Try converting it first (e.g. HEIC → JPG on your device).`,
    )
  }
}

export function fromBitmap(bitmap: ImageBitmap): OffscreenCanvas {
  const [canvas, ctx] = makeCanvas(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  return canvas
}

/**
 * Resize with progressive halving when shrinking a lot. Single-pass bilinear
 * downscaling by more than 2x aliases badly in most browsers.
 */
export function resize(src: OffscreenCanvas, width: number, height: number): OffscreenCanvas {
  let current = src
  while (current.width / 2 >= width && current.height / 2 >= height) {
    const [half, ctx] = makeCanvas(Math.floor(current.width / 2), Math.floor(current.height / 2))
    ctx.drawImage(current, 0, 0, half.width, half.height)
    current = half
  }
  if (current.width === width && current.height === height) return current
  const [out, ctx] = makeCanvas(width, height)
  ctx.drawImage(current, 0, 0, width, height)
  return out
}

export function crop(src: OffscreenCanvas, x: number, y: number, width: number, height: number): OffscreenCanvas {
  const sx = Math.max(0, Math.min(src.width - 1, Math.round(x)))
  const sy = Math.max(0, Math.min(src.height - 1, Math.round(y)))
  const sw = Math.max(1, Math.min(src.width - sx, Math.round(width)))
  const sh = Math.max(1, Math.min(src.height - sy, Math.round(height)))
  const [out, ctx] = makeCanvas(sw, sh)
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
  return out
}

export function pad(src: OffscreenCanvas, width: number, height: number, color: string): OffscreenCanvas {
  const [out, ctx] = makeCanvas(width, height)
  if (color !== 'transparent') {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, out.width, out.height)
  }
  ctx.drawImage(src, Math.round((out.width - src.width) / 2), Math.round((out.height - src.height) / 2))
  return out
}

export function rotate(src: OffscreenCanvas, degrees: 90 | 180 | 270): OffscreenCanvas {
  const swap = degrees === 90 || degrees === 270
  const [out, ctx] = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

export function flip(src: OffscreenCanvas, horizontal: boolean, vertical: boolean): OffscreenCanvas {
  if (!horizontal && !vertical) return src
  const [out, ctx] = makeCanvas(src.width, src.height)
  ctx.translate(horizontal ? out.width : 0, vertical ? out.height : 0)
  ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1)
  ctx.drawImage(src, 0, 0)
  return out
}

export function flatten(src: OffscreenCanvas, color: string): OffscreenCanvas {
  const [out, ctx] = makeCanvas(src.width, src.height)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0)
  return out
}

export function applyOp(src: OffscreenCanvas, op: Op): OffscreenCanvas {
  switch (op.type) {
    case 'resize':
      return resize(src, op.width, op.height)
    case 'crop':
      return crop(src, op.x, op.y, op.width, op.height)
    case 'pad':
      return pad(src, op.width, op.height, op.color)
    case 'rotate':
      return rotate(src, op.degrees)
    case 'flip':
      return flip(src, op.horizontal, op.vertical)
    case 'flatten':
      return flatten(src, op.color)
  }
}

export function applyOps(src: OffscreenCanvas, ops: Op[]): OffscreenCanvas {
  return ops.reduce(applyOp, src)
}

export async function encodeOnce(canvas: OffscreenCanvas, format: OutputFormat, quality?: number): Promise<Blob> {
  const blob = await canvas.convertToBlob(
    format === 'image/png' ? { type: format } : { type: format, quality: quality ?? 0.85 },
  )
  if (blob.type !== format) {
    throw new Error(`This browser cannot encode ${format.replace('image/', '').toUpperCase()}.`)
  }
  return blob
}

export interface EncodeResult {
  blob: Blob
  quality?: number
  missedTarget?: boolean
}

/**
 * Encode, optionally binary-searching quality to land under a target byte size.
 * JPEG has no transparency, so callers should `flatten` first if needed.
 */
export async function encode(canvas: OffscreenCanvas, opts: EncodeOptions): Promise<EncodeResult> {
  if (opts.format === 'image/png' || !opts.targetBytes) {
    const blob = await encodeOnce(canvas, opts.format, opts.quality)
    return { blob, quality: opts.format === 'image/png' ? undefined : (opts.quality ?? 0.85) }
  }

  const target = opts.targetBytes
  let lo = 0.05
  let hi = Math.min(1, opts.quality ?? 0.95)
  let best: { blob: Blob; quality: number } | null = null

  // Quick check: does the requested quality already fit?
  const first = await encodeOnce(canvas, opts.format, hi)
  if (first.size <= target) return { blob: first, quality: hi }

  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2
    const blob = await encodeOnce(canvas, opts.format, mid)
    if (blob.size <= target) {
      best = { blob, quality: mid }
      lo = mid
    } else {
      hi = mid
    }
    if (hi - lo < 0.02) break
  }

  if (best) return best
  const floor = await encodeOnce(canvas, opts.format, lo)
  return { blob: floor, quality: lo, missedTarget: floor.size > target }
}
