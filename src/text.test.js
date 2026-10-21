import { describe, expect, it } from 'vitest'
import { diff, toMarkdown } from './text.js'

describe('diff', () => {
  const apply = (a, b, edits) => edits.filter((e) => e.op !== '-').map((e) => (e.op === '=' ? a[e.a] : b[e.b]))
  const cases = [
    [[], []], ['abc'.split(''), []], [[], 'abc'.split('')], ['abcabba'.split(''), 'cbabac'.split('')],
    ['the quick brown fox'.split(' '), 'the slow brown dog jumps'.split(' ')],
  ]
  it('turns a into b with the fewest edits', () => {
    for (const [a, b] of cases) {
      const edits = diff(a, b)
      expect(apply(a, b, edits)).toEqual(b)
    }
    expect(diff('abcabba'.split(''), 'cbabac'.split('')).filter((e) => e.op !== '=')).toHaveLength(5)
    expect(() => diff('abcd'.split(''), 'wxyz'.split(''), 3)).toThrow(/too different/)
    expect(diff(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ op: '=', a: 0, b: 0 }, { op: '-', a: 1 }, { op: '+', b: 1 }, { op: '=', a: 2, b: 2 }])
  })
})

describe('toMarkdown', () => {
  const L = (text, size, y, page = 1) => ({ text, size, y, page })
  it('finds headings, paragraphs and lists, and drops page numbers', () => {
    const md = toMarkdown([
      L('Annual Report', 24, 800),
      L('Introduction', 14, 760),
      L('This is the first para-', 10, 740), L('graph of the text.', 10, 728),
      L('A second paragraph.', 10, 700),
      L('• first item', 10, 680), L('• second item', 10, 668), L('continues here', 10, 656),
      L('1. numbered', 10, 630),
      L('Page 3', 10, 40),
      L('Page 4 is mentioned here', 10, 800, 2), L('Page 4', 10, 600, 2), L('4', 10, 40, 2),
    ])
    expect(md).toBe('# Annual Report\n\n## Introduction\n\nThis is the first paragraph of the text.\n\nA second paragraph.\n\n'
      + '- first item\n- second item continues here\n1. numbered\n\nPage 4 is mentioned here\n\nPage 4\n')
  })
})
