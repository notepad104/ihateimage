/**
 * AI object removal with MI-GAN (Sargsyan et al., ICCV 2023) running on-device
 * through ONNX Runtime Web. The ~28 MB model is fetched once from Hugging Face
 * and kept in the browser's Cache Storage; pixels never leave the page.
 *
 * Model contract (migan_pipeline_v2.onnx):
 *   image: uint8 [1,3,512,512]   mask: uint8 [1,1,512,512] (255 keep, 0 fill)
 *   result: uint8 [1,3,512,512]
 */
export const MODEL_URL = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx'
export const MODEL_SIZE_LABEL = '~28 MB'
const CACHE_NAME = 'ihateimage-models-v1'
const ORT_VERSION = '1.21.0'
/** Used only if the bundled runtime files cannot be located (e.g. unusual hosting setups). */
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`
const N = 512

type Ort = typeof import('onnxruntime-web')
type Session = import('onnxruntime-web').InferenceSession

let ortPromise: Promise<Ort> | null = null
let sessionPromise: Promise<{ ort: Ort; session: Session }> | null = null

async function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((ort) => {
      // Without cross-origin isolation only one wasm thread is available anyway.
      ort.env.wasm.numThreads = 1
      return ort
    })
  }
  return ortPromise
}

export type ModelProgress = (fraction: number, stage: 'download' | 'load' | 'run') => void

async function fetchModel(onProgress?: ModelProgress): Promise<ArrayBuffer> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(MODEL_URL)
    if (hit) {
      onProgress?.(1, 'download')
      return hit.arrayBuffer()
    }
  } catch {
    cache = null
  }
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 28_079_181
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(Math.min(0.99, received / total), 'download')
  }
  const buf = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  if (cache) {
    try {
      await cache.put(MODEL_URL, new Response(buf.slice(), { headers: { 'content-type': 'application/octet-stream' } }))
    } catch {
      /* quota exceeded or private mode; fine */
    }
  }
  onProgress?.(1, 'download')
  return buf.buffer
}

export async function isModelCached(): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(MODEL_URL)) !== undefined
  } catch {
    return false
  }
}

async function getSession(onProgress?: ModelProgress) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const [ort, buf] = await Promise.all([loadOrt(), fetchModel(onProgress)])
      onProgress?.(0, 'load')
      const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator
      const attempts: (() => Promise<Session>)[] = [
        () =>
          ort.InferenceSession.create(buf, {
            executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'],
            graphOptimizationLevel: 'all',
          }),
        () => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }),
        () => {
          ort.env.wasm.wasmPaths = ORT_CDN
          return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })
        },
      ]
      let session: Session | null = null
      let lastError: unknown
      for (const attempt of attempts) {
        try {
          session = await attempt()
          break
        } catch (e) {
          lastError = e
        }
      }
      if (!session) throw lastError instanceof Error ? lastError : new Error('Could not start the AI runtime')
      onProgress?.(1, 'load')
      return { ort, session }
    })().catch((e) => {
      sessionPromise = null
      throw e
    })
  }
  return sessionPromise
}

function bbox(mask: Uint8Array, w: number, h: number) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/**
 * Fill masked pixels using MI-GAN. Returns a new ImageData.
 * Works on a square crop around the mask so small objects keep full detail.
 */
export async function aiInpaint(image: ImageData, mask: Uint8Array, onProgress?: ModelProgress): Promise<ImageData> {
  const W = image.width
  const H = image.height
  const out = new ImageData(new Uint8ClampedArray(image.data), W, H)
  const bb = bbox(mask, W, H)
  if (!bb) return out

  const { ort, session } = await getSession(onProgress)
  onProgress?.(0, 'run')

  // Square crop: object plus context, at least 512 px when the image allows it.
  const bw = bb.x1 - bb.x0 + 1
  const bh = bb.y1 - bb.y0 + 1
  const desired = Math.max(bw, bh) * 2.4 + 96
  const side = Math.round(Math.min(Math.max(desired, N), Math.min(W, H)))
  const cw = Math.min(side, W)
  const ch = Math.min(side, H)
  const cx = Math.round(Math.min(Math.max((bb.x0 + bb.x1) / 2 - cw / 2, 0), W - cw))
  const cy = Math.round(Math.min(Math.max((bb.y0 + bb.y1) / 2 - ch / 2, 0), H - ch))

  // Source crop → 512×512
  const src = new OffscreenCanvas(W, H)
  src.getContext('2d')!.putImageData(image, 0, 0)
  const small = new OffscreenCanvas(N, N)
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(src, cx, cy, cw, ch, 0, 0, N, N)
  const px = sctx.getImageData(0, 0, N, N).data

  const imgT = new Uint8Array(3 * N * N)
  for (let i = 0; i < N * N; i++) {
    imgT[i] = px[i * 4]
    imgT[N * N + i] = px[i * 4 + 1]
    imgT[2 * N * N + i] = px[i * 4 + 2]
  }
  // Mask → 512×512 with slight dilation (255 = keep, 0 = fill)
  const maskT = new Uint8Array(N * N).fill(255)
  const sx = cw / N
  const sy = ch / N
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const mx0 = cx + Math.floor(x * sx)
      const my0 = cy + Math.floor(y * sy)
      const mx1 = Math.min(W - 1, cx + Math.ceil((x + 1) * sx))
      const my1 = Math.min(H - 1, cy + Math.ceil((y + 1) * sy))
      let hit = 0
      for (let yy = my0; yy <= my1 && !hit; yy++) for (let xx = mx0; xx <= mx1 && !hit; xx++) if (mask[yy * W + xx]) hit = 1
      if (hit) maskT[y * N + x] = 0
    }
  }
  // dilate by 2 px
  const dil = new Uint8Array(maskT)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (maskT[y * N + x] !== 0) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < N && yy < N) dil[yy * N + xx] = 0
        }
      }
    }
  }

  const feeds = {
    image: new ort.Tensor('uint8', imgT, [1, 3, N, N]),
    mask: new ort.Tensor('uint8', dil, [1, 1, N, N]),
  }
  const result = await session.run(feeds)
  const res = result.result.data as Uint8Array
  onProgress?.(0.9, 'run')

  // result → RGBA 512 → scale to crop size
  const resImg = new ImageData(N, N)
  for (let i = 0; i < N * N; i++) {
    resImg.data[i * 4] = res[i]
    resImg.data[i * 4 + 1] = res[N * N + i]
    resImg.data[i * 4 + 2] = res[2 * N * N + i]
    resImg.data[i * 4 + 3] = 255
  }
  const resCanvas = new OffscreenCanvas(N, N)
  resCanvas.getContext('2d')!.putImageData(resImg, 0, 0)
  const back = new OffscreenCanvas(cw, ch)
  const bctx = back.getContext('2d')!
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(resCanvas, 0, 0, N, N, 0, 0, cw, ch)
  const filled = bctx.getImageData(0, 0, cw, ch).data

  // Composite with a feathered edge so the seam disappears.
  const R = 3
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const gx = cx + x
      const gy = cy + y
      const gi = gy * W + gx
      let a = mask[gi] ? 1 : 0
      if (!a) {
        let c = 0
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const xx = gx + dx
            const yy = gy + dy
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) c++
          }
        }
        if (!c) continue
        a = Math.min(1, c / ((2 * R + 1) * (2 * R + 1) * 0.45))
      }
      const oi = gi * 4
      const fi = (y * cw + x) * 4
      out.data[oi] = out.data[oi] * (1 - a) + filled[fi] * a
      out.data[oi + 1] = out.data[oi + 1] * (1 - a) + filled[fi + 1] * a
      out.data[oi + 2] = out.data[oi + 2] * (1 - a) + filled[fi + 2] * a
    }
  }
  onProgress?.(1, 'run')
  return out
}

/** Decode any blob to ImageData on the main thread. */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return ctx.getImageData(0, 0, c.width, c.height)
}

export async function imageDataToBlob(img: ImageData): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height)
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}
