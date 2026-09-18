import type { DetectResponse, Op, PreviewResponse, ProcessRequest, ProcessResponse, Quad, WorkerRequest, WorkerResponse } from './types'

type Pending = {
  resolve: (r: ProcessResponse) => void
}

function makeWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

/**
 * Tiny worker pool. Each worker handles one request at a time; requests queue
 * up and are dispatched as workers free up.
 */
class WorkerPool {
  private workers: { worker: Worker; busy: boolean }[] = []
  private queue: ProcessRequest[] = []
  private pending = new Map<string, Pending>()

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const worker = makeWorker()
      const slot = { worker, busy: false }
      worker.onmessage = (e: MessageEvent<ProcessResponse>) => {
        const p = this.pending.get(e.data.id)
        this.pending.delete(e.data.id)
        slot.busy = false
        p?.resolve(e.data)
        this.pump()
      }
      worker.onerror = (e) => {
        // A crashed worker leaves its request hanging; fail everything it owned.
        slot.busy = false
        for (const [id, p] of this.pending) {
          p.resolve({ id, ok: false, error: e.message || 'Worker crashed' })
        }
        this.pending.clear()
        this.pump()
      }
      this.workers.push(slot)
    }
  }

  run(req: ProcessRequest): Promise<ProcessResponse> {
    return new Promise((resolve) => {
      this.pending.set(req.id, { resolve })
      this.queue.push(req)
      this.pump()
    })
  }

  private pump() {
    for (const slot of this.workers) {
      if (slot.busy) continue
      const next = this.queue.shift()
      if (!next) return
      slot.busy = true
      slot.worker.postMessage(next)
    }
  }
}

let pool: WorkerPool | null = null

export function getPool(): WorkerPool {
  if (!pool) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
    pool = new WorkerPool(n)
  }
  return pool
}

let counter = 0
export function nextId(prefix = 'job'): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

export async function processImage(
  req: Omit<ProcessRequest, 'id' | 'kind'>,
): Promise<Extract<ProcessResponse, { ok: true }>> {
  const res = await getPool().run({ ...req, kind: 'process', id: nextId() })
  if (!res.ok) throw new Error(res.error)
  return res
}

/**
 * A single dedicated worker for interactive previews. It caches decoded,
 * downscaled sources so slider changes only pay for the pixel math.
 */
class PreviewWorker {
  private worker = makeWorker()
  private pending = new Map<string, { resolve: (r: WorkerResponse) => void }>()

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      p?.resolve(e.data)
    }
    this.worker.onerror = (e) => {
      for (const [id, p] of this.pending) p.resolve({ id, ok: false, error: e.message || 'Preview worker crashed' })
      this.pending.clear()
    }
  }

  private send(req: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      this.pending.set(req.id, { resolve })
      this.worker.postMessage(req)
    })
  }

  async cache(key: string, source: Blob, maxSide: number): Promise<{ width: number; height: number }> {
    const res = (await this.send({ kind: 'cache', id: nextId('pv'), key, source, maxSide })) as PreviewResponse
    if (!res.ok) throw new Error(res.error)
    return { width: res.width, height: res.height }
  }

  async render(key: string, ops: Op[], maxSide?: number): Promise<ImageBitmap> {
    const res = (await this.send({ kind: 'render', id: nextId('pv'), key, ops, maxSide })) as PreviewResponse
    if (!res.ok) throw new Error(res.error)
    if (!res.bitmap) throw new Error('No preview produced')
    return res.bitmap
  }

  evict(key: string) {
    void this.send({ kind: 'evict', id: nextId('pv'), key })
  }

  async detect(source: Blob, seed?: Quad): Promise<{ quad: Quad | null; width: number; height: number }> {
    const res = (await this.send({ kind: 'detect', id: nextId('dt'), source, seed })) as DetectResponse
    if (!res.ok) throw new Error(res.error)
    return { quad: res.quad, width: res.width, height: res.height }
  }
}

let preview: PreviewWorker | null = null
export function getPreviewWorker(): PreviewWorker {
  if (!preview) preview = new PreviewWorker()
  return preview
}

/** Classic (non-ML) page-outline detection, off the main thread. Quad in source pixels, edge-snapped. */
export function detectDocumentFast(source: Blob): Promise<Quad | null> {
  return getPreviewWorker()
    .detect(source)
    .then((r) => r.quad)
}

/** Snap a rough outline (source pixels) onto the paper edges. */
export function refineDocumentQuad(source: Blob, quad: Quad): Promise<Quad> {
  return getPreviewWorker()
    .detect(source, quad)
    .then((r) => r.quad ?? quad)
}
