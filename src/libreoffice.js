// Office to PDF with LibreOffice compiled to WebAssembly (@matbee/libreoffice-converter, MPL-2.0), self-hosted in
// vendor/lo as gzipped chunks (see scripts/copy-assets.js). The first use downloads ~80 MB, kept in Cache Storage.
const BASE = new URL(`${import.meta.env.BASE_URL}vendor/lo/`, location.href).href
const base = (name) => name.replace(/\.[^.]+$/, '')
let converter = null // one LibreOffice per tab: starting it takes a while, converting is quick after that

// Join a file's chunks, unzip them and keep the result in Cache Storage. Returns a blob: URL for the worker.
async function assemble(name, entry, version, onBytes) {
  const key = `libre-pdf-office-${version}`
  // Older versions are 250 MB each: drop them.
  for (const k of await caches.keys().catch(() => [])) if (k.startsWith('libre-pdf-office-') && k !== key) await caches.delete(k)
  const cache = await caches.open(key).catch(() => null)
  let res = await cache?.match(BASE + name)
  if (!res) {
    const body = new ReadableStream({
      async start(controller) {
        try {
          for (const part of entry.parts) {
            const r = await fetch(BASE + part)
            if (!r.ok) throw new Error(`Download failed (${r.status}). Check your connection and try again.`)
            const reader = r.body.getReader()
            for (let chunk; !(chunk = await reader.read()).done;) { controller.enqueue(chunk.value); onBytes(chunk.value.length) }
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })
    res = new Response(body.pipeThrough(new DecompressionStream('gzip')), { headers: { 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } })
    if (cache) { await cache.put(BASE + name, res); res = await cache.match(BASE + name) }
  }
  return URL.createObjectURL(await res.blob())
}

async function start(onStatus) {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw new Error('This browser cannot run the converter here (it needs SharedArrayBuffer). Try a recent Chrome, Edge or Firefox on a computer.')
  }
  const manifest = await (await fetch(`${BASE}manifest.json`)).json()
  const total = manifest['soffice.wasm'].size + manifest['soffice.data'].size
  let got = 0
  const onBytes = (n) => { got += n; onStatus(`Downloading the converter (only once): ${Math.round((got / total) * 100)}% of ${Math.round(total / 1048576)} MB…`) }
  onStatus('Preparing the converter…')
  const [wasm, data] = await Promise.all(['soffice.wasm', 'soffice.data'].map((n) => assemble(n, manifest[n], manifest.version, onBytes)))
  const { WorkerBrowserConverter } = await import('@matbee/libreoffice-converter/browser')
  const conv = new WorkerBrowserConverter({
    sofficeJs: `${BASE}soffice.js`, sofficeWasm: wasm, sofficeData: data, sofficeWorkerJs: `${BASE}soffice.worker.js`,
    browserWorkerJs: `${BASE}browser.worker.global.js`,
    onProgress: (p) => onStatus(`Starting LibreOffice (this can take a minute or two): ${Math.round(p.percent)}%…`),
  })
  await conv.initialize()
  return conv
}

export async function officeToPdf(files, _opts, onStatus) {
  converter ??= start(onStatus).catch((err) => { converter = null; throw err })
  const conv = await converter
  const out = []
  for (const file of files) {
    onStatus(`Converting ${file.name}…`)
    const result = await conv.convert(new Uint8Array(await file.arrayBuffer()), { outputFormat: 'pdf' }, file.name)
      .catch((err) => { throw new Error(`Could not convert ${file.name}: ${err.message}`) })
    out.push({ name: `${base(file.name)}.pdf`, data: result.data })
  }
  return out
}

/** Free the ~250 MB the converter keeps in this browser's storage. */
export async function forgetOffice() {
  for (const key of await caches.keys()) if (key.startsWith('libre-pdf-office-')) await caches.delete(key)
}
