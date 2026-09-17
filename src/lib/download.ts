import JSZip from 'jszip'
import type { ProcessResult } from './types'

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
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
    const n = seen.get(r.name) ?? 0
    seen.set(r.name, n + 1)
    if (n === 0) return r.name
    const i = r.name.lastIndexOf('.')
    return i > 0 ? `${r.name.slice(0, i)} (${n})${r.name.slice(i)}` : `${r.name} (${n})`
  })
}

export async function downloadZip(results: ProcessResult[], zipName: string) {
  const zip = new JSZip()
  const names = uniqueNames(results)
  results.forEach((r, i) => zip.file(names[i], r.blob))
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
