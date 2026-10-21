// Text helpers for PDF to Markdown and Compare. Pure, so they can be unit tested.

const BULLET = /^[•●▪◦‣∙·*–-]\s+/
const NUMBERED = /^\d{1,3}[.)]\s+/
const PAGE_NUMBER = /^(page\s+)?\d{1,4}(\s*(\/|of)\s*\d{1,4})?$/i

/**
 * Lines from lines.js -> blocks ({ heading: 1-3 } | { prefix: '- ' | '1. ' } | {}, with text and page). Headings come
 * from font size relative to the body text, paragraphs from vertical gaps, lists from bullet / number prefixes.
 * Page numbers in headers / footers are dropped. ponytail: no tables, links or bold; add when someone needs them.
 */
export function toBlocks(lines) {
  // Page numbers sit first or last on their page.
  lines = lines.filter((l, i) => !(PAGE_NUMBER.test(l.text) && (lines[i - 1]?.page !== l.page || lines[i + 1]?.page !== l.page)))
  // Body size = the size carrying the most characters.
  const weight = {}
  for (const l of lines) weight[l.size] = (weight[l.size] ?? 0) + l.text.length
  const body = +Object.entries(weight).sort((a, b) => b[1] - a[1])[0]?.[0] || 10

  const blocks = []
  let block = null
  let prev = null
  const flush = () => { if (block) blocks.push(block); block = null }
  for (const l of lines) {
    const r = l.size / body
    const level = r >= 1.6 ? 1 : r >= 1.3 ? 2 : r >= 1.12 ? 3 : 0
    const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity
    if (level) {
      // A heading wrapped over two lines stays one heading.
      if (block?.heading === level && gap < l.size * 1.6) block.text += ` ${l.text}`
      else { flush(); block = { heading: level, text: l.text, page: l.page } }
    } else if (BULLET.test(l.text) || NUMBERED.test(l.text)) {
      flush()
      block = { prefix: NUMBERED.test(l.text) ? l.text.match(NUMBERED)[0].trim() + ' ' : '- ', text: l.text.replace(BULLET, '').replace(NUMBERED, ''), page: l.page }
    } else if (block && !block.heading && gap < Math.max(prev.size, l.size) * 1.8) {
      block.text = block.text.endsWith('-') && /^\p{Ll}/u.test(l.text) ? block.text.slice(0, -1) + l.text : `${block.text} ${l.text}`
    } else {
      flush()
      block = { text: l.text, page: l.page }
    }
    prev = l
  }
  flush()
  return blocks
}

export function toMarkdown(lines) {
  const blocks = toBlocks(lines)
  // Blank line between blocks, except between list items so they render as one list.
  const render = (b) => (b.heading ? `${'#'.repeat(b.heading)} ` : b.prefix ?? '') + b.text
  return blocks.map((b, i) => (i ? (b.prefix && blocks[i - 1].prefix ? '\n' : '\n\n') : '') + render(b)).join('') + '\n'
}

/**
 * Myers diff of two token arrays. Returns [{ op: '=' | '-' | '+', a?: index in a, b?: index in b }] in order.
 * Memory grows with the square of the number of differences, not the document size, so it gives up past `maxD`.
 */
export function diff(a, b, maxD = 4000) {
  const n = a.length
  const m = b.length
  const max = n + m
  const v = new Int32Array(2 * max + 2)
  const off = max + 1
  const trace = []
  search: for (let d = 0; d <= max; d++) {
    if (d > maxD) throw new Error('The documents are too different to compare word by word.')
    trace.push(v.slice(off - d - 1, off + d + 2)) // v before step d, k in [-d-1, d+1] at index k + d + 1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) break search
    }
  }
  const edits = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d]
    const at = (k) => t[k + d + 1]
    const k = x - y
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const px = d ? at(pk) : 0
    const py = d ? px - pk : 0
    while (x > px && y > py) edits.push({ op: '=', a: --x, b: --y })
    if (d) edits.push(x === px ? { op: '+', b: --y } : { op: '-', a: --x })
  }
  return edits.reverse()
}

/**
 * One page's pdf.js text items -> rows of cells. Columns are found from the rows that have several cells: the
 * horizontal spans their cells cover, merged where they overlap. Text runs split on wide gaps (2+ spaces).
 */
export function toTable(items) {
  const chunks = []
  for (const it of items) {
    if (!it.str?.trim()) continue
    const [, , c, d, e, f] = it.transform
    const size = Math.hypot(c, d) || it.height || 10
    for (const m of it.str.matchAll(/\S+(?: \S+)*/g)) {
      const x0 = e + (it.width * m.index) / it.str.length
      chunks.push({ text: m[0], x0, x1: x0 + (it.width * m[0].length) / it.str.length, y: f, size })
    }
  }
  const rows = []
  for (const ch of chunks.sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
    const row = rows.find((r) => Math.abs(r.y - ch.y) < Math.max(r.size, ch.size) * 0.5)
    if (row) row.cells.push(ch)
    else rows.push({ y: ch.y, size: ch.size, cells: [ch] })
  }
  for (const r of rows) r.cells.sort((a, b) => a.x0 - b.x0)
  // Column spans from multi-cell rows, merged when they overlap.
  const spans = rows.filter((r) => r.cells.length > 1).flatMap((r) => r.cells.map((ch) => [ch.x0, ch.x1])).sort((a, b) => a[0] - b[0])
  const cols = []
  for (const [a, b] of spans) {
    const last = cols.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else cols.push([a, b])
  }
  if (!cols.length) cols.push([-Infinity, Infinity])
  // Each cell goes to the column it overlaps most (or the nearest one).
  const colOf = (ch) => {
    let best = 0
    let score = -Infinity
    cols.forEach(([a, b], k) => {
      const s = Math.min(b, ch.x1) - Math.max(a, ch.x0)
      if (s > score) [best, score] = [k, s]
    })
    return best
  }
  return rows.map((r) => {
    const out = Array(cols.length).fill('')
    for (const ch of r.cells) { const k = colOf(ch); out[k] = out[k] ? `${out[k]} ${ch.text}` : ch.text }
    while (out.length && !out.at(-1)) out.pop()
    return out
  })
}
