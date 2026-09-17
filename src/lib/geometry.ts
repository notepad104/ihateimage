import type { Gravity, Rect } from './types'

export interface Size {
  width: number
  height: number
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function round(n: number): number {
  return Math.max(1, Math.round(n))
}

/** Parse "16:9", "16/9", "1.777" into a width/height ratio. Returns null if invalid. */
export function parseRatio(input: string): number | null {
  const s = input.trim().replace('/', ':')
  if (!s) return null
  if (s.includes(':')) {
    const [a, b] = s.split(':').map((x) => Number(x.trim()))
    if (!a || !b || a <= 0 || b <= 0) return null
    return a / b
  }
  const n = Number(s)
  return n > 0 ? n : null
}

/** Largest rect of the given aspect ratio that fits inside `src`, positioned by gravity. */
export function cropToRatio(src: Size, ratio: number, gravity: Gravity = 'center'): Rect {
  const srcRatio = src.width / src.height
  let width: number
  let height: number
  if (srcRatio > ratio) {
    height = src.height
    width = Math.round(height * ratio)
  } else {
    width = src.width
    height = Math.round(width / ratio)
  }
  width = clamp(width, 1, src.width)
  height = clamp(height, 1, src.height)
  const { x, y } = positionByGravity(src, { width, height }, gravity)
  return { x, y, width, height }
}

/** Smallest canvas of the given ratio that contains `src` entirely. */
export function padToRatio(src: Size, ratio: number): Size {
  const srcRatio = src.width / src.height
  if (srcRatio > ratio) {
    return { width: src.width, height: round(src.width / ratio) }
  }
  return { width: round(src.height * ratio), height: src.height }
}

export function positionByGravity(outer: Size, inner: Size, gravity: Gravity): { x: number; y: number } {
  const dx = outer.width - inner.width
  const dy = outer.height - inner.height
  const xs = gravity.endsWith('left') ? 0 : gravity.endsWith('right') ? dx : dx / 2
  const ys = gravity.startsWith('top') ? 0 : gravity.startsWith('bottom') ? dy : dy / 2
  return { x: Math.round(xs), y: Math.round(ys) }
}

export interface ResizeSpec {
  mode: 'pixels' | 'percent' | 'fit'
  width?: number
  height?: number
  percent?: number
  lockAspect?: boolean
  noEnlarge?: boolean
}

/** Resolve a user-facing resize spec into concrete output dimensions. */
export function resolveResize(src: Size, spec: ResizeSpec): Size {
  let out: Size = { ...src }
  if (spec.mode === 'percent') {
    const p = (spec.percent ?? 100) / 100
    out = { width: round(src.width * p), height: round(src.height * p) }
  } else if (spec.mode === 'fit') {
    const maxW = spec.width ?? src.width
    const maxH = spec.height ?? src.height
    const scale = Math.min(maxW / src.width, maxH / src.height)
    out = { width: round(src.width * scale), height: round(src.height * scale) }
  } else {
    const w = spec.width
    const h = spec.height
    if (w && h && !spec.lockAspect) out = { width: round(w), height: round(h) }
    else if (w && h) {
      // Both provided but aspect locked → treat as bounding box.
      const scale = Math.min(w / src.width, h / src.height)
      out = { width: round(src.width * scale), height: round(src.height * scale) }
    } else if (w) out = { width: round(w), height: round((w / src.width) * src.height) }
    else if (h) out = { width: round((h / src.height) * src.width), height: round(h) }
  }
  if (spec.noEnlarge && (out.width > src.width || out.height > src.height)) {
    const scale = Math.min(src.width / out.width, src.height / out.height, 1)
    out = { width: round(out.width * scale), height: round(out.height * scale) }
  }
  return out
}

export function rectsEqual(a: Rect | undefined, b: Rect | undefined): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
