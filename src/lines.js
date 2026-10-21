// pdf.js text items -> visual lines in reading order. Pure (no pdf.js import) so it can be unit tested.
// Shared with libre-cv (src/lines.js there); here rows also carry their baseline `y` for paragraph detection.

const YEAR = /(?:19|20)\d{2}/

/**
 * @param {{str: string, transform: number[], width: number, height: number}[]} items pdf.js getTextContent().items
 * @returns {{text: string, size: number, page: number, y: number}[]}
 */
export function toLines(items, page) {
  const parts = items
    .filter((it) => it.str !== undefined && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.hypot(it.transform[2], it.transform[3]) || it.height }))
  return splitColumns(parts).flatMap((col) => groupRows(col, page))
}

// Group parts into rows by y (top to bottom), and join each row left to right.
function groupRows(parts, page) {
  const rows = []
  for (const p of [...parts].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - p.y) < Math.max(r.size, p.size) * 0.5)
    if (row) { row.parts.push(p); row.size = Math.max(row.size, p.size) }
    else rows.push({ y: p.y, size: p.size, parts: [p] })
  }
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x)
    let text = ''
    let end = null
    for (const p of r.parts) {
      const gap = end === null ? 0 : p.x - end
      // Wide gaps (e.g. title on the left, dates on the right) become 3 spaces so the parser can split.
      text += end === null ? '' : gap > r.size * 2 ? '   ' : gap > r.size * 0.15 ? ' ' : ''
      text += p.str
      end = p.x + p.w
    }
    return { text: text.replace(/(\S) {2}(?=\S)/g, '$1 ').trim(), size: Math.round(r.size * 10) / 10, page, y: r.y }
  })
}

// Distinct baselines (rows) among parts.
const rowsOf = (parts) => {
  const ys = []
  for (const p of parts) if (!ys.some((y) => Math.abs(y - p.y) < p.size * 0.5)) ys.push(p.y)
  return ys
}

/**
 * Two-column layouts (sidebar CVs, LinkedIn exports): find an empty vertical gutter and return
 * [header, first column, second column], the column holding the biggest text (the name) first.
 * Returns [parts] unchanged for single-column pages, including "title ... dates" rows and
 * Europass-style "dates | content" layouts, where splitting would tear entries apart.
 * ponytail: one gutter per page; three-column layouts read as two.
 */
export function splitColumns(parts) {
  if (parts.length < 10) return [parts]
  const left = Math.min(...parts.map((p) => p.x))
  const right = Math.max(...parts.map((p) => p.x + p.w))
  const width = right - left

  // The x (between 20% and 80% of the text width) crossed by the fewest items; centre of the widest such run.
  let best = { crossing: Infinity, from: 0, to: 0 }
  for (let gx = left + width * 0.2; gx <= left + width * 0.8; gx += 1) {
    const crossing = parts.filter((p) => p.x < gx && p.x + p.w > gx).length
    if (crossing < best.crossing) best = { crossing, from: gx, to: gx }
    else if (crossing === best.crossing && gx - best.to <= 1) best.to = gx
  }
  if (best.crossing > Math.max(2, parts.length * 0.05)) return [parts]
  const gx = (best.from + best.to) / 2

  const spanning = parts.filter((p) => p.x < gx && p.x + p.w > gx)
  const a = parts.filter((p) => p.x + p.w <= gx)
  const b = parts.filter((p) => p.x >= gx)
  const aRows = rowsOf(a)
  const bRows = rowsOf(b)
  if (aRows.length < 4 || bRows.length < 4) return [parts]

  // A side that is mostly dates is a "title | dates" row layout or a Europass date gutter, not a column.
  const dateShare = (side) => side.filter((p) => YEAR.test(p.str)).length / side.length
  if (dateShare(a) > 0.35 || dateShare(b) > 0.35) return [parts]

  // Full-width items above both columns (a centred name) are the header; the rest join the first column.
  const top = Math.max(...a.map((p) => p.y), ...b.map((p) => p.y))
  const header = spanning.filter((p) => p.y > top)
  const rest = spanning.filter((p) => p.y <= top)
  const biggest = (side) => Math.max(0, ...side.map((p) => p.size))
  const cols = biggest(b) > biggest(a) + 0.5 ? [b, a] : [a, b]
  cols[0] = [...cols[0], ...rest]
  return [header, ...cols].filter((c) => c.length)
}
