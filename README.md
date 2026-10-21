# Libre PDF

Free, open-source PDF tools at **[libre-pdf.org](https://libre-pdf.org)** — everything iLovePDF does, including its
paid tools: merge, split, remove / extract / organize pages, rotate, compress, OCR, repair, scan to PDF, images and
Office documents to PDF, PDF to JPG / Word / Excel / PowerPoint / Markdown / PDF/A, edit, forms, page numbers,
watermark, crop, sign, redact, protect, unlock and compare.
No account, no upload, no limits: **everything runs in your browser** and your files never leave your device.

## How it works

- **`src/pdf.js`** — every PDF operation, as pure functions (files in, files out) on top of
  [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (the maintained `@cantoo` fork, which adds AES-256 encryption).
  Runs in a Web Worker (`src/worker.js`) so big files don't freeze the page.
- **`src/render.js`** — tools that need [pdf.js](https://mozilla.github.io/pdf.js/) or a canvas and so run in the page:
  thumbnails, PDF to JPG / PowerPoint ([PptxGenJS](https://gitbrent.github.io/PptxGenJS/)) / Markdown, OCR, and the
  deep-recovery fallback of Repair.
- **OCR** — [tesseract.js](https://tesseract.projectnaptha.com/) renders each page's text as an invisible text-only PDF
  page, which is laid over the original page, so the PDF looks the same but becomes searchable.
  Languages: English, Portuguese, Spanish, French, German, Italian.
- **`src/text.js`** — text structure (headings, paragraphs, lists, tables) for Markdown / Word / Excel,
  and the word diff used by Compare. **`src/office.js`** writes .docx and .xlsx directly (zipped XML).
- **Office to PDF** — `src/libreoffice.js` runs LibreOffice compiled to WebAssembly
  ([@matbee/libreoffice-converter](https://www.npmjs.com/package/@matbee/libreoffice-converter), MPL-2.0). Cloudflare
  serves files up to 25 MiB, so the build gzips its two big files and cuts them into chunks; the page joins and unzips
  them (~80 MB, downloaded only when someone uses the tool, then kept in Cache Storage). It needs SharedArrayBuffer,
  hence the `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers.
- **Redact** flattens the redacted pages to images (with the boxes burned in) and drops everything they referenced,
  so no hidden text survives. **PDF/A** does the same for pages whose fonts aren't embedded.
  shared with [Libre CV](https://github.com/guipguia/libre-cv)).
- **`src/Sign.jsx`, `Redact.jsx`, `Editor.jsx`, `Forms.jsx`, `Compare.jsx`, `PageGrid.jsx`** — the tools with their own UI
  (`usePage.jsx` holds the shared page preview).
- **`src/tools.js`** — the tool list: title, options form, which operation to run. Adding a tool is usually one
  entry here plus one function in `pdf.js`.
- Several output files are zipped with [fflate](https://github.com/101arrowz/fflate).

## Privacy

No backend, no database, no cookies, no analytics. pdf.js fonts, CMaps and WASM, the OCR engine and language data, and LibreOffice are self-hosted
(`scripts/copy-assets.js` copies them from `node_modules` into `public/vendor`), and a strict
Content-Security-Policy (`public/_headers`) stops the page from contacting any other server. See `public/privacy.html`.

## Development

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests for every operation
npm run build   # runs the tests, then builds the static site in dist/
npx wrangler dev  # serves dist/ exactly like Cloudflare, with the headers from public/_headers
```

`public/_headers` matters: the strict CSP keeps every page from talking to any other server, and the
cross-origin isolation headers let LibreOffice use SharedArrayBuffer. LibreOffice's own scripts (`/vendor/lo/*`) get a
CSP that also allows `unsafe-eval`, because Emscripten's embind builds functions at run time; they still cannot
connect anywhere but this site.

## Deployment (Cloudflare Workers)

The site is deployed as a static-assets-only Worker (`wrangler.jsonc`): no server code runs. Tool pages such as
`/merge-pdf` are client-side routes, so unknown paths fall back to `index.html`.

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `guipguia/libre-pdf`.
2. Deploy command `npx wrangler deploy` (the default). Wrangler runs `npm run build`, which runs the tests first.
3. Settings → Domains & Routes → add the custom domain.
4. Keep Web Analytics and Workers Logs **off**.

## License

MIT
