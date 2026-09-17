/**
 * Content-aware fill: multi-scale PatchMatch inpainting (Wexler / Barnes et al.).
 *
 * Works on a crop around the masked region at a capped working resolution,
 * fills coarse-to-fine, then composites the result back into the full image
 * with a feathered edge. Pure JS, runs inside the worker.
 */

const WORK_MAX = 640
const MIN_LEVEL = 40

interface Level {
  w: number
  h: number
  rgb: Float32Array // w*h*3
  hole: Uint8Array // w*h, 1 = to fill
}

interface Nnf {
  x: Int32Array
  y: Int32Array
  d: Float32Array
}

function bbox(mask: Uint8Array, w: number, h: number) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** Area-average resample of RGB + "any" resample of the hole mask. */
function resample(src: Level, w: number, h: number): Level {
  const rgb = new Float32Array(w * h * 3)
  const hole = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * src.h) / h)
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.h) / h))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * src.w) / w)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.w) / w))
      let r = 0
      let g = 0
      let b = 0
      let cnt = 0
      let anyHole = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const si = sy * src.w + sx
          if (src.hole[si]) anyHole = 1
          r += src.rgb[si * 3]
          g += src.rgb[si * 3 + 1]
          b += src.rgb[si * 3 + 2]
          cnt++
        }
      }
      const o = y * w + x
      rgb[o * 3] = r / cnt
      rgb[o * 3 + 1] = g / cnt
      rgb[o * 3 + 2] = b / cnt
      hole[o] = anyHole
    }
  }
  return { w, h, rgb, hole }
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h)
  // Horizontal then vertical pass (square structuring element).
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w && mask[row + xx]) v = 1
      }
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1
      }
      out[y * w + x] = v
    }
  }
  return out
}

/** Fill the hole by onion-peeling from the boundary, then smooth. */
function diffusionFill(level: Level) {
  const { w, h, rgb, hole } = level
  const known = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1
  let remaining = 0
  for (let i = 0; i < w * h; i++) if (!known[i]) remaining++
  if (remaining === w * h) {
    rgb.fill(128)
    return
  }
  const next: number[] = []
  while (remaining > 0) {
    next.length = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        let r = 0
        let g = 0
        let b = 0
        let c = 0
        const nb = [i - 1, i + 1, i - w, i + w]
        const ok = [x > 0, x < w - 1, y > 0, y < h - 1]
        for (let k = 0; k < 4; k++) {
          if (ok[k] && known[nb[k]]) {
            r += rgb[nb[k] * 3]
            g += rgb[nb[k] * 3 + 1]
            b += rgb[nb[k] * 3 + 2]
            c++
          }
        }
        if (c) {
          rgb[i * 3] = r / c
          rgb[i * 3 + 1] = g / c
          rgb[i * 3 + 2] = b / c
          next.push(i)
        }
      }
    }
    if (!next.length) break
    for (const i of next) known[i] = 1
    remaining -= next.length
  }
  // Jacobi smoothing inside the hole.
  const tmp = new Float32Array(rgb.length)
  for (let it = 0; it < 25; it++) {
    tmp.set(rgb)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!hole[i]) continue
        for (let c = 0; c < 3; c++) {
          rgb[i * 3 + c] =
            (tmp[(i - 1) * 3 + c] + tmp[(i + 1) * 3 + c] + tmp[(i - w) * 3 + c] + tmp[(i + w) * 3 + c]) / 4
        }
      }
    }
  }
}

/** Summed-area table of the hole mask for O(1) "patch contains hole?" queries. */
function integral(mask: Uint8Array, w: number, h: number): Int32Array {
  const sat = new Int32Array((w + 1) * (h + 1))
  for (let y = 1; y <= h; y++) {
    let rowSum = 0
    for (let x = 1; x <= w; x++) {
      rowSum += mask[(y - 1) * w + (x - 1)]
      sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + rowSum
    }
  }
  return sat
}

function rectSum(sat: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  // inclusive coords
  const W = w + 1
  return sat[(y1 + 1) * W + (x1 + 1)] - sat[y0 * W + (x1 + 1)] - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0]
}

let rngState = 123456789
function rand(): number {
  rngState ^= rngState << 13
  rngState ^= rngState >>> 17
  rngState ^= rngState << 5
  return (rngState >>> 0) / 4294967296
}

function patchDistance(
  rgb: Float32Array,
  w: number,
  h: number,
  px: number,
  py: number,
  qx: number,
  qy: number,
  r: number,
  cutoff: number,
): number {
  let d = 0
  for (let dy = -r; dy <= r; dy++) {
    let ty = py + dy
    if (ty < 0) ty = 0
    else if (ty >= h) ty = h - 1
    const sy = qy + dy
    for (let dx = -r; dx <= r; dx++) {
      let tx = px + dx
      if (tx < 0) tx = 0
      else if (tx >= w) tx = w - 1
      const ti = (ty * w + tx) * 3
      const si = (sy * w + qx + dx) * 3
      const dr = rgb[ti] - rgb[si]
      const dg = rgb[ti + 1] - rgb[si + 1]
      const db = rgb[ti + 2] - rgb[si + 2]
      d += dr * dr + dg * dg + db * db
    }
    if (d > cutoff) return d
  }
  return d
}

interface LevelWork {
  r: number
  targets: Int32Array
  isTarget: Uint8Array
  valid: Uint8Array
  validList: Int32Array
}

function prepareLevel(level: Level, r: number): LevelWork | null {
  const { w, h, hole } = level
  const sat = integral(hole, w, h)
  const isTarget = new Uint8Array(w * h)
  const valid = new Uint8Array(w * h)
  const targets: number[] = []
  const validList: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const y0 = Math.max(0, y - r)
      const x1 = Math.min(w - 1, x + r)
      const y1 = Math.min(h - 1, y + r)
      const holes = rectSum(sat, w, x0, y0, x1, y1)
      const i = y * w + x
      if (holes > 0) {
        isTarget[i] = 1
        targets.push(i)
      } else if (x >= r && y >= r && x < w - r && y < h - r) {
        valid[i] = 1
        validList.push(i)
      }
    }
  }
  if (!validList.length || !targets.length) return null
  return { r, targets: Int32Array.from(targets), isTarget, valid, validList: Int32Array.from(validList) }
}

function randomValid(work: LevelWork): number {
  return work.validList[Math.floor(rand() * work.validList.length)]
}

function initNnf(level: Level, work: LevelWork, prev: { level: Level; work: LevelWork; nnf: Nnf } | null): Nnf {
  const { w, h } = level
  const x = new Int32Array(w * h)
  const y = new Int32Array(w * h)
  const d = new Float32Array(w * h).fill(Infinity)
  for (let k = 0; k < work.targets.length; k++) {
    const p = work.targets[k]
    const px = p % w
    const py = (p - px) / w
    let q = -1
    if (prev) {
      const cx = Math.min(prev.level.w - 1, px >> 1)
      const cy = Math.min(prev.level.h - 1, py >> 1)
      const cp = cy * prev.level.w + cx
      if (prev.work.isTarget[cp]) {
        const qx = prev.nnf.x[cp] * 2 + (px & 1)
        const qy = prev.nnf.y[cp] * 2 + (py & 1)
        if (qx >= 0 && qy >= 0 && qx < w && qy < h && work.valid[qy * w + qx]) q = qy * w + qx
      }
    }
    if (q < 0) q = randomValid(work)
    x[p] = q % w
    y[p] = (q - x[p]) / w
    d[p] = patchDistance(level.rgb, w, h, px, py, x[p], y[p], work.r, Infinity)
  }
  return { x, y, d }
}

function patchMatch(level: Level, work: LevelWork, nnf: Nnf, iterations: number) {
  const { w, h, rgb } = level
  const { r, targets, isTarget, valid } = work
  const maxRadius = Math.max(w, h)
  for (let it = 0; it < iterations; it++) {
    const forward = it % 2 === 0
    for (let k = 0; k < targets.length; k++) {
      const p = targets[forward ? k : targets.length - 1 - k]
      const px = p % w
      const py = (p - px) / w
      let bx = nnf.x[p]
      let by = nnf.y[p]
      let bd = nnf.d[p]

      // Propagation from already-visited neighbours.
      const step = forward ? -1 : 1
      const nx = px + step
      if (nx >= 0 && nx < w) {
        const n = py * w + nx
        if (isTarget[n]) {
          const qx = nnf.x[n] - step
          const qy = nnf.y[n]
          if (qx >= 0 && qx < w && valid[qy * w + qx]) {
            const dd = patchDistance(rgb, w, h, px, py, qx, qy, r, bd)
            if (dd < bd) {
              bd = dd
              bx = qx
              by = qy
            }
          }
        }
      }
      const ny = py + step
      if (ny >= 0 && ny < h) {
        const n = ny * w + px
        if (isTarget[n]) {
          const qx = nnf.x[n]
          const qy = nnf.y[n] - step
          if (qy >= 0 && qy < h && valid[qy * w + qx]) {
            const dd = patchDistance(rgb, w, h, px, py, qx, qy, r, bd)
            if (dd < bd) {
              bd = dd
              bx = qx
              by = qy
            }
          }
        }
      }

      // Random search with exponentially shrinking window.
      for (let radius = maxRadius; radius >= 1; radius = Math.floor(radius / 2)) {
        const qx = bx + Math.floor((rand() * 2 - 1) * radius)
        const qy = by + Math.floor((rand() * 2 - 1) * radius)
        if (qx < 0 || qy < 0 || qx >= w || qy >= h || !valid[qy * w + qx]) continue
        const dd = patchDistance(rgb, w, h, px, py, qx, qy, r, bd)
        if (dd < bd) {
          bd = dd
          bx = qx
          by = qy
        }
      }

      nnf.x[p] = bx
      nnf.y[p] = by
      nnf.d[p] = bd
    }
  }
}

function vote(level: Level, work: LevelWork, nnf: Nnf) {
  const { w, h, rgb, hole } = level
  const { r, targets } = work
  const acc = new Float32Array(w * h * 3)
  const wsum = new Float32Array(w * h)

  let mean = 0
  for (let k = 0; k < targets.length; k++) mean += nnf.d[targets[k]]
  mean /= targets.length
  const sigma2 = Math.max(mean, 1) * 0.5

  for (let k = 0; k < targets.length; k++) {
    const p = targets[k]
    const px = p % w
    const py = (p - px) / w
    const qx = nnf.x[p]
    const qy = nnf.y[p]
    const wt = Math.exp(-nnf.d[p] / (2 * sigma2)) + 1e-4
    for (let dy = -r; dy <= r; dy++) {
      const ty = py + dy
      if (ty < 0 || ty >= h) continue
      for (let dx = -r; dx <= r; dx++) {
        const tx = px + dx
        if (tx < 0 || tx >= w) continue
        const ti = ty * w + tx
        if (!hole[ti]) continue
        const si = ((qy + dy) * w + qx + dx) * 3
        acc[ti * 3] += rgb[si] * wt
        acc[ti * 3 + 1] += rgb[si + 1] * wt
        acc[ti * 3 + 2] += rgb[si + 2] * wt
        wsum[ti] += wt
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (hole[i] && wsum[i] > 0) {
      rgb[i * 3] = acc[i * 3] / wsum[i]
      rgb[i * 3 + 1] = acc[i * 3 + 1] / wsum[i]
      rgb[i * 3 + 2] = acc[i * 3 + 2] / wsum[i]
    }
  }
}

/** Bilinear upsample of the coarse fill into the fine level's hole pixels. */
function upsampleFill(coarse: Level, fine: Level) {
  const { w, h, rgb, hole } = fine
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(coarse.h - 1, (y + 0.5) * (coarse.h / h) - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(coarse.h - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!hole[i]) continue
      const fx = Math.max(0, Math.min(coarse.w - 1, (x + 0.5) * (coarse.w / w) - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(coarse.w - 1, x0 + 1)
      const tx = fx - x0
      for (let c = 0; c < 3; c++) {
        const a = coarse.rgb[(y0 * coarse.w + x0) * 3 + c]
        const b = coarse.rgb[(y0 * coarse.w + x1) * 3 + c]
        const cc = coarse.rgb[(y1 * coarse.w + x0) * 3 + c]
        const d = coarse.rgb[(y1 * coarse.w + x1) * 3 + c]
        rgb[i * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty
      }
    }
  }
}

export interface InpaintProgress {
  (fraction: number): void
}

/**
 * Fill every pixel where `mask[i] !== 0` with plausible content.
 * Returns a new ImageData; the input is not modified.
 */
export function inpaint(image: ImageData, mask: Uint8Array, onProgress?: InpaintProgress): ImageData {
  const W = image.width
  const H = image.height
  const out = new ImageData(new Uint8ClampedArray(image.data), W, H)
  const bb = bbox(mask, W, H)
  if (!bb) return out

  rngState = 0x2545f491

  // Crop window: mask bbox plus generous context for source patches.
  const bw = bb.x1 - bb.x0 + 1
  const bh = bb.y1 - bb.y0 + 1
  const margin = Math.max(64, Math.round(Math.max(bw, bh) * 1.25))
  const cx0 = Math.max(0, bb.x0 - margin)
  const cy0 = Math.max(0, bb.y0 - margin)
  const cx1 = Math.min(W - 1, bb.x1 + margin)
  const cy1 = Math.min(H - 1, bb.y1 + margin)
  const cw = cx1 - cx0 + 1
  const ch = cy1 - cy0 + 1

  const crop: Level = { w: cw, h: ch, rgb: new Float32Array(cw * ch * 3), hole: new Uint8Array(cw * ch) }
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (cy0 + y) * W + cx0 + x
      const di = y * cw + x
      crop.rgb[di * 3] = image.data[si * 4]
      crop.rgb[di * 3 + 1] = image.data[si * 4 + 1]
      crop.rgb[di * 3 + 2] = image.data[si * 4 + 2]
      crop.hole[di] = mask[si] ? 1 : 0
    }
  }

  // Working resolution.
  const scale = Math.min(1, WORK_MAX / Math.max(cw, ch))
  let base: Level =
    scale < 1 ? resample(crop, Math.max(8, Math.round(cw * scale)), Math.max(8, Math.round(ch * scale))) : crop
  if (scale < 1) base.hole = dilate(base.hole, base.w, base.h, 1)
  else base = { ...base, hole: dilate(base.hole, base.w, base.h, 1) }

  // Pyramid.
  const levels: Level[] = [base]
  while (Math.min(levels[levels.length - 1].w, levels[levels.length - 1].h) > MIN_LEVEL * 2 && levels.length < 7) {
    const prev = levels[levels.length - 1]
    levels.push(resample(prev, Math.floor(prev.w / 2), Math.floor(prev.h / 2)))
  }

  const coarsest = levels[levels.length - 1]
  diffusionFill(coarsest)

  let prev: { level: Level; work: LevelWork; nnf: Nnf } | null = null
  const totalSteps = levels.length
  for (let li = levels.length - 1; li >= 0; li--) {
    const level = levels[li]
    if (li !== levels.length - 1) upsampleFill(levels[li + 1], level)
    const r = Math.min(level.w, level.h) < 80 ? 2 : 3
    const work = prepareLevel(level, r)
    if (!work) {
      prev = null
      continue
    }
    const nnf = initNnf(level, work, prev && prev.work.r === r ? prev : prev)
    const isFinest = li === 0
    const em = isFinest ? 3 : li === 1 ? 4 : 6
    const pmIters = isFinest ? 3 : 4
    for (let e = 0; e < em; e++) {
      patchMatch(level, work, nnf, pmIters)
      vote(level, work, nnf)
      // Distances are stale after voting; refresh cheaply for weighting next round.
      if (e < em - 1) {
        for (let k = 0; k < work.targets.length; k++) {
          const p = work.targets[k]
          const px = p % level.w
          const py = (p - px) / level.w
          nnf.d[p] = patchDistance(level.rgb, level.w, level.h, px, py, nnf.x[p], nnf.y[p], r, Infinity)
        }
      }
    }
    prev = { level, work, nnf }
    onProgress?.((totalSteps - li) / (totalSteps + 1))
  }

  // Composite back: feathered blend of the (possibly upscaled) fill into the crop.
  const feather = dilate(crop.hole, cw, ch, 2)
  const alpha = new Float32Array(cw * ch)
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x
      if (crop.hole[i]) alpha[i] = 1
      else if (feather[i]) {
        // distance-ish falloff: count hole neighbours in 5x5
        let c = 0
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < cw && yy < ch && crop.hole[yy * cw + xx]) c++
          }
        alpha[i] = Math.min(1, c / 12)
      }
    }
  }

  for (let y = 0; y < ch; y++) {
    const fy = Math.max(0, Math.min(base.h - 1, (y + 0.5) * (base.h / ch) - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(base.h - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x
      const a = alpha[i]
      if (a <= 0) continue
      const fx = Math.max(0, Math.min(base.w - 1, (x + 0.5) * (base.w / cw) - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(base.w - 1, x0 + 1)
      const tx = fx - x0
      const oi = ((cy0 + y) * W + cx0 + x) * 4
      for (let c = 0; c < 3; c++) {
        const p00 = base.rgb[(y0 * base.w + x0) * 3 + c]
        const p10 = base.rgb[(y0 * base.w + x1) * 3 + c]
        const p01 = base.rgb[(y1 * base.w + x0) * 3 + c]
        const p11 = base.rgb[(y1 * base.w + x1) * 3 + c]
        const v = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty
        out.data[oi + c] = out.data[oi + c] * (1 - a) + v * a
      }
    }
  }
  onProgress?.(1)
  return out
}
