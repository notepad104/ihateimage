import JSZip from 'jszip'
import type { ProcessResult } from './types'

/**
 * Make a user-supplied name safe to hand to the OS and to put inside a ZIP:
 * no path separators or traversal, no control characters, bounded length.
 */
export function safeFileName(name: string, fallback = 'image'): string {
  let s = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
  if (!s || s === '_') s = fallback
  if (s.length > 180) {
    const dot = s.lastIndexOf('.')
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : ''
    s = s.slice(0, 180 - ext.length) + ext
  }
  return s
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFileName(name)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function uniqueNames(results: ProcessResult[]): string[] {
  const seen = new Map<string, number>()
  return results.map((r) => {
    const base = safeFileName(r.name)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    if (n === 0) return base
    const i = base.lastIndexOf('.')
    return i > 0 ? `${base.slice(0, i)} (${n})${base.slice(i)}` : `${base} (${n})`
  })
}

export async function downloadZip(results: ProcessResult[], zipName: string) {
  const zip = new JSZip()
  const names = uniqueNames(results)
  // Flat archive: entry names are sanitized, so no directories or traversal are possible.
  results.forEach((r, i) => zip.file(names[i], r.blob, { createFolders: false }))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  downloadBlob(blob, zipName.endsWith('.zip') ? zipName : `${zipName}.zip`)
}

export function downloadAll(results: ProcessResult[], zipName: string) {
  if (results.length === 1) {
    downloadBlob(results[0].blob, results[0].name)
    return Promise.resolve()
  }
  return downloadZip(results, zipName)
}
