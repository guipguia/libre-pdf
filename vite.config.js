import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation (SharedArrayBuffer) for the LibreOffice converter. Production headers, CSP included, come
// from public/_headers: test them locally with `npx wrangler dev`.
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

export default defineConfig({ plugins: [react()], worker: { format: 'es' }, server: { headers }, preview: { headers } })
