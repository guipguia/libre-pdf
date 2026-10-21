// Shared by the tools that draw on a page preview (Sign, Redact, Edit, Forms).
import { useEffect, useRef, useState } from 'react'
import { openPdf, renderPage } from './render.js'

/** The pdf.js document for `file`, destroyed when the file changes. */
export function usePdf(file, onError) {
  const [pdf, setPdf] = useState(null)
  useEffect(() => {
    let doc
    let cancelled = false
    setPdf(null)
    openPdf(file).then((d) => { doc = d; cancelled ? d.loadingTask.destroy() : setPdf(d) }, (err) => onError(err.message))
    return () => { cancelled = true; doc?.loadingTask.destroy() }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps
  return pdf
}

/** Page n (0-based) as an image, with its visible size in points. */
export function usePageImage(pdf, n, onError) {
  const [page, setPage] = useState(null)
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    pdf.getPage(n + 1).then(async (p) => {
      const vp = p.getViewport({ scale: 1 })
      const canvas = await renderPage(pdf, n + 1, 1000 / vp.width)
      if (!cancelled) setPage({ url: canvas.toDataURL('image/jpeg', 0.85), width: vp.width, height: vp.height, ratio: vp.width / vp.height })
    }).catch((err) => cancelled || onError(err.message))
    return () => { cancelled = true }
  }, [pdf, n]) // eslint-disable-line react-hooks/exhaustive-deps
  return page
}

export function Pager({ pdf, n, setN, children }) {
  return (
    <p className="grid-actions">
      <button type="button" disabled={!n} onClick={() => setN(n - 1)} aria-label="Previous page">←</button>{' '}
      Page {n + 1} of {pdf.numPages}{' '}
      <button type="button" disabled={n === pdf.numPages - 1} onClick={() => setN(n + 1)} aria-label="Next page">→</button>{' '}
      {children}
    </p>
  )
}

/** Pointer position over an element as fractions of its size, clamped to 0..1. */
export function frac(e, el = e.currentTarget) {
  const r = el.getBoundingClientRect()
  const c = (v) => Math.min(Math.max(v, 0), 1)
  return [c((e.clientX - r.left) / r.width), c((e.clientY - r.top) / r.height)]
}

/**
 * Page preview where dragging draws rectangles ({ x, y, w, h } fractions). Clicking a rectangle removes it.
 * `rects` may carry a `label` shown inside.
 */
export function RectSheet({ page, rects, onAdd, onRemove, kind }) {
  const [draft, setDraft] = useState(null)
  const start = useRef(null)
  const sheet = useRef(null)
  const rect = ([x0, y0], [x1, y1]) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = frac(e, sheet.current)
  }
  const move = (e) => start.current && setDraft(rect(start.current, frac(e, sheet.current)))
  const up = (e) => {
    if (!start.current) return
    const r = rect(start.current, frac(e, sheet.current))
    start.current = null
    setDraft(null)
    if (r.w > 0.005 && r.h > 0.005) onAdd(r)
  }
  const style = (r) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` })
  return (
    <div className="sheet armed draw" ref={sheet} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDraft(null) }}>
      <img src={page.url} alt="" draggable={false} />
      {rects.map((r, k) => (
        <button
          type="button" key={k} className={`rect ${kind}`} style={style(r)} title="Click to remove" aria-label={`Remove ${r.label ?? 'area'} ${k + 1}`}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemove(k)}
        >{r.label}</button>
      ))}
      {draft && <span className={`rect ${kind} draft`} style={style(draft)} />}
    </div>
  )
}
