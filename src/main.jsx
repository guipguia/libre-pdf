import { StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { zipSync } from 'fflate'
import { runInWorker } from './runWorker.js'
import { TOOLS } from './tools.js'
import './style.css'

const PageGrid = lazy(() => import('./PageGrid.jsx'))
const Sign = lazy(() => import('./Sign.jsx'))
const Compare = lazy(() => import('./Compare.jsx'))
const Redact = lazy(() => import('./Redact.jsx'))
const Editor = lazy(() => import('./Editor.jsx'))
const Forms = lazy(() => import('./Forms.jsx'))
const NAME = 'Libre PDF'
const GROUPS = [...new Set(TOOLS.map((t) => t.group))]

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000) // Safari needs the URL alive a bit after click()
}

const TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', md: 'text/markdown',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1)} MB`

// One file is saved as-is; several are zipped (stored, not compressed: PDFs and JPGs are compressed already).
function save(out, zipName) {
  if (out.length === 1) return download(out[0].name, out[0].data, TYPES[out[0].name.split('.').pop()]), out[0].name
  const entries = {}
  for (const f of out) {
    let name = f.name
    for (let k = 2; entries[name]; k++) name = f.name.replace(/(\.[^.]+)$/, ` (${k})$1`)
    entries[name] = f.data
  }
  download(zipName, zipSync(entries, { level: 0 }), 'application/zip')
  return zipName
}

const OFFICE = '.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp,.html,.htm,.epub'
const ACCEPT = { image: 'image/*', office: OFFICE, pdf: 'application/pdf,.pdf' }
const accepts = (tool, file) => tool.accept === 'image' ? file.type.startsWith('image/')
  : tool.accept === 'office' ? OFFICE.split(',').some((ext) => file.name.toLowerCase().endsWith(ext))
    : file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

function Link({ to, go, ...props }) {
  const onClick = (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return // let the browser open a new tab
    e.preventDefault()
    go(to)
  }
  return <a href={to} onClick={onClick} {...props} />
}

function Home({ go }) {
  return (
    <main className="home">
      <h1>Every PDF tool, right in your browser</h1>
      <p className="lead">Merge, split, convert and protect PDFs for free. Your files never leave your device: there is no upload, no account and no limit.</p>
      {GROUPS.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <ul className="tools">
            {TOOLS.filter((t) => t.group === g).map((t) => (
              <li key={t.slug}><Link to={`/${t.slug}`} go={go}><strong>{t.title}</strong><span>{t.desc}</span></Link></li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}

function Field({ f, value, onChange }) {
  const set = (e) => onChange(e.target.value)
  return (
    <label>
      {f.label}
      {f.type === 'select'
        ? <select value={value} onChange={set}>{Object.entries(f.choices).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        : <input type={f.type} value={value} onChange={set} min={f.min} max={f.max} autoComplete={f.autoComplete} />}
    </label>
  )
}

function ToolPage({ tool }) {
  const fields = tool.fields ?? []
  const [files, setFiles] = useState([])
  const [opts, setOpts] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value])))
  const [state, setState] = useState(null) // the tool's extra UI state (pages, signature…)
  const [status, setStatus] = useState({ text: '' })
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  function add(list) {
    const all = [...list]
    const ok = all.filter((f) => accepts(tool, f))
    setStatus({ text: ok.length < all.length ? `Skipped ${all.length - ok.length} file(s) of the wrong type.` : '', error: ok.length < all.length })
    if (!ok.length) return
    setFiles(tool.multiple ? [...files, ...ok].slice(0, tool.max) : [ok[0]])
  }
  const move = (k, d) => {
    const next = [...files]
    ;[next[k], next[k + d]] = [next[k + d], next[k]]
    setFiles(next)
  }

  async function run() {
    setBusy(true)
    setStatus({ text: 'Working…' })
    try {
      const o = tool.opts ? { ...opts, ...tool.opts(state) } : opts
      const out = tool.run
        ? await (await (tool.run === 'officeToPdf' ? import('./libreoffice.js') : import('./render.js')))[tool.run](files, o, (text) => setStatus({ text }))
        : await runInWorker(tool.op, files, o)
      const name = save(out, `${files[0].name.replace(/\.[^.]+$/, '')}_${tool.slug}.zip`)
      const total = (list) => list.reduce((n, f) => n + (f.size ?? f.data.length), 0)
      const sizes = tool.sizes ? ` (${mb(total(files))} → ${mb(total(out))})` : ''
      const notes = out.map((f) => f.note).filter(Boolean)
      setStatus({ text: `Done — saved ${name}${sizes}. Nothing was uploaded.${notes.length ? ` ${notes.join(' ')}` : ''}`, done: true })
    } catch (err) {
      setStatus({ text: err.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  const min = tool.op === 'merge' || tool.view === 'compare' ? 2 : 1
  const ready = files.length >= min && (tool.ready ? tool.ready(state) : !tool.view || state?.length > 0)
  const report = (text, error) => setStatus({ text, error })
  const type = ACCEPT[tool.accept ?? 'pdf']
  return (
    <main
      className={`tool${over ? ' over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget) || setOver(false)}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
    >
      <h1>{tool.title}</h1>
      <p className="lead">{tool.desc}</p>

      <label className="drop">
        <strong>{files.length && tool.multiple ? 'Add more files' : `Choose ${tool.multiple ? 'files' : 'a file'}`}</strong>
        <span>or drop {{ image: 'images', office: 'documents' }[tool.accept] ?? 'PDFs'} here</span>
        <input type="file" accept={type} multiple={tool.multiple} onChange={(e) => { add(e.target.files); e.target.value = '' }} hidden />
      </label>
      {tool.capture && (
        <label className="button camera">
          Take a photo
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { add(e.target.files); e.target.value = '' }} hidden />
        </label>
      )}

      {files.length > 0 && (tool.multiple || !tool.view) && (
        <ol className="files">
          {files.map((f, k) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}-${k}`}>
              <span className="fname">{f.name}</span>
              <span className="fsize">{(f.size / 1048576).toFixed(1)} MB</span>
              {tool.multiple && <>
                <button type="button" aria-label={`Move ${f.name} up`} disabled={!k} onClick={() => move(k, -1)}>↑</button>
                <button type="button" aria-label={`Move ${f.name} down`} disabled={k === files.length - 1} onClick={() => move(k, 1)}>↓</button>
              </>}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== k))}>✕</button>
            </li>
          ))}
        </ol>
      )}

      <Suspense fallback={<p>Loading…</p>}>
        {tool.view?.startsWith('grid') && files[0] && (
          <>
            <p className="hint"><strong>{files[0].name}</strong> — {tool.hint}</p>
            <PageGrid file={files[0]} mode={tool.view.slice(5)} pages={state ?? []} setPages={setState} onError={report} />
          </>
        )}
        {tool.view === 'sign' && files[0] && <Sign file={files[0]} onChange={setState} onError={report} />}
        {tool.view === 'redact' && files[0] && <Redact file={files[0]} onChange={setState} onError={report} />}
        {tool.view === 'edit' && files[0] && <Editor file={files[0]} onChange={setState} onError={report} />}
        {tool.view === 'forms' && files[0] && <Forms file={files[0]} onChange={setState} onError={report} />}
        {tool.view === 'compare' && files.length === 2 && <Compare files={files} onStatus={report} />}
      </Suspense>

      {tool.hint && !tool.view && <p className="hint">{tool.hint}</p>}

      {fields.length > 0 && (
        <fieldset className="options">
          <legend>Options</legend>
          {fields.filter((f) => !f.when || f.when(opts)).map((f) => (
            <Field key={f.key} f={f} value={opts[f.key]} onChange={(v) => setOpts({ ...opts, [f.key]: v })} />
          ))}
        </fieldset>
      )}

      {(tool.op || tool.run) && <div className="actions">
        <button type="button" className="primary" disabled={!ready || busy} onClick={run}>
          {busy ? 'Working…' : tool.title}
        </button>
        {min === 2 && files.length === 1 && <span className="hint">Add at least one more PDF.</span>}
      </div>}
      {tool.view === 'compare' && files.length < 2 && <p className="hint">Add the old version first, then the new one.</p>}
      {status.text && <p className={`status${status.error ? ' error' : ''}`} role="status">{status.text}</p>}
    </main>
  )
}

function App() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const sync = () => setPath(location.pathname)
    addEventListener('popstate', sync)
    return () => removeEventListener('popstate', sync)
  }, [])
  const go = (to) => {
    history.pushState(null, '', to)
    setPath(to)
    scrollTo(0, 0)
  }
  const tool = TOOLS.find((t) => `/${t.slug}` === path.replace(/\/$/, ''))
  useEffect(() => {
    document.title = tool ? `${tool.title} — free, private | ${NAME}` : `${NAME} — free PDF tools that run in your browser`
  }, [tool])

  return (
    <>
      <header className="top"><Link to="/" go={go} className="brand">{NAME}</Link><span>Your files never leave your device</span></header>
      {tool ? <ToolPage key={tool.slug} tool={tool} /> : <Home go={go} />}
      <footer>
        Everything runs in your browser — nothing is uploaded. Free and open source (MIT) ·{' '}
        <a href="https://github.com/guipguia/libre-pdf">GitHub</a> · <a href="/privacy">Privacy</a>
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
