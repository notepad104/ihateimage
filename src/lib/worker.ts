/// <reference lib="webworker" />
import { applyOps, decode, encode, fromBitmap } from './image-ops'
import type { ProcessRequest, ProcessResponse } from './types'

self.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const req = event.data
  try {
    const bitmap = await decode(req.source)
    let canvas = fromBitmap(bitmap)
    bitmap.close()
    canvas = applyOps(canvas, req.ops)
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
  } catch (err) {
    const res: ProcessResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(res)
  }
}
