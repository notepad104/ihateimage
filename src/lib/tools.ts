import type { LucideIcon } from 'lucide-react'
import {
  Crop,
  Eraser,
  FileOutput,
  MapPinOff,
  Maximize2,
  Minimize2,
  RotateCw,
  ScanLine,
  Sparkles,
  Stamp,
  Wand2,
} from 'lucide-react'

export interface ToolDef {
  id: string
  path: string
  name: string
  tagline: string
  description: string
  icon: LucideIcon
  /** Tailwind classes for the icon tile */
  tint: string
}

export const TOOLS: ToolDef[] = [
  {
    id: 'compress',
    path: '/compress',
    name: 'Compress image',
    tagline: 'Shrink file size, keep the quality',
    description:
      'Reduce JPG, PNG, WebP and AVIF file sizes with a quality slider or a target file size. Great for email, web and messaging.',
    icon: Minimize2,
    tint: 'bg-emerald-100 text-emerald-700',
  },
  {
    id: 'resize',
    path: '/resize',
    name: 'Resize image',
    tagline: 'Set exact pixels or a percentage',
    description: 'Change width and height in pixels or by percentage, in bulk. Lock the aspect ratio or fit inside a box.',
    icon: Maximize2,
    tint: 'bg-sky-100 text-sky-700',
  },
  {
    id: 'aspect',
    path: '/aspect-ratio',
    name: 'Change aspect ratio',
    tagline: 'Crop or pad to 1:1, 16:9, 4:5 …',
    description:
      'Crop to a new ratio with a draggable frame, or add borders so nothing is cut off. Perfect for social media sizes.',
    icon: Crop,
    tint: 'bg-violet-100 text-violet-700',
  },
  {
    id: 'convert',
    path: '/convert',
    name: 'Convert format',
    tagline: 'JPG, PNG, WebP and AVIF',
    description: 'Convert between JPG, PNG, WebP and AVIF, or turn an SVG into a bitmap. Pick a background color when dropping transparency.',
    icon: FileOutput,
    tint: 'bg-amber-100 text-amber-700',
  },
  {
    id: 'rotate',
    path: '/rotate',
    name: 'Rotate & flip',
    tagline: 'Turn 90°, 180°, mirror',
    description: 'Rotate in 90° steps and mirror horizontally or vertically. Fixes sideways photos in one click.',
    icon: RotateCw,
    tint: 'bg-rose-100 text-rose-700',
  },
  {
    id: 'scan',
    path: '/scan-document',
    name: 'Scan document',
    tagline: 'Photo → flat, clean scan',
    description:
      'Photograph a page, receipt or whiteboard. The edges are found automatically, the perspective is straightened and the paper is whitened, like a scanner app, on your device.',
    icon: ScanLine,
    tint: 'bg-orange-100 text-orange-700',
  },
  {
    id: 'remove-bg',
    path: '/remove-background',
    name: 'Remove background',
    tagline: 'AI cut-out, right in your browser',
    description:
      'Automatically remove the background from photos of people, products and objects. The AI model runs on your device.',
    icon: Eraser,
    tint: 'bg-fuchsia-100 text-fuchsia-700',
  },
  {
    id: 'beautify',
    path: '/beautify',
    name: 'Beautify image',
    tagline: 'Light, color, filters, recolor',
    description:
      'Fix exposure and white balance, boost colors, apply one-tap looks, and swap a specific color for another with the eyedropper.',
    icon: Sparkles,
    tint: 'bg-pink-100 text-pink-700',
  },
  {
    id: 'remove-objects',
    path: '/remove-objects',
    name: 'Remove objects',
    tagline: 'Brush away people, text, blemishes',
    description:
      'Paint over anything unwanted and the background is rebuilt from its surroundings, with a fast pattern-matching fill or an on-device AI model.',
    icon: Wand2,
    tint: 'bg-teal-100 text-teal-700',
  },
  {
    id: 'watermark',
    path: '/watermark',
    name: 'Add watermark',
    tagline: 'Text or logo, anywhere, in bulk',
    description:
      'Stamp text or your logo on photos. Pick a corner, drag it into place, or tile it across the image. Same relative size on every photo.',
    icon: Stamp,
    tint: 'bg-cyan-100 text-cyan-700',
  },
  {
    id: 'metadata',
    path: '/metadata',
    name: 'Edit EXIF & GPS',
    tagline: 'View, strip or rewrite metadata',
    description:
      'See what your photo reveals: location, camera, date. Remove it all or replace it with your own values. JPG, PNG and WebP are edited in place without re-encoding.',
    icon: MapPinOff,
    tint: 'bg-slate-200 text-slate-700',
  },
]

export function toolById(id: string): ToolDef {
  const t = TOOLS.find((x) => x.id === id)
  if (!t) throw new Error(`Unknown tool ${id}`)
  return t
}
