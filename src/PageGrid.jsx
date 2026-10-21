// Page thumbnails. mode 'select': click to toggle `sel`. mode 'organize': drag or buttons to reorder, rotate, delete.
// `pages` is [{ i, rot, sel }]: i = original page index, rot = extra rotation in degrees.
import { useEffect, useRef, useState } from 'react'
import { openPdf, renderPage } from './render.js'

const THUMB = 140 // px, longest side

export default function PageGrid({ file, mode, pages, setPages, onError }) {
  const [thumbs, setThumbs] = useState([])
  const drag = useRef(null)

  useEffect(() => {
    let pdf
    let cancelled = false
    setThumbs([])
    ;(async () => {
      pdf = await openPdf(file)
      if (cancelled) return
      setPages(Array.from({ length: pdf.numPages }, (_, i) => ({ i, rot: 0, sel: false })))
      // ponytail: renders every thumbnail in order; render only visible ones if 1000-page files get common.
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n)
        const vp = page.getViewport({ scale: 1 })
        const canvas = await renderPage(pdf, n, THUMB / Math.max(vp.width, vp.height))
        const url = canvas.toDataURL('image/jpeg', 0.7)
        setThumbs((t) => Object.assign([...t], { [n - 1]: url }))
      }
    })().catch((err) => cancelled || onError(err.message))
    return () => {
      cancelled = true
      pdf?.loadingTask.destroy()
    }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (k, change) => setPages(pages.map((p, j) => (j === k ? { ...p, ...change } : p)))
  const move = (from, to) => {
    if (to < 0 || to >= pages.length || from === to) return
    const next = [...pages]
    next.splice(to, 0, next.splice(from, 1)[0])
    setPages(next)
  }

  return (
    <>
      {mode === 'select' && (
        <p className="grid-actions">
          {pages.filter((p) => p.sel).length} of {pages.length} selected ·{' '}
          <button type="button" onClick={() => setPages(pages.map((p) => ({ ...p, sel: true })))}>All</button>{' '}
          <button type="button" onClick={() => setPages(pages.map((p) => ({ ...p, sel: false })))}>None</button>
        </p>
      )}
      <ol className="grid">
        {pages.map((p, k) => (
          <li
            key={p.i}
            className={p.sel ? 'sel' : ''}
            draggable={mode === 'organize'}
            onDragStart={() => { drag.current = k }}
            onDragOver={(e) => mode === 'organize' && e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (drag.current !== null) move(drag.current, k); drag.current = null }}
          >
            {mode === 'select' ? (
              <button type="button" className="thumb" aria-pressed={p.sel} onClick={() => update(k, { sel: !p.sel })}>
                <Thumb src={thumbs[p.i]} rot={p.rot} />
              </button>
            ) : (
              <div className="thumb"><Thumb src={thumbs[p.i]} rot={p.rot} /></div>
            )}
            <span className="num">{p.i + 1}</span>
            {mode === 'organize' && (
              <span className="page-actions">
                <button type="button" title="Move left" aria-label={`Move page ${p.i + 1} left`} onClick={() => move(k, k - 1)}>←</button>
                <button type="button" title="Rotate left" aria-label={`Rotate page ${p.i + 1} left`} onClick={() => update(k, { rot: (p.rot + 270) % 360 })}>⟲</button>
                <button type="button" title="Rotate right" aria-label={`Rotate page ${p.i + 1} right`} onClick={() => update(k, { rot: (p.rot + 90) % 360 })}>⟳</button>
                <button type="button" title="Delete" aria-label={`Delete page ${p.i + 1}`} onClick={() => setPages(pages.filter((_, j) => j !== k))}>✕</button>
                <button type="button" title="Move right" aria-label={`Move page ${p.i + 1} right`} onClick={() => move(k, k + 1)}>→</button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </>
  )
}

function Thumb({ src, rot }) {
  return src ? <img src={src} alt="" style={{ transform: `rotate(${rot}deg)` }} /> : <span className="loading">…</span>
}
