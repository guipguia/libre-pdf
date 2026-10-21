// Minimal Word (.docx) and Excel (.xlsx) writers: just the XML parts Office needs, zipped with fflate.
import { strToU8, zipSync } from 'fflate'

// XML-escape and drop control characters XML forbids.
const x = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006'
const rels = (list) => `${HEAD}<Relationships xmlns="${PKG}/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`
const types = (overrides) => `${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`).join('')}</Types>`
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
const STYLES = `${HEAD}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}</w:styles>`

/** Blocks from text.js toBlocks -> .docx. A new PDF page starts a new Word page. */
export function docx(blocks) {
  let page = blocks[0]?.page
  const body = blocks.map((b) => {
    const br = b.page !== page ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''
    page = b.page
    const pPr = b.heading ? `<w:pPr><w:pStyle w:val="Heading${b.heading}"/></w:pPr>` : b.prefix ? '<w:pPr><w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360"/></w:pPr>' : ''
    const text = b.prefix ? `${b.prefix === '- ' ? '•' : b.prefix.trim()}\t${b.text}` : b.text
    return `${br}<w:p>${pPr}<w:r><w:t xml:space="preserve">${x(text).replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')}</w:t></w:r></w:p>`
  }).join('')
  return zip({
    '[Content_Types].xml': types([['/word/document.xml', 'wordprocessingml.document.main+xml'], ['/word/styles.xml', 'wordprocessingml.styles+xml']]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/_rels/document.xml.rels': rels([['rId1', 'styles', 'styles.xml']]),
    'word/styles.xml': STYLES,
    'word/document.xml': `${HEAD}<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  })
}

/** Column number (0-based) -> Excel letters: 0 -> A, 26 -> AA. */
export const col = (n) => (n >= 26 ? col(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + (n % 26))

// "1,234.50" or "-12" -> number; anything else stays text.
export function number(s) {
  const t = s.trim()
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t)) return null
  return Number(t.replace(/,/g, ''))
}

/** [{ name, rows: string[][] }] -> .xlsx, one worksheet each. Numbers become real numbers. */
export function xlsx(sheets) {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const sheetXml = (rows) => `${HEAD}<worksheet xmlns="${S}"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, k) => {
    if (v === '') return ''
    const ref = `${col(k)}${i + 1}`
    const n = number(v)
    return n === null ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>` : `<c r="${ref}"><v>${n}</v></c>`
  }).join('')}</row>`).join('')}</sheetData></worksheet>`
  const files = {
    '[Content_Types].xml': types([['/xl/workbook.xml', 'spreadsheetml.sheet.main+xml'], ...sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, 'spreadsheetml.worksheet+xml'])]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/_rels/workbook.xml.rels': rels(sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`])),
    'xl/workbook.xml': `${HEAD}<workbook xmlns="${S}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${x(s.name.replace(/[[\]:*?/\\]/g, '').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  }
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s.rows) })
  return zip(files)
}
