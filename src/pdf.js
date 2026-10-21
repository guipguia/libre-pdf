// All PDF operations. Pure: files in, files out ({ name, data: Uint8Array }). Runs in a Web Worker (worker.js)
// and in Node for tests, so nothing here may touch the DOM.
import {
  PDFArray, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, StandardFonts, decodePDFRawStream, degrees, rgb,
} from '@cantoo/pdf-lib'
import { zlibSync } from 'fflate'
import { LineCapStyle } from '@cantoo/pdf-lib'

const MM = 72 / 25.4

export const base = (name) => name.replace(/\.[^.]+$/, '')
const out = async (name, doc) => ({ name, data: await doc.save() })

export async function load({ name, data }, password) {
  if (String.fromCharCode(...data.subarray(0, 1024)).indexOf('%PDF-') < 0) throw new Error(`${name} is not a PDF.`)
  try {
    return await PDFDocument.load(data, password === undefined ? {} : { password })
  } catch (err) {
    if (password === undefined && /encrypt/i.test(err.message)) {
      throw new Error(`${name} is password-protected. Remove the password first with "Unlock PDF".`)
    }
    if (password !== undefined && /password/i.test(err.message)) throw new Error(`Wrong password for ${name}.`)
    throw new Error(`Could not read ${name}: ${err.message}`)
  }
}

/** "1-3, 5, 8-" -> [[0,1,2],[4],[7,...,count-1]] (0-based). Throws on pages outside 1..count. */
export function parseRanges(text, count) {
  const ranges = text.split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^(\d*)\s*(?:(-)\s*(\d*))?$/)
    if (!m || (!m[1] && !m[3])) throw new Error(`"${part}" is not a page or range.`)
    const from = m[1] ? +m[1] : 1
    const to = m[2] ? (m[3] ? +m[3] : count) : from
    if (from < 1 || to > count || from > to) throw new Error(`"${part}" is outside pages 1–${count}.`)
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
  })
  if (!ranges.length) throw new Error('Enter at least one page or range.')
  return ranges
}

// New document made of `pages` ([{ i, rot }]) of `src`, in that order, each turned by `rot` extra degrees.
async function pick(src, pages) {
  const doc = await PDFDocument.create()
  const copied = await doc.copyPages(src, pages.map((p) => p.i))
  copied.forEach((page, k) => {
    if (pages[k].rot) page.setRotation(degrees((page.getRotation().angle + pages[k].rot) % 360))
    doc.addPage(page)
  })
  return doc
}

/** Map a point measured on the page as the reader sees it (after /Rotate) to PDF user space. */
export function place(box, angle, vx, vy) {
  const { x, y, width: w, height: h } = box
  const r = ((angle % 360) + 360) % 360
  const [px, py] = r === 90 ? [w - vy, vx] : r === 180 ? [w - vx, h - vy] : r === 270 ? [vy, h - vx] : [vx, vy]
  return { x: x + px, y: y + py, rotate: degrees(r) }
}

// Page size as the reader sees it.
function view(page) {
  const box = page.getCropBox()
  const angle = page.getRotation().angle
  const turned = angle % 180 !== 0
  return { box, angle, width: turned ? box.height : box.width, height: turned ? box.width : box.height }
}

export async function merge(files) {
  if (files.length < 2) throw new Error('Add at least two PDFs to merge.')
  const doc = await PDFDocument.create()
  for (const file of files) {
    const src = await load(file)
    for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page)
  }
  return [await out('merged.pdf', doc)]
}

export async function split([file], { mode, ranges, every }) {
  const src = await load(file)
  const count = src.getPageCount()
  let groups
  if (mode === 'ranges') groups = parseRanges(ranges, count)
  else {
    const n = Math.max(1, Math.floor(+every || 1))
    groups = Array.from({ length: Math.ceil(count / n) }, (_, g) =>
      Array.from({ length: Math.min(n, count - g * n) }, (_, k) => g * n + k))
  }
  const label = (g) => (g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g.at(-1) + 1}`)
  return Promise.all(groups.map(async (g) => out(`${base(file.name)}_${label(g)}.pdf`, await pick(src, g.map((i) => ({ i }))))))
}

/** Remove / extract / organize: `pages` is the final list of [{ i, rot }]. */
export async function pages([file], { pages, suffix }) {
  if (!pages?.length) throw new Error('No pages left — keep at least one page.')
  return [await out(`${base(file.name)}_${suffix}.pdf`, await pick(await load(file), pages))]
}

export async function rotate(files, { angle }) {
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    for (const page of doc.getPages()) page.setRotation(degrees((page.getRotation().angle + +angle + 360) % 360))
    return out(`${base(file.name)}_rotated.pdf`, doc)
  }))
}

export async function pageNumbers(files, { position, start, format, size, from }) {
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const all = doc.getPages()
    const first = Math.max(1, +from || 1)
    all.forEach((page, k) => {
      if (k + 1 < first) return
      const text = format.replace('{n}', +start + k - first + 1).replace('{total}', all.length - first + +start)
      const v = view(page)
      const tw = font.widthOfTextAtSize(text, +size)
      const margin = 10 * MM
      const [vert, horiz] = position.split('-')
      const vx = horiz === 'left' ? margin : horiz === 'right' ? v.width - margin - tw : (v.width - tw) / 2
      const vy = vert === 'top' ? v.height - margin - +size : margin
      page.drawText(text, { ...place(v.box, v.angle, vx, vy), size: +size, font, color: rgb(0, 0, 0) })
    })
    return out(`${base(file.name)}_numbered.pdf`, doc)
  }))
}

// The standard fonts only cover Western European text, and pdf-lib silently prints "?" for anything else.
function checkText(font, text) {
  const set = new Set(font.getCharacterSet())
  const bad = [...text].filter((c) => !set.has(c.codePointAt(0)) && !/\s/.test(c))
  if (bad.length) throw new Error(`The built-in font cannot show "${[...new Set(bad)].join('')}" (it covers Western European languages).`)
}

const hex = (c) => rgb(...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255))

export async function watermark(files, { text, size, opacity, angle, color }) {
  if (!text.trim()) throw new Error('Enter the watermark text.')
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    const font = await doc.embedFont(StandardFonts.HelveticaBold)
    checkText(font, text)
    const tw = font.widthOfTextAtSize(text, +size)
    const a = (+angle * Math.PI) / 180
    for (const page of doc.getPages()) {
      const v = view(page)
      // Start point so the text's middle lands on the page centre.
      const vx = v.width / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * +size) / 3
      const vy = v.height / 2 - (Math.sin(a) * tw) / 2 - (Math.cos(a) * +size) / 3
      const p = place(v.box, v.angle, vx, vy)
      page.drawText(text, { x: p.x, y: p.y, rotate: degrees(v.angle + +angle), size: +size, font, color: hex(color), opacity: +opacity })
    }
    return out(`${base(file.name)}_watermarked.pdf`, doc)
  }))
}

export async function crop(files, { top, right, bottom, left }) {
  const [t, r, b, l] = [top, right, bottom, left].map((m) => Math.max(0, +m || 0) * MM)
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    for (const page of doc.getPages()) {
      const v = view(page)
      if (l + r >= v.width || t + b >= v.height) throw new Error(`Margins are larger than the page in ${file.name}.`)
      const p1 = place(v.box, v.angle, l, b)
      const p2 = place(v.box, v.angle, v.width - r, v.height - t)
      const x = Math.min(p1.x, p2.x)
      const y = Math.min(p1.y, p2.y)
      page.setCropBox(x, y, Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y))
    }
    return out(`${base(file.name)}_cropped.pdf`, doc)
  }))
}

/** EXIF orientation of a JPEG (1 when absent). Only 3, 6 and 8 (pure rotations) are acted on. */
export function jpegOrientation(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  if (dv.getUint16(0) !== 0xffd8) return 1
  for (let o = 2; o + 4 < d.length;) {
    const marker = dv.getUint16(o)
    const len = dv.getUint16(o + 2)
    if (marker === 0xffe1 && dv.getUint32(o + 4) === 0x45786966) { // "Exif"
      const t = o + 10
      const le = dv.getUint16(t) === 0x4949
      const ifd = t + dv.getUint32(t + 4, le)
      for (let k = 0, n = dv.getUint16(ifd, le); k < n; k++) {
        const e = ifd + 2 + k * 12
        if (dv.getUint16(e, le) === 0x0112) return dv.getUint16(e + 8, le)
      }
      return 1
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1
    o += 2 + len
  }
  return 1
}

const SIZES = { A4: [595.28, 841.89], Letter: [612, 792] }

/** Images -> one PDF. JPG and PNG are embedded as-is; the worker converts other formats to PNG first. */
export async function imagesToPdf(files, { size, orientation, margin }) {
  const doc = await PDFDocument.create()
  const m = +margin
  for (const file of files) {
    const isPng = file.data[0] === 0x89 && file.data[1] === 0x50
    const img = isPng ? await doc.embedPng(file.data) : await doc.embedJpg(file.data)
    const o = isPng ? 1 : jpegOrientation(file.data)
    const sideways = o === 6 || o === 8
    const [iw, ih] = sideways ? [img.height, img.width] : [img.width, img.height] // as displayed
    let pw, ph
    if (size === 'fit') [pw, ph] = [iw + 2 * m, ih + 2 * m]
    else {
      ;[pw, ph] = SIZES[size]
      const landscape = orientation === 'landscape' || (orientation === 'auto' && iw > ih)
      if (landscape) [pw, ph] = [ph, pw]
    }
    const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih, size === 'fit' ? 1 : Infinity)
    const [w, h] = [iw * s, ih * s] // displayed size on the page
    const [bx, by] = [(pw - w) / 2, (ph - h) / 2]
    const page = doc.addPage([pw, ph])
    if (o === 6) page.drawImage(img, { x: bx, y: by + h, width: h, height: w, rotate: degrees(-90) })
    else if (o === 8) page.drawImage(img, { x: bx + w, y: by, width: h, height: w, rotate: degrees(90) })
    else if (o === 3) page.drawImage(img, { x: bx + w, y: by + h, width: w, height: h, rotate: degrees(180) })
    else page.drawImage(img, { x: bx, y: by, width: w, height: h })
  }
  return [await out(files.length === 1 ? `${base(files[0].name)}.pdf` : 'images.pdf', doc)]
}

export async function protect(files, { password, confirm }) {
  if (!password) throw new Error('Enter a password.')
  if (password !== confirm) throw new Error('The passwords do not match.')
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    doc.encrypt({ userPassword: password, ownerPassword: password })
    return out(`${base(file.name)}_protected.pdf`, doc)
  }))
}

export async function unlock(files, { password }) {
  return Promise.all(files.map(async (file) => {
    const doc = await load(file, password ?? '')
    // pdf-lib drops /Encrypt from the trailer but keeps the dictionary object, which later readers trip over.
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFStream ? obj.dict : obj
      if (dict instanceof PDFDict && dict.get(PDFName.of('Filter')) === PDFName.of('Standard') && dict.has(PDFName.of('U'))) doc.context.delete(ref)
    }
    return out(`${base(file.name)}_unlocked.pdf`, doc)
  }))
}

/** Sign: stamp a PNG at `marks` ([{ page, x, y, w }]: top-left corner and width as fractions of the visible page). */
export async function stamp([file], { image, marks }) {
  if (!marks?.length) throw new Error('Click on a page to place your signature.')
  const doc = await load(file)
  const img = await doc.embedPng(image)
  for (const m of marks) {
    const page = doc.getPage(m.page)
    const v = view(page)
    const w = m.w * v.width
    const h = (w * img.height) / img.width
    page.drawImage(img, { ...place(v.box, v.angle, m.x * v.width, v.height - m.y * v.height - h), width: w, height: h })
  }
  return [await out(`${base(file.name)}_signed.pdf`, doc)]
}

/** OCR: lay each one-page text-only PDF from Tesseract (`layers`: [{ i, data }]) over page i, stretched to fit. */
export async function textLayer([file], { layers }) {
  const doc = await load(file)
  for (const { i, data } of layers) {
    const [layer] = await doc.embedPdf(data, [0])
    const page = doc.getPage(i)
    const v = view(page)
    page.drawPage(layer, { ...place(v.box, v.angle, 0, 0), width: v.width, height: v.height })
  }
  return [await out(`${base(file.name)}_ocr.pdf`, doc)]
}

const N = PDFName.of
const LEVELS = { low: { quality: 0.85, maxSide: 3000 }, medium: { quality: 0.7, maxSide: 2000 }, high: { quality: 0.5, maxSide: 1200 } }

// Delete objects nothing points to (left behind by edits and incremental saves); pdf-lib writes every object it has.
export function prune(ctx) {
  const seen = new Set()
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info]
  while (stack.length) {
    const o = stack.pop()
    if (o instanceof PDFRef) {
      if (!seen.has(o)) { seen.add(o); stack.push(ctx.lookup(o)) }
    } else if (o instanceof PDFArray) stack.push(...o.asArray())
    else if (o instanceof PDFDict) stack.push(...o.values())
    else if (o instanceof PDFStream) stack.push(...o.dict.values())
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) ctx.delete(ref)
}

// Colour components of an image colour space we can safely redraw (Gray, RGB, or ICC with 1 or 3), else 0.
function components(ctx, cs) {
  if (cs === N('DeviceGray')) return 1
  if (cs === N('DeviceRGB')) return 3
  if (cs instanceof PDFArray && cs.get(0) === N('ICCBased')) {
    const n = ctx.lookup(cs.get(1))?.dict?.get(N('N'))
    return n instanceof PDFNumber && [1, 3].includes(n.asNumber()) ? n.asNumber() : 0
  }
  return 0
}

// Re-encode one big image as a smaller JPEG (browser only: needs OffscreenCanvas). Skips anything unusual.
async function shrinkImage(ctx, ref, obj, { quality, maxSide }) {
  const d = obj.dict
  if (d.get(N('Subtype')) !== N('Image') || d.has(N('ImageMask')) || d.has(N('Mask')) || d.has(N('Decode'))) return
  const [w, h, bpc] = ['Width', 'Height', 'BitsPerComponent'].map((k) => d.lookup(N(k))?.asNumber?.())
  if (!(w * h >= 40_000)) return
  const n = components(ctx, d.lookup(N('ColorSpace')))
  const filter = d.lookup(N('Filter'))
  let bitmap
  if (filter === N('DCTDecode') && n) bitmap = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' })).catch(() => null)
  else if (filter === N('FlateDecode') && n && bpc === 8 && !d.has(N('DecodeParms'))) {
    const px = decodePDFRawStream(obj).decode()
    if (px.length < w * h * n) return
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0, j = 0; i < w * h; i++, j += n) {
      rgba[i * 4] = px[j]
      rgba[i * 4 + 1] = px[n === 1 ? j : j + 1]
      rgba[i * 4 + 2] = px[n === 1 ? j : j + 2]
      rgba[i * 4 + 3] = 255
    }
    bitmap = await createImageBitmap(new ImageData(rgba, w, h))
  }
  if (!bitmap) return
  const s = Math.min(1, maxSide / Math.max(w, h))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const jpg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer())
  if (jpg.length >= obj.contents.length) return
  const dict = { Type: 'XObject', Subtype: 'Image', Width: canvas.width, Height: canvas.height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }
  const smask = d.get(N('SMask'))
  const stream = ctx.stream(jpg, dict)
  if (smask) stream.dict.set(N('SMask'), smask)
  ctx.assign(ref, stream)
}

export async function compress(files, { level }) {
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    const ctx = doc.context
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue
      if (typeof OffscreenCanvas !== 'undefined') await shrinkImage(ctx, ref, obj, LEVELS[level])
      // Streams stored uncompressed: deflate them (lossless).
      const now = ctx.lookup(ref)
      if (now === obj && !obj.dict.has(N('Filter')) && obj.contents.length > 256) {
        obj.dict.set(N('Filter'), N('FlateDecode'))
        ctx.assign(ref, PDFRawStream.of(obj.dict, zlibSync(obj.contents)))
      }
    }
    prune(ctx)
    const data = await doc.save({ useObjectStreams: true })
    // Never hand back a bigger file.
    return { name: `${base(file.name)}_compressed.pdf`, data: data.length < file.data.length ? data : file.data }
  }))
}

/** Rewrite the file from scratch: pdf-lib parses objects one by one and ignores a broken cross-reference table. */
export async function repair(files) {
  return Promise.all(files.map(async (file) => {
    const doc = await load(file)
    if (!doc.getPageCount()) throw new Error(`No pages could be recovered from ${file.name}.`)
    prune(doc.context)
    return out(`${base(file.name)}_repaired.pdf`, doc)
  }))
}

/**
 * Redact: replace pages with flat images (`pages`: [{ i, data: JPEG, width, height }] in points) so no text, vector or
 * hidden content of those pages survives. Form fields on them go too; `clean` also drops metadata, bookmarks and attachments.
 */
export async function replacePages([file], { pages, clean, suffix }) {
  const doc = await load(file)
  const form = doc.getForm()
  for (const { i, data, width, height } of pages) {
    const annots = doc.getPage(i).node.Annots()?.asArray() ?? []
    for (const field of form.getFields()) {
      if (field.acroField.getWidgets().some((w) => annots.includes(doc.context.getObjectRef(w.dict)))) form.removeField(field)
    }
    const img = await doc.embedJpg(data)
    doc.insertPage(i, [width, height]).drawImage(img, { x: 0, y: 0, width, height })
    doc.removePage(i + 1)
  }
  if (clean) {
    const info = doc.getInfoDict()
    for (const key of info.keys()) info.delete(key)
    for (const key of ['Metadata', 'Outlines', 'Names']) doc.catalog.delete(N(key))
  }
  prune(doc.context)
  return [await out(`${base(file.name)}_${suffix}.pdf`, doc)]
}

/**
 * Edit PDF: draw `objects` ([{ page, type, ... }]) measured in points from the visible page's top-left corner.
 * Shapes become SVG paths (y down), drawn from that corner so they follow page rotation.
 */
export async function edit([file], { objects }) {
  if (!objects?.length) throw new Error('Add something to a page first.')
  const doc = await load(file)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const images = new Map()
  for (const o of objects) {
    const page = doc.getPage(o.page)
    const v = view(page)
    const corner = place(v.box, v.angle, 0, v.height)
    const path = (d, style) => page.drawSvgPath(d, { x: corner.x, y: corner.y, rotate: corner.rotate, ...style })
    const stroke = { borderColor: hex(o.color ?? '#000000'), borderWidth: +o.width || 1, borderLineCap: LineCapStyle.Round }
    const box = `M${o.x} ${o.y}h${o.w}v${o.h}h${-o.w}Z`
    if (o.type === 'rect') path(box, { ...stroke, ...(o.fill && { color: hex(o.color) }) })
    else if (o.type === 'highlight') path(box, { color: hex(o.color), opacity: 0.35 })
    else if (o.type === 'whiteout') path(box, { color: rgb(1, 1, 1) })
    else if (o.type === 'ellipse') {
      const [rx, ry, cx, cy] = [o.w / 2, o.h / 2, o.x + o.w / 2, o.y + o.h / 2]
      path(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`, { ...stroke, ...(o.fill && { color: hex(o.color) }) })
    } else if (o.type === 'line') path(`M${o.x1} ${o.y1}L${o.x2} ${o.y2}`, stroke)
    else if (o.type === 'pen') path(`M${o.points.map((p) => p.join(' ')).join('L')}`, stroke)
    else if (o.type === 'text') {
      checkText(font, o.text)
      o.text.split('\n').forEach((line, i) => {
        page.drawText(line, { ...place(v.box, v.angle, o.x, v.height - o.y - o.size * (0.8 + i * 1.2)), size: +o.size, font, color: hex(o.color) })
      })
    } else if (o.type === 'image') {
      if (!images.has(o.data)) images.set(o.data, await doc.embedPng(o.data))
      page.drawImage(images.get(o.data), { ...place(v.box, v.angle, o.x, v.height - o.y - o.h), width: o.w, height: o.h })
    }
  }
  return [await out(`${base(file.name)}_edited.pdf`, doc)]
}

const FIELD_TYPES = [[PDFTextField, 'text'], [PDFCheckBox, 'checkbox'], [PDFRadioGroup, 'radio'], [PDFDropdown, 'dropdown'], [PDFOptionList, 'list']]

/** The fillable fields of a PDF: [{ name, type, value, options }]. Buttons and signature fields are left out. */
export async function formFields([file]) {
  const doc = await load(file)
  return doc.getForm().getFields().flatMap((f) => {
    const type = FIELD_TYPES.find(([T]) => f instanceof T)?.[1]
    if (!type || f.isReadOnly()) return []
    const value = type === 'text' ? f.getText() ?? '' : type === 'checkbox' ? f.isChecked() : type === 'radio' ? f.getSelected() ?? '' : f.getSelected()[0] ?? ''
    return [{ name: f.getName(), type, value, options: f.getOptions?.() ?? [], multiline: type === 'text' && f.isMultiline() }]
  })
}

/**
 * mode 'fill': set `values` ({ name: value }), optionally `flatten` (fields become plain page content).
 * mode 'create': add `fields` ([{ page, x, y, w, h, type: 'text' | 'multiline' | 'checkbox', name }], fractions of the visible page).
 * ponytail: new fields on rotated pages sit in the right place but their text is not turned with the page.
 */
export async function form([file], { mode, values, flatten, fields }) {
  const doc = await load(file)
  const pdfForm = doc.getForm()
  if (mode === 'fill') {
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const [name, value] of Object.entries(values ?? {})) {
      const f = pdfForm.getField(name)
      if (f instanceof PDFTextField) { checkText(font, value); f.setText(value) }
      else if (f instanceof PDFCheckBox) value ? f.check() : f.uncheck()
      else if (value) f.select(value)
    }
    pdfForm.updateFieldAppearances(font)
    if (flatten) pdfForm.flatten()
    return [await out(`${base(file.name)}_filled.pdf`, doc)]
  }
  if (!fields?.length) throw new Error('Draw at least one field on a page.')
  const taken = new Set(pdfForm.getFields().map((f) => f.getName()))
  for (const f of fields) {
    const want = f.name.trim() || 'field'
    let name = want
    for (let k = 2; taken.has(name); k++) name = `${want}_${k}`
    taken.add(name)
    const page = doc.getPage(f.page)
    const v = view(page)
    const p1 = place(v.box, v.angle, f.x * v.width, v.height - f.y * v.height)
    const p2 = place(v.box, v.angle, (f.x + f.w) * v.width, v.height - (f.y + f.h) * v.height)
    const rect = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), borderColor: rgb(0.55, 0.6, 0.7), borderWidth: 1 }
    if (f.type === 'checkbox') pdfForm.createCheckBox(name).addToPage(page, rect)
    else {
      const field = pdfForm.createTextField(name)
      if (f.type === 'multiline') field.enableMultiline()
      field.addToPage(page, rect)
    }
  }
  return [await out(`${base(file.name)}_form.pdf`, doc)]
}

/**
 * Scan clean-up on RGBA pixels, in place. 'gray': greyscale with the contrast stretched so paper turns white and
 * ink black. 'bw': then black or white using Otsu's threshold. 'color': unchanged.
 */
export function enhance(px, mode) {
  if (mode === 'color') return px
  const n = px.length / 4
  const gray = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) hist[(gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8)]++
  // Levels: map the 1st..90th percentile to 0..255 (paper is the bright majority, so it clips to white).
  const pct = (p) => { let s = 0; for (let v = 0; v < 256; v++) if ((s += hist[v]) >= n * p) return v; return 255 }
  const [lo, hi] = [pct(0.01), Math.max(pct(0.9), pct(0.01) + 1)]
  const lut = Uint8Array.from({ length: 256 }, (_, v) => Math.min(255, Math.max(0, ((v - lo) * 255) / (hi - lo))))
  let t = 256
  if (mode === 'bw') {
    const h = new Float64Array(256)
    for (let v = 0; v < 256; v++) h[lut[v]] += hist[v]
    let [sum, sumB, wB, best] = [0, 0, 0, -1]
    for (let v = 0; v < 256; v++) sum += v * h[v]
    for (let v = 0; v < 256; v++) {
      wB += h[v]
      if (!wB || wB === n) continue
      sumB += v * h[v]
      const between = wB * (n - wB) * (sumB / wB - (sum - sumB) / (n - wB)) ** 2
      if (between > best) [best, t] = [between, v]
    }
  }
  for (let i = 0; i < n; i++) {
    const v = mode === 'bw' ? (lut[gray[i]] > t ? 255 : 0) : lut[gray[i]]
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v
  }
  return px
}

// Names of fonts used without their font program embedded, per page index ({ pages: [i], fonts: [name] }).
// Looks at each page's fonts and those of the forms (XObjects) it draws, one level deep.
export async function fontReport([file]) {
  const doc = await load(file)
  const ctx = doc.context
  const missing = (font) => {
    if (!(font instanceof PDFDict) || font.get(N('Subtype')) === N('Type3')) return null
    const desc = font.get(N('Subtype')) === N('Type0')
      ? ctx.lookup(ctx.lookup(font.get(N('DescendantFonts')))?.get(0))?.lookup?.(N('FontDescriptor'))
      : font.lookup(N('FontDescriptor'))
    const embedded = desc instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(N(k)))
    return embedded ? null : font.lookup(N('BaseFont'))?.decodeText?.() ?? font.lookup(N('BaseFont'))?.toString().slice(1) ?? 'unnamed font'
  }
  const fontsOf = (resources) => {
    const res = ctx.lookup(resources)
    if (!(res instanceof PDFDict)) return []
    const fonts = res.lookup(N('Font'))
    const own = fonts instanceof PDFDict ? fonts.values().map((f) => missing(ctx.lookup(f))) : []
    const xobjs = res.lookup(N('XObject'))
    const nested = xobjs instanceof PDFDict ? xobjs.values().flatMap((x) => {
      const xo = ctx.lookup(x)
      return xo instanceof PDFStream && xo.dict.get(N('Subtype')) === N('Form') ? fontsOf(xo.dict.get(N('Resources'))).map((n) => n) : []
    }) : []
    return [...own, ...nested].filter(Boolean)
  }
  const pages = []
  const fonts = new Set()
  doc.getPages().forEach((page, i) => {
    const names = fontsOf(page.node.get(N('Resources')))
    if (names.length) pages.push(i)
    names.forEach((n) => fonts.add(n))
  })
  return { pages, fonts: [...fonts] }
}

/**
 * PDF/A-2b: the structural parts (ID, sRGB output intent, XMP), minus what PDF/A forbids that can be removed safely
 * (JavaScript, attachments, hidden or non-printing annotations). Fonts that aren't embedded can't be fixed here;
 * the page-side pdfToPdfa flattens those pages first when asked. ponytail: LZW streams are not re-encoded.
 */
export async function pdfa([file]) {
  const doc = await load(file)
  const names = doc.catalog.lookup(N('Names'))
  if (names instanceof PDFDict) { names.delete(N('JavaScript')); names.delete(N('EmbeddedFiles')) }
  doc.catalog.delete(N('AA'))
  const action = doc.catalog.lookup(N('OpenAction'))
  if (action instanceof PDFDict && action.get(N('S')) === N('JavaScript')) doc.catalog.delete(N('OpenAction'))
  doc.catalog.lookup(N('AcroForm'))?.delete?.(N('NeedAppearances'))
  for (const page of doc.getPages()) {
    page.node.delete(N('AA'))
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annot = doc.context.lookup(ref)
      if (!(annot instanceof PDFDict) || annot.get(N('Subtype')) === N('Popup')) continue
      if (annot.get(N('Subtype')) === N('FileAttachment')) continue
      annot.delete(N('AA'))
      const a = annot.lookup(N('A'))
      if (a instanceof PDFDict && a.get(N('S')) === N('JavaScript')) annot.delete(N('A'))
      // Print on; Invisible, Hidden and NoView off.
      const flags = annot.lookup(N('F'))?.asNumber?.() ?? 0
      annot.set(N('F'), PDFNumber.of((flags | 4) & ~(1 | 2 | 32)))
    }
  }
  doc.convertToPDFA({ conformance: '2B' })
  prune(doc.context)
  return [await out(`${base(file.name)}_pdfa.pdf`, doc)]
}
