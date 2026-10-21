// Run one pdf.js operation (see worker.js) in a fresh Web Worker. Files go in as File objects, results come back transferred.
export function runInWorker(op, files, opts) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    const done = () => worker.terminate()
    worker.onmessage = ({ data }) => { done(); data.error ? reject(new Error(data.error)) : resolve(data.out) }
    worker.onerror = (e) => { done(); reject(new Error(e.message || 'The browser ran out of memory. Try fewer or smaller files.')) }
    worker.postMessage({ op, files, opts })
  })
}
