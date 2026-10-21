import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { col, docx, number, xlsx } from './office.js'
import { toTable } from './text.js'

const item = (str, x, y, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size })

describe('toTable', () => {
  it('finds columns, including right-aligned numbers, and keeps title rows in column A', () => {
    const rows = toTable([
      item('Quarterly sales report for all regions', 50, 800),
      item('Region', 50, 760), item('Q1', 250, 760), item('Q2', 350, 760),
      item('North', 50, 740), item('1,200', 240, 740), item('900', 355, 740),
      item('South East', 50, 720), item('80', 255, 720), item('12,345.5', 330, 720),
    ])
    expect(rows).toEqual([
      ['Quarterly sales report for all regions'],
      ['Region', 'Q1', 'Q2'], ['North', '1,200', '900'], ['South East', '80', '12,345.5'],
    ])
  })
  it('splits a single text run on wide gaps', () => {
    expect(toTable([item('Name   Age', 50, 700), item('Ana    31', 50, 680)])).toEqual([['Name', 'Age'], ['Ana', '31']])
  })
})

describe('office files', () => {
  it('converts numbers and column names', () => {
    expect([number('1,234.50'), number('-12'), number('12a'), number('1,23')]).toEqual([1234.5, -12, null, null])
    expect([col(0), col(25), col(26), col(701)]).toEqual(['A', 'Z', 'AA', 'ZZ'])
  })
  it('writes a docx with headings, list items, escaping and page breaks', () => {
    const files = unzipSync(docx([{ heading: 1, text: 'Title', page: 1 }, { prefix: '- ', text: 'a < b & c', page: 1 }, { text: 'Next', page: 2 }]))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'])
    const doc = strFromU8(files['word/document.xml'])
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>')
    expect(doc).toContain('a &lt; b &amp; c')
    expect(doc).toContain('<w:br w:type="page"/>')
  })
  it('writes an xlsx with one sheet per page and numeric cells', () => {
    const files = unzipSync(xlsx([{ name: 'Page 1', rows: [['Name', '1,200']] }, { name: 'Page 2', rows: [['x']] }]))
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('<c r="B1"><v>1200</v></c>')
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Page 2"')
  })
})
