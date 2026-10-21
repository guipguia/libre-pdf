// Runs one pdf.js operation off the main thread so big files don't freeze the page.
import * as ops from './pdf.js'

// pdf-lib only embeds JPG and PNG; redraw anything else the browser can decode (WebP, GIF, BMP, AVIF…) as PNG.
async function embeddable(file) {
  if (/^image\/(jpeg|png)$/.test(file.type)) return file
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name} is not an image this browser can read.`) })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  return new File([await canvas.convertToBlob({ type: 'image/png' })], file.name, { type: 'image/png' })
}

// Scan to PDF: phone photos are upright (createImageBitmap applies EXIF rotation), shrunk to a sane size and cleaned up.
async function scanned(file, filter) {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name} is not an image this browser can read.`) })
  const s = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * s), Math.round(bitmap.height * s))
  const g = canvas.getContext('2d')
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const img = g.getImageData(0, 0, canvas.width, canvas.height)
  ops.enhance(img.data, filter)
  g.putImageData(img, 0, 0)
  return new File([await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })], file.name, { type: 'image/jpeg' })
}

onmessage = async ({ data: { op, files, opts } }) => {
  try {
    if (op === 'imagesToPdf') files = await Promise.all(files.map((f) => (opts.filter ? scanned(f, opts.filter) : embeddable(f))))
    const input = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
    const out = await ops[op](input, opts)
    // Most ops return files (whose buffers we hand over without copying); a few return plain data.
    postMessage({ out }, Array.isArray(out) ? out.flatMap((f) => f.data?.buffer ?? []) : [])
  } catch (err) {
    postMessage({ error: err.message })
  }
}
