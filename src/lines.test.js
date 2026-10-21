import { expect, test } from 'vitest'
import { toLines } from './lines.js'

// Fake pdf.js text item: width ~ half a font size per character, y grows upwards (PDF coordinates).
const item = (str, x, y, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size })
const text = (items) => toLines(items, 1).map((l) => l.text)
const column = (x, top, lines, size) => lines.map((s, i) => item(s, x, top - i * 14, size))

test('LinkedIn-style: contact sidebar on the left, name in the main column', () => {
  const items = [
    ...column(30, 800, ['Contact', 'jane@example.com', '+351 912 345 678 (Mobile)', 'www.linkedin.com/in/janedoe', '(LinkedIn)',
      'Top Skills', 'Python', 'Kubernetes', 'Languages', 'English (Native or Bilingual)', 'Portuguese (Professional Working)']),
    item('Jane Doe', 260, 800, 24),
    ...column(260, 770, ['Senior Software Engineer at Acme', 'Lisbon, Lisbon, Portugal', 'Experience', 'Acme Corp',
      'Senior Software Engineer', 'March 2020 - Present (4 years 7 months)', 'Built the billing platform for every European market.']),
  ]
  const lines = text(items)
  expect(lines.slice(0, 3)).toEqual(['Jane Doe', 'Senior Software Engineer at Acme', 'Lisbon, Lisbon, Portugal'])
  expect(lines).toContain('www.linkedin.com/in/janedoe') // sidebar lines kept whole, not glued to main lines
})

test('name above two columns: its column is read first, each column whole', () => {
  const items = [
    item('Jane Doe', 220, 820, 24),
    ...column(30, 780, ['SKILLS', 'Python', 'Docker', 'Go', 'SQL']),
    ...column(250, 780, ['EXPERIENCE', 'Engineer', 'Acme Corp', 'Built many useful services for customers', 'Led a team of five people']),
  ]
  expect(text(items)).toEqual(['Jane Doe', 'EXPERIENCE', 'Engineer', 'Acme Corp', 'Built many useful services for customers',
    'Led a team of five people', 'SKILLS', 'Python', 'Docker', 'Go', 'SQL'])
})

test('single column with right-aligned dates is not split', () => {
  const rows = [['Senior Engineer', 'Mar 2020 – Present'], ['Acme Corp', 'Lisbon'], ['Developer', 'Jan 2015 – Feb 2020'],
    ['Beta Ltd', 'Porto'], ['Intern', 'Jun 2014 – Dec 2014'], ['Gamma', 'Braga'], ['Teacher', 'Sep 2010 – Jun 2013']]
  const items = rows.flatMap(([l, r], i) => [item(l, 30, 800 - i * 14), item(r, 450, 800 - i * 14)])
  expect(text(items)[0]).toBe('Senior Engineer   Mar 2020 – Present')
})

test('Europass-style dates column on the left is not split', () => {
  const rows = [['2020 – Present', 'Senior Engineer, Acme Corp'], ['', 'Built the billing system'], ['2015 – 2020', 'Developer, Beta Ltd'],
    ['', 'Wrote services'], ['2012 – 2015', 'Intern, Gamma'], ['', 'Fixed bugs'], ['2010 – 2012', 'Teacher, School']]
  const items = rows.flatMap(([l, r], i) => [...(l ? [item(l, 30, 800 - i * 14)] : []), item(r, 200, 800 - i * 14)])
  expect(text(items)[0]).toBe('2020 – Present   Senior Engineer, Acme Corp')
})
