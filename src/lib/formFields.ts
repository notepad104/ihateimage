/**
 * Finds the blanks in a form: underlines and boxes drawn on the page, runs of
 * underscores or dots, and empty space after a label ending in a colon. Works
 * from the recognised words plus a quick scan of the pixels for long
 * horizontal rules. All boxes are fractions of the image.
 */
import type { OcrResult, OcrWord } from './ocr'
import type { Rect } from './types'

export type FieldKind = 'underline' | 'box' | 'dots' | 'gap'

export interface FormField {
  id: string
  kind: FieldKind
  box: Rect
  /** Text found to the left of or above the blank, without the trailing colon */
  label: string
}

/** Width the pixel analysis runs at; rules are long, so fine detail is not needed. */
const ANALYSIS_WIDTH = 1200
/** Fraction of the analysed width a dark run must span to count as a rule. */
const MIN_RULE_FRACTION = 0.06
const MIN_RULE_PX = 30
/** Highest share of dark pixels for a region to count as empty. */
const EMPTY_RATIO = 0.04

interface Px {
  x: number
  y: number
  width: number
  height: number
}

interface Segment {
  x0: number
  x1: number
  y0: number
  y1: number
  /** Dark pixels in the segment; ink / length gives its real thickness even when it is skewed. */
  ink: number
  used?: boolean
  /** Part of a table or frame (several rules share its extent) */
  grid?: boolean
}

interface Gray {
  data: Uint8Array
  width: number
  height: number
  dark: number
}

async function grayscale(source: Blob): Promise<Gray> {
  const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, ANALYSIS_WIDTH / bmp.width)
    const width = Math.max(1, Math.round(bmp.width * scale))
    const height = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bmp, 0, 0, width, height)
    const px = ctx.getImageData(0, 0, width, height).data
    const data = new Uint8Array(width * height)
    const hist = new Uint32Array(256)
    for (let i = 0; i < data.length; i++) {
      const v = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
      data[i] = v
      hist[v | 0]++
    }
    // Median brightness stands in for the paper colour; ink is well below it.
    let acc = 0
    let median = 255
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= data.length / 2) {
        median = v
        break
      }
    }
    return { data, width, height, dark: Math.min(150, Math.max(60, median * 0.65)) }
  } finally {
    bmp.close()
  }
}

function darkRatio(g: Gray, r: Px): number {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(g.width, Math.ceil(r.x + r.width))
  const y1 = Math.min(g.height, Math.ceil(r.y + r.height))
  if (x1 <= x0 || y1 <= y0) return 1
  let dark = 0
  for (let y = y0; y < y1; y++) {
    const row = y * g.width
    for (let x = x0; x < x1; x++) if (g.data[row + x] < g.dark) dark++
  }
  return dark / ((x1 - x0) * (y1 - y0))
}

/** Long horizontal runs of ink, merged across neighbouring rows into thin segments. */
function findRules(g: Gray): Segment[] {
  const minLen = Math.max(MIN_RULE_PX, g.width * MIN_RULE_FRACTION)
  const maxThick = Math.max(4, g.height * 0.006)
  const open: Segment[] = []
  const done: Segment[] = []
  for (let y = 0; y < g.height; y++) {
    const row = y * g.width
    const runs: [number, number][] = []
    let start = -1
    let gap = 0
    for (let x = 0; x <= g.width; x++) {
      const isDark = x < g.width && g.data[row + x] < g.dark
      if (isDark) {
        if (start < 0) start = x
        gap = 0
      } else if (start >= 0) {
        gap++
        if (gap > 2 || x === g.width) {
          const end = x - gap
          if (end - start >= minLen) runs.push([start, end])
          start = -1
          gap = 0
        }
      }
    }
    const next: Segment[] = []
    for (const [x0, x1] of runs) {
      // A run continues a segment from the previous rows if the two touch; a skewed line in a photo
      // steps sideways one row at a time, so its runs overlap only a little.
      let hit: Segment | undefined
      for (const s of open) {
        if (Math.min(s.x1, x1) - Math.max(s.x0, x0) >= -2) {
          hit = s
          break
        }
      }
      if (hit) {
        hit.x0 = Math.min(hit.x0, x0)
        hit.x1 = Math.max(hit.x1, x1)
        hit.y1 = y
        hit.ink += x1 - x0
        if (!next.includes(hit)) next.push(hit)
      } else next.push({ x0, x1, y0: y, y1: y, ink: x1 - x0 })
    }
    for (const s of open) if (!next.includes(s)) done.push(s)
    open.length = 0
    open.push(...next)
  }
  done.push(...open)
  return done.filter((s) => {
    const len = s.x1 - s.x0
    return s.ink / len <= maxThick && s.y1 - s.y0 + 1 <= maxThick + 0.04 * len
  })
}

/** Vertical rules (frame sides, table columns), found by scanning the transposed image. Returned in image coordinates. */
function findVerticalRules(g: Gray): Segment[] {
  const t = new Uint8Array(g.width * g.height)
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) t[x * g.height + y] = g.data[y * g.width + x]
  return findRules({ data: t, width: g.height, height: g.width, dark: g.dark }).map((s) => ({
    x0: s.y0,
    x1: s.y1 + 1,
    y0: s.x0,
    y1: s.x1,
    ink: s.ink,
  }))
}

/** Rules that share their horizontal extent with two or more others are the lines of a table or frame. */
function markGrid(segments: Segment[], tol: number) {
  for (const s of segments) {
    let alike = 0
    for (const o of segments) if (o !== s && Math.abs(o.x0 - s.x0) <= tol && Math.abs(o.x1 - s.x1) <= tol) alike++
    if (alike >= 2) s.grid = true
  }
}

/** Join pieces of the same rule that a small gap (underscores, dotted leaders, a speck of dust) split apart. */
function joinCollinear(segments: Segment[], maxGap: number): Segment[] {
  const sorted = [...segments].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const out: Segment[] = []
  for (const s of sorted) {
    const prev = out.find((p) => s.y0 <= p.y1 + 2 && s.y1 >= p.y0 - 2 && s.x0 - p.x1 <= maxGap && s.x0 >= p.x0)
    if (prev) {
      prev.x1 = Math.max(prev.x1, s.x1)
      prev.y0 = Math.min(prev.y0, s.y0)
      prev.y1 = Math.max(prev.y1, s.y1)
      prev.ink += s.ink
    } else out.push({ ...s })
  }
  return out
}

function intersect(a: Px, b: Px): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const BLANK_WORD = /^[_.·•…\-–—=]{3,}$/

export async function detectFields(source: Blob, ocr: OcrResult): Promise<FormField[]> {
  const g = await grayscale(source)
  const W = g.width
  const H = g.height
  const toPx = (r: Rect): Px => ({ x: r.x * W, y: r.y * H, width: r.width * W, height: r.height * H })

  const lines = ocr.lines.map((l) => ({ ...l, px: toPx(l.box), words: l.words.map((w) => ({ ...w, px: toPx(w.box) })) }))
  const words = lines.flatMap((l) => l.words)
  const heights = lines.map((l) => l.px.height).sort((a, b) => a - b)
  let mh = heights.length ? heights[Math.floor(heights.length / 2)] : H * 0.02
  mh = Math.min(Math.max(mh, 8), H * 0.06)

  const found: { kind: FieldKind; px: Px; labelWords?: OcrWord[] }[] = []

  // 1. Boxes and underlines drawn on the page.
  const rules = joinCollinear(findRules(g), 0.5 * mh)
  markGrid(rules, 0.5 * mh)
  for (let i = 0; i < rules.length; i++) {
    const a = rules[i]
    for (let j = 0; j < rules.length; j++) {
      const b = rules[j]
      if (b.y0 <= a.y1 || a.used || b.used) continue
      const gapY = b.y0 - a.y1
      if (gapY < 0.8 * mh || gapY > 5 * mh) continue
      if (Math.abs(a.x0 - b.x0) > 0.25 * mh || Math.abs(a.x1 - b.x1) > 0.25 * mh) continue
      const inner: Px = { x: a.x0 + 3, y: a.y1 + 2, width: a.x1 - a.x0 - 6, height: gapY - 3 }
      if (inner.width < 0.6 * mh || darkRatio(g, inner) > EMPTY_RATIO) continue
      // A table row with a label in it is not an empty box, however little ink the label is.
      if (words.some((w) => intersect(w.px, inner) > 0.5 * w.px.width * w.px.height)) continue
      a.used = b.used = true
      found.push({ kind: 'box', px: { x: a.x0 + 1, y: a.y1 + 1, width: a.x1 - a.x0 - 2, height: gapY - 2 } })
      break
    }
  }
  for (const s of rules) {
    // Table and frame lines are not blanks, even when the cell above them is empty.
    if (s.used || s.grid) continue
    const h = Math.min(1.15 * mh, s.y0 - 1)
    if (h < 0.6 * mh) continue
    const above: Px = { x: s.x0, y: s.y0 - h, width: s.x1 - s.x0, height: h - 1 }
    if (darkRatio(g, above) > EMPTY_RATIO) continue
    // Ink above the rule that the recogniser read as words means underlined text, not a blank.
    const underlined = words.some((w) => {
      const ov = intersect(w.px, above)
      return ov > 0.3 * w.px.width * w.px.height
    })
    if (underlined) continue
    found.push({ kind: 'underline', px: above })
  }

  // 2. Runs of underscores or dots the recogniser saw as words.
  for (const line of lines) {
    for (const w of line.words) {
      if (!BLANK_WORD.test(w.text)) continue
      const h = Math.max(w.px.height, 1.1 * mh)
      const bottom = w.px.y + w.px.height
      found.push({ kind: w.text.includes('.') ? 'dots' : 'underline', px: { x: w.px.x, y: bottom - h, width: w.px.width, height: h } })
    }
  }

  // 3. Empty space after a label that ends with a colon.
  // Blanks after a label run to the right edge of the text, stopping at a frame or column line.
  const vrules = findVerticalRules(g)
  const textRight = Math.max(0, ...lines.map((l) => l.px.x + l.px.width))
  const rightEdge = Math.min(W * 0.96, textRight + 0.5 * mh)
  for (const line of lines) {
    const ws = [...line.words].sort((a, b) => a.px.x - b.px.x)
    const cy = line.px.y + line.px.height / 2
    let labelStart = 0
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]
      if (!/[:：]$/.test(w.text)) continue
      const next = ws[i + 1]
      const x0 = w.px.x + w.px.width + 0.3 * mh
      let x1 = next ? next.px.x - 0.3 * mh : W * 0.96
      let framed = false
      for (const v of vrules) {
        if (v.x0 > x0 + mh && v.y0 <= cy && v.y1 >= cy) {
          x1 = Math.min(x1, v.x0 - 0.3 * mh)
          framed = true
        }
      }
      // Without a frame to stop at, do not run past the text on the page.
      if (!next && !framed) x1 = Math.min(x1, rightEdge)
      if (x1 - x0 < 2.5 * mh) {
        labelStart = i + 1
        continue
      }
      // Room to write: twice the label's line height, centred on it, but never across a rule.
      const lineH = Math.max(line.px.height, mh)
      let top = cy - lineH
      let bottom = cy + lineH
      for (const r of rules) {
        if (r.x1 < x0 || r.x0 > x1) continue
        if (r.y1 < cy && r.y1 + 2 > top) top = r.y1 + 2
        if (r.y0 > cy && r.y0 - 2 < bottom) bottom = r.y0 - 2
      }
      found.push({ kind: 'gap', px: { x: x0, y: top, width: x1 - x0, height: bottom - top }, labelWords: ws.slice(labelStart, i + 1) })
      labelStart = i + 1
    }
  }

  // Dedupe: keep drawn fields over inferred ones when they overlap.
  const order: Record<FieldKind, number> = { box: 0, underline: 1, dots: 2, gap: 3 }
  found.sort((a, b) => order[a.kind] - order[b.kind])
  const kept: typeof found = []
  for (const f of found) {
    if (f.px.width < 1.5 * mh || f.px.height < 0.5 * mh) continue
    const dup = kept.some((k) => intersect(k.px, f.px) >= 0.5 * Math.min(k.px.width * k.px.height, f.px.width * f.px.height))
    if (!dup) kept.push(f)
  }
  kept.sort((a, b) => (Math.abs(a.px.y - b.px.y) > 0.6 * mh ? a.px.y - b.px.y : a.px.x - b.px.x))

  const labelFor = (f: Px, given?: OcrWord[]): string => {
    let picked: { text: string; x: number }[] = given?.map((w) => ({ text: w.text, x: w.box.x })) ?? []
    if (!picked.length) {
      // Words on the same row, to the left, closest group first.
      const cy = f.y + f.height / 2
      const row = words
        .filter((w) => {
          const wy = w.px.y + w.px.height / 2
          return Math.abs(wy - cy) < 0.6 * mh && w.px.x + w.px.width <= f.x + 0.3 * mh && w.px.x + w.px.width >= f.x - 14 * mh
        })
        .sort((a, b) => b.px.x - a.px.x)
      const group: typeof row = []
      for (const w of row) {
        const last = group[group.length - 1]
        if (last && last.px.x - (w.px.x + w.px.width) > 1.5 * mh) break
        group.push(w)
      }
      picked = group.map((w) => ({ text: w.text, x: w.px.x }))
    }
    if (!picked.length) {
      // Otherwise the words just above the blank, or (signature lines) just below it.
      const spans = (w: (typeof words)[number]) => intersect(w.px, { ...f, y: w.px.y, height: w.px.height }) > 0.3 * w.px.width * w.px.height
      const above = words.filter((w) => {
        const bottom = w.px.y + w.px.height
        return bottom > f.y - 1.6 * mh && bottom < f.y + 0.2 * mh && spans(w)
      })
      const below = above.length
        ? []
        : words.filter((w) => w.px.y > f.y + f.height - 0.2 * mh && w.px.y < f.y + f.height + 1.2 * mh && spans(w))
      picked = (above.length ? above : below).map((w) => ({ text: w.text, x: w.px.x }))
    }
    return picked
      .sort((a, b) => a.x - b.x)
      .map((w) => w.text)
      .join(' ')
      .replace(/[\s:：_.]+$/, '')
      .slice(0, 48)
  }

  return kept.map((f, i) => ({
    id: `f${i + 1}`,
    kind: f.kind,
    box: { x: f.px.x / W, y: f.px.y / H, width: f.px.width / W, height: f.px.height / H },
    label: labelFor(f.px, f.labelWords),
  }))
}
