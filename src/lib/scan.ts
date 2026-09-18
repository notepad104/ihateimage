/**
 * Document scanning primitives, all pure TypeScript so they run inside the
 * worker: classic page-outline detection, perspective geometry (homography,
 * real-world aspect estimate), the warp itself and the "scanned paper" look.
 */
import type { Point, Quad } from './types'

// ---------------------------------------------------------------------------
// Quad helpers
// ---------------------------------------------------------------------------

/** Sort four arbitrary points into TL, TR, BR, BL (clockwise on screen). */
export function orderQuad(pts: Point[]): Quad {
  if (pts.length !== 4) throw new Error('A quad needs exactly four points')
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4
  // y grows downwards, so ascending atan2 is clockwise as seen on screen.
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i
  return [sorted[start], sorted[(start + 1) % 4], sorted[(start + 2) % 4], sorted[(start + 3) % 4]]
}

export function quadArea(q: Point[]): number {
  let s = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function isConvex(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return sign !== 0
}

/** Interior angles in degrees, one per corner. */
function quadAngles(q: Quad): number[] {
  const out: number[] = []
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4]
    const c = q[i]
    const n = q[(i + 1) % 4]
    const v1x = p.x - c.x
    const v1y = p.y - c.y
    const v2x = n.x - c.x
    const v2y = n.y - c.y
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1)
    out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI)
  }
  return out
}

/** A plausible page: convex, no absurd corner angles, not a sliver. */
export function isReasonableQuad(q: Quad, width: number, height: number): boolean {
  if (!isConvex(q)) return false
  if (quadAngles(q).some((a) => a < 40 || a > 140)) return false
  const frac = quadArea(q) / (width * height)
  return frac >= 0.03 && frac <= 1.0
}

/** Corners at a small inset from the image edges, used when nothing is detected. */
export function defaultQuad(width: number, height: number, inset = 0.04): Quad {
  const dx = width * inset
  const dy = height * inset
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ]
}

export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad
}

// ---------------------------------------------------------------------------
// Perspective geometry
// ---------------------------------------------------------------------------

/** Solve the 8 DOF homography mapping src[i] → dst[i]. Returns a row-major 3×3. */
export function homography(src: Quad, dst: Quad): Float64Array {
  // Build the 8×9 augmented system.
  const m: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error('Degenerate quadrilateral')
    if (pivot !== col) [m[pivot], m[col]] = [m[col], m[pivot]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = m[r][col] / m[col][col]
      if (f === 0) continue
      for (let c = col; c < 9; c++) m[r][c] -= f * m[col][c]
    }
  }
  const h = new Float64Array(9)
  for (let i = 0; i < 8; i++) h[i] = m[i][8] / m[i][i]
  h[8] = 1
  return h
}

/**
 * Real width/height ratio of the rectangle that projects onto `q`, following
 * Zhang & He, "Whiteboard scanning and image enhancement" (2004). Assumes the
 * principal point at the image centre and recovers the focal length from the
 * vanishing geometry. Falls back to the measured side ratio when the view is
 * (near) affine, where the closed form is numerically meaningless.
 */
export function estimateAspect(q: Quad, imgW: number, imgH: number): number {
  const [tl, tr, br, bl] = q
  const measured = () => {
    const w = (dist(tl, tr) + dist(bl, br)) / 2
    const h = (dist(tl, bl) + dist(tr, br)) / 2
    return h > 0 ? w / h : 1
  }
  const u0 = imgW / 2
  const v0 = imgH / 2
  const m1 = [tl.x, tl.y, 1]
  const m2 = [tr.x, tr.y, 1]
  const m3 = [bl.x, bl.y, 1]
  const m4 = [br.x, br.y, 1]
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const c14 = cross(m1, m4)
  const d24 = dot(cross(m2, m4), m3)
  const d34 = dot(cross(m3, m4), m2)
  if (Math.abs(d24) < 1e-9 || Math.abs(d34) < 1e-9) return measured()
  const k2 = dot(c14, m3) / d24
  const k3 = dot(c14, m2) / d34
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1]
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1]
  // Near-affine view: opposite sides almost parallel, the focal estimate blows up.
  if (Math.abs(n2[2]) < 2e-3 || Math.abs(n3[2]) < 2e-3) return measured()
  const f2 =
    -(
      n2[0] * n3[0] -
      (n2[0] * n3[2] + n2[2] * n3[0]) * u0 +
      n2[2] * n3[2] * u0 * u0 +
      (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)
    ) /
    (n2[2] * n3[2])
  if (!(f2 > 0)) return measured()
  const f = Math.sqrt(f2)
  // |A⁻¹ n| with A = [[f,0,u0],[0,f,v0],[0,0,1]]
  const norm = (n: number[]) => Math.hypot((n[0] - u0 * n[2]) / f, (n[1] - v0 * n[2]) / f, n[2])
  const ratio = norm(n2) / norm(n3)
  if (!Number.isFinite(ratio) || ratio < 0.15 || ratio > 6.5) return measured()
  // Keep the estimate within a sane band of the measured ratio; extreme
  // focal solutions on noisy corners otherwise produce comically tall pages.
  const meas = measured()
  return Math.min(Math.max(ratio, meas / 2.2), meas * 2.2)
}

/** Output rectangle for a quad in pixel coordinates, keeping the longest visible edges sharp. */
export function warpOutputSize(q: Quad, aspect: number, maxSide = 6000): { width: number; height: number } {
  const [tl, tr, br, bl] = q
  const wPx = Math.max(dist(tl, tr), dist(bl, br))
  const hPx = Math.max(dist(tl, bl), dist(tr, br))
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : wPx / Math.max(1, hPx)
  let width = Math.max(wPx, hPx * a)
  let height = width / a
  const longest = Math.max(width, height)
  if (longest > maxSide) {
    width *= maxSide / longest
    height *= maxSide / longest
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

/** Inverse-map every output pixel into the source quad with bilinear sampling. */
export function warp(img: ImageData, q: Quad, outW: number, outH: number): ImageData {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ]
  const h = homography(rect, q)
  const W = img.width
  const H = img.height
  const src = img.data
  const out = new ImageData(outW, outH)
  const dst = out.data
  const maxX = W - 1
  const maxY = H - 1
  let o = 0
  for (let y = 0; y < outH; y++) {
    const yc = y + 0.5
    for (let x = 0; x < outW; x++) {
      const xc = x + 0.5
      const den = h[6] * xc + h[7] * yc + h[8]
      let u = (h[0] * xc + h[1] * yc + h[2]) / den - 0.5
      let v = (h[3] * xc + h[4] * yc + h[5]) / den - 0.5
      if (u < 0) u = 0
      else if (u > maxX) u = maxX
      if (v < 0) v = 0
      else if (v > maxY) v = maxY
      const x0 = u | 0
      const y0 = v | 0
      const x1 = x0 < maxX ? x0 + 1 : x0
      const y1 = y0 < maxY ? y0 + 1 : y0
      const fx = u - x0
      const fy = v - y0
      const i00 = (y0 * W + x0) * 4
      const i10 = (y0 * W + x1) * 4
      const i01 = (y1 * W + x0) * 4
      const i11 = (y1 * W + x1) * 4
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      dst[o] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11
      dst[o + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11
      dst[o + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11
      dst[o + 3] = 255
      o += 4
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Scan look
// ---------------------------------------------------------------------------

/**
 * Scanner look, in place. Three stages, all driven by the image itself:
 *
 *  1. Illumination map. The paper colour is estimated per block from that
 *     block's bright pixels, blocks without paper (photos, big headlines)
 *     borrow from their brightest neighbour, and the map is smoothed. Dividing
 *     the image by this map removes shadows, vignetting and colour casts:
 *     paper becomes uniformly white, ink and pictures keep their relative tone.
 *  2. Auto exposure. Levels are set from the normalised image's histogram so
 *     ink lands on black and paper on white.
 *  3. Paper cleanup. Faint colour noise on near-white pixels is neutralised.
 *
 * `strength` 0..1 blends between the original and the fully processed pixel.
 */
export function scanFilter(img: ImageData, strength: number): void {
  const s = Math.max(0, Math.min(1, strength))
  if (s <= 0) return
  const W = img.width
  const H = img.height
  const d = img.data
  const B = Math.max(8, Math.round(Math.max(W, H) / 40))
  const bw = Math.ceil(W / B)
  const bh = Math.ceil(H / B)
  const nb = bw * bh
  const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

  // Pass 1: per-block luminance mean and max.
  const sum = new Float64Array(nb)
  const cnt = new Uint32Array(nb)
  const mx = new Float32Array(nb)
  for (let y = 0; y < H; y++) {
    const by = (y / B) | 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const l = lumOf(d[i], d[i + 1], d[i + 2])
      const b = by * bw + ((x / B) | 0)
      sum[b] += l
      cnt[b]++
      if (l > mx[b]) mx[b] = l
    }
  }
  const thr = new Float32Array(nb)
  for (let b = 0; b < nb; b++) {
    const mean = cnt[b] ? sum[b] / cnt[b] : 0
    thr[b] = mean + 0.5 * (mx[b] - mean)
  }

  // Pass 2: per-block mean colour of the bright ("paper") pixels.
  const bgR = new Float32Array(nb)
  const bgG = new Float32Array(nb)
  const bgB = new Float32Array(nb)
  const bgN = new Uint32Array(nb)
  const allR = new Float64Array(nb)
  const allG = new Float64Array(nb)
  const allB = new Float64Array(nb)
  for (let y = 0; y < H; y++) {
    const by = (y / B) | 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const b = by * bw + ((x / B) | 0)
      const r = d[i]
      const g = d[i + 1]
      const bl = d[i + 2]
      allR[b] += r
      allG[b] += g
      allB[b] += bl
      if (lumOf(r, g, bl) >= thr[b]) {
        bgR[b] += r
        bgG[b] += g
        bgB[b] += bl
        bgN[b]++
      }
    }
  }
  for (let b = 0; b < nb; b++) {
    if (bgN[b]) {
      bgR[b] /= bgN[b]
      bgG[b] /= bgN[b]
      bgB[b] /= bgN[b]
    } else if (cnt[b]) {
      bgR[b] = allR[b] / cnt[b]
      bgG[b] = allG[b] / cnt[b]
      bgB[b] = allB[b] / cnt[b]
    }
  }

  // Blocks with no paper in them (a photo, a dark heading) would otherwise be
  // "corrected" to white: let every block take the brightest paper colour in
  // its 3×3 neighbourhood, then smooth.
  const maxFilter = () => {
    const oR = new Float32Array(nb)
    const oG = new Float32Array(nb)
    const oB = new Float32Array(nb)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let best = -1
        let bi = y * bw + x
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= bh) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= bw) continue
            const j = yy * bw + xx
            const l = lumOf(bgR[j], bgG[j], bgB[j])
            if (l > best) {
              best = l
              bi = j
            }
          }
        }
        oR[y * bw + x] = bgR[bi]
        oG[y * bw + x] = bgG[bi]
        oB[y * bw + x] = bgB[bi]
      }
    }
    return [oR, oG, oB]
  }
  const blur = (src: Float32Array) => {
    const out = new Float32Array(nb)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let acc = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= bh) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= bw) continue
            acc += src[yy * bw + xx]
            n++
          }
        }
        out[y * bw + x] = acc / n
      }
    }
    return out
  }
  const [mR, mG, mB] = maxFilter()
  const mapR = blur(blur(mR))
  const mapG = blur(blur(mG))
  const mapB = blur(blur(mB))

  const TARGET = 240
  const MAX_GAIN = 3.2
  const MIN_GAIN = 0.6
  const sample = (map: Float32Array, fx: number, fy: number) => {
    const x0 = Math.max(0, Math.min(bw - 1, Math.floor(fx)))
    const y0 = Math.max(0, Math.min(bh - 1, Math.floor(fy)))
    const x1 = Math.min(bw - 1, x0 + 1)
    const y1 = Math.min(bh - 1, y0 + 1)
    const tx = Math.max(0, Math.min(1, fx - x0))
    const ty = Math.max(0, Math.min(1, fy - y0))
    const a = map[y0 * bw + x0] * (1 - tx) + map[y0 * bw + x1] * tx
    const b = map[y1 * bw + x0] * (1 - tx) + map[y1 * bw + x1] * tx
    return a * (1 - ty) + b * ty
  }
  const gainFor = (bg: number) => Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET / Math.max(24, bg)))

  // Pass 3 (subsampled): histogram of normalised luminance for auto levels.
  const BINS = 1024
  const hist = new Uint32Array(BINS)
  let hn = 0
  const step = Math.max(1, Math.round(Math.sqrt((W * H) / 400_000)))
  for (let y = 0; y < H; y += step) {
    const fy = y / B - 0.5
    for (let x = 0; x < W; x += step) {
      const fx = x / B - 0.5
      const i = (y * W + x) * 4
      const l = lumOf(
        d[i] * gainFor(sample(mapR, fx, fy)),
        d[i + 1] * gainFor(sample(mapG, fx, fy)),
        d[i + 2] * gainFor(sample(mapB, fx, fy)),
      )
      hist[Math.min(BINS - 1, Math.max(0, Math.round(l * 2)))]++
      hn++
    }
  }
  const pct = (p: number) => {
    let acc = 0
    const target = hn * p
    for (let b = 0; b < BINS; b++) {
      acc += hist[b]
      if (acc >= target) return b / 2
    }
    return 255
  }
  const black = Math.min(70, Math.max(0, pct(0.01) * 0.9))
  const white = Math.min(250, Math.max(215, pct(0.92)))
  const scale = 255 / Math.max(1, white - black)

  // Pass 4: normalise, levels, paper cleanup, blend.
  for (let y = 0; y < H; y++) {
    const fy = y / B - 0.5
    for (let x = 0; x < W; x++) {
      const fx = x / B - 0.5
      const i = (y * W + x) * 4
      const r0 = d[i]
      const g0 = d[i + 1]
      const b0 = d[i + 2]
      let r = (r0 * gainFor(sample(mapR, fx, fy)) - black) * scale
      let g = (g0 * gainFor(sample(mapG, fx, fy)) - black) * scale
      let b = (b0 * gainFor(sample(mapB, fx, fy)) - black) * scale
      if (r < 0) r = 0
      else if (r > 255) r = 255
      if (g < 0) g = 0
      else if (g > 255) g = 255
      if (b < 0) b = 0
      else if (b > 255) b = 255
      // Near-white with little chroma: it is paper, make it neutral.
      const hi = Math.max(r, g, b)
      const lo = Math.min(r, g, b)
      if (hi > 185 && hi - lo < 40) {
        const grey = (r + g + b) / 3
        const k = 0.85 * (1 - (hi - lo) / 40)
        r += (grey - r) * k
        g += (grey - g) * k
        b += (grey - b) * k
      }
      d[i] = r0 + (r - r0) * s
      d[i + 1] = g0 + (g - g0) * s
      d[i + 2] = b0 + (b - b0) * s
    }
  }
}

// ---------------------------------------------------------------------------
// Classic detection
// ---------------------------------------------------------------------------

function toGray(img: ImageData): Float32Array {
  const n = img.width * img.height
  const g = new Float32Array(n)
  const d = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
  return g
}

/** Separable 3×3 box blur. */
function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? src[row + x - 1] : src[row + x]
      const r = x < w - 1 ? src[row + x + 1] : src[row + x]
      tmp[row + x] = (l + src[row + x] + r) / 3
    }
  }
  for (let y = 0; y < h; y++) {
    const up = y > 0 ? (y - 1) * w : y * w
    const dn = y < h - 1 ? (y + 1) * w : y * w
    const row = y * w
    for (let x = 0; x < w; x++) out[row + x] = (tmp[up + x] + tmp[row + x] + tmp[dn + x]) / 3
  }
  return out
}

type Gradient = { gx: Float32Array; gy: Float32Array; mag: Float32Array }

/**
 * Colour-aware gradient: Sobel on each blurred RGB channel, keeping per pixel
 * the channel with the strongest response. An orange band against a blue
 * cloth has no luminance edge but a very strong colour edge.
 */
function colorGradient(img: ImageData, w: number, h: number): Gradient {
  const n = w * h
  const d = img.data
  const out: Gradient = { gx: new Float32Array(n), gy: new Float32Array(n), mag: new Float32Array(n) }
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n)
    for (let i = 0, j = c; i < n; i++, j += 4) ch[i] = d[j]
    const g = sobelXY(blur3(blur3(ch, w, h), w, h), w, h)
    for (let i = 0; i < n; i++) {
      if (g.mag[i] > out.mag[i]) {
        out.mag[i] = g.mag[i]
        out.gx[i] = g.gx[i]
        out.gy[i] = g.gy[i]
      }
    }
  }
  return out
}

/** Signed Sobel gradients plus magnitude. */
function sobelXY(g: Float32Array, w: number, h: number): Gradient {
  const gx = new Float32Array(g.length)
  const gy = new Float32Array(g.length)
  const mag = new Float32Array(g.length)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const dx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]
      const dy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]
      gx[i] = dx
      gy[i] = dy
      mag[i] = Math.hypot(dx, dy)
    }
  }
  return { gx, gy, mag }
}

/**
 * Zero out edges that belong to thin strokes: text, table rules, hairlines.
 * A stroke has a second strong edge with the opposite gradient a few pixels
 * away along the gradient direction; a page edge is a single step.
 */
function suppressThin(gx: Float32Array, gy: Float32Array, mag: Float32Array, w: number, h: number, thr: number): Float32Array {
  const out = new Float32Array(mag.length)
  const weak = thr * 0.5
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = mag[i]
      if (m < weak) continue
      const nx = gx[i] / m
      const ny = gy[i] / m
      let thin = false
      for (let k = 2; k <= 4 && !thin; k++) {
        for (const sgn of [1, -1]) {
          const xx = Math.round(x + sgn * nx * k)
          const yy = Math.round(y + sgn * ny * k)
          if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue
          const j = yy * w + xx
          if (mag[j] >= weak && gx[j] * gx[i] + gy[j] * gy[i] < -0.5 * mag[j] * m) {
            thin = true
            break
          }
        }
      }
      if (!thin) out[i] = m
    }
  }
  return out
}

function percentile(values: Float32Array, p: number): number {
  let max = 0
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i]
  if (max <= 0) return 0
  const bins = 1024
  const hist = new Uint32Array(bins)
  for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, ((values[i] / max) * (bins - 1)) | 0)]++
  const target = values.length * p
  let acc = 0
  for (let b = 0; b < bins; b++) {
    acc += hist[b]
    if (acc >= target) return (b / (bins - 1)) * max
  }
  return max
}

function otsu(g: Float32Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++
  const total = g.length
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT
}

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1
        }
      }
    }
  }
  return out
}

function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let keep = 1
      for (let dy = -1; dy <= 1 && keep; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < w && !mask[yy * w + xx]) {
            keep = 0
            break
          }
        }
      }
      out[i] = keep
    }
  }
  return out
}

function close(mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let m = mask
  for (let i = 0; i < iterations; i++) m = dilate(m, w, h)
  for (let i = 0; i < iterations; i++) m = erode(m, w, h)
  return m
}

/** Largest 4-connected component of a binary mask, as a mask plus its size. */
function largestComponent(mask: Uint8Array, w: number, h: number): { comp: Uint8Array; size: number } | null {
  const labels = new Int32Array(mask.length)
  const stack = new Int32Array(mask.length)
  let label = 0
  let bestLabel = 0
  let bestSize = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    label++
    let size = 0
    let sp = 0
    stack[sp++] = start
    labels[start] = label
    while (sp > 0) {
      const i = stack[--sp]
      size++
      const x = i % w
      const y = (i - x) / w
      if (x > 0 && mask[i - 1] && !labels[i - 1]) {
        labels[i - 1] = label
        stack[sp++] = i - 1
      }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) {
        labels[i + 1] = label
        stack[sp++] = i + 1
      }
      if (y > 0 && mask[i - w] && !labels[i - w]) {
        labels[i - w] = label
        stack[sp++] = i - w
      }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) {
        labels[i + w] = label
        stack[sp++] = i + w
      }
    }
    if (size > bestSize) {
      bestSize = size
      bestLabel = label
    }
  }
  if (!bestLabel) return null
  const comp = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) if (labels[i] === bestLabel) comp[i] = 1
  return { comp, size: bestSize }
}

/** Pixels of the component that touch a non-component pixel or the image border. */
function boundaryPoints(comp: Uint8Array, w: number, h: number): Point[] {
  const pts: Point[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!comp[i]) continue
      if (
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !comp[i - 1] ||
        !comp[i + 1] ||
        !comp[i - w] ||
        !comp[i + w]
      ) {
        pts.push({ x, y })
      }
    }
  }
  return pts
}

/** Andrew's monotone chain. Returns the hull counter-clockwise (in y-up terms). */
function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function pointLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return dist(p, a)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

/** Ramer–Douglas–Peucker on an open polyline. */
function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts
  let maxD = 0
  let idx = 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= eps) return [a, b]
  const left = rdp(pts.slice(0, idx + 1), eps)
  const right = rdp(pts.slice(idx), eps)
  return left.slice(0, -1).concat(right)
}

/** Simplify a closed convex polygon until it has at most `maxPts` vertices. */
function simplifyClosed(hull: Point[], maxPts: number): Point[] {
  if (hull.length <= maxPts) return hull
  // Split at the two farthest-apart vertices so both halves are open chains.
  let ai = 0
  let bi = 0
  let far = -1
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = dist(hull[i], hull[j])
      if (d > far) {
        far = d
        ai = i
        bi = j
      }
    }
  }
  const first = hull.slice(ai, bi + 1)
  const second = hull.slice(bi).concat(hull.slice(0, ai + 1))
  let eps = 1
  for (let iter = 0; iter < 16; iter++) {
    const a = rdp(first, eps)
    const b = rdp(second, eps)
    const merged = a.slice(0, -1).concat(b.slice(0, -1))
    if (merged.length <= maxPts) return merged
    eps *= 1.5
  }
  return hull.slice(0, maxPts)
}

/** Best 4 vertices (in order) of a convex polygon: the ones spanning the most area. */
function bestQuad(poly: Point[]): Quad | null {
  const n = poly.length
  if (n < 4) return null
  if (n === 4) return orderQuad(poly)
  let best: Quad | null = null
  let bestA = -1
  for (let i = 0; i < n - 3; i++)
    for (let j = i + 1; j < n - 2; j++)
      for (let k = j + 1; k < n - 1; k++)
        for (let l = k + 1; l < n; l++) {
          const q: Point[] = [poly[i], poly[j], poly[k], poly[l]]
          const a = quadArea(q)
          if (a > bestA) {
            bestA = a
            best = orderQuad(q)
          }
        }
  return best
}

function quadFromMask(comp: Uint8Array, w: number, h: number): Quad | null {
  const hull = convexHull(boundaryPoints(comp, w, h))
  if (hull.length < 4) return null
  return bestQuad(simplifyClosed(hull, 10))
}

/** Push each corner away from the centroid by `px` pixels. */
function inflate(q: Quad, px: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  return q.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / len) * px, y: p.y + (dy / len) * px }
  }) as Quad
}

/**
 * How well the quad's sides sit on image gradients (0..1). A side hugging the
 * image border counts as supported: pages often run out of frame.
 */
function edgeSupport(q: Quad, mag: Float32Array, w: number, h: number, thr: number): number {
  const N = 40
  let total = 0
  for (let s = 0; s < 4; s++) {
    const a = q[s]
    const b = q[(s + 1) % 4]
    let acc = 0
    let border = 0
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) / N
      const x = Math.round(a.x + (b.x - a.x) * t)
      const y = Math.round(a.y + (b.y - a.y) * t)
      if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) {
        border++
        continue
      }
      let m = 0
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = mag[(y + dy) * w + (x + dx)]
          if (v > m) m = v
        }
      }
      acc += Math.min(1, m / (thr * 0.6))
    }
    const inside = N - border
    const side = inside > 0 ? acc / inside : 0
    total += border / N >= 0.8 ? Math.max(side, BORDER_SUPPORT) : side * (inside / N) + BORDER_SUPPORT * (border / N)
  }
  return total / 4
}

/** Assumed edge support for a side that runs along the image border. */
const BORDER_SUPPORT = 0.6

/** Coarse colour histogram (5 bits per channel) of the outer 6% of the image: what "background" looks like. */
function borderHistogram(rgb: Uint8ClampedArray, w: number, h: number): { hist: Uint32Array; floor: number } {
  const hist = new Uint32Array(32 * 32 * 32)
  const bx = Math.max(2, Math.round(w * 0.06))
  const by = Math.max(2, Math.round(h * 0.06))
  let n = 0
  for (let y = 0; y < h; y++) {
    const edgeRow = y < by || y >= h - by
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= bx && x < w - bx) continue
      const i = (y * w + x) * 4
      hist[((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3)]++
      n++
    }
  }
  return { hist, floor: Math.max(2, n * 0.002) }
}

function matchesBackground(bg: { hist: Uint32Array; floor: number }, r: number, g: number, b: number): boolean {
  const rb = r >> 3
  const gb = g >> 3
  const bb = b >> 3
  for (let dr = -1; dr <= 1; dr++) {
    const rr = rb + dr
    if (rr < 0 || rr > 31) continue
    for (let dg = -1; dg <= 1; dg++) {
      const gg = gb + dg
      if (gg < 0 || gg > 31) continue
      for (let db = -1; db <= 1; db++) {
        const bbb = bb + db
        if (bbb < 0 || bbb > 31) continue
        if (bg.hist[(rr << 10) | (gg << 5) | bbb] >= bg.floor) return true
      }
    }
  }
  return false
}

/**
 * Fraction of the pixels just outside the quad that look like the image
 * background (0..1). Separates the page outline from strong edges inside the
 * page, such as the inner edge of a coloured header band. Sides on the image
 * border count as neutral.
 */
function backgroundMatch(q: Quad, rgb: Uint8ClampedArray, w: number, h: number, bg: { hist: Uint32Array; floor: number }): number {
  const N = 24
  const d = Math.max(4, Math.max(w, h) * 0.03)
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  let total = 0
  for (let s = 0; s < 4; s++) {
    const a = q[s]
    const b = q[(s + 1) % 4]
    const len = dist(a, b) || 1
    let nx = -(b.y - a.y) / len
    let ny = (b.x - a.x) / len
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if ((cx - mx) * nx + (cy - my) * ny > 0) {
      // Normal currently points inwards; flip to outwards.
      nx = -nx
      ny = -ny
    }
    let valid = 0
    let hits = 0
    for (let k = 0; k < N; k++) {
      const t = 0.1 + (0.8 * (k + 0.5)) / N
      const ox = Math.round(a.x + (b.x - a.x) * t + nx * d)
      const oy = Math.round(a.y + (b.y - a.y) * t + ny * d)
      if (ox < 0 || oy < 0 || ox >= w || oy >= h) continue
      valid++
      const i = (oy * w + ox) * 4
      if (matchesBackground(bg, rgb[i], rgb[i + 1], rgb[i + 2])) hits++
    }
    total += valid < N / 2 ? 0.5 : hits / valid
  }
  return total / 4
}

/**
 * How different the pixels just inside the quad are from those just outside
 * (0..1). A page edge separates paper from background; the boundary of a text
 * block has paper on both sides and scores near zero. Median per side keeps
 * text hits from skewing it; sides on the image border count as neutral.
 */
function sideContrast(q: Quad, rgb: Uint8ClampedArray, w: number, h: number): number {
  const N = 24
  const d = Math.max(4, Math.max(w, h) * 0.025)
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  let total = 0
  for (let s = 0; s < 4; s++) {
    const a = q[s]
    const b = q[(s + 1) % 4]
    const len = dist(a, b) || 1
    let nx = -(b.y - a.y) / len
    let ny = (b.x - a.x) / len
    // Point the normal inwards.
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if ((cx - mx) * nx + (cy - my) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    const diffs: number[] = []
    for (let k = 0; k < N; k++) {
      const t = 0.1 + (0.8 * (k + 0.5)) / N
      const px = a.x + (b.x - a.x) * t
      const py = a.y + (b.y - a.y) * t
      const ix = Math.round(px + nx * d)
      const iy = Math.round(py + ny * d)
      const ox = Math.round(px - nx * d)
      const oy = Math.round(py - ny * d)
      if (ix < 0 || iy < 0 || ix >= w || iy >= h || ox < 0 || oy < 0 || ox >= w || oy >= h) continue
      const ii = (iy * w + ix) * 4
      const oo = (oy * w + ox) * 4
      // Colour distance, so an orange header against a blue cloth still counts.
      diffs.push(Math.max(Math.abs(rgb[ii] - rgb[oo]), Math.abs(rgb[ii + 1] - rgb[oo + 1]), Math.abs(rgb[ii + 2] - rgb[oo + 2])))
    }
    if (diffs.length < N / 2) {
      total += 0.5
      continue
    }
    diffs.sort((x, y) => x - y)
    total += Math.min(1, diffs[Math.floor(diffs.length / 2)] / 30)
  }
  return total / 4
}

// ---- Straight lines (Hough) -------------------------------------------------

/** Line in normal form: x·cosθ + y·sinθ = ρ, θ in radians within [0, π). */
interface Line {
  theta: number
  rho: number
  votes: number
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % Math.PI
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

function intersectLines(a: Line, b: Line): Point | null {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta)
  if (Math.abs(det) < 1e-6) return null
  return {
    x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det,
    y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det,
  }
}

/**
 * Dominant straight lines through the strong-edge pixels, with non-max
 * suppression. Votes are gradient-directed: a pixel only votes for lines
 * perpendicular to its gradient (±8°), so texture noise cancels out while a
 * real edge stacks up.
 */
function houghLines(
  gx: Float32Array,
  gy: Float32Array,
  mag: Float32Array,
  /** Non-zero where the edge is a clean step (not a thin stroke); those votes count double. */
  stepMag: Float32Array,
  w: number,
  h: number,
  thr: number,
  maxLines: number,
): Line[] {
  const nT = 180
  const D = Math.ceil(Math.hypot(w, h))
  const nR = 2 * D + 1
  const acc = new Uint32Array(nT * nR)
  const cos = new Float32Array(nT)
  const sin = new Float32Array(nT)
  for (let t = 0; t < nT; t++) {
    cos[t] = Math.cos((t * Math.PI) / nT)
    sin[t] = Math.sin((t * Math.PI) / nT)
  }
  const SPREAD = 8
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (mag[i] < thr) continue
      const weight = stepMag[i] > 0 ? 2 : 1
      // Normal direction of the edge = gradient direction, folded into [0, π).
      let deg = Math.round((Math.atan2(gy[i], gx[i]) * 180) / Math.PI)
      if (deg < 0) deg += 180
      if (deg >= 180) deg -= 180
      for (let dt = -SPREAD; dt <= SPREAD; dt++) {
        let t = deg + dt
        if (t < 0) t += nT
        else if (t >= nT) t -= nT
        // ρ = x·cosθ + y·sinθ is valid for any θ; no sign games needed on wrap.
        const r = Math.round(x * cos[t] + y * sin[t]) + D
        acc[t * nR + r] += weight
      }
    }
  }
  let max = 0
  for (let i = 0; i < acc.length; i++) if (acc[i] > max) max = acc[i]
  const floor = Math.max(Math.min(w, h) * 0.12, max * 0.15)
  const peaks: Line[] = []
  for (let t = 0; t < nT; t++) {
    for (let r = 0; r < nR; r++) {
      const v = acc[t * nR + r]
      if (v < floor) continue
      // Local maximum in a ±2° × ±3 px window (θ wraps with ρ negated).
      let isMax = true
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        let tt = t + dt
        let sign = 1
        if (tt < 0) {
          tt += nT
          sign = -1
        } else if (tt >= nT) {
          tt -= nT
          sign = -1
        }
        for (let dr = -3; dr <= 3; dr++) {
          const rr = sign === 1 ? r + dr : nR - 1 - r + dr
          if (rr < 0 || rr >= nR || (dt === 0 && dr === 0)) continue
          const o = acc[tt * nR + rr]
          if (o > v || (o === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isMax = false
            break
          }
        }
      }
      if (isMax) peaks.push({ theta: (t * Math.PI) / nT, rho: r - D, votes: v })
    }
  }
  peaks.sort((a, b) => b.votes - a.votes)
  const out: Line[] = []
  for (const p of peaks) {
    if (out.length >= maxLines) break
    const dup = out.some((q) => {
      const dTheta = angleDiff(p.theta, q.theta)
      if (dTheta > (4 * Math.PI) / 180) return false
      // Same orientation; compare ρ allowing for the θ↔θ+π flip.
      const flipped = Math.abs(p.theta - q.theta) > Math.PI / 2
      return Math.abs(p.rho - (flipped ? -q.rho : q.rho)) < Math.min(w, h) * 0.04
    })
    if (!dup) out.push(p)
  }
  return out
}

/** Quadrilaterals formed by two roughly parallel line pairs that cross each other. */
function quadsFromLines(lines: Line[], w: number, h: number, limit: number): Quad[] {
  const out: Quad[] = []
  const minGap = Math.min(w, h) * 0.15
  const n = lines.length
  const inBounds = (p: Point) => p.x >= -0.04 * w && p.x <= 1.04 * w && p.y >= -0.04 * h && p.y <= 1.04 * h
  for (let i = 0; i < n && out.length < limit; i++) {
    for (let j = i + 1; j < n && out.length < limit; j++) {
      if (angleDiff(lines[i].theta, lines[j].theta) > (30 * Math.PI) / 180) continue
      for (let k = 0; k < n && out.length < limit; k++) {
        if (k === i || k === j) continue
        if (angleDiff(lines[i].theta, lines[k].theta) < (55 * Math.PI) / 180) continue
        for (let l = k + 1; l < n && out.length < limit; l++) {
          if (l === i || l === j) continue
          if (angleDiff(lines[k].theta, lines[l].theta) > (30 * Math.PI) / 180) continue
          const c1 = intersectLines(lines[i], lines[k])
          const c2 = intersectLines(lines[i], lines[l])
          const c3 = intersectLines(lines[j], lines[l])
          const c4 = intersectLines(lines[j], lines[k])
          if (!c1 || !c2 || !c3 || !c4) continue
          if (![c1, c2, c3, c4].every(inBounds)) continue
          if (dist(c1, c2) < minGap || dist(c1, c4) < minGap) continue
          const q = orderQuad([c1, c2, c3, c4])
          if (!isConvex(q)) continue
          out.push(q)
        }
      }
    }
  }
  return out
}

// ---- Corner refinement -------------------------------------------------------

interface FitLine {
  p: Point
  d: Point
}

/** Total-least-squares line through points, with iterative outlier rejection. */
function fitLine(points: Point[], minInliers: number): FitLine | null {
  let pts = points
  let fit: FitLine | null = null
  for (let iter = 0; iter < 3; iter++) {
    if (pts.length < minInliers) return null
    let mx = 0
    let my = 0
    for (const p of pts) {
      mx += p.x
      my += p.y
    }
    mx /= pts.length
    my /= pts.length
    let sxx = 0
    let sxy = 0
    let syy = 0
    for (const p of pts) {
      const dx = p.x - mx
      const dy = p.y - my
      sxx += dx * dx
      sxy += dx * dy
      syy += dy * dy
    }
    // Principal axis of the 2×2 covariance.
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    const d = { x: Math.cos(ang), y: Math.sin(ang) }
    fit = { p: { x: mx, y: my }, d }
    const res = pts.map((p) => Math.abs((p.x - mx) * d.y - (p.y - my) * d.x))
    const sorted = [...res].sort((a, b) => a - b)
    const med = sorted[Math.floor(sorted.length / 2)]
    const tol = Math.max(1.5, med * 2.5)
    const kept = pts.filter((_, i) => res[i] <= tol)
    if (kept.length === pts.length) break
    pts = kept
  }
  return fit && pts.length >= minInliers ? fit : null
}

function intersectFit(a: FitLine, b: FitLine): Point | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x
  if (Math.abs(det) < 1e-6) return null
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t }
}

/**
 * Snap a rough quad onto the actual paper edges. For every side, sample points
 * along it, look perpendicular to the side within ±radius for the strongest
 * gradient across the side, fit a line to those hits and intersect adjacent
 * lines. Corners that would jump too far, or sides without enough edge hits,
 * keep their previous position.
 */
export function refineQuad(img: ImageData, quad: Quad): Quad {
  const w = img.width
  const h = img.height
  const { gx, gy, mag } = colorGradient(img, w, h)
  const thr = Math.max(6, percentile(mag, 0.85))
  const longest = Math.max(w, h)
  let cur = quad
  for (const radius of [Math.max(6, longest * 0.03), Math.max(3, longest * 0.012)]) {
    const fits: (FitLine | null)[] = []
    for (let s = 0; s < 4; s++) {
      const a = cur[s]
      const b = cur[(s + 1) % 4]
      const len = dist(a, b)
      if (len < 12) {
        fits.push(null)
        continue
      }
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
      const nrm = { x: -dir.y, y: dir.x }
      const N = Math.max(16, Math.min(72, Math.round(len / 5)))
      const hits: Point[] = []
      const R = Math.round(radius)
      for (let k = 0; k < N; k++) {
        const t = 0.06 + (0.88 * (k + 0.5)) / N
        const px = a.x + dir.x * len * t
        const py = a.y + dir.y * len * t
        let best = 0
        let bestOff = 0
        for (let o = -R; o <= R; o++) {
          const x = Math.round(px + nrm.x * o)
          const y = Math.round(py + nrm.y * o)
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue
          const i = y * w + x
          const resp = Math.abs(gx[i] * nrm.x + gy[i] * nrm.y)
          if (resp > best) {
            best = resp
            bestOff = o
          }
        }
        if (best >= thr * 0.35) hits.push({ x: px + nrm.x * bestOff, y: py + nrm.y * bestOff })
      }
      fits.push(fitLine(hits, Math.max(6, Math.round(N * 0.35))))
    }
    const next = cur.map((c, i) => {
      const l1 = fits[(i + 3) % 4]
      const l2 = fits[i]
      if (!l1 || !l2) return c
      const p = intersectFit(l1, l2)
      if (!p || dist(p, c) > radius * 1.6) return c
      return { x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) }
    }) as Quad
    if (isReasonableQuad(next, w, h)) cur = next
  }
  return cur
}

/**
 * Find the page in a small (≈ 480 px) copy of the photo. Candidate outlines
 * come from a bright-region mask, a dark-region mask, an edge-enclosed region
 * and quads built from the dominant straight lines (plus the image borders, for
 * pages that run out of frame). The candidate whose sides best follow real
 * edges wins. Returns null when nothing looks like a page.
 */
export interface DetectDebug {
  /** A known-good outline to score alongside the candidates (tuning aid). */
  truth?: Quad
  lines?: Line[]
  scored?: { q: Quad; support: number; contrast: number; bgMatch: number; frac: number; score: number }[]
  truthScore?: { support: number; contrast: number; bgMatch: number; frac: number; score: number }
}

export function detectQuadClassic(img: ImageData, debug?: DetectDebug): Quad | null {
  const w = img.width
  const h = img.height
  if (w < 32 || h < 32) return null
  const gray = blur3(blur3(toGray(img), w, h), w, h)
  const { gx, gy, mag } = colorGradient(img, w, h)
  const thr = Math.max(8, percentile(mag, 0.85))
  // Step edges only (no text strokes or rules): what page outlines are made of.
  const stepMag = suppressThin(gx, gy, mag, w, h, thr)
  const candidates: Quad[] = []

  // Bright / dark region via Otsu.
  const t = otsu(gray)
  const bright = new Uint8Array(w * h)
  const dark = new Uint8Array(w * h)
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= t) bright[i] = 1
    else dark[i] = 1
  }
  for (const mask of [bright, dark]) {
    const comp = largestComponent(close(mask, w, h, 2), w, h)
    if (comp && comp.size > w * h * 0.05) {
      const q = quadFromMask(comp.comp, w, h)
      if (q) candidates.push(inflate(q, 1))
    }
  }

  // Region enclosed by edges: flood the non-edge area from the border, what
  // remains unfilled is inside a closed outline.
  const edge = dilate(
    Uint8Array.from(mag, (v) => (v >= thr ? 1 : 0)),
    w,
    h,
  )
  const outside = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (i: number) => {
    if (!edge[i] && !outside[i]) {
      outside[i] = 1
      stack[sp++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  while (sp > 0) {
    const i = stack[--sp]
    const x = i % w
    const y = (i - x) / w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  const interior = new Uint8Array(w * h)
  for (let i = 0; i < interior.length; i++) if (!edge[i] && !outside[i]) interior[i] = 1
  const inner = largestComponent(interior, w, h)
  if (inner && inner.size > w * h * 0.05) {
    const q = quadFromMask(inner.comp, w, h)
    if (q) candidates.push(inflate(q, 2.5))
  }

  // Straight-line quads. The image borders join in as lines so a page that
  // runs out of frame can still close.
  // Directed voting is noise-tolerant, so weaker edges (a page edge inside a
  // shadow) may vote too.
  const lines = houghLines(gx, gy, mag, stepMag, w, h, thr * 0.5, 32)
  lines.push(
    { theta: 0, rho: 0, votes: 0 },
    { theta: 0, rho: w - 1, votes: 0 },
    { theta: Math.PI / 2, rho: 0, votes: 0 },
    { theta: Math.PI / 2, rho: h - 1, votes: 0 },
  )
  candidates.push(...quadsFromLines(lines, w, h, 1500))
  if (debug) debug.lines = lines

  const bg = borderHistogram(img.data, w, h)
  const evaluate = (q: Quad) => {
    const frac = quadArea(q) / (w * h)
    const support = edgeSupport(q, mag, w, h, thr)
    const contrast = sideContrast(q, img.data, w, h)
    const bgMatch = backgroundMatch(q, img.data, w, h, bg)
    const score = support * (0.4 + 0.6 * contrast) * (0.5 + 0.5 * bgMatch) * (0.75 + 0.25 * frac)
    return { support, contrast, bgMatch, frac, score }
  }
  if (debug?.truth) debug.truthScore = evaluate(debug.truth)
  if (debug) debug.scored = []

  let best: Quad | null = null
  let bestScore = 0
  for (const q of candidates) {
    const clamped = q.map((p) => ({ x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) })) as Quad
    if (!isReasonableQuad(clamped, w, h)) continue
    const frac = quadArea(clamped) / (w * h)
    if (frac < 0.06 || frac > 0.985) continue
    const e = evaluate(clamped)
    debug?.scored?.push({ q: clamped, ...e })
    if (e.support < 0.3) continue
    if (e.score > bestScore) {
      bestScore = e.score
      best = clamped
    }
  }
  return bestScore >= 0.3 ? best : null
}
