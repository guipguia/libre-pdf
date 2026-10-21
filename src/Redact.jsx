// Redact PDF: mark areas by dragging on the page, or find text / patterns. Reports { marks } via onChange.
import { useEffect, useState } from 'react'
import { matchBoxes } from './render.js'
import { Pager, RectSheet, usePageImage, usePdf } from './usePage.jsx'

const PATTERNS = {
  email: { label: 'Email addresses', re: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g },
  phone: { label: 'Phone numbers', re: /\+?\d[\d ().-]{7,}\d/g },
  bank: { label: 'IBAN and card numbers', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b|\b\d(?:[ -]?\d){12,18}\b/g },
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default function Redact({ file, onChange, onError }) {
  const pdf = usePdf(file, onError)
  const [n, setN] = useState(0)
  const page = usePageImage(pdf, n, onError)
  const [marks, setMarks] = useState([])
  const [words, setWords] = useState('')
  const [patterns, setPatterns] = useState({})
  const [found, setFound] = useState('')

  useEffect(() => { setMarks([]); setN(0) }, [file])
  useEffect(() => { onChange({ marks }) }, [marks]) // eslint-disable-line react-hooks/exhaustive-deps

  async function find() {
    const res = [
      ...words.split(',').map((w) => w.trim()).filter(Boolean).map((w) => new RegExp(escape(w), 'gi')),
      ...Object.keys(PATTERNS).filter((k) => patterns[k]).map((k) => PATTERNS[k].re),
    ]
    if (!res.length) return setFound('Type some words or tick a pattern first.')
    const add = []
    for (let p = 0; p < pdf.numPages; p++) {
      const pg = await pdf.getPage(p + 1)
      for (const re of res) for (const m of await matchBoxes(pg, re)) add.push({ page: p, x: m.box[0], y: m.box[1], w: m.box[2], h: m.box[3] })
    }
    setMarks([...marks, ...add])
    setFound(add.length ? `Marked ${add.length} match${add.length === 1 ? '' : 'es'}. Check every page before redacting.` : 'Nothing found. Scanned pages need "OCR PDF" first, or mark areas by hand.')
  }

  if (!pdf) return null
  const here = marks.map((m, k) => ({ ...m, k })).filter((m) => m.page === n)
  const pages = new Set(marks.map((m) => m.page)).size
  return (
    <>
      <fieldset className="options">
        <legend>Find and mark</legend>
        <label>Words or phrases, separated by commas<input value={words} onChange={(e) => setWords(e.target.value)} placeholder="John Smith, ACME Ltd" /></label>
        {Object.entries(PATTERNS).map(([k, p]) => (
          <label key={k} className="check"><input type="checkbox" checked={!!patterns[k]} onChange={(e) => setPatterns({ ...patterns, [k]: e.target.checked })} />{p.label}</label>
        ))}
        <div><button type="button" onClick={find}>Mark matches</button></div>
        {found && <p className="hint wide">{found}</p>}
      </fieldset>
      <Pager pdf={pdf} n={n} setN={setN}>
        {marks.length > 0 && <button type="button" onClick={() => setMarks([])}>Clear all</button>}
      </Pager>
      <p className="hint">Drag on the page to black out an area. Click a box to remove it. {marks.length} area{marks.length === 1 ? '' : 's'} on {pages} page{pages === 1 ? '' : 's'}.</p>
      {page && <RectSheet page={page} rects={here} kind="redact" onAdd={(r) => setMarks([...marks, { ...r, page: n }])} onRemove={(k) => setMarks(marks.filter((_, j) => j !== here[k].k))} />}
    </>
  )
}
