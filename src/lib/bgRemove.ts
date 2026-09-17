/**
 * On-device background removal with IS-Net (Qin et al., "Highly Accurate
 * Dichotomous Image Segmentation", ECCV 2022) through ONNX Runtime Web.
 * Same model family as the popular hosted tools, but the photo never leaves
 * the browser. Model files are pinned by SHA-256 and cached after first use.
 *
 * Model contract (onnx-community/ISNet-ONNX):
 *   input:  float32 [1,3,1024,1024], (pixel - 128) / 256
 *   output: [1,1,1024,1024] saliency map, higher = foreground
 */
import { getSession, isModelCached, toFloat32, type ModelProgress, type PinnedModel } from './onnx'

export type BgModel = 'fast' | 'best'

const BASE = 'https://huggingface.co/onnx-community/ISNet-ONNX/resolve/main/onnx/'

export const BG_MODELS: Record<BgModel, PinnedModel & { label: string; blurb: string }> = {
  fast: {
    url: `${BASE}model_quantized.onnx`,
    sha256: '9f5c5fa3ccc771612d5290a648f055f94a4fa4ce289c6b3df7258e7e10e87a42',
    bytes: 44_348_381,
    sizeLabel: '~44 MB',
    label: 'Fast',
    blurb: 'Quantized model. Quick on any device, great for people and products.',
  },
  best: {
    url: `${BASE}model_fp16.onnx`,
    sha256: 'dffe20331551dcc5d7601563e472448424821f2df41f5bad395848826c5b5be5',
    bytes: 88_116_798,
    sizeLabel: '~88 MB',
    label: 'Best',
    blurb: 'Full-precision edges for hair and fine detail. Best with a GPU.',
  },
}

const N = 1024

export function isBgModelCached(model: BgModel) {
  return isModelCached(BG_MODELS[model])
}

/**
 * Returns a PNG with the background made transparent. `onProgress` reports
 * model download/load and the inference stage.
 */
export async function removeBackgroundLocal(source: Blob, model: BgModel, onProgress?: ModelProgress): Promise<Blob> {
  const { ort, session } = await getSession(BG_MODELS[model], onProgress)
  onProgress?.(0, 'run')

  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  const W = bitmap.width
  const H = bitmap.height

  // Network input: the whole image stretched to 1024×1024, like the reference implementation.
  const small = new OffscreenCanvas(N, N)
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(bitmap, 0, 0, N, N)
  const px = sctx.getImageData(0, 0, N, N).data
  const input = new Float32Array(3 * N * N)
  for (let i = 0; i < N * N; i++) {
    input[i] = (px[i * 4] - 128) / 256
    input[N * N + i] = (px[i * 4 + 1] - 128) / 256
    input[2 * N * N + i] = (px[i * 4 + 2] - 128) / 256
  }

  const result = await session.run({ input: new ort.Tensor('float32', input, [1, 3, N, N]) })
  const first = result[session.outputNames[0]]
  const map = toFloat32(first.data as ArrayLike<number>, first.type)
  onProgress?.(0.85, 'run')

  // Min-max normalise the saliency map into an 8-bit alpha mask.
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < N * N; i++) {
    const v = map[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo || 1
  const maskImg = new ImageData(N, N)
  for (let i = 0; i < N * N; i++) {
    const a = Math.round(((map[i] - lo) / range) * 255)
    maskImg.data[i * 4] = a
    maskImg.data[i * 4 + 1] = a
    maskImg.data[i * 4 + 2] = a
    maskImg.data[i * 4 + 3] = 255
  }
  const maskCanvas = new OffscreenCanvas(N, N)
  maskCanvas.getContext('2d')!.putImageData(maskImg, 0, 0)

  // Scale the mask back to the original size and apply it as alpha.
  const out = new OffscreenCanvas(W, H)
  const octx = out.getContext('2d')!
  octx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const scaled = new OffscreenCanvas(W, H)
  const mctx = scaled.getContext('2d')!
  mctx.imageSmoothingEnabled = true
  mctx.imageSmoothingQuality = 'high'
  mctx.drawImage(maskCanvas, 0, 0, N, N, 0, 0, W, H)
  const alpha = mctx.getImageData(0, 0, W, H).data
  const img = octx.getImageData(0, 0, W, H)
  for (let i = 0, j = 3; j < img.data.length; i += 4, j += 4) img.data[j] = alpha[i]
  octx.putImageData(img, 0, 0)
  onProgress?.(1, 'run')
  return out.convertToBlob({ type: 'image/png' })
}
