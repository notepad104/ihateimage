/**
 * On-device page-corner detection with DocAligner (DocsaidLab, Apache-2.0)
 * through ONNX Runtime Web. The 4.8 MB LCNet-100 heatmap model is fetched once
 * from Hugging Face, verified against a pinned SHA-256 and cached; the photo
 * never leaves the browser.
 *
 * Model contract (lcnet100_h_e_bifpn_256_fp32.onnx):
 *   input:  float32 [1,3,256,256], RGB / 255, image stretched to the square
 *   output: float32 [1,4,h,w] one heatmap per corner
 */
import { getSession, isModelCached, toFloat32, type ModelProgress, type PinnedModel } from './onnx'
import { isReasonableQuad, orderQuad } from './scan'
import type { Point, Quad } from './types'

export const DOC_MODEL: PinnedModel = {
  url: 'https://huggingface.co/7rplus/pagescan-weights/resolve/main/lcnet100_h_e_bifpn_256_fp32.onnx',
  sha256: 'f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e',
  bytes: 4_767_987,
  sizeLabel: '~4.8 MB',
}

const N = 256

export function isDocModelCached(): Promise<boolean> {
  return isModelCached(DOC_MODEL)
}

/**
 * Centre of the blob around a heatmap's peak. Returns null when the peak is
 * too weak to trust (corner out of frame or no page at all).
 */
function peak(map: Float32Array, off: number, w: number, h: number): Point | null {
  let max = -Infinity
  let arg = 0
  for (let i = 0; i < w * h; i++) {
    const v = map[off + i]
    if (v > max) {
      max = v
      arg = i
    }
  }
  if (!(max >= 0.15)) return null
  const thr = Math.min(0.3, max * 0.5)
  // Flood the connected region above `thr` starting at the peak; weighted centroid.
  const seen = new Uint8Array(w * h)
  const stack: number[] = [arg]
  seen[arg] = 1
  let sx = 0
  let sy = 0
  let sw = 0
  while (stack.length) {
    const i = stack.pop()!
    const v = map[off + i]
    const x = i % w
    const y = (i - x) / w
    sx += x * v
    sy += y * v
    sw += v
    const tryPush = (j: number) => {
      if (!seen[j] && map[off + j] >= thr) {
        seen[j] = 1
        stack.push(j)
      }
    }
    if (x > 0) tryPush(i - 1)
    if (x < w - 1) tryPush(i + 1)
    if (y > 0) tryPush(i - w)
    if (y < h - 1) tryPush(i + w)
  }
  if (sw <= 0) return null
  return { x: (sx / sw + 0.5) / w, y: (sy / sw + 0.5) / h }
}

/** Corners in source pixels, or null when the model does not see a page. */
export async function detectDocumentAi(source: Blob, onProgress?: ModelProgress): Promise<Quad | null> {
  const { ort, session } = await getSession(DOC_MODEL, onProgress)
  onProgress?.(0, 'run')

  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  const W = bitmap.width
  const H = bitmap.height
  const small = new OffscreenCanvas(N, N)
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(bitmap, 0, 0, N, N)
  bitmap.close()
  const px = sctx.getImageData(0, 0, N, N).data
  const input = new Float32Array(3 * N * N)
  for (let i = 0; i < N * N; i++) {
    input[i] = px[i * 4] / 255
    input[N * N + i] = px[i * 4 + 1] / 255
    input[2 * N * N + i] = px[i * 4 + 2] / 255
  }

  const feeds: Record<string, import('onnxruntime-web').Tensor> = {}
  feeds[session.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, N, N])
  const result = await session.run(feeds)
  const outName = session.outputNames.find((n) => n.toLowerCase().includes('heat')) ?? session.outputNames[0]
  const tensor = result[outName]
  const dims = tensor.dims
  if (dims.length !== 4 || dims[1] < 4) throw new Error('Unexpected output from the page-detection model')
  const hh = dims[2]
  const hw = dims[3]
  const map = toFloat32(tensor.data as ArrayLike<number>, tensor.type)
  onProgress?.(0.9, 'run')

  const pts: Point[] = []
  for (let c = 0; c < 4; c++) {
    const p = peak(map, c * hh * hw, hw, hh)
    if (!p) return null
    pts.push({ x: p.x * W, y: p.y * H })
  }
  const quad = orderQuad(pts)
  onProgress?.(1, 'run')
  return isReasonableQuad(quad, W, H) ? quad : null
}
