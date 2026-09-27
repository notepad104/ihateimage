import { GripHorizontal, Trash2, Type } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { itemRect, LINE_HEIGHT, MAX_TEXT_SIZE, MIN_TEXT_SIZE, textBlockPx, type FillItem, type ImageItem, type TextItem } from '../lib/fill'
import type { FormField } from '../lib/formFields'
import type { Rect } from '../lib/types'
import { cx } from './ui'

export interface FillEditorProps {
  url: string
  width: number
  height: number
  fields: FormField[]
  showFields: boolean
  items: FillItem[]
  /** Id of the selected item or blank */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Live update while dragging or typing. */
  onChange: (id: string, patch: Partial<TextItem> | Partial<ImageItem>) => void
  /** A drag or resize finished: a good moment to record history. */
  onCommit: () => void
  onRemove: (id: string) => void
  /** Fill a blank with text; `initial` is a character the user has just typed. */
  onFieldFill: (field: FormField, initial?: string) => void
  onFieldChange: (id: string, box: Rect) => void
  onFieldRemove: (id: string) => void
  onAddTextAt: (x: number, y: number) => void
}

type Drag =
  | { kind: 'move'; target: 'item' | 'field'; id: string; startX: number; startY: number; ox: number; oy: number; moved: boolean }
  | { kind: 'resize'; target: 'item' | 'field'; id: string; startX: number; startY: number; origin: Rect; size?: number }

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const FIELD_TITLES: Record<FormField['kind'], string> = {
  underline: 'Blank line',
  box: 'Empty box',
  dots: 'Dotted line',
  gap: 'Space after a label',
}

export function FillEditor({
  url,
  width,
  height,
  fields,
  showFields,
  items,
  selectedId,
  onSelect,
  onChange,
  onCommit,
  onRemove,
  onFieldFill,
  onFieldChange,
  onFieldRemove,
  onAddTextAt,
}: FillEditorProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  const dragRef = useRef<Drag | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Displayed pixels per image pixel. ResizeObserver stays quiet for the first paint, so measure once by hand.
  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const measure = () => setScale(el.getBoundingClientRect().width / width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  // Focus the textarea of a freshly selected text item.
  useEffect(() => {
    const sel = items.find((i) => i.id === selectedId)
    if (sel?.kind === 'text') {
      const ta = textareaRef.current
      if (ta && document.activeElement !== ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }
  }, [selectedId, items])

  const selectedField = fields.find((f) => f.id === selectedId) ?? null

  // Keyboard: delete, nudge, escape; typing into a selected blank starts a text box there.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')
      if (e.key === 'Escape') {
        onSelect(null)
        t?.blur?.()
        return
      }
      if (typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedField) onFieldRemove(selectedField.id)
        else onRemove(selectedId)
        return
      }
      if (selectedField) {
        if (e.key === 'Enter') {
          e.preventDefault()
          onFieldFill(selectedField)
        } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault()
          onFieldFill(selectedField, e.key)
        }
        return
      }
      const step = (e.shiftKey ? 10 : 1) / (width * Math.max(scale, 0.01))
      const item = items.find((i) => i.id === selectedId)
      if (!item) return
      if (e.key === 'ArrowLeft') onChange(selectedId, { x: item.x - step })
      else if (e.key === 'ArrowRight') onChange(selectedId, { x: item.x + step })
      else if (e.key === 'ArrowUp') onChange(selectedId, { y: item.y - (step * width) / height })
      else if (e.key === 'ArrowDown') onChange(selectedId, { y: item.y + (step * width) / height })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, selectedField, items, onChange, onRemove, onSelect, onFieldFill, onFieldRemove, width, height, scale])

  const pxW = width * scale
  const pxH = height * scale

  const startDrag = (e: ReactPointerEvent, drag: Drag) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = drag
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d || !pxW) return
    const dx = (e.clientX - d.startX) / pxW
    const dy = (e.clientY - d.startY) / pxH
    if (d.kind === 'move') {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
      d.moved = true
      if (d.target === 'field') {
        const f = fields.find((x) => x.id === d.id)
        if (f) onFieldChange(d.id, { ...f.box, x: d.ox + dx, y: d.oy + dy })
      } else onChange(d.id, { x: d.ox + dx, y: d.oy + dy })
      return
    }
    if (d.target === 'field') {
      onFieldChange(d.id, { ...d.origin, width: Math.max(0.01, d.origin.width + dx), height: Math.max(0.005, d.origin.height + dy) })
      return
    }
    const item = items.find((i) => i.id === d.id)
    if (!item) return
    if (item.kind === 'image') {
      const w = Math.max(0.02, d.origin.width + dx)
      onChange(d.id, { width: w, height: (w * d.origin.height) / d.origin.width })
    } else if (d.size) {
      const h = Math.max(0.005, d.origin.height + dy)
      onChange(d.id, { size: Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, (d.size * h) / d.origin.height)) })
    }
  }

  const onPointerUp = () => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (d.kind === 'move' && !d.moved) onSelect(d.id)
    else if (d.target === 'item') onCommit()
  }

  const itemRects = items.map((i) => ({ item: i, rect: itemRect(i, width, height) }))
  const filled = new Set(items.map((i) => i.fieldId).filter(Boolean))
  const visibleFields = fields.filter(
    (f) =>
      (showFields || f.id === selectedId) &&
      !filled.has(f.id) &&
      !itemRects.some(({ rect }) => overlap(rect, f.box) > 0.4 * f.box.width * f.box.height),
  )

  const toolbar = (onDrag: (e: ReactPointerEvent) => void, onDelete: () => void, extra?: ReactNode) => (
    <div
      className="absolute -top-8 left-0 z-10 flex items-center gap-0.5 rounded-md bg-slate-900 p-0.5 text-white shadow"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span
        title="Drag to move"
        className="flex h-6 w-7 cursor-grab items-center justify-center rounded hover:bg-white/15 active:cursor-grabbing"
        onPointerDown={onDrag}
      >
        <GripHorizontal className="h-3.5 w-3.5" />
      </span>
      {extra}
      <button type="button" title="Remove" aria-label="Remove" className="flex h-6 w-7 items-center justify-center rounded hover:bg-white/15" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  const handle = (onDown: (e: ReactPointerEvent) => void) => (
    <span
      title="Drag to resize"
      className="absolute -bottom-1.5 -right-1.5 z-10 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-600 shadow"
      onPointerDown={onDown}
    />
  )

  return (
    <div
      ref={sheetRef}
      className="relative w-full select-none overflow-hidden rounded-xl bg-slate-100 shadow-inner"
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') onSelect(null)
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== 'IMG') return
        const r = e.currentTarget.getBoundingClientRect()
        onAddTextAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
      }}
    >
      <img src={url} alt="" className="absolute inset-0 h-full w-full" draggable={false} />

      {scale > 0 &&
        visibleFields.map((f) => {
          const selected = f.id === selectedId
          const name = f.label || FIELD_TITLES[f.kind]
          return (
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              title={selected ? `${name} · start typing, or double-click, to fill it in` : `${name} · click to select, double-click to type here`}
              aria-label={`Blank: ${name}`}
              className={cx(
                'absolute rounded-sm border-2 border-dashed transition-colors focus:outline-none',
                selected ? 'border-brand-600 bg-brand-500/20' : 'border-sky-500/80 bg-sky-400/15 hover:bg-sky-400/35',
              )}
              style={{ left: f.box.x * pxW, top: f.box.y * pxH, width: f.box.width * pxW, height: f.box.height * pxH, cursor: 'pointer' }}
              onPointerDown={(e) => startDrag(e, { kind: 'move', target: 'field', id: f.id, startX: e.clientX, startY: e.clientY, ox: f.box.x, oy: f.box.y, moved: false })}
              onDoubleClick={(e) => {
                e.stopPropagation()
                onFieldFill(f)
              }}
            >
              {selected &&
                toolbar(
                  (e) => startDrag(e, { kind: 'move', target: 'field', id: f.id, startX: e.clientX, startY: e.clientY, ox: f.box.x, oy: f.box.y, moved: true }),
                  () => onFieldRemove(f.id),
                  <button
                    type="button"
                    title="Type here"
                    aria-label="Type here"
                    className="flex h-6 w-7 items-center justify-center rounded hover:bg-white/15"
                    onClick={() => onFieldFill(f)}
                  >
                    <Type className="h-3.5 w-3.5" />
                  </button>,
                )}
              {selected && handle((e) => startDrag(e, { kind: 'resize', target: 'field', id: f.id, startX: e.clientX, startY: e.clientY, origin: f.box }))}
            </div>
          )
        })}

      {scale > 0 &&
        itemRects.map(({ item, rect }) => {
          const selected = item.id === selectedId
          const left = rect.x * pxW
          const top = rect.y * pxH
          const w = rect.width * pxW
          const h = rect.height * pxH
          const bar =
            selected &&
            toolbar(
              (e) => startDrag(e, { kind: 'move', target: 'item', id: item.id, startX: e.clientX, startY: e.clientY, ox: item.x, oy: item.y, moved: true }),
              () => onRemove(item.id),
            )
          const grip =
            selected &&
            handle((e) =>
              startDrag(e, {
                kind: 'resize',
                target: 'item',
                id: item.id,
                startX: e.clientX,
                startY: e.clientY,
                origin: rect,
                size: item.kind === 'text' ? item.size : undefined,
              }),
            )

          if (item.kind === 'image') {
            return (
              <div
                key={item.id}
                className={cx('absolute', selected ? 'ring-2 ring-brand-500' : 'hover:ring-2 hover:ring-brand-300')}
                style={{ left, top, width: w, height: h, cursor: 'move' }}
                onPointerDown={(e) => startDrag(e, { kind: 'move', target: 'item', id: item.id, startX: e.clientX, startY: e.clientY, ox: item.x, oy: item.y, moved: false })}
              >
                <img src={item.url} alt="Signature" className="h-full w-full" draggable={false} />
                {bar}
                {grip}
              </div>
            )
          }

          const { px } = textBlockPx(item, height)
          const fontPx = px * scale
          const style = {
            fontFamily: item.font,
            fontWeight: item.bold ? 700 : 400,
            fontSize: fontPx,
            lineHeight: LINE_HEIGHT,
            color: item.color,
          }
          return (
            <div
              key={item.id}
              className={cx('absolute', selected ? 'ring-2 ring-brand-500' : 'hover:ring-2 hover:ring-brand-300')}
              style={{ left, top, width: Math.max(w, fontPx * 2), height: h, cursor: selected ? 'text' : 'move' }}
              onPointerDown={(e) => {
                if (selected) return
                startDrag(e, { kind: 'move', target: 'item', id: item.id, startX: e.clientX, startY: e.clientY, ox: item.x, oy: item.y, moved: false })
              }}
            >
              {selected ? (
                <textarea
                  ref={textareaRef}
                  value={item.text}
                  rows={item.text.split('\n').length}
                  spellCheck={false}
                  placeholder="Type here"
                  aria-label="Text on the form"
                  className="block h-full resize-none overflow-hidden whitespace-pre bg-transparent p-0 outline-none placeholder:text-slate-400/70"
                  style={{ ...style, width: Math.max(w, fontPx * 2) + fontPx }}
                  onChange={(e) => onChange(item.id, { text: e.target.value })}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="whitespace-pre" style={style}>
                  {item.text || <span className="text-slate-400/70">Type here</span>}
                </div>
              )}
              {bar}
              {grip}
            </div>
          )
        })}
    </div>
  )
}
