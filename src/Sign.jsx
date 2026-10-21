// Sign PDF: make a signature (draw, type or upload), then click on pages to place it.
// Reports { image: PNG bytes, marks: [{ page, x, y, w }] } (fractions of the visible page) through onChange.
import { useEffect, useRef, useState } from 'react'
import { Pager, usePageImage, usePdf } from './usePage.jsx'

const INK = { '#111111': 'Black', '#1f3a93': 'Blue' }

// Crop a canvas to its non-transparent pixels and export it as PNG.
async function exportSignature(canvas) {
  const { width, height } = canvas
  const px = canvas.getContext('2d').getImageData(0, 0, width, height).data
  let [x0, y0, x1, y1] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    }
  }
  if (x1 < 0) return null
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 5
  out.height = y1 - y0 + 5
  out.getContext('2d').drawImage(canvas, x0 - 2, y0 - 2, out.width, out.height, 0, 0, out.width, out.height)
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'))
  return { data: new Uint8Array(await blob.arrayBuffer()), url: out.toDataURL(), aspect: out.height / out.width }
}

function SignaturePad({ onSignature }) {
  const [mode, setMode] = useState('draw')
  const [ink, setInk] = useState('#111111')
  const [typed, setTyped] = useState('')
  const canvas = useRef(null)
  const drawing = useRef(false)

  const clear = () => { const c = canvas.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onSignature(null) }
  useEffect(clear, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'type') return
    const c = canvas.current
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    g.font = 'italic 72px "Segoe Script", "Brush Script MT", "URW Chancery L", cursive'
    g.fillStyle = ink
    g.textBaseline = 'middle'
    g.fillText(typed, 20, c.height / 2, c.width - 40)
    exportSignature(c).then(onSignature)
  }, [mode, typed, ink]) // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return [((e.clientX - r.left) * canvas.current.width) / r.width, ((e.clientY - r.top) * canvas.current.height) / r.height]
  }
  const down = (e) => {
    if (mode !== 'draw') return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const g = canvas.current.getContext('2d')
    Object.assign(g, { lineWidth: 5, lineCap: 'round', lineJoin: 'round', strokeStyle: ink })
    g.beginPath()
    g.moveTo(...point(e))
  }
  const move = (e) => {
    if (!drawing.current) return
    const g = canvas.current.getContext('2d')
    g.lineTo(...point(e))
    g.stroke()
  }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false
    exportSignature(canvas.current).then(onSignature)
  }
  async function upload(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const bitmap = await createImageBitmap(file).catch(() => null)
    if (!bitmap) return
    const c = canvas.current
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    const s = Math.min(c.width / bitmap.width, c.height / bitmap.height)
    g.drawImage(bitmap, 0, 0, bitmap.width * s, bitmap.height * s)
    onSignature(await exportSignature(c))
  }

  return (
    <fieldset className="options sign-pad">
      <legend>Your signature</legend>
      <div className="tabs" role="group" aria-label="How to sign">
        {['draw', 'type', 'image'].map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
        ))}
        {mode !== 'image' && (
          <select aria-label="Ink colour" value={ink} onChange={(e) => setInk(e.target.value)}>
            {Object.entries(INK).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        {mode === 'draw' && <button type="button" onClick={clear}>Clear</button>}
      </div>
      {mode === 'type' && <input aria-label="Type your name" placeholder="Type your name" value={typed} onChange={(e) => setTyped(e.target.value)} />}
      {mode === 'image' && <input type="file" aria-label="Signature image" accept="image/png,image/jpeg,image/webp" onChange={upload} />}
      <canvas
        ref={canvas} width={900} height={260} className={`pad ${mode}`}
        aria-label={mode === 'draw' ? 'Draw your signature here' : 'Signature preview'}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      />
    </fieldset>
  )
}

export default function Sign({ file, onChange, onError }) {
  const [sig, setSig] = useState(null)
  const [marks, setMarks] = useState([])
  const [size, setSize] = useState(0.25)
  const pdf = usePdf(file, onError)
  const [n, setN] = useState(0)
  const page = usePageImage(pdf, n, onError)

  useEffect(() => { setMarks([]); setN(0) }, [file])
  useEffect(() => { onChange(sig ? { image: sig.data, marks } : null) }, [sig, marks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Height of a mark as a fraction of the page height.
  const h = (w) => w * sig.aspect * page.ratio
  function place(e) {
    if (!sig || !page) return
    const r = e.currentTarget.getBoundingClientRect()
    const clamp = (v, max) => Math.min(Math.max(v, 0), max)
    const x = clamp((e.clientX - r.left) / r.width - size / 2, 1 - size)
    const y = clamp((e.clientY - r.top) / r.height - h(size) / 2, 1 - h(size))
    setMarks([...marks, { page: n, x, y, w: size }])
  }
  const here = marks.map((m, k) => ({ ...m, k })).filter((m) => m.page === n)
  const everyPage = () => {
    const last = here.at(-1)
    setMarks([...marks.filter((m) => m.page === n), ...Array.from({ length: pdf.numPages }, (_, p) => ({ ...last, page: p })).filter((m) => m.page !== n)])
  }

  return (
    <>
      <SignaturePad onSignature={setSig} />
      {pdf && (
        <div className="sign-page">
          <Pager pdf={pdf} n={n} setN={setN}>
            <label className="inline">Size <input type="range" min="0.08" max="0.6" step="0.01" value={size} onChange={(e) => setSize(+e.target.value)} /></label>{' '}
            {here.length > 0 && pdf.numPages > 1 && <button type="button" onClick={everyPage}>Same place on every page</button>}
          </Pager>
          <p className="hint">{sig ? 'Click on the page to place your signature. Click a signature to remove it.' : 'Make your signature above first.'}</p>
          {page && (
            <div className={`sheet${sig ? ' armed' : ''}`} onClick={place}>
              <img src={page.url} alt={`Page ${n + 1}`} />
              {sig && here.map((m) => (
                <img
                  key={m.k} src={sig.url} alt="Signature (click to remove)" className="mark"
                  style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%` }}
                  onClick={(e) => { e.stopPropagation(); setMarks(marks.filter((_, j) => j !== m.k)) }}
                />
              ))}
            </div>
          )}
          <p className="hint">{marks.length} signature{marks.length === 1 ? '' : 's'} placed.</p>
        </div>
      )}
    </>
  )
}
