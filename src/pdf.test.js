import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib'
import * as ops from './pdf.js'

// A PDF whose page k (1-based) is k*100 points wide, so pages can be identified after reordering.
async function make(name, count, rotation = 0) {
  const doc = await PDFDocument.create()
  for (let k = 1; k <= count; k++) doc.addPage([k * 100, 500]).setRotation({ type: 'degrees', angle: rotation })
  return { name, data: await doc.save() }
}
const widths = async ({ data }, password) =>
  (await PDFDocument.load(data, password ? { password } : {})).getPages().map((p) => p.getWidth())

describe('parseRanges', () => {
  it('parses pages, ranges and open ends', () => {
    expect(ops.parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]])
    expect(ops.parseRanges('-2', 9)).toEqual([[0, 1]])
  })
  it('rejects bad input', () => {
    expect(() => ops.parseRanges('0', 3)).toThrow(/outside/)
    expect(() => ops.parseRanges('2-9', 3)).toThrow(/outside/)
    expect(() => ops.parseRanges('a', 3)).toThrow(/not a page/)
    expect(() => ops.parseRanges(' , ', 3)).toThrow(/at least one/)
  })
})

describe('place', () => {
  const box = { x: 0, y: 0, width: 100, height: 200 }
  it('maps the visual bottom-left corner for every rotation', () => {
    expect(ops.place(box, 0, 0, 0)).toMatchObject({ x: 0, y: 0 })
    expect(ops.place(box, 90, 0, 0)).toMatchObject({ x: 100, y: 0 })
    expect(ops.place(box, 180, 0, 0)).toMatchObject({ x: 100, y: 200 })
    expect(ops.place(box, 270, 0, 0)).toMatchObject({ x: 0, y: 200 })
  })
})

describe('operations', () => {
  it('merges in order', async () => {
    const [m] = await ops.merge([await make('a.pdf', 2), await make('b.pdf', 1)])
    expect(await widths(m)).toEqual([100, 200, 100])
  })

  it('splits by ranges and by every n pages', async () => {
    const f = await make('doc.pdf', 5)
    const r = await ops.split([f], { mode: 'ranges', ranges: '1-2,5' })
    expect(r.map((x) => x.name)).toEqual(['doc_1-2.pdf', 'doc_5.pdf'])
    expect(await widths(r[1])).toEqual([500])
    const e = await ops.split([f], { mode: 'every', every: 2 })
    expect(await Promise.all(e.map((x) => widths(x)))).toEqual([[100, 200], [300, 400], [500]])
  })

  it('reorders, drops and rotates pages', async () => {
    const [p] = await ops.pages([await make('d.pdf', 3)], { pages: [{ i: 2, rot: 90 }, { i: 0 }], suffix: 'x' })
    const doc = await PDFDocument.load(p.data)
    expect(doc.getPages().map((x) => [x.getWidth(), x.getRotation().angle])).toEqual([[300, 90], [100, 0]])
  })

  it('crops relative to what the reader sees on rotated pages', async () => {
    const [c] = await ops.crop([await make('d.pdf', 1, 90)], { top: 10, right: 0, bottom: 0, left: 0 })
    const box = (await PDFDocument.load(c.data)).getPage(0).getCropBox()
    // Visual top of a page rotated 90° clockwise is its left edge (x = 0) in user space.
    expect(box.x).toBeCloseTo((10 * 72) / 25.4)
    expect(box.width).toBeCloseTo(100 - (10 * 72) / 25.4)
  })

  it('adds page numbers and watermarks without breaking the file', async () => {
    const f = await make('d.pdf', 2, 270)
    const [n] = await ops.pageNumbers([f], { position: 'bottom-center', start: 1, format: '{n} / {total}', size: 12, from: 1 })
    const [w] = await ops.watermark([n], { text: 'DRAFT', size: 40, opacity: 0.3, angle: 45, color: '#ff0000' })
    expect(await widths(w)).toEqual([100, 200])
  })

  it('protects and unlocks with a password', async () => {
    const [p] = await ops.protect([await make('d.pdf', 1)], { password: 'pw', confirm: 'pw' })
    await expect(ops.merge([p, p])).rejects.toThrow(/password-protected/)
    await expect(ops.unlock([p], { password: 'nope' })).rejects.toThrow(/Wrong password/)
    const [u] = await ops.unlock([p], { password: 'pw' })
    expect(await widths(u)).toEqual([100])
  })

  it('rejects files that are not PDFs', async () => {
    await expect(ops.rotate([{ name: 'x.pdf', data: new TextEncoder().encode('hello') }], { angle: 90 })).rejects.toThrow(/not a PDF/)
  })
})

describe('images', () => {
  // Minimal JPEG header carrying only an EXIF orientation tag (big-endian TIFF).
  function exifJpeg(orientation) {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, app1.length + 2, ...app1, 0xff, 0xda])
  }
  it('reads the EXIF orientation', () => {
    expect(ops.jpegOrientation(exifJpeg(6))).toBe(6)
    expect(ops.jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda]))).toBe(1)
  })

  it('puts each PNG on its own page', async () => {
    // 1x1 red PNG.
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const [p] = await ops.imagesToPdf([{ name: 'a.png', data: png }, { name: 'b.png', data: png }], { size: 'A4', orientation: 'portrait', margin: 0 })
    expect(await widths(p)).toEqual([595.28, 595.28])
  })
})

describe('phase 2 operations', () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

  it('stamps a signature where it was placed, also on rotated pages', async () => {
    const [s] = await ops.stamp([await make('d.pdf', 2, 90)], { image: png, marks: [{ page: 1, x: 0.5, y: 0.5, w: 0.2 }] })
    expect(s.name).toBe('d_signed.pdf')
    expect(await widths(s)).toEqual([100, 200])
    await expect(ops.stamp([await make('d.pdf', 1)], { image: png, marks: [] })).rejects.toThrow(/Click on a page/)
  })

  it('lays a text-only PDF over a page', async () => {
    const layer = await PDFDocument.create()
    layer.addPage([300, 300]).drawText('hello')
    const [o] = await ops.textLayer([await make('d.pdf', 2)], { layers: [{ i: 1, data: await layer.save() }] })
    const doc = await PDFDocument.load(o.data)
    expect(doc.getPage(1).node.Resources().lookup(PDFName.of('XObject'))).toBeTruthy()
    expect(await widths(o)).toEqual([100, 200])
  })

  it('compress drops orphaned objects and deflates raw streams, never growing the file', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    doc.context.register(doc.context.stream('x'.repeat(50_000))) // orphan
    const page = doc.getPage(0)
    const raw = doc.context.register(doc.context.stream(`BT /F1 1 Tf ET\n${' '.repeat(20_000)}`))
    page.node.set(PDFName.of('Contents'), raw)
    const before = await doc.save({ useObjectStreams: false })
    const [c] = await ops.compress([{ name: 'd.pdf', data: before }], { level: 'medium' })
    expect(c.data.length).toBeLessThan(before.length / 10)
    expect(await widths(c)).toEqual([100])
  })

  it('repairs a file with a broken cross-reference table', async () => {
    const good = new TextDecoder('latin1').decode((await make('d.pdf', 2)).data)
    const broken = good.replace(/startxref\s+\d+/, 'startxref\n999999')
    const [r] = await ops.repair([{ name: 'd.pdf', data: Uint8Array.from(broken, (c) => c.charCodeAt(0)) }])
    expect(await widths(r)).toEqual([100, 200])
  })
})

describe('replacePages', () => {
  it('swaps a page for an image and strips metadata when asked', async () => {
    const doc = await PDFDocument.create()
    doc.setTitle('Secret title')
    for (const w of [100, 200]) doc.addPage([w, 300]).drawText('secret')
    // Smallest valid JPEG: 1x1 grey.
    const jpg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k='), (c) => c.charCodeAt(0))
    const [r] = await ops.replacePages([{ name: 'd.pdf', data: await doc.save() }], { pages: [{ i: 1, data: jpg, width: 200, height: 300 }], clean: true, suffix: 'redacted' })
    const back = await PDFDocument.load(r.data)
    expect(await widths(r)).toEqual([100, 200])
    expect(back.getTitle()).toBeUndefined()
    expect(new TextDecoder('latin1').decode(r.data)).not.toContain('Secret title')
    // Only page 1's content stream may still say "secret": page 2's original stream must be gone from the file.
    const streams = [...back.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o) => o instanceof PDFRawStream)
    const texts = streams.map((o) => { try { return new TextDecoder('latin1').decode(decodePDFRawStream(o).decode()) } catch { return '' } })
    expect(texts.filter((t) => /736563726574/i.test(t))).toHaveLength(1) // pdf-lib writes text as hex
  })
})

describe('edit', () => {
  it('draws every object type, also on rotated pages', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const common = { color: '#ff0000', width: 2 }
    const objects = [0, 1].flatMap((page) => [
      { page, type: 'rect', x: 10, y: 10, w: 50, h: 20, fill: true, ...common },
      { page, type: 'ellipse', x: 10, y: 40, w: 50, h: 20, ...common },
      { page, type: 'line', x1: 0, y1: 0, x2: 50, y2: 50, ...common },
      { page, type: 'pen', points: [[1, 1], [5, 9], [9, 3]], ...common },
      { page, type: 'highlight', x: 0, y: 0, w: 30, h: 10, color: '#ffeb3b' },
      { page, type: 'whiteout', x: 0, y: 0, w: 30, h: 10 },
      { page, type: 'text', x: 10, y: 10, text: 'Olá\nmundo', size: 12, color: '#000000' },
      { page, type: 'image', x: 10, y: 10, w: 20, h: 20, data: png },
    ])
    const [e] = await ops.edit([await make('d.pdf', 2, 90)], { objects })
    expect(await widths(e)).toEqual([100, 200])
    await expect(ops.edit([await make('d.pdf', 1)], { objects: [{ page: 0, type: 'text', x: 0, y: 0, text: 'Привет', size: 12, color: '#000000' }] })).rejects.toThrow(/cannot show "Привет"/)
  })
})

describe('forms', () => {
  it('creates fields, lists them, fills and flattens them', async () => {
    const fields = [
      { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.05, type: 'text', name: 'Name' },
      { page: 0, x: 0.1, y: 0.2, w: 0.05, h: 0.05, type: 'checkbox', name: 'Agree' },
      { page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.2, type: 'multiline', name: 'Name' },
    ]
    const [made] = await ops.form([await make('d.pdf', 2, 90)], { mode: 'create', fields })
    const list = await ops.formFields([made])
    expect(list.map((f) => [f.name, f.type, f.value])).toEqual([['Name', 'text', ''], ['Agree', 'checkbox', false], ['Name_2', 'text', '']])
    const [filled] = await ops.form([made], { mode: 'fill', values: { Name: 'José', Agree: true } })
    expect((await ops.formFields([filled])).map((f) => f.value)).toEqual(['José', true, ''])
    const [flat] = await ops.form([made], { mode: 'fill', values: { Name: 'José' }, flatten: true })
    expect(await ops.formFields([flat])).toEqual([])
    await expect(ops.form([made], { mode: 'fill', values: { Name: '日本' } })).rejects.toThrow(/cannot show/)
  })
})

describe('enhance', () => {
  // Grey-ish paper (180) with some darker ink (90).
  const scan = () => Uint8ClampedArray.from({ length: 100 * 4 }, (_, i) => (i % 4 === 3 ? 255 : Math.floor(i / 4) < 20 ? 90 : 180))
  it('stretches paper to white and ink to black', () => {
    const g = ops.enhance(scan(), 'gray')
    expect([g[0], g[1], g[2], g[3]]).toEqual([0, 0, 0, 255])
    expect(g[50 * 4]).toBe(255)
  })
  it('thresholds to pure black and white', () => {
    const b = ops.enhance(scan(), 'bw')
    expect(new Set(Array.from(b).filter((_, i) => i % 4 !== 3))).toEqual(new Set([0, 255]))
    expect(b[19 * 4]).toBe(0)
    expect(b[20 * 4]).toBe(255)
  })
})

describe('pdfa', () => {
  it('reports standard (non-embedded) fonts per page and writes PDF/A metadata', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    doc.addPage([100, 100]).drawText('hi')
    doc.addJavaScript('x', 'app.alert(1)')
    const f = { name: 'd.pdf', data: await doc.save() }
    expect(await ops.fontReport([f])).toEqual({ pages: [1], fonts: ['Helvetica'] })
    const [a] = await ops.pdfa([f])
    const text = new TextDecoder('latin1').decode(a.data)
    expect(text).toMatch(/^%PDF-1\.7/)
    expect(text).toContain('pdfaid:part')
    expect(text).toContain('/OutputIntents')
    const names = (await PDFDocument.load(a.data)).catalog.lookup(PDFName.of('Names'))
    expect(names?.has(PDFName.of('JavaScript'))).toBeFalsy()
    expect((await PDFDocument.load(f.data)).catalog.lookup(PDFName.of('Names')).has(PDFName.of('JavaScript'))).toBe(true)
  })
})
