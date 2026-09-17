import { mimeOf } from './format'
import type { LoadedFile } from './types'

let seq = 0

async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const dims = { width: bmp.width, height: bmp.height }
    bmp.close()
    return dims
  } catch {
    // Fall back to <img>, which handles a few more formats (e.g. SVG without size).
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(`Cannot open "${file.name}". The format may not be supported by this browser.`))
      }
      img.src = url
    })
  }
}

export interface LoadOutcome {
  loaded: LoadedFile[]
  errors: { name: string; message: string }[]
}

export async function loadFiles(files: Iterable<File>): Promise<LoadOutcome> {
  const loaded: LoadedFile[] = []
  const errors: { name: string; message: string }[] = []
  await Promise.all(
    Array.from(files).map(async (file) => {
      const type = mimeOf(file)
      if (!type.startsWith('image/')) {
        errors.push({ name: file.name, message: 'Not an image file' })
        return
      }
      try {
        const { width, height } = await readDimensions(file)
        seq += 1
        loaded.push({
          id: `f${seq}-${Date.now().toString(36)}`,
          file,
          name: file.name,
          size: file.size,
          type,
          url: URL.createObjectURL(file),
          width,
          height,
        })
      } catch (e) {
        errors.push({ name: file.name, message: e instanceof Error ? e.message : String(e) })
      }
    }),
  )
  // Keep the user's selection order.
  const order = Array.from(files).map((f) => f.name)
  loaded.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  return { loaded, errors }
}

export function revokeFiles(files: LoadedFile[]) {
  for (const f of files) URL.revokeObjectURL(f.url)
}

/** Pull image files out of a paste or drop event. */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  if (dt.items && dt.items.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  if (!out.length && dt.files) out.push(...Array.from(dt.files))
  return out
}
