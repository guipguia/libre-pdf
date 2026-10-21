// Compare PDF: word-by-word text diff of two PDFs, highlighted on the pages side by side.
// ponytail: compares text only (not images or layout) and renders every page up front; fine for typical documents.
import { useEffect, useState } from 'react'
import { matchBoxes, openPdf, renderPage } from './render.js'
import { diff } from './text.js'

// Every word with its box as fractions of the page ([x, y, w, h] from the top-left), plus page images.
async function read(pdf, onStatus, label) {
  const words = []
  const pages = []
  for (let n = 1; n <= pdf.numPages; n++) {
    onStatus(`Reading ${label}: page ${n} of ${pdf.numPages}…`)
    const page = await pdf.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    pages.push((await renderPage(pdf, n, 700 / vp.width)).toDataURL('image/jpeg', 0.75))
    for (const w of await matchBoxes(page, /\S+/g)) words.push({ ...w, page: n - 1 })
  }
  return { words, pages }
}

export default function Compare({ files, onStatus }) {
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    const docs = []
    ;(async () => {
      for (const f of files) docs.push(await openPdf(f))
      const A = await read(docs[0], onStatus, files[0].name)
      const B = await read(docs[1], onStatus, files[1].name)
      onStatus('Comparing…')
      const edits = diff(A.words.map((w) => w.text), B.words.map((w) => w.text))
      const marks = { a: A.pages.map(() => []), b: B.pages.map(() => []) }
      const changes = []
      let run = null
      for (const e of edits) {
        if (e.op === '=') { run = null; continue }
        const w = e.op === '-' ? A.words[e.a] : B.words[e.b]
        marks[e.op === '-' ? 'a' : 'b'][w.page].push(w.box)
        if (!run) changes.push(run = { removed: [], added: [], page: w.page })
        run[e.op === '-' ? 'removed' : 'added'].push(w.text)
      }
      if (!cancelled) {
        setResult({ A, B, marks, changes })
        onStatus(changes.length ? `${changes.length} difference${changes.length === 1 ? '' : 's'} found.` : 'The text of both PDFs is identical.')
      }
    })().catch((err) => cancelled || onStatus(err.message, true))
    return () => {
      cancelled = true
      for (const d of docs) d.loadingTask.destroy()
    }
  }, [files]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return null
  const { A, B, marks, changes } = result
  const Page = ({ src, boxes, kind }) => (
    <div className="sheet">
      {src ? <img src={src} alt="" /> : <p className="hint">No page</p>}
      {boxes?.map(([x, y, w, h], k) => (
        <span key={k} className={`hl ${kind}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
      ))}
    </div>
  )
  return (
    <div className="compare">
      {changes.length > 0 && (
        <details className="changes" open>
          <summary>Differences</summary>
          <ol>
            {changes.slice(0, 500).map((c, k) => (
              <li key={k}>
                <a href={`#cmp-${c.page}`}>p. {c.page + 1}</a>{' '}
                {c.removed.length > 0 && <del>{c.removed.join(' ')}</del>} {c.added.length > 0 && <ins>{c.added.join(' ')}</ins>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="pair head"><strong>{files[0].name}</strong><strong>{files[1].name}</strong></div>
      {Array.from({ length: Math.max(A.pages.length, B.pages.length) }, (_, p) => (
        <div className="pair" key={p} id={`cmp-${p}`}>
          <Page src={A.pages[p]} boxes={marks.a[p]} kind="del" />
          <Page src={B.pages[p]} boxes={marks.b[p]} kind="ins" />
        </div>
      ))}
    </div>
  )
}
