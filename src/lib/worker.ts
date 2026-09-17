/// <reference lib="webworker" />
import { applyOps, decode, encode, fromBitmap, prepareOps, releaseOps, resize } from './image-ops'
import type { PreviewResponse, ProcessResponse, WorkerRequest } from './types'

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
