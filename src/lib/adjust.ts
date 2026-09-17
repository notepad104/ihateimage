/**
 * Pixel-level color/light adjustments. Pure functions over ImageData so they
 * run identically for the live preview (downscaled) and the final export.
 */

export interface RecolorRule {
  id: string
  /** Hex color sampled from the image */
  from: string
  /** Hex color to shift matching pixels towards */
  to: string
  /** 0..100 → how wide a hue range around `from` is affected */
  tolerance: number
}

export interface AdjustParams {
  /** Auto levels (histogram stretch) before everything else */
  auto: boolean
  exposure: number
  brightness: number
  contrast: number
  highlights: number
  shadows: number
  saturation: number
  vibrance: number
  temperature: number
  tint: number
  hue: number
  sharpen: number
  blur: number
  vignette: number
  grain: number
  recolor: RecolorRule[]
}

export const DEFAULT_ADJUST: AdjustParams = {
  auto: false,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  sharpen: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  recolor: [],
}

export type SliderKey = Exclude<keyof AdjustParams, 'auto' | 'recolor'>

export function isIdentity(p: AdjustParams): boolean {
  if (p.auto || p.recolor.length) return false
  return (Object.keys(DEFAULT_ADJUST) as (keyof AdjustParams)[]).every(
    (k) => k === 'auto' || k === 'recolor' || p[k] === 0,
  )
}

// ---------- color helpers ----------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (Number.isNaN(n) || full.length !== 6) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** r,g,b in 0..255 → h in degrees 0..360, s,l in 0..1 */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---------- auto levels ----------

function autoLevelsLut(data: Uint8ClampedArray): [Uint8Array, Uint8Array, Uint8Array] | null {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  const step = Math.max(1, Math.floor(data.length / 4 / 200_000)) * 4
  let n = 0
  for (let i = 0; i < data.length; i += step) {
    hist[0][data[i]]++
    hist[1][data[i + 1]]++
    hist[2][data[i + 2]]++
    n++
  }
  const luts: Uint8Array[] = []
  let changed = false
  for (let c = 0; c < 3; c++) {
    const h = hist[c]
    const lowTarget = n * 0.005
    const highTarget = n * 0.995
    let acc = 0
    let lo = 0
    let hi = 255
    for (let v = 0; v < 256; v++) {
      acc += h[v]
      if (acc >= lowTarget) {
        lo = v
        break
      }
    }
    acc = 0
    for (let v = 255; v >= 0; v--) {
      acc += h[v]
      if (acc >= n - highTarget) {
        hi = v
        break
      }
    }
    const lut = new Uint8Array(256)
    if (hi - lo < 16) {
      for (let v = 0; v < 256; v++) lut[v] = v
    } else {
      changed = true
      for (let v = 0; v < 256; v++) lut[v] = clamp255(((v - lo) * 255) / (hi - lo))
    }
    luts.push(lut)
  }
  return changed ? (luts as [Uint8Array, Uint8Array, Uint8Array]) : null
}

// ---------- spatial filters ----------

/** In-place box blur (two passes ≈ gaussian). radius in px. */
function boxBlur(data: Uint8ClampedArray, w: number, h: number, radius: number, passes = 2) {
  if (radius < 1) return
  const r = Math.round(radius)
  const tmp = new Uint8ClampedArray(data.length)
  const div = 2 * r + 1
  for (let pass = 0; pass < passes; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w * 4
      let sr = 0
      let sg = 0
      let sb = 0
      for (let x = -r; x <= r; x++) {
        const cx = Math.max(0, Math.min(w - 1, x))
        const i = row + cx * 4
        sr += data[i]
        sg += data[i + 1]
        sb += data[i + 2]
      }
      for (let x = 0; x < w; x++) {
        const o = row + x * 4
        tmp[o] = sr / div
        tmp[o + 1] = sg / div
        tmp[o + 2] = sb / div
        tmp[o + 3] = data[o + 3]
        const addX = Math.min(w - 1, x + r + 1)
        const subX = Math.max(0, x - r)
        const ai = row + addX * 4
        const si = row + subX * 4
        sr += data[ai] - data[si]
        sg += data[ai + 1] - data[si + 1]
        sb += data[ai + 2] - data[si + 2]
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sr = 0
      let sg = 0
      let sb = 0
      for (let y = -r; y <= r; y++) {
        const cy = Math.max(0, Math.min(h - 1, y))
        const i = (cy * w + x) * 4
        sr += tmp[i]
        sg += tmp[i + 1]
        sb += tmp[i + 2]
      }
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 4
        data[o] = sr / div
        data[o + 1] = sg / div
        data[o + 2] = sb / div
        const addY = Math.min(h - 1, y + r + 1)
        const subY = Math.max(0, y - r)
        const ai = (addY * w + x) * 4
        const si = (subY * w + x) * 4
        sr += tmp[ai] - tmp[si]
        sg += tmp[ai + 1] - tmp[si + 1]
        sb += tmp[ai + 2] - tmp[si + 2]
      }
    }
  }
}

/** Unsharp mask using a 3x3 blur. amount 0..~1.5 */
function sharpen(data: Uint8ClampedArray, w: number, h: number, amount: number) {
  const src = new Uint8ClampedArray(data)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w
    const y1 = y * w
    const y2 = Math.min(h - 1, y + 1) * w
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1)
      const x2 = Math.min(w - 1, x + 1)
      const o = (y1 + x) * 4
      for (let c = 0; c < 3; c++) {
        const blur =
          (src[(y0 + x0) * 4 + c] +
            src[(y0 + x) * 4 + c] +
            src[(y0 + x2) * 4 + c] +
            src[(y1 + x0) * 4 + c] +
            src[(y1 + x) * 4 + c] +
            src[(y1 + x2) * 4 + c] +
            src[(y2 + x0) * 4 + c] +
            src[(y2 + x) * 4 + c] +
            src[(y2 + x2) * 4 + c]) /
          9
        const v = src[o + c]
        data[o + c] = clamp255(v + amount * (v - blur))
      }
    }
  }
}

// ---------- main ----------

interface CompiledRecolor {
  fromH: number
  fromS: number
  fromL: number
  toH: number
  toS: number
  toL: number
  tol: number
}

function compileRecolor(rules: RecolorRule[]): CompiledRecolor[] {
  return rules
    .filter((r) => r.from && r.to && r.from.toLowerCase() !== r.to.toLowerCase())
    .map((r) => {
      const [fr, fg, fb] = hexToRgb(r.from)
      const [tr, tg, tb] = hexToRgb(r.to)
      const [fromH, fromS, fromL] = rgbToHsl(fr, fg, fb)
      const [toH, toS, toL] = rgbToHsl(tr, tg, tb)
      return { fromH, fromS, fromL, toH, toS, toL, tol: 8 + (r.tolerance / 100) * 82 }
    })
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Applies all adjustments in place and returns the same ImageData. */
export function applyAdjust(img: ImageData, p: AdjustParams): ImageData {
  const { data, width: w, height: h } = img
  const n = w * h

  const luts = p.auto ? autoLevelsLut(data) : null
  const recolor = compileRecolor(p.recolor)

  const expF = Math.pow(2, p.exposure / 50)
  const t = p.temperature / 100
  const tempR = 1 + 0.22 * t
  const tempB = 1 - 0.22 * t
  const tintG = 1 - 0.18 * (p.tint / 100)
  const bright = (p.brightness / 100) * 80
  const c = p.contrast / 100
  const contrastF = c < 0 ? 1 + 0.8 * c : 1 + 1.6 * c
  const sh = p.shadows / 100
  const hl = p.highlights / 100
  const satF = 1 + p.saturation / 100
  const vib = p.vibrance / 100

  // Hue rotation matrix (YIQ space, like CSS hue-rotate).
  let hueM: number[] | null = null
  if (p.hue !== 0) {
    const a = (p.hue * Math.PI) / 180
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    hueM = [
      0.213 + cos * 0.787 - sin * 0.213,
      0.715 - cos * 0.715 - sin * 0.715,
      0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143,
      0.715 + cos * 0.285 + sin * 0.14,
      0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787,
      0.715 - cos * 0.715 + sin * 0.715,
      0.072 + cos * 0.928 + sin * 0.072,
    ]
  }

  const doTone =
    luts !== null ||
    recolor.length > 0 ||
    p.exposure !== 0 ||
    p.temperature !== 0 ||
    p.tint !== 0 ||
    p.brightness !== 0 ||
    p.contrast !== 0 ||
    p.shadows !== 0 ||
    p.highlights !== 0 ||
    p.saturation !== 0 ||
    p.vibrance !== 0 ||
    hueM !== null

  if (doTone) {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      let r = data[o]
      let g = data[o + 1]
      let b = data[o + 2]

      if (luts) {
        r = luts[0][r]
        g = luts[1][g]
        b = luts[2][b]
      }

      if (recolor.length) {
        const [hh, ss, ll] = rgbToHsl(r, g, b)
        if (ss > 0.08 && ll > 0.03 && ll < 0.97) {
          for (const rule of recolor) {
            const d = hueDistance(hh, rule.fromH)
            if (d >= rule.tol) continue
            let wgt = 1 - smoothstep(rule.tol * 0.55, rule.tol, d)
            wgt *= Math.min(1, ss / 0.25)
            if (wgt <= 0.001) continue
            const ns = Math.max(0, Math.min(1, ss + (rule.toS - rule.fromS)))
            const nl = Math.max(0, Math.min(1, ll + (rule.toL - rule.fromL) * 0.75))
            const [nr, ng, nb] = hslToRgb(rule.toH, ns, nl)
            r = r + (nr - r) * wgt
            g = g + (ng - g) * wgt
            b = b + (nb - b) * wgt
          }
        }
      }

      if (expF !== 1) {
        r *= expF
        g *= expF
        b *= expF
      }
      if (t !== 0) {
        r *= tempR
        b *= tempB
      }
      if (tintG !== 1) g *= tintG
      if (bright !== 0) {
        r += bright
        g += bright
        b += bright
      }
      if (contrastF !== 1) {
        r = (r - 128) * contrastF + 128
        g = (g - 128) * contrastF + 128
        b = (b - 128) * contrastF + 128
      }
      if (sh !== 0 || hl !== 0) {
        const lum = clamp255(0.299 * r + 0.587 * g + 0.114 * b) / 255
        if (sh !== 0) {
          const wgt = (1 - lum) * (1 - lum) * sh * 0.7
          r += wgt * (sh > 0 ? 255 - r : r)
          g += wgt * (sh > 0 ? 255 - g : g)
          b += wgt * (sh > 0 ? 255 - b : b)
        }
        if (hl !== 0) {
          const wgt = lum * lum * hl * 0.7
          r += wgt * (hl > 0 ? 255 - r : r)
          g += wgt * (hl > 0 ? 255 - g : g)
          b += wgt * (hl > 0 ? 255 - b : b)
        }
      }
      if (hueM) {
        const nr = hueM[0] * r + hueM[1] * g + hueM[2] * b
        const ng = hueM[3] * r + hueM[4] * g + hueM[5] * b
        const nb = hueM[6] * r + hueM[7] * g + hueM[8] * b
        r = nr
        g = ng
        b = nb
      }
      if (satF !== 1 || vib !== 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b
        let f = satF
        if (vib !== 0) {
          const mx = Math.max(r, g, b)
          const mn = Math.min(r, g, b)
          const ps = mx > 0 ? (mx - mn) / mx : 0
          f *= 1 + vib * (1 - ps) * 1.3
        }
        r = gray + (r - gray) * f
        g = gray + (g - gray) * f
        b = gray + (b - gray) * f
      }

      data[o] = clamp255(r)
      data[o + 1] = clamp255(g)
      data[o + 2] = clamp255(b)
    }
  }

  const maxSide = Math.max(w, h)
  if (p.blur > 0) boxBlur(data, w, h, (p.blur / 100) * 0.012 * maxSide)
  if (p.sharpen > 0) sharpen(data, w, h, (p.sharpen / 100) * 1.6)

  if (p.vignette > 0 || p.grain > 0) {
    const cx = w / 2
    const cy = h / 2
    const halfDiag = Math.sqrt(cx * cx + cy * cy)
    const vig = (p.vignette / 100) * 0.9
    const grainAmt = (p.grain / 100) * 48
    let seed = 0x9e3779b9
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        let f = 1
        if (vig > 0) {
          const dx = x - cx
          const dy = y - cy
          const d = Math.sqrt(dx * dx + dy * dy) / halfDiag
          f = 1 - vig * smoothstep(0.35, 1.05, d)
        }
        let gn = 0
        if (grainAmt > 0) {
          // xorshift32
          seed ^= seed << 13
          seed ^= seed >>> 17
          seed ^= seed << 5
          gn = ((seed >>> 0) / 4294967296 - 0.5) * grainAmt
        }
        if (f !== 1 || gn !== 0) {
          data[o] = clamp255(data[o] * f + gn)
          data[o + 1] = clamp255(data[o + 1] * f + gn)
          data[o + 2] = clamp255(data[o + 2] * f + gn)
        }
      }
    }
  }

  return img
}

export interface Preset {
  id: string
  name: string
  params: Partial<AdjustParams>
}

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Original', params: {} },
  { id: 'auto', name: 'Auto', params: { auto: true, vibrance: 10 } },
  { id: 'vivid', name: 'Vivid', params: { contrast: 15, saturation: 20, vibrance: 25, exposure: 4 } },
  { id: 'punch', name: 'Punch', params: { sharpen: 45, contrast: 12, vibrance: 25, shadows: 8 } },
  { id: 'warm', name: 'Warm', params: { temperature: 35, tint: 6, saturation: 8, brightness: 4 } },
  { id: 'cool', name: 'Cool', params: { temperature: -35, saturation: 4, contrast: 5 } },
  { id: 'soft', name: 'Soft', params: { contrast: -15, brightness: 8, highlights: -12, blur: 4, saturation: -5 } },
  { id: 'matte', name: 'Matte', params: { contrast: -22, brightness: 10, shadows: 30, saturation: -18, vignette: 15 } },
  { id: 'dramatic', name: 'Dramatic', params: { contrast: 35, shadows: -20, highlights: -15, saturation: -10, vignette: 35 } },
  { id: 'vintage', name: 'Vintage', params: { temperature: 22, saturation: -25, contrast: -10, vignette: 40, grain: 22, shadows: 15 } },
  { id: 'bw', name: 'B&W', params: { saturation: -100, contrast: 18, sharpen: 10 } },
  { id: 'noir', name: 'Noir', params: { saturation: -100, contrast: 40, shadows: -25, vignette: 45, grain: 15 } },
]

export function applyPreset(base: AdjustParams, preset: Preset): AdjustParams {
  return { ...DEFAULT_ADJUST, ...preset.params, recolor: base.recolor }
}
