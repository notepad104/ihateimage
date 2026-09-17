/**
 * Shared plumbing for on-device models: ONNX Runtime Web loading, pinned model
 * downloads (SHA-256 verified, cached in Cache Storage) and session creation.
 * Nothing here ever sends pixels anywhere; only the model files are fetched.
 */

export type Ort = typeof import('onnxruntime-web')
export type Session = import('onnxruntime-web').InferenceSession

export interface PinnedModel {
  url: string
  sha256: string
  bytes: number
  /** Human-readable download size */
  sizeLabel: string
}

export type ModelProgress = (fraction: number, stage: 'download' | 'load' | 'run') => void

const CACHE_NAME = 'ihateimage-models-v1'

let ortPromise: Promise<Ort> | null = null

export function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((ort) => {
      // Without cross-origin isolation only one wasm thread is available anyway.
      ort.env.wasm.numThreads = 1
      return ort
    })
  }
  return ortPromise
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function verify(model: PinnedModel, buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (buf.byteLength !== model.bytes || (await sha256Hex(buf)) !== model.sha256) {
    try {
      const cache = await caches.open(CACHE_NAME)
      await cache.delete(model.url)
    } catch {
      /* ignore */
    }
    throw new Error('The downloaded AI model did not match its expected checksum and was discarded. Please try again.')
  }
  return buf
}

/** Download (or read from cache) a pinned model file, verifying its checksum either way. */
export async function fetchModel(model: PinnedModel, onProgress?: ModelProgress): Promise<ArrayBuffer> {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(model.url)
    if (hit) {
      onProgress?.(1, 'download')
      return verify(model, await hit.arrayBuffer())
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('checksum')) throw e
    cache = null
  }
  const res = await fetch(model.url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`)
  const limit = model.bytes * 1.05
  const total = Number(res.headers.get('content-length')) || model.bytes
  if (total > limit) throw new Error('Model download is larger than expected; aborting')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (received > limit) {
      await reader.cancel()
      throw new Error('Model download is larger than expected; aborting')
    }
    onProgress?.(Math.min(0.99, received / total), 'download')
  }
  const buf = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  await verify(model, buf.buffer)
  if (cache) {
    try {
      await cache.put(model.url, new Response(buf.slice(), { headers: { 'content-type': 'application/octet-stream' } }))
    } catch {
      /* quota exceeded or private mode; fine */
    }
  }
  onProgress?.(1, 'download')
  return buf.buffer
}

export async function isModelCached(model: PinnedModel): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(model.url)) !== undefined
  } catch {
    return false
  }
}

/** Create a session, preferring WebGPU when available and falling back to WebAssembly. */
export async function createSession(buf: ArrayBuffer, onProgress?: ModelProgress): Promise<{ ort: Ort; session: Session }> {
  const ort = await loadOrt()
  onProgress?.(0, 'load')
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  const attempts: (() => Promise<Session>)[] = [
    () =>
      ort.InferenceSession.create(buf, {
        executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'],
        graphOptimizationLevel: 'all',
      }),
    () => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }),
  ]
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      const session = await attempt()
      onProgress?.(1, 'load')
      return { ort, session }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not start the AI runtime')
}

const sessions = new Map<string, Promise<{ ort: Ort; session: Session }>>()

/** Memoized: one live session per model URL. */
export function getSession(model: PinnedModel, onProgress?: ModelProgress) {
  let p = sessions.get(model.url)
  if (!p) {
    p = fetchModel(model, onProgress)
      .then((buf) => createSession(buf, onProgress))
      .catch((e) => {
        sessions.delete(model.url)
        throw e
      })
    sessions.set(model.url, p)
  }
  return p
}

/** ORT returns float16 tensors as Uint16Array; expand to float32. */
export function toFloat32(data: ArrayLike<number>, type: string): Float32Array {
  if (type !== 'float16') return data instanceof Float32Array ? data : Float32Array.from(data)
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const h = data[i]
    const s = (h & 0x8000) >> 15
    const e = (h & 0x7c00) >> 10
    const f = h & 0x03ff
    let v: number
    if (e === 0) v = (f / 1024) * Math.pow(2, -14)
    else if (e === 0x1f) v = f ? NaN : Infinity
    else v = (1 + f / 1024) * Math.pow(2, e - 15)
    out[i] = s ? -v : v
  }
  return out
}
