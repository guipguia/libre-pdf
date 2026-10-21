// Tools that need pdf.js or a canvas, so they run in the page: thumbnails, PDF to JPG / Markdown / PowerPoint, OCR, repair.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { toLines } from './lines.js'
import { runInWorker } from './runWorker.js'
import { toBlocks, toMarkdown, toTable } from './text.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
const base = (name) => name.replace(/\.[^.]+$/, '')
const vendor = new URL(`${import.meta.env.BASE_URL}vendor/`, location.href).href

/** Caller must call .loadingTask.destroy() on the result. */
export async function openPdf(file) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    wasmUrl: `${vendor}pdfjs/wasm/`,
    cMapUrl: `${vendor}pdfjs/cmaps/`,
    standardFontDataUrl: `${vendor}pdfjs/standard_fonts/`,
    iccUrl: `${vendor}pdfjs/iccs/`,
  })
  try {
    return await task.promise
  } catch (err) {
    task.destroy()
    if (err.name === 'PasswordException') throw new Error(`${file.name} is password-protected. Remove the password first with "Unlock PDF".`)
    throw new Error(`Could not read ${file.name}: ${err.message}`)
  }
}

/** Page n (1-based) drawn at `scale` (1 = 72 dpi), white background. */
export async function renderPage(pdf, n, scale) {
  const page = await pdf.getPage(n)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport, background: '#fff' }).promise
  page.cleanup()
  return canvas
}

export async function pdfToJpg(files, { dpi, quality }, onStatus) {
  const out = []
  for (const file of files) {
    const pdf = await openPdf(file)
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        onStatus(`${file.name}: page ${n} of ${pdf.numPages}…`)
        const canvas = await renderPage(pdf, n, +dpi / 72)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', +quality))
        canvas.width = 0 // free the bitmap now; big pages at 300 dpi add up fast
        out.push({ name: `${base(file.name)}_page-${n}.jpg`, data: new Uint8Array(await blob.arrayBuffer()) })
      }
    } finally {
      pdf.loadingTask.destroy()
    }
  }
  return out
}

const pageCount = (n) => `${n} page${n === 1 ? '' : 's'}`

/** OCR: Tesseract reads each page image and returns an invisible-text PDF page, laid over the original in the worker. */
export async function ocr(files, { lang, skip }, onStatus) {
  onStatus('Loading the OCR engine (the first time downloads a few MB)…')
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(lang, 1, {
    workerPath: `${vendor}tesseract/worker.min.js`,
    corePath: `${vendor}tesseract/`,
    langPath: `${vendor}tesseract`,
    workerBlobURL: false,
  })
  const out = []
  try {
    for (const file of files) {
      const pdf = await openPdf(file)
      const layers = []
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          if (skip === 'yes') {
            const chars = (await page.getTextContent()).items.reduce((s, it) => s + (it.str?.trim().length ?? 0), 0)
            if (chars > 20) continue
          }
          onStatus(`${file.name}: reading page ${n} of ${pdf.numPages}…`)
          const vp = page.getViewport({ scale: 1 })
          const canvas = await renderPage(pdf, n, Math.min(300 / 72, 4000 / Math.max(vp.width, vp.height)))
          const { data } = await worker.recognize(canvas, { pdfTitle: file.name, pdfTextOnly: true }, { pdf: true, text: false })
          canvas.width = 0
          layers.push({ i: n - 1, data: new Uint8Array(data.pdf) })
        }
      } finally {
        pdf.loadingTask.destroy()
      }
      if (!layers.length) throw new Error(`${file.name} already has text on every page. Choose "OCR every page" to redo it.`)
      onStatus(`${file.name}: adding the text layer to ${pageCount(layers.length)}…`)
      out.push(...await runInWorker('textLayer', [file], { layers }))
    }
  } finally {
    await worker.terminate()
  }
  return out
}

// Each page's text items, read in order. Throws for scans, which have no text to read.
async function pageItems(file, onStatus) {
  const pdf = await openPdf(file)
  const pages = []
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onStatus(`${file.name}: page ${n} of ${pdf.numPages}…`)
      pages.push((await (await pdf.getPage(n)).getTextContent()).items)
    }
  } finally {
    pdf.loadingTask.destroy()
  }
  if (!pages.some((items) => items.some((it) => it.str?.trim()))) throw new Error(`${file.name} has no text, only images. Run "OCR PDF" on it first.`)
  return pages
}
const linesOf = (pages) => pages.flatMap((items, n) => toLines(items, n + 1))

export async function pdfToMarkdown(files, _opts, onStatus) {
  const out = []
  for (const file of files) out.push({ name: `${base(file.name)}.md`, data: new TextEncoder().encode(toMarkdown(linesOf(await pageItems(file, onStatus)))) })
  return out
}

export async function pdfToWord(files, _opts, onStatus) {
  const { docx } = await import('./office.js')
  const out = []
  for (const file of files) out.push({ name: `${base(file.name)}.docx`, data: docx(toBlocks(linesOf(await pageItems(file, onStatus)))) })
  return out
}

export async function pdfToExcel(files, _opts, onStatus) {
  const { xlsx } = await import('./office.js')
  const out = []
  for (const file of files) {
    const sheets = (await pageItems(file, onStatus)).map((items, n) => ({ name: `Page ${n + 1}`, rows: toTable(items) })).filter((s) => s.rows.length)
    out.push({ name: `${base(file.name)}.xlsx`, data: xlsx(sheets) })
  }
  return out
}

/** One slide per page, the page as a picture. Slide size follows the first page. */
export async function pdfToPptx(files, { dpi }, onStatus) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const out = []
  for (const file of files) {
    const pdf = await openPdf(file)
    try {
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
      const [W, H] = [first.width / 72, first.height / 72] // inches
      const pptx = new PptxGenJS()
      pptx.defineLayout({ name: 'PDF', width: W, height: H })
      pptx.layout = 'PDF'
      for (let n = 1; n <= pdf.numPages; n++) {
        onStatus(`${file.name}: page ${n} of ${pdf.numPages}…`)
        const canvas = await renderPage(pdf, n, +dpi / 72)
        const [w, h] = [canvas.width / +dpi, canvas.height / +dpi]
        const s = Math.min(W / w, H / h)
        pptx.addSlide().addImage({ data: canvas.toDataURL('image/jpeg', 0.85).slice(5), x: (W - w * s) / 2, y: (H - h * s) / 2, w: w * s, h: h * s })
        canvas.width = 0
      }
      out.push({ name: `${base(file.name)}.pptx`, data: await pptx.write({ outputType: 'uint8array' }) })
    } finally {
      pdf.loadingTask.destroy()
    }
  }
  return out
}

/** pdf-lib rewrite first (keeps bookmarks and forms); if it can't parse the file, pdf.js's recovery mode rebuilds the pages. */
export async function repair(files, _opts, onStatus) {
  const out = []
  for (const file of files) {
    try {
      out.push(...await runInWorker('repair', [file], {}))
    } catch (err) {
      if (/password-protected|not a PDF/.test(err.message)) throw err
      onStatus(`${file.name}: trying deeper recovery…`)
      const pdf = await openPdf(file).catch(() => { throw new Error(`${file.name} is too damaged to recover.`) })
      try {
        const data = await pdf.extractPages([{ document: null }])
        if (!data) throw new Error(`${file.name} is too damaged to recover.`)
        out.push({ name: `${base(file.name)}_repaired.pdf`, data })
      } finally {
        pdf.loadingTask.destroy()
      }
    }
  }
  return out
}

/**
 * Boxes ([x, y, w, h] as fractions of the page, from the top-left) of every match of `re` (global) in a page's text.
 * A text item's width is split between its characters evenly. ponytail: matches spanning two text items are missed.
 */
export async function matchBoxes(page, re) {
  const vp = page.getViewport({ scale: 1 })
  const found = []
  for (const it of (await page.getTextContent()).items) {
    if (!it.str?.trim()) continue
    const [, , c, d, e, f] = it.transform
    const size = Math.hypot(c, d) || it.height
    for (const m of it.str.matchAll(re)) {
      const x0 = e + (it.width * m.index) / it.str.length
      const x1 = e + (it.width * (m.index + m[0].length)) / it.str.length
      const [ax, ay] = vp.convertToViewportPoint(x0, f - size * 0.25)
      const [bx, by] = vp.convertToViewportPoint(x1, f + size * 0.85)
      found.push({ text: m[0], box: [Math.min(ax, bx) / vp.width, Math.min(ay, by) / vp.height, Math.abs(bx - ax) / vp.width, Math.abs(by - ay) / vp.height] })
    }
  }
  return found
}

// Pages `indexes` drawn as JPEGs (with `marks` [{ page, x, y, w, h }] burned in black) for replacePages.
async function flatten(file, indexes, marks, dpi, onStatus) {
  const pdf = await openPdf(file)
  const pages = []
  try {
    for (const i of indexes) {
      onStatus(`${file.name}: flattening page ${i + 1}…`)
      const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1 })
      const canvas = await renderPage(pdf, i + 1, +dpi / 72)
      const g = canvas.getContext('2d')
      g.fillStyle = '#000'
      const [W, H] = [canvas.width, canvas.height]
      for (const m of marks.filter((m) => m.page === i)) g.fillRect(m.x * W - 2, m.y * H - 2, m.w * W + 4, m.h * H + 4)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      canvas.width = 0
      pages.push({ i, data: new Uint8Array(await blob.arrayBuffer()), width: vp.width, height: vp.height })
    }
  } finally {
    pdf.loadingTask.destroy()
  }
  return pages
}

/** Pages with marks are redrawn as images with black boxes burned in. */
export async function redact([file], { marks, clean, dpi }, onStatus) {
  const indexes = [...new Set(marks.map((m) => m.page))].sort((a, b) => a - b)
  const pages = await flatten(file, indexes, marks, dpi, onStatus)
  onStatus('Rebuilding the PDF…')
  return runInWorker('replacePages', [file], { pages, clean: clean === 'yes', suffix: 'redacted' })
}

/** PDF/A-2b. Pages using fonts that aren't embedded are turned into images first when `fonts` is 'flatten'. */
export async function pdfToPdfa(files, { fonts }, onStatus) {
  const out = []
  for (let file of files) {
    const report = await runInWorker('fontReport', [file], {})
    let note = ''
    if (report.fonts.length && fonts === 'flatten') {
      const pages = await flatten(file, report.pages, [], 200, onStatus)
      const [flat] = await runInWorker('replacePages', [file], { pages, suffix: 'flat' })
      file = new File([flat.data], file.name, { type: 'application/pdf' })
      note = `${file.name}: ${pageCount(pages.length)} turned into images so every font is embedded.`
    } else if (report.fonts.length) {
      note = `${file.name} is not fully PDF/A yet: these fonts are not embedded: ${report.fonts.join(', ')}. Choose "Turn those pages into images" to fix it.`
    }
    onStatus(`${file.name}: converting…`)
    const [result] = await runInWorker('pdfa', [file], {})
    out.push({ ...result, note })
  }
  return out
}
