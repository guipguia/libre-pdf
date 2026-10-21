// Copies pdf.js and tesseract.js runtime files into public/vendor so the site never loads anything from a third-party CDN
// (privacy: no visitor IP leaks), and writes the sitemap from the tool list.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { TOOLS } from '../src/tools.js'

const SITE = 'https://libre-pdf.org'
const out = 'public/vendor'
for (const dir of ['pdfjs', 'tesseract']) rmSync(`${out}/${dir}`, { recursive: true, force: true })
const copy = (from, to) => cpSync(`node_modules/${from}`, `${out}/${to}`, { recursive: true })

for (const dir of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) copy(`pdfjs-dist/${dir}`, `pdfjs/${dir}`)
copy('tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js')
for (const v of ['', '-simd', '-relaxedsimd']) {
  copy(`tesseract.js-core/tesseract-core${v}-lstm.wasm.js`, `tesseract/tesseract-core${v}-lstm.wasm.js`)
}
for (const lang of ['eng', 'por', 'spa', 'fra', 'deu', 'ita']) {
  copy(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `tesseract/${lang}.traineddata.gz`)
}
// Apache-2.0 requires shipping the license with redistributed files.
copy('pdfjs-dist/LICENSE', 'pdfjs/LICENSE')
copy('tesseract.js/dist/worker.min.js.LICENSE.txt', 'tesseract/worker.min.js.LICENSE.txt')
copy('tesseract.js-core/LICENSE', 'tesseract/LICENSE-tesseract.js-core')

// LibreOffice (Office to PDF). Cloudflare serves files up to 25 MiB, so the two big files are gzipped and cut into
// 24 MiB chunks that the page joins and unzips (src/libreoffice.js). Slow, so skipped when this version is already there.
const LO = 'node_modules/@matbee/libreoffice-converter'
const version = `${JSON.parse(readFileSync(`${LO}/package.json`, 'utf8')).version}-p1` // -pN: bump when the patch below changes
const manifestPath = `${out}/lo/manifest.json`
if (!existsSync(manifestPath) || JSON.parse(readFileSync(manifestPath, 'utf8')).version !== version) {
  rmSync(`${out}/lo`, { recursive: true, force: true })
  mkdirSync(`${out}/lo`, { recursive: true })
  for (const f of ['wasm/soffice.js', 'wasm/soffice.worker.js']) cpSync(`${LO}/${f}`, `${out}/lo/${f.split('/')[1]}`)
  // Starting LibreOffice can take over the package's hard-coded 2 minutes on a slow computer: allow 10.
  const worker = readFileSync(`${LO}/dist/browser.worker.global.js`, 'utf8')
  const patched = worker.replace('"WASM initialization timeout")),12e4)', '"WASM initialization timeout")),6e5)')
  if (patched === worker) throw new Error('LibreOffice worker patch no longer applies: check the init timeout in browser.worker.global.js')
  writeFileSync(`${out}/lo/browser.worker.global.js`, patched)
  const manifest = { version }
  for (const name of ['soffice.wasm', 'soffice.data']) {
    const gz = gzipSync(readFileSync(`${LO}/wasm/${name}`), { level: 9 })
    const CHUNK = 24 * 1024 * 1024
    manifest[name] = { size: gz.length, parts: [] }
    for (let i = 0; i * CHUNK < gz.length; i++) {
      const part = `${name}.gz.${i}`
      writeFileSync(`${out}/lo/${part}`, gz.subarray(i * CHUNK, (i + 1) * CHUNK))
      manifest[name].parts.push(part)
    }
  }
  writeFileSync(`${out}/lo/LICENSE.txt`, 'LibreOffice WebAssembly build from @matbee/libreoffice-converter ' + version + ', MPL-2.0.\n'
    + 'Modified: browser.worker.global.js waits 10 minutes instead of 2 for LibreOffice to start (scripts/copy-assets.js).\n'
    + 'Source: https://github.com/matbeedotcom/libreoffice-document-converter and https://www.libreoffice.org/about-us/source-code/\n'
    + 'License text: https://www.mozilla.org/MPL/2.0/\n')
  writeFileSync(manifestPath, JSON.stringify(manifest))
}

const urls = ['', ...TOOLS.map((t) => t.slug)].map((p) => `  <url><loc>${SITE}/${p}</loc></url>`)
writeFileSync('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
