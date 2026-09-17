import type { AdjustParams } from './adjust'

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

/**
 * A concrete, fully-resolved pixel operation. Pages compute these on the main
 * thread (where source dimensions are known) and the worker just executes them
 * in order.
 */
export type Op =
  | { type: 'resize'; width: number; height: number }
  | { type: 'crop'; x: number; y: number; width: number; height: number }
  | { type: 'pad'; width: number; height: number; color: string }
  | { type: 'rotate'; degrees: 90 | 180 | 270 }
  | { type: 'flip'; horizontal: boolean; vertical: boolean }
  | { type: 'flatten'; color: string }
  | { type: 'adjust'; params: AdjustParams }
  /** mask is width*height bytes, non-zero = fill this pixel */
  | { type: 'inpaint'; mask: Uint8Array; width: number; height: number }

export interface EncodeOptions {
  format: OutputFormat
  /** 0..1, ignored for PNG */
  quality?: number
  /** If set, quality is searched so the output is at or below this many bytes. */
  targetBytes?: number
}

export interface ProcessRequest {
  kind: 'process'
  id: string
  source: Blob
  ops: Op[]
  encode: EncodeOptions
}

export type ProcessResponse =
  | {
      id: string
      ok: true
      blob: Blob
      width: number
      height: number
      /** Quality actually used (after target-size search) */
      quality?: number
      /** True when target size could not be reached even at minimum quality */
      missedTarget?: boolean
    }
  | { id: string; ok: false; error: string }

/** Decode + downscale a source once and keep it in the worker under `key`. */
export interface PreviewCacheRequest {
  kind: 'cache'
  id: string
  key: string
  source: Blob
  maxSide: number
}

/** Apply ops to a cached preview and return an ImageBitmap. */
export interface PreviewRenderRequest {
  kind: 'render'
  id: string
  key: string
  ops: Op[]
  /** Optionally shrink further before applying ops (thumbnails). */
  maxSide?: number
}

export interface PreviewEvictRequest {
  kind: 'evict'
  id: string
  key: string
}

export type WorkerRequest = ProcessRequest | PreviewCacheRequest | PreviewRenderRequest | PreviewEvictRequest

export type PreviewResponse =
  | { id: string; ok: true; bitmap?: ImageBitmap; width: number; height: number }
  | { id: string; ok: false; error: string }

export type WorkerResponse = ProcessResponse | PreviewResponse

export interface LoadedFile {
  id: string
  file: File
  name: string
  size: number
  type: string
  url: string
  width: number
  height: number
}

export interface ProcessResult {
  blob: Blob
  name: string
  width: number
  height: number
  note?: string
}

export type Gravity =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
