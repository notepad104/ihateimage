/// <reference lib="webworker" />
import { applyOps, decode, encode, fromBitmap, prepareOps, releaseOps, resize } from './image-ops'
import { detectQuadClassic, isReasonableQuad, refineQuad, scaleQuad } from './scan'
import type { DetectResponse, PreviewResponse, ProcessResponse, Quad, WorkerRequest } from './types'

/** Longest side of the working copy used for page-outline detection. */
const DETECT_MAX = 480
/** Longest side of the working copy used to snap corners onto edges. */
const REFINE_MAX = 1400

function imageDataOf(canvas: OffscreenCanvas): ImageData {
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
}

/** Refine `quad` (full-resolution pixels) on a medium-sized copy of the image. */
function refineOnCopy(full: OffscreenCanvas, quad: Quad): Quad {
  const copy = fitCanvas(full, REFINE_MAX)
  const s = copy.width / full.width
  const refined = refineQuad(imageDataOf(copy), scaleQuad(quad, s, s))
  return scaleQuad(refined, 1 / s, 1 / s)
}

/** Downscaled sources kept for live previews, keyed by the page-provided key. */
const previewCache = new Map<string, OffscreenCanvas>()

function fitCanvas(src: OffscreenCanvas, maxSide: number): OffscreenCanvas {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
  if (scale >= 1) return src
  return resize(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)))
}

function copyCanvas(src: OffscreenCanvas): OffscreenCanvas {
  const c = new OffscreenCanvas(src.width, src.height)
  c.getContext('2d')!.drawImage(src, 0, 0)
  return c
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    switch (req.kind) {
      case 'process': {
        const bitmap = await decode(req.source)
        let canvas = fromBitmap(bitmap)
        bitmap.close()
        const ops = await prepareOps(req.ops)
        try {
          canvas = applyOps(canvas, ops)
        } finally {
          releaseOps(ops)
        }
        const { blob, quality, missedTarget } = await encode(canvas, req.encode)
        const res: ProcessResponse = {
          id: req.id,
          ok: true,
          blob,
          width: canvas.width,
          height: canvas.height,
          quality,
          missedTarget,
        }
        self.postMessage(res)
        return
      }
      case 'cache': {
        const bitmap = await decode(req.source)
        const canvas = fitCanvas(fromBitmap(bitmap), req.maxSide)
        bitmap.close()
        previewCache.set(req.key, canvas)
        const res: PreviewResponse = { id: req.id, ok: true, width: canvas.width, height: canvas.height }
        self.postMessage(res)
        return
      }
      case 'render': {
        const cached = previewCache.get(req.key)
        if (!cached) throw new Error('Preview source not loaded')
        let canvas = req.maxSide ? fitCanvas(cached, req.maxSide) : cached
        canvas = canvas === cached ? copyCanvas(cached) : canvas
        const ops = await prepareOps(req.ops)
        try {
          canvas = applyOps(canvas, ops)
        } finally {
          releaseOps(ops)
        }
        const bitmap = canvas.transferToImageBitmap()
        const res: PreviewResponse = { id: req.id, ok: true, bitmap, width: bitmap.width, height: bitmap.height }
        self.postMessage(res, [bitmap])
        return
      }
      case 'evict': {
        previewCache.delete(req.key)
        const res: PreviewResponse = { id: req.id, ok: true, width: 0, height: 0 }
        self.postMessage(res)
        return
      }
      case 'detect': {
        const bitmap = await decode(req.source)
        const full = fromBitmap(bitmap)
        bitmap.close()
        // A seed (the model's outline) is authoritative: snap it to the edges
        // and return it. The classic detector only runs without a seed, or when
        // snapping produced something that is no longer a plausible page.
        let quad: Quad | null = null
        let source: 'seed' | 'classic' = 'seed'
        if (req.seed) {
          const snapped = refineOnCopy(full, req.seed)
          quad = isReasonableQuad(snapped, full.width, full.height) ? snapped : req.seed
        }
        if (!quad) {
          const small = fitCanvas(full, DETECT_MAX)
          const classic = detectQuadClassic(imageDataOf(small))
          if (classic) {
            quad = refineOnCopy(full, scaleQuad(classic, full.width / small.width, full.height / small.height))
            source = 'classic'
          }
        }
        const res: DetectResponse = { id: req.id, ok: true, quad, width: full.width, height: full.height, source }
        self.postMessage(res)
        return
      }
    }
  } catch (err) {
    const res: ProcessResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(res)
  }
}
