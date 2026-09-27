/**
 * On-device text recognition with Tesseract (LSTM engine, English) running in
 * a Web Worker. The engine (~6.7 MB) and the language file (~2 MB) are served
 * from this origin and cached by the browser; pixels never leave the device.
 */
import type { Rect } from './types'

export interface OcrWord {
  text: string
  confidence: number
  /** Fractions of the image */
  box: Rect
}

export interface OcrLine {
  text: string
  confidence: number
  box: Rect
  words: OcrWord[]
}

export interface OcrResult {
  /** Plain text: one line per text line, blank line between paragraphs. */
  text: string
  /** 0–100 */
  confidence: number
  lines: OcrLine[]
}

export type OcrStage = 'download' | 'load' | 'run'
export type OcrProgress = (fraction: number, stage: OcrStage) => void

export const OCR_SIZE_LABEL = '~9 MB'

const BASE = '/ocr'

/** Tesseract reads best when glyphs are 20–40 px tall; keep the long side in this range. */
const MIN_SIDE = 1400
const MAX_SIDE = 2600
const MAX_UPSCALE = 2

type TesseractModule = typeof import('tesseract.js')
type Worker = import('tesseract.js').Worker

let workerPromise: Promise<Worker> | null = null
let progress: OcrProgress | null = null
let queue: Promise<unknown> = Promise.resolve()

async function loadTesseract(): Promise<TesseractModule> {
  const mod = (await import('tesseract.js')) as TesseractModule & { default?: TesseractModule }
  return mod.default?.createWorker ? mod.default : mod
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await loadTesseract()
      const worker = await T.createWorker('eng', T.OEM.LSTM_ONLY, {
        workerPath: `${BASE}/worker.min.js`,
        corePath: `${BASE}/`,
        langPath: BASE,
        // The core locates its .wasm next to the worker script, which needs a real URL, not a blob.
        workerBlobURL: false,
        logger: (m) => {
          if (!progress) return
          if (m.status === 'recognizing text') progress(m.progress, 'run')
          else if (m.status === 'initializing api' || m.status === 'initialized api') progress(m.progress, 'load')
          else progress(m.progress, 'download')
        },
      })
      await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1' })
      return worker
    })().catch((e) => {
      workerPromise = null
      throw e instanceof Error ? e : new Error('Could not start the text recogniser')
    })
  }
  return workerPromise
}

/** Frees the worker and its memory. Safe to call at any time; the next call starts it again. */
export async function releaseOcr() {
  const p = workerPromise
  workerPromise = null
  if (!p) return
  try {
    const w = await p
    await w.terminate()
  } catch {
    /* already gone */
  }
}

/** Render the source as an opaque PNG at a size Tesseract handles well. */
async function prepare(source: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const long = Math.max(bmp.width, bmp.height)
    let scale = 1
    if (long > MAX_SIDE) scale = MAX_SIDE / long
    else if (long < MIN_SIDE) scale = Math.min(MAX_UPSCALE, MIN_SIDE / long)
    const width = Math.max(1, Math.round(bmp.width * scale))
    const height = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bmp, 0, 0, width, height)
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), width, height }
  } finally {
    bmp.close()
  }
}

/**
 * 'document': Tesseract's automatic layout analysis, best reading order for pages of prose.
 * 'form': sparse-text mode, which finds labels scattered between rules and boxes that the
 * layout analysis tends to drop; the text is then rebuilt row by row from the word positions.
 */
export type OcrMode = 'document' | 'form'

/** Sort words into rows and join them, for layouts Tesseract's own ordering does not suit. */
function textFromLines(lines: OcrLine[]): string {
  const words = lines.flatMap((l) => l.words).sort((a, b) => a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2))
  const rows: OcrWord[][] = []
  for (const w of words) {
    const row = rows[rows.length - 1]
    const cy = w.box.y + w.box.height / 2
    if (row) {
      const ry = row.reduce((s, r) => s + r.box.y + r.box.height / 2, 0) / row.length
      const rh = row.reduce((s, r) => s + r.box.height, 0) / row.length
      if (Math.abs(cy - ry) < 0.5 * rh) {
        row.push(w)
        continue
      }
    }
    rows.push([w])
  }
  return rows.map((r) => r.sort((a, b) => a.box.x - b.box.x).map((w) => w.text).join(' ')).join('\n')
}

/** Recognise the text in an image. Calls are queued; the worker handles one image at a time. */
export function recognizeText(source: Blob, onProgress?: OcrProgress, mode: OcrMode = 'document'): Promise<OcrResult> {
  const job = queue.then(async () => {
    progress = onProgress ?? null
    try {
      onProgress?.(0, 'download')
      const worker = await getWorker()
      const { blob, width, height } = await prepare(source)
      onProgress?.(0, 'run')
      await worker.setParameters({ tessedit_pageseg_mode: (mode === 'form' ? '11' : '3') as import('tesseract.js').PSM })
      const { data } = await worker.recognize(blob, {}, { text: true, blocks: true })
      const toRect = (b: { x0: number; y0: number; x1: number; y1: number }): Rect => ({
        x: b.x0 / width,
        y: b.y0 / height,
        width: (b.x1 - b.x0) / width,
        height: (b.y1 - b.y0) / height,
      })
      const lines: OcrLine[] = []
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const words = line.words
              .filter((w) => w.text.trim())
              .map((w) => ({ text: w.text, confidence: w.confidence, box: toRect(w.bbox) }))
            if (!words.length) continue
            lines.push({ text: line.text.replace(/\s+$/, ''), confidence: line.confidence, box: toRect(line.bbox), words })
          }
        }
      }
      onProgress?.(1, 'run')
      const text = mode === 'form' ? textFromLines(lines) : data.text.replace(/[ \t]+\n/g, '\n').trim()
      return { text, confidence: data.confidence, lines }
    } finally {
      progress = null
    }
  })
  queue = job.catch(() => undefined)
  return job
}

/** Join the lines of each paragraph into flowing text, keeping blank lines between paragraphs. */
export function flowParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
}
