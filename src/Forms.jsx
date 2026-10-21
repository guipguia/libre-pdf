// PDF forms: fill in an existing form, or draw new fields (or detect blank lines and boxes) to make one fillable.
// Reports { mode: 'fill', values, flatten } or { mode: 'create', fields } through onChange.
import { useEffect, useState } from 'react'
import { matchBoxes } from './render.js'
import { runInWorker } from './runWorker.js'
import { Pager, RectSheet, usePageImage, usePdf } from './usePage.jsx'

const KINDS = { text: 'Text', multiline: 'Text (several lines)', checkbox: 'Checkbox' }

function Fill({ fields, onChange }) {
  const [values, setValues] = useState({})
  const [flatten, setFlatten] = useState(false)
  useEffect(() => { onChange({ mode: 'fill', values, flatten }) }, [values, flatten]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (name, v) => setValues({ ...values, [name]: v })
  return (
    <fieldset className="options">
      <legend>Fill in ({fields.length} field{fields.length === 1 ? '' : 's'})</legend>
      {fields.map((f) => {
        const value = values[f.name] ?? f.value
        return (
          <label key={f.name} className={f.type === 'checkbox' ? 'check' : f.multiline ? 'wide' : ''}>
            {f.type === 'checkbox' && <input type="checkbox" checked={value} onChange={(e) => set(f.name, e.target.checked)} />}
            {f.name}
            {f.type === 'text' && (f.multiline
              ? <textarea rows={3} value={value} onChange={(e) => set(f.name, e.target.value)} />
              : <input value={value} onChange={(e) => set(f.name, e.target.value)} />)}
            {['radio', 'dropdown', 'list'].includes(f.type) && (
              <select value={value} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </label>
        )
      })}
      <label className="check wide"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />Flatten: make the answers part of the page so they can no longer be changed</label>
    </fieldset>
  )
}

function Create({ file, onChange, onError }) {
  const pdf = usePdf(file, onError)
  const [n, setN] = useState(0)
  const page = usePageImage(pdf, n, onError)
  const [fields, setFields] = useState([])
  const [kind, setKind] = useState('text')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { onChange({ mode: 'create', fields }) }, [fields]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = (prefix) => `${prefix}_${fields.length + 1}`
  async function detect() {
    const found = []
    for (let p = 0; p < pdf.numPages; p++) {
      const pg = await pdf.getPage(p + 1)
      // Runs of underscores are blanks to write on; box characters are checkboxes.
      for (const m of await matchBoxes(pg, /_{4,}/g)) found.push({ page: p, type: 'text', x: m.box[0], y: m.box[1] - m.box[3] * 0.3, w: m.box[2], h: m.box[3] * 1.2 })
      for (const m of await matchBoxes(pg, /[☐□❏■▢]/g)) found.push({ page: p, type: 'checkbox', x: m.box[0], y: m.box[1], w: m.box[2], h: m.box[3] })
    }
    setFields([...fields, ...found.map((f, k) => ({ ...f, name: `${f.type === 'checkbox' ? 'check' : 'field'}_${fields.length + k + 1}` }))])
    setNote(found.length ? `Found ${found.length} blank${found.length === 1 ? '' : 's'}. Check them on every page.` : 'No blank lines (____) or boxes (☐) found in the text. Draw the fields instead.')
  }

  if (!pdf) return null
  const here = fields.map((f, k) => ({ ...f, k, label: f.name })).filter((f) => f.page === n)
  return (
    <>
      <fieldset className="options">
        <legend>New field</legend>
        <label>Type<select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Name<input value={name} placeholder={next(kind === 'checkbox' ? 'check' : 'field')} onChange={(e) => setName(e.target.value)} /></label>
        <div><button type="button" onClick={detect}>Detect blanks automatically</button></div>
        {note && <p className="hint wide">{note}</p>}
      </fieldset>
      <Pager pdf={pdf} n={n} setN={setN}><span className="hint">{fields.length} new field{fields.length === 1 ? '' : 's'}</span></Pager>
      <p className="hint">Drag on the page to draw a field. Click a field to remove it.</p>
      {page && (
        <RectSheet
          page={page} rects={here} kind="field"
          onAdd={(r) => { setFields([...fields, { ...r, page: n, type: kind, name: name.trim() || next(kind === 'checkbox' ? 'check' : 'field') }]); setName('') }}
          onRemove={(k) => setFields(fields.filter((_, j) => j !== here[k].k))}
        />
      )}
    </>
  )
}

export default function Forms({ file, onChange, onError }) {
  const [fields, setFields] = useState(null)
  const [mode, setMode] = useState(null)
  useEffect(() => {
    let cancelled = false
    setFields(null)
    runInWorker('formFields', [file], {}).then((list) => {
      if (cancelled) return
      setFields(list)
      setMode(list.length ? 'fill' : 'create')
    }, (err) => onError(err.message))
    return () => { cancelled = true }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!fields) return <p className="hint">Reading the form…</p>
  return (
    <>
      <div className="tabs" role="group" aria-label="What to do">
        <button type="button" aria-pressed={mode === 'fill'} disabled={!fields.length} onClick={() => setMode('fill')}>Fill in</button>
        <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Add fields</button>
        {!fields.length && <span className="hint">This PDF has no fillable fields yet: draw some to make it a form.</span>}
      </div>
      {mode === 'fill' ? <Fill fields={fields} onChange={onChange} /> : <Create file={file} onChange={onChange} onError={onError} />}
    </>
  )
}
