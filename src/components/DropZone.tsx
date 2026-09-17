import { ImagePlus, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { filesFromDataTransfer } from '../lib/files'
import { Button, cx } from './ui'

export function DropZone({
  onFiles,
  multiple = true,
  compact = false,
  busy = false,
}: {
  onFiles: (files: File[]) => void
  multiple?: boolean
  compact?: boolean
  busy?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = filesFromDataTransfer(e.dataTransfer)
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cx(
        'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors',
        over ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white hover:border-slate-400',
        compact ? 'gap-2 px-4 py-6' : 'gap-4 px-6 py-16 sm:py-24',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      {compact ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            <ImagePlus className="h-4 w-4" />
            Add more images
          </Button>
          <p className="text-xs text-slate-500">or drop / paste them anywhere</p>
        </>
      ) : (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
            <Upload className="h-8 w-8" />
          </div>
          <div>
            <Button size="lg" onClick={() => inputRef.current?.click()} disabled={busy}>
              {multiple ? 'Select images' : 'Select image'}
            </Button>
            <p className="mt-3 text-sm text-slate-600">
              or drop {multiple ? 'files' : 'a file'} here, or paste from your clipboard
            </p>
          </div>
          <p className="text-xs text-slate-500">JPG, PNG, WebP, AVIF, GIF, BMP · processed on your device</p>
        </>
      )}
    </div>
  )
}
