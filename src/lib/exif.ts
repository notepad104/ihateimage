/**
 * EXIF reader/writer for JPEG, PNG and WebP containers. Enough to display what
 * a photo reveals, strip it, or rewrite the common fields (camera, dates,
 * author, copyright, GPS) without touching the compressed image data.
 *
 * All three formats carry the same TIFF-structured EXIF payload:
 *   JPEG → APP1 segment prefixed with "Exif\0\0"
 *   PNG  → eXIf chunk (raw TIFF)
 *   WebP → EXIF chunk inside the RIFF container (raw TIFF)
 */

export type ExifValue = string | number | number[] | [number, number][]

export interface ExifEntry {
  tag: number
  name: string
  ifd: 'ifd0' | 'exif' | 'gps' | 'other'
  value: ExifValue
  display: string
}

export type Container = 'jpeg' | 'png' | 'webp'

export interface ParsedExif {
  container: Container | null
  entries: ExifEntry[]
  orientation?: number
  gps?: { lat: number; lon: number; alt?: number }
  /** Other metadata blocks present (XMP, IPTC, ICC, comments) */
  segments: string[]
}

const TAG_NAMES: Record<string, Record<number, string>> = {
  ifd0: {
    0x010e: 'Description',
    0x010f: 'Camera make',
    0x0110: 'Camera model',
    0x0112: 'Orientation',
    0x011a: 'X resolution',
    0x011b: 'Y resolution',
    0x0128: 'Resolution unit',
    0x0131: 'Software',
    0x0132: 'Modified',
    0x013b: 'Artist',
    0x8298: 'Copyright',
  },
  exif: {
    0x829a: 'Exposure time',
    0x829d: 'F-number',
    0x8827: 'ISO',
    0x9000: 'Exif version',
    0x9003: 'Date taken',
    0x9004: 'Date digitized',
    0x9204: 'Exposure bias',
    0x9209: 'Flash',
    0x920a: 'Focal length',
    0x9286: 'User comment',
    0xa002: 'Pixel width',
    0xa003: 'Pixel height',
    0xa405: 'Focal length (35mm)',
    0xa420: 'Image unique ID',
    0xa430: 'Camera owner',
    0xa431: 'Body serial number',
    0xa433: 'Lens make',
    0xa434: 'Lens model',
    0xa435: 'Lens serial number',
  },
  gps: {
    0x0000: 'GPS version',
    0x0001: 'Latitude ref',
    0x0002: 'Latitude',
    0x0003: 'Longitude ref',
    0x0004: 'Longitude',
    0x0005: 'Altitude ref',
    0x0006: 'Altitude',
    0x0007: 'GPS time',
    0x001d: 'GPS date',
  },
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

function str(bytes: Uint8Array, start: number, len: number): string {
  let s = ''
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

export function detectContainer(bytes: Uint8Array): Container | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes[0] === 0x89 && str(bytes, 1, 3) === 'PNG') return 'png'
  if (str(bytes, 0, 4) === 'RIFF' && str(bytes, 8, 4) === 'WEBP') return 'webp'
  return null
}

/** Strip an optional "Exif\0\0" prefix so we always hand a bare TIFF to the parser. */
function bareTiff(payload: Uint8Array): Uint8Array {
  return str(payload, 0, 4) === 'Exif' ? payload.subarray(6) : payload
}

// ---------- container: JPEG ----------

interface JpegSegment {
  marker: number
  start: number
  end: number
  data: Uint8Array
}

function readJpegSegments(bytes: Uint8Array): { segments: JpegSegment[]; scanStart: number } {
  const segments: JpegSegment[] = []
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) break
    const marker = bytes[pos + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2
      continue
    }
    if (marker === 0xda) return { segments, scanStart: pos }
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3]
    segments.push({ marker, start: pos, end: pos + 2 + len, data: bytes.subarray(pos + 4, pos + 2 + len) })
    pos += 2 + len
  }
  return { segments, scanStart: pos }
}

const jpegIs = {
  exif: (s: JpegSegment) => s.marker === 0xe1 && str(s.data, 0, 4) === 'Exif',
  xmp: (s: JpegSegment) => s.marker === 0xe1 && str(s.data, 0, 28) === 'http://ns.adobe.com/xap/1.0/',
  icc: (s: JpegSegment) => s.marker === 0xe2 && str(s.data, 0, 11) === 'ICC_PROFILE',
  iptc: (s: JpegSegment) => s.marker === 0xed,
  comment: (s: JpegSegment) => s.marker === 0xfe,
}

// ---------- container: PNG ----------

interface PngChunk {
  type: string
  start: number
  end: number
  data: Uint8Array
}

function readPngChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = []
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const len = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]
    const type = str(bytes, pos + 4, 4)
    const end = pos + 12 + len
    chunks.push({ type, start: pos, end, data: bytes.subarray(pos + 8, pos + 8 + len) })
    pos = end
    if (type === 'IEND') break
  }
  return chunks
}

let crcTable: Uint32Array | null = null
function crc32(...parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const p of parts) for (let i = 0; i < p.length; i++) crc = crcTable[(crc ^ p[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length, false)
  const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
  out.set(t, 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(t, data), false)
  return out
}

const PNG_TEXT = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME'])

// ---------- container: WebP ----------

interface RiffChunk {
  fourcc: string
  start: number
  end: number // includes padding
  data: Uint8Array
}

function readRiffChunks(bytes: Uint8Array): RiffChunk[] {
  const chunks: RiffChunk[] = []
  let pos = 12
  while (pos + 8 <= bytes.length) {
    const fourcc = str(bytes, pos, 4)
    const size = bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)
    const end = pos + 8 + size + (size % 2)
    chunks.push({ fourcc, start: pos, end: Math.min(end, bytes.length), data: bytes.subarray(pos + 8, pos + 8 + size) })
    pos = end
  }
  return chunks
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const padded = data.length + (data.length % 2)
  const out = new Uint8Array(8 + padded)
  out.set([...fourcc].map((c) => c.charCodeAt(0)), 0)
  new DataView(out.buffer).setUint32(4, data.length, true)
  out.set(data, 8)
  return out
}

// ---------- TIFF reading ----------

class TiffReader {
  view: DataView
  constructor(
    public buf: Uint8Array,
    public le: boolean,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  u16(o: number) {
    return this.view.getUint16(o, this.le)
  }
  u32(o: number) {
    return this.view.getUint32(o, this.le)
  }
  i32(o: number) {
    return this.view.getInt32(o, this.le)
  }
}

function readValue(r: TiffReader, type: number, count: number, valueOffset: number): ExifValue {
  const size = (TYPE_SIZE[type] ?? 1) * count
  const off = size <= 4 ? valueOffset : r.u32(valueOffset)
  if (off + size > r.buf.length) return ''
  switch (type) {
    case 2: {
      let s = ''
      for (let i = 0; i < count; i++) {
        const c = r.buf[off + i]
        if (c === 0) break
        s += String.fromCharCode(c)
      }
      return s.trim()
    }
    case 1:
    case 7: {
      const arr = Array.from(r.buf.subarray(off, off + count))
      if (type === 7 && count > 8) {
        const head = String.fromCharCode(...arr.slice(0, 5))
        if (head === 'ASCII' || head === 'UNICO') {
          return String.fromCharCode(...arr.slice(8).filter((b) => b >= 32 && b < 127)).trim()
        }
      }
      return count === 1 ? arr[0] : arr
    }
    case 3: {
      const arr = Array.from({ length: count }, (_, i) => r.u16(off + i * 2))
      return count === 1 ? arr[0] : arr
    }
    case 4:
    case 9: {
      const arr = Array.from({ length: count }, (_, i) => (type === 4 ? r.u32(off + i * 4) : r.i32(off + i * 4)))
      return count === 1 ? arr[0] : arr
    }
    case 5:
    case 10: {
      const arr: [number, number][] = Array.from({ length: count }, (_, i) =>
        type === 5
          ? [r.u32(off + i * 8), r.u32(off + i * 8 + 4)]
          : [r.i32(off + i * 8), r.i32(off + i * 8 + 4)],
      )
      return arr
    }
    default:
      return ''
  }
}

function rat(v: ExifValue, i = 0): number | null {
  if (!Array.isArray(v) || !Array.isArray(v[i])) return null
  const [n, d] = v[i] as [number, number]
  return d === 0 ? 0 : n / d
}

const ORIENTATIONS: Record<number, string> = {
  1: 'normal',
  2: 'mirrored',
  3: 'rotated 180°',
  4: 'flipped vertically',
  5: 'transposed',
  6: 'rotated 90° CW',
  7: 'transverse',
  8: 'rotated 90° CCW',
}

function display(tag: number, v: ExifValue, ifd: string): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') {
    if (ifd === 'ifd0' && tag === 0x0112) return `${v} (${ORIENTATIONS[v] ?? 'unknown'})`
    return String(v)
  }
  if (Array.isArray(v) && v.length && Array.isArray(v[0])) {
    const rats = v as [number, number][]
    if (ifd === 'gps' && (tag === 0x0002 || tag === 0x0004) && rats.length === 3) {
      return `${rat(v, 0)}° ${rat(v, 1)}' ${(rat(v, 2) ?? 0).toFixed(2)}"`
    }
    if (tag === 0x829a) {
      const t = rat(v) ?? 0
      return t < 1 && t > 0 ? `1/${Math.round(1 / t)} s` : `${t} s`
    }
    if (tag === 0x829d) return `f/${(rat(v) ?? 0).toFixed(1)}`
    if (tag === 0x920a) return `${(rat(v) ?? 0).toFixed(1)} mm`
    if (tag === 0x0006) return `${(rat(v) ?? 0).toFixed(1)} m`
    return rats.map(([n, d]) => (d === 1 ? String(n) : `${n}/${d}`)).join(', ')
  }
  if (Array.isArray(v)) {
    const arr = v as number[]
    if (ifd === 'exif' && tag === 0x9000 && arr.length === 4) {
      const s = String.fromCharCode(...arr)
      return `${s.slice(0, 2).replace(/^0/, '')}.${s.slice(2)}`
    }
    if (ifd === 'gps' && tag === 0x0000) return arr.join('.')
    return arr.slice(0, 16).join(', ') + (arr.length > 16 ? '…' : '')
  }
  return String(v)
}

function parseIfd(r: TiffReader, offset: number, ifd: 'ifd0' | 'exif' | 'gps', out: ExifEntry[]): Record<number, ExifValue> {
  const values: Record<number, ExifValue> = {}
  if (offset + 2 > r.buf.length) return values
  const count = r.u16(offset)
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12
    if (e + 12 > r.buf.length) break
    const tag = r.u16(e)
    const type = r.u16(e + 2)
    const n = r.u32(e + 4)
    if (!TYPE_SIZE[type] || n > 100000) continue
    const v = readValue(r, type, n, e + 8)
    values[tag] = v
    if (tag === 0x8769 || tag === 0x8825 || tag === 0xa005) continue
    const name = TAG_NAMES[ifd]?.[tag] ?? `Tag 0x${tag.toString(16).padStart(4, '0')}`
    out.push({ tag, name, ifd, value: v, display: display(tag, v, ifd) })
  }
  return values
}

function parseTiff(tiff: Uint8Array, result: ParsedExif) {
  if (tiff.length < 8) return
  const le = tiff[0] === 0x49 && tiff[1] === 0x49
  const r = new TiffReader(tiff, le)
  const ifd0Off = r.u32(4)
  const ifd0 = parseIfd(r, ifd0Off, 'ifd0', result.entries)
  if (typeof ifd0[0x0112] === 'number') result.orientation = ifd0[0x0112] as number
  if (typeof ifd0[0x8769] === 'number') parseIfd(r, ifd0[0x8769] as number, 'exif', result.entries)
  if (typeof ifd0[0x8825] === 'number') {
    const gps = parseIfd(r, ifd0[0x8825] as number, 'gps', result.entries)
    const lat = gps[0x0002]
    const lon = gps[0x0004]
    if (lat && lon && Array.isArray(lat) && Array.isArray(lon)) {
      const toDec = (v: ExifValue) => (rat(v, 0) ?? 0) + (rat(v, 1) ?? 0) / 60 + (rat(v, 2) ?? 0) / 3600
      let latD = toDec(lat)
      let lonD = toDec(lon)
      if (gps[0x0001] === 'S') latD = -latD
      if (gps[0x0003] === 'W') lonD = -lonD
      const altV = gps[0x0006]
      const alt = altV ? (rat(altV) ?? 0) * (gps[0x0005] === 1 ? -1 : 1) : undefined
      result.gps = { lat: latD, lon: lonD, alt }
    }
  }
}

export async function parseExif(file: Blob): Promise<ParsedExif> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const container = detectContainer(bytes)
  const result: ParsedExif = { container, entries: [], segments: [] }
  let tiff: Uint8Array | null = null

  if (container === 'jpeg') {
    const { segments } = readJpegSegments(bytes)
    for (const s of segments) {
      if (jpegIs.exif(s)) tiff = s.data.subarray(6)
      else if (jpegIs.xmp(s)) result.segments.push('XMP')
      else if (jpegIs.icc(s)) result.segments.push('ICC color profile')
      else if (jpegIs.iptc(s)) result.segments.push('IPTC / Photoshop')
      else if (jpegIs.comment(s)) result.segments.push('Comment')
    }
  } else if (container === 'png') {
    for (const c of readPngChunks(bytes)) {
      if (c.type === 'eXIf') tiff = bareTiff(c.data)
      else if (c.type === 'iCCP') result.segments.push('ICC color profile')
      else if (c.type === 'iTXt' && str(c.data, 0, 17) === 'XML:com.adobe.xmp') result.segments.push('XMP')
      else if (PNG_TEXT.has(c.type)) result.segments.push(c.type === 'tIME' ? 'Modification time' : 'Text')
    }
  } else if (container === 'webp') {
    for (const c of readRiffChunks(bytes)) {
      if (c.fourcc === 'EXIF') tiff = bareTiff(c.data)
      else if (c.fourcc === 'XMP ') result.segments.push('XMP')
      else if (c.fourcc === 'ICCP') result.segments.push('ICC color profile')
    }
  }

  result.segments = Array.from(new Set(result.segments))
  if (tiff) parseTiff(tiff, result)
  return result
}

// ---------- writing ----------

export interface ExifForm {
  description: string
  artist: string
  copyright: string
  make: string
  model: string
  software: string
  lensModel: string
  /** "YYYY-MM-DDTHH:MM" from a datetime-local input, or '' */
  dateTaken: string
  lat: string
  lon: string
  alt: string
}

export const EMPTY_FORM: ExifForm = {
  description: '',
  artist: '',
  copyright: '',
  make: '',
  model: '',
  software: '',
  lensModel: '',
  dateTaken: '',
  lat: '',
  lon: '',
  alt: '',
}

export function formFromParsed(p: ParsedExif): ExifForm {
  const get = (ifd: string, tag: number) => {
    const e = p.entries.find((x) => x.ifd === ifd && x.tag === tag)
    return e && typeof e.value === 'string' ? e.value : ''
  }
  const exifDate = get('exif', 0x9003) || get('ifd0', 0x0132)
  const m = exifDate.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
  return {
    description: get('ifd0', 0x010e),
    artist: get('ifd0', 0x013b),
    copyright: get('ifd0', 0x8298),
    make: get('ifd0', 0x010f),
    model: get('ifd0', 0x0110),
    software: get('ifd0', 0x0131),
    lensModel: get('exif', 0xa434),
    dateTaken: m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : '',
    lat: p.gps ? p.gps.lat.toFixed(6) : '',
    lon: p.gps ? p.gps.lon.toFixed(6) : '',
    alt: p.gps?.alt !== undefined ? String(Math.round(p.gps.alt * 10) / 10) : '',
  }
}

interface WEntry {
  tag: number
  type: number
  data: Uint8Array
  count: number
}

const enc = new TextEncoder()

function ascii(tag: number, s: string): WEntry {
  const bytes = enc.encode(s.replace(/[^\x20-\x7e]/g, '?') + '\0')
  return { tag, type: 2, data: bytes, count: bytes.length }
}
function u16(tag: number, v: number): WEntry {
  const d = new Uint8Array(2)
  new DataView(d.buffer).setUint16(0, v, false)
  return { tag, type: 3, data: d, count: 1 }
}
function u8(tag: number, v: number): WEntry {
  return { tag, type: 1, data: new Uint8Array([v]), count: 1 }
}
function rationals(tag: number, pairs: [number, number][]): WEntry {
  const d = new Uint8Array(pairs.length * 8)
  const dv = new DataView(d.buffer)
  pairs.forEach(([n, den], i) => {
    dv.setUint32(i * 8, n >>> 0, false)
    dv.setUint32(i * 8 + 4, den >>> 0, false)
  })
  return { tag, type: 5, data: d, count: pairs.length }
}
function u32(tag: number, v: number): WEntry {
  const d = new Uint8Array(4)
  new DataView(d.buffer).setUint32(0, v, false)
  return { tag, type: 4, data: d, count: 1 }
}

function ifdSize(entries: WEntry[]): number {
  let size = 2 + entries.length * 12 + 4
  for (const e of entries) if (e.data.length > 4) size += e.data.length + (e.data.length % 2)
  return size
}

function writeIfd(out: Uint8Array, at: number, entries: WEntry[]): void {
  const dv = new DataView(out.buffer, out.byteOffset)
  entries.sort((a, b) => a.tag - b.tag)
  dv.setUint16(at, entries.length, false)
  let dataPos = at + 2 + entries.length * 12 + 4
  entries.forEach((e, i) => {
    const o = at + 2 + i * 12
    dv.setUint16(o, e.tag, false)
    dv.setUint16(o + 2, e.type, false)
    dv.setUint32(o + 4, e.count, false)
    if (e.data.length <= 4) {
      out.set(e.data, o + 8)
    } else {
      dv.setUint32(o + 8, dataPos, false)
      out.set(e.data, dataPos)
      dataPos += e.data.length + (e.data.length % 2)
    }
  })
  dv.setUint32(at + 2 + entries.length * 12, 0, false)
}

function toDms(dec: number): [number, number][] {
  const a = Math.abs(dec)
  const d = Math.floor(a)
  const mFull = (a - d) * 60
  const m = Math.floor(mFull)
  const s = Math.round((mFull - m) * 60 * 10000)
  return [
    [d, 1],
    [m, 1],
    [s, 10000],
  ]
}

/** Build a bare TIFF/EXIF block (big-endian) from the form. */
export function buildTiff(form: ExifForm, orientation?: number): Uint8Array {
  const ifd0: WEntry[] = []
  const exif: WEntry[] = []
  const gps: WEntry[] = []

  if (form.description) ifd0.push(ascii(0x010e, form.description))
  if (form.make) ifd0.push(ascii(0x010f, form.make))
  if (form.model) ifd0.push(ascii(0x0110, form.model))
  if (orientation && orientation >= 1 && orientation <= 8) ifd0.push(u16(0x0112, orientation))
  if (form.software) ifd0.push(ascii(0x0131, form.software))
  if (form.artist) ifd0.push(ascii(0x013b, form.artist))
  if (form.copyright) ifd0.push(ascii(0x8298, form.copyright))

  if (form.dateTaken) {
    const m = form.dateTaken.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)
    if (m) {
      const s = `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`
      ifd0.push(ascii(0x0132, s))
      exif.push(ascii(0x9003, s), ascii(0x9004, s))
    }
  }
  if (form.lensModel) exif.push(ascii(0xa434, form.lensModel))
  exif.push({ tag: 0x9000, type: 7, data: enc.encode('0232'), count: 4 })

  const lat = parseFloat(form.lat)
  const lon = parseFloat(form.lon)
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    gps.push({ tag: 0x0000, type: 1, data: new Uint8Array([2, 3, 0, 0]), count: 4 })
    gps.push(ascii(0x0001, lat < 0 ? 'S' : 'N'))
    gps.push(rationals(0x0002, toDms(lat)))
    gps.push(ascii(0x0003, lon < 0 ? 'W' : 'E'))
    gps.push(rationals(0x0004, toDms(lon)))
    const alt = parseFloat(form.alt)
    if (Number.isFinite(alt)) {
      gps.push(u8(0x0005, alt < 0 ? 1 : 0))
      gps.push(rationals(0x0006, [[Math.round(Math.abs(alt) * 100), 100]]))
    }
  }

  const hasExif = exif.length > 0
  const hasGps = gps.length > 0
  const ifd0Entries = [...ifd0]
  if (hasExif) ifd0Entries.push(u32(0x8769, 0))
  if (hasGps) ifd0Entries.push(u32(0x8825, 0))
  const ifd0Off = 8
  const exifOff = ifd0Off + ifdSize(ifd0Entries)
  const gpsOff = exifOff + (hasExif ? ifdSize(exif) : 0)
  const total = gpsOff + (hasGps ? ifdSize(gps) : 0)
  for (const e of ifd0Entries) {
    if (e.tag === 0x8769) new DataView(e.data.buffer).setUint32(0, exifOff, false)
    if (e.tag === 0x8825) new DataView(e.data.buffer).setUint32(0, gpsOff, false)
  }

  const tiff = new Uint8Array(total)
  tiff.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08])
  writeIfd(tiff, ifd0Off, ifd0Entries)
  if (hasExif) writeIfd(tiff, exifOff, exif)
  if (hasGps) writeIfd(tiff, gpsOff, gps)
  return tiff
}

export interface RewriteOptions {
  /** null → strip EXIF entirely */
  form: ExifForm | null
  keepIcc: boolean
  /** Also drop XMP, IPTC, text chunks and comments */
  stripOther: boolean
  /** Pixel size of the image; needed to synthesize a WebP VP8X header */
  size: { width: number; height: number }
}

/** Returns a new file of the same container with metadata replaced. Image data is copied untouched. */
export async function rewriteMetadata(file: Blob, opts: RewriteOptions): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const container = detectContainer(bytes)
  if (!container) throw new Error('Unsupported container; only JPG, PNG and WebP can be edited in place')
  const parsed = opts.form ? await parseExif(file) : null
  const tiff = opts.form ? buildTiff(opts.form, parsed?.orientation) : null

  if (container === 'jpeg') return rewriteJpeg(bytes, tiff, opts)
  if (container === 'png') return rewritePng(bytes, tiff, opts)
  return rewriteWebp(bytes, tiff, opts)
}

function rewriteJpeg(bytes: Uint8Array, tiff: Uint8Array | null, opts: RewriteOptions): Blob {
  const { segments, scanStart } = readJpegSegments(bytes)
  const keep: Uint8Array[] = []
  let insertAfterApp0 = false
  for (const s of segments) {
    if (jpegIs.exif(s)) continue
    if (opts.stripOther && (jpegIs.xmp(s) || jpegIs.iptc(s) || jpegIs.comment(s))) continue
    if (!opts.keepIcc && jpegIs.icc(s)) continue
    keep.push(bytes.subarray(s.start, s.end))
    if (s.marker === 0xe0 && keep.length === 1) insertAfterApp0 = true
  }
  let exifSeg: Uint8Array | null = null
  if (tiff) {
    const payload = new Uint8Array(6 + tiff.length)
    payload.set(EXIF_HEADER)
    payload.set(tiff, 6)
    exifSeg = new Uint8Array(4 + payload.length)
    exifSeg.set([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff])
    exifSeg.set(payload, 4)
  }
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  if (exifSeg && !insertAfterApp0) parts.push(exifSeg)
  keep.forEach((k, i) => {
    parts.push(k)
    if (exifSeg && insertAfterApp0 && i === 0) parts.push(exifSeg)
  })
  parts.push(bytes.subarray(scanStart))
  return new Blob(parts as BlobPart[], { type: 'image/jpeg' })
}

function rewritePng(bytes: Uint8Array, tiff: Uint8Array | null, opts: RewriteOptions): Blob {
  const chunks = readPngChunks(bytes)
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  for (const c of chunks) {
    if (c.type === 'eXIf') continue
    if (opts.stripOther && PNG_TEXT.has(c.type)) continue
    if (!opts.keepIcc && c.type === 'iCCP') continue
    parts.push(bytes.subarray(c.start, c.end))
    if (c.type === 'IHDR' && tiff) parts.push(pngChunk('eXIf', tiff))
  }
  return new Blob(parts as BlobPart[], { type: 'image/png' })
}

function rewriteWebp(bytes: Uint8Array, tiff: Uint8Array | null, opts: RewriteOptions): Blob {
  const chunks = readRiffChunks(bytes)
  const body: Uint8Array[] = []
  let vp8x: Uint8Array | null = null
  const rest: RiffChunk[] = []
  for (const c of chunks) {
    if (c.fourcc === 'VP8X') vp8x = new Uint8Array(c.data)
    else if (c.fourcc === 'EXIF') continue
    else if (opts.stripOther && c.fourcc === 'XMP ') continue
    else if (!opts.keepIcc && c.fourcc === 'ICCP') continue
    else rest.push(c)
  }
  if (!vp8x) {
    // Simple (non-extended) file: synthesize the VP8X header the spec requires for metadata.
    vp8x = new Uint8Array(10)
    const first = rest.find((c) => c.fourcc === 'VP8L' || c.fourcc === 'VP8 ')
    let alpha = false
    if (first?.fourcc === 'VP8L' && first.data.length >= 5) {
      const bits = first.data[1] | (first.data[2] << 8) | (first.data[3] << 16) | (first.data[4] << 24)
      alpha = ((bits >>> 28) & 1) === 1
    }
    if (alpha) vp8x[0] |= 0x10
    const w = opts.size.width - 1
    const h = opts.size.height - 1
    vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4)
  }
  // Flags: ICC 0x20, Alpha 0x10, EXIF 0x08, XMP 0x04, Animation 0x02
  vp8x[0] = tiff ? vp8x[0] | 0x08 : vp8x[0] & ~0x08
  if (opts.stripOther) vp8x[0] &= ~0x04
  if (!opts.keepIcc) vp8x[0] &= ~0x20
  if (!rest.some((c) => c.fourcc === 'ICCP')) vp8x[0] &= ~0x20

  body.push(riffChunk('VP8X', vp8x))
  for (const c of rest) body.push(bytes.subarray(c.start, c.end))
  if (tiff) body.push(riffChunk('EXIF', tiff))

  const size = body.reduce((s, p) => s + p.length, 0) + 4
  const header = new Uint8Array(12)
  header.set([0x52, 0x49, 0x46, 0x46]) // RIFF
  new DataView(header.buffer).setUint32(4, size, true)
  header.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return new Blob([header, ...body] as BlobPart[], { type: 'image/webp' })
}

export const EDITABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
