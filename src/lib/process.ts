import type { ProcessRequest, ProcessResponse } from './types'

type Pending = {
  resolve: (r: ProcessResponse) => void
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
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
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

export async function processImage(req: Omit<ProcessRequest, 'id'>): Promise<Extract<ProcessResponse, { ok: true }>> {
  const res = await getPool().run({ ...req, id: nextId() })
  if (!res.ok) throw new Error(res.error)
  return res
}
