// Edit PDF: add text, shapes, freehand drawing, highlights, whiteout and images on top of the pages.
// Objects are kept in points from the visible page's top-left corner (the same units pdf.js `edit` draws in).
import { useEffect, useRef, useState } from 'react'
import { Pager, frac, usePageImage, usePdf } from './usePage.jsx'

const MODES = { select: 'Select', text: 'Text', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', pen: 'Draw', highlight: 'Highlight', whiteout: 'Whiteout', image: 'Image' }
const BOXES = ['rect', 'ellipse', 'highlight', 'whiteout', 'image']

function shift(o, dx, dy) {
  if (o.type === 'line') return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
  if (o.type === 'pen') return { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy]) }
  return { ...o, x: o.x + dx, y: o.y + dy }
}

function Shape({ o, onDown }) {
  const box = { x: o.x, y: o.y, width: o.w, height: o.h, onPointerDown: onDown }
  const stroke = { stroke: o.color, strokeWidth: o.width, fill: o.fill ? o.color : 'none', strokeLinecap: 'round', strokeLinejoin: 'round', onPointerDown: onDown }
  switch (o.type) {
    case 'rect': return <rect {...box} {...stroke} />
    case 'ellipse': return <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} {...stroke} />
    case 'highlight': return <rect {...box} fill={o.color} fillOpacity={0.35} />
    case 'whiteout': return <rect {...box} fill="#fff" />
    case 'line': return <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} {...stroke} />
    case 'pen': return <polyline points={o.points.map((p) => p.join(',')).join(' ')} {...stroke} fill="none" />
    case 'image': return <image href={o.url} {...box} preserveAspectRatio="none" />
    case 'text': return (
      <text x={o.x} y={o.y + o.size * 0.8} fontSize={o.size} fill={o.color} fontFamily="Helvetica, Arial, sans-serif" onPointerDown={onDown}>
        {o.text.split('\n').map((line, i) => <tspan key={i} x={o.x} dy={i ? o.size * 1.2 : 0}>{line || ' '}</tspan>)}
      </text>
    )
  }
}

async function toPng(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { data: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), aspect: bitmap.height / bitmap.width }
}

export default function Editor({ file, onChange, onError }) {
  const pdf = usePdf(file, onError)
  const [n, setN] = useState(0)
  const page = usePageImage(pdf, n, onError)
  const [objects, setObjects] = useState([])
  const [mode, setMode] = useState('text')
  const [sel, setSel] = useState(null)
  const [style, setStyle] = useState({ color: '#c0392b', width: 2, size: 16, fill: false })
  const [picture, setPicture] = useState(null)
  const [draft, setDraft] = useState(null)
  const svg = useRef(null)
  const drag = useRef(null)

  useEffect(() => { setObjects([]); setN(0); setSel(null) }, [file])
  useEffect(() => { onChange({ objects: objects.map(({ url, ...o }) => o) }) }, [objects]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e) => {
      if (sel === null || !['Delete', 'Backspace'].includes(e.key) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return
      setObjects((all) => all.filter((_, k) => k !== sel))
      setSel(null)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [sel])

  const pt = (e) => { const [fx, fy] = frac(e, svg.current); return [fx * page.width, fy * page.height] }
  const add = (o) => { setObjects([...objects, { page: n, ...o }]); setSel(objects.length) }
  const update = (change) => {
    if (sel !== null) setObjects(objects.map((o, k) => (k === sel ? { ...o, ...change } : o)))
  }
  const restyle = (change) => { setStyle({ ...style, ...change }); update(change) }

  function down(e) {
    svg.current.setPointerCapture(e.pointerId)
    const [x, y] = pt(e)
    if (mode === 'select') return setSel(null)
    if (mode === 'text') { add({ type: 'text', x, y, text: 'Text', size: style.size, color: style.color }); setMode('select'); return }
    if (mode === 'image') {
      if (!picture) return onError('Choose an image first.')
      const w = page.width * 0.3
      add({ type: 'image', x, y, w, h: w * picture.aspect, data: picture.data, url: picture.url })
      setMode('select')
      return
    }
    const color = mode === 'highlight' ? '#ffeb3b' : style.color
    const o = mode === 'line' ? { type: 'line', x1: x, y1: y, x2: x, y2: y } : mode === 'pen' ? { type: 'pen', points: [[x, y]] } : { type: mode, x, y, w: 0, h: 0 }
    drag.current = { draw: true, start: [x, y] }
    setDraft({ page: n, ...o, color, width: style.width, fill: style.fill })
  }
  function grab(k, e) {
    if (mode !== 'select') return
    e.stopPropagation()
    svg.current.setPointerCapture(e.pointerId)
    setSel(k)
    drag.current = { last: pt(e) }
  }
  function move(e) {
    if (!drag.current) return
    const [x, y] = pt(e)
    if (drag.current.draw) {
      const [sx, sy] = drag.current.start
      setDraft((d) => d.type === 'line' ? { ...d, x2: x, y2: y }
        : d.type === 'pen' ? { ...d, points: [...d.points, [x, y]] }
        : { ...d, x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) })
    } else {
      const [lx, ly] = drag.current.last
      drag.current.last = [x, y]
      setObjects((all) => all.map((o, k) => (k === sel ? shift(o, x - lx, y - ly) : o)))
    }
  }
  function up() {
    if (drag.current?.draw && draft) {
      const big = draft.type === 'pen' ? draft.points.length > 1 : draft.type === 'line' ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 2 : draft.w > 2 && draft.h > 2
      if (big) add(draft)
    }
    drag.current = null
    setDraft(null)
  }

  if (!pdf) return null
  const selected = sel !== null ? objects[sel] : null
  return (
    <>
      <fieldset className="options editor">
        <legend>Tools</legend>
        <div className="tabs" role="group" aria-label="Tool">
          {Object.entries(MODES).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
          ))}
        </div>
        <label>Colour<input type="color" value={selected?.color ?? style.color} onChange={(e) => restyle({ color: e.target.value })} /></label>
        <label>Line width
          <select value={selected?.width ?? style.width} onChange={(e) => restyle({ width: +e.target.value })}>
            {[1, 2, 4, 8].map((w) => <option key={w} value={w}>{w} pt</option>)}
          </select>
        </label>
        <label>Text size<input type="number" min="4" max="200" value={selected?.size ?? style.size} onChange={(e) => restyle({ size: +e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={selected?.fill ?? style.fill} onChange={(e) => restyle({ fill: e.target.checked })} />Fill shapes</label>
        {mode === 'image' && <label>Image<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files[0]; if (f) setPicture(await toPng(f).catch(() => onError('This image cannot be read.'))) }} /></label>}
        {selected?.type === 'text' && <label className="wide">Selected text<textarea aria-label="Selected text" rows={3} value={selected.text} onChange={(e) => update({ text: e.target.value })} /></label>}
        {selected && <div className="wide"><button type="button" onClick={() => { setObjects(objects.filter((_, k) => k !== sel)); setSel(null) }}>Delete selected</button></div>}
      </fieldset>
      <Pager pdf={pdf} n={n} setN={(p) => { setN(p); setSel(null) }}>
        <span className="hint">{objects.length} item{objects.length === 1 ? '' : 's'} added</span>
      </Pager>
      <p className="hint">
        {mode === 'select' ? 'Click an item to select it, drag to move it, Delete to remove it.'
          : mode === 'text' ? 'Click where the text should start, then type it in the Text box above.'
            : mode === 'image' ? 'Choose an image, then click where it should go.' : 'Drag on the page to draw.'}
      </p>
      {page && (
        <div className="sheet">
          <img src={page.url} alt={`Page ${n + 1}`} draggable={false} />
          <svg
            ref={svg} className={`overlay ${mode}`} viewBox={`0 0 ${page.width} ${page.height}`}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          >
            {objects.map((o, k) => o.page === n && (
              <g key={k} className={k === sel ? 'sel' : ''}><Shape o={o} onDown={(e) => grab(k, e)} /></g>
            ))}
            {draft && <Shape o={draft} />}
          </svg>
        </div>
      )}
    </>
  )
}
