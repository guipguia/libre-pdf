// Every tool the site offers. Plain data (no imports) so scripts/copy-assets.js can build the sitemap from it.
// op: function name in pdf.js, run in a Web Worker. run: function name in render.js, run in the page (pdf.js / canvas).
// fields: options form; `when` hides a field. view: extra UI ('grid-select' | 'grid-organize' | 'sign' | 'compare')
// whose state `opts(state)` turns into op options and `ready(state)` checks. max: most files accepted.
// sizes: show input -> output size when done.

export const TOOLS = [
  {
    slug: 'merge-pdf', group: 'Organize', title: 'Merge PDF', op: 'merge', multiple: true,
    desc: 'Combine several PDFs into one, in the order you choose.',
  },
  {
    slug: 'split-pdf', group: 'Organize', title: 'Split PDF', op: 'split',
    desc: 'Split a PDF into several files, by page ranges or every few pages.',
    fields: [
      { key: 'mode', label: 'Split', type: 'select', value: 'every', choices: { every: 'Every N pages', ranges: 'By page ranges' } },
      { key: 'every', label: 'Pages per file', type: 'number', value: 1, min: 1, when: (o) => o.mode === 'every' },
      { key: 'ranges', label: 'Ranges, one file each (e.g. 1-3, 4, 5-)', type: 'text', value: '1-2, 3-', when: (o) => o.mode === 'ranges' },
    ],
  },
  {
    slug: 'remove-pages', group: 'Organize', title: 'Remove pages', op: 'pages', view: 'grid-select',
    desc: 'Delete pages from a PDF.', hint: 'Click the pages to remove.',
    opts: (pages) => ({ pages: pages.filter((p) => !p.sel), suffix: 'removed' }),
  },
  {
    slug: 'extract-pages', group: 'Organize', title: 'Extract pages', op: 'pages', view: 'grid-select',
    desc: 'Make a new PDF from only the pages you pick.', hint: 'Click the pages to keep.',
    opts: (pages) => ({ pages: pages.filter((p) => p.sel), suffix: 'extracted' }),
  },
  {
    slug: 'organize-pdf', group: 'Organize', title: 'Organize PDF', op: 'pages', view: 'grid-organize',
    desc: 'Reorder, rotate and delete pages.', hint: 'Drag pages to reorder them, or use the buttons under each page.',
    opts: (pages) => ({ pages, suffix: 'organized' }),
  },
  {
    slug: 'rotate-pdf', group: 'Organize', title: 'Rotate PDF', op: 'rotate', multiple: true,
    desc: 'Rotate every page of one or more PDFs.',
    fields: [{ key: 'angle', label: 'Rotate', type: 'select', value: '90', choices: { 90: '90° clockwise', 180: '180°', '-90': '90° counter-clockwise' } }],
  },
  {
    slug: 'compress-pdf', group: 'Optimize', title: 'Compress PDF', op: 'compress', multiple: true, sizes: true,
    desc: 'Make a PDF smaller by re-saving its images and removing unused data.',
    fields: [{
      key: 'level', label: 'Compression', type: 'select', value: 'medium',
      choices: { low: 'Low — best image quality', medium: 'Recommended', high: 'Extreme — smallest file, lower image quality' },
    }],
  },
  {
    slug: 'ocr-pdf', group: 'Optimize', title: 'OCR PDF', run: 'ocr', multiple: true,
    desc: 'Make scanned PDFs searchable: recognised text is added invisibly over each page.',
    fields: [
      { key: 'lang', label: 'Document language', type: 'select', value: 'eng', choices: { eng: 'English', por: 'Portuguese', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian' } },
      { key: 'skip', label: 'Pages with text', type: 'select', value: 'yes', choices: { yes: 'Skip pages that already have text', no: 'OCR every page' } },
    ],
  },
  {
    slug: 'repair-pdf', group: 'Optimize', title: 'Repair PDF', run: 'repair', multiple: true,
    desc: 'Recover a damaged PDF that will not open or shows errors.',
  },
  {
    slug: 'jpg-to-pdf', group: 'Convert', title: 'Images to PDF', op: 'imagesToPdf', multiple: true, accept: 'image',
    desc: 'Turn JPG, PNG, WebP and other images into a PDF, one image per page.',
    fields: [
      { key: 'size', label: 'Page size', type: 'select', value: 'A4', choices: { A4: 'A4', Letter: 'US Letter', fit: 'Same as image' } },
      { key: 'orientation', label: 'Orientation', type: 'select', value: 'auto', choices: { auto: 'Automatic', portrait: 'Portrait', landscape: 'Landscape' }, when: (o) => o.size !== 'fit' },
      { key: 'margin', label: 'Margin', type: 'select', value: '0', choices: { 0: 'None', 20: 'Small', 50: 'Large' } },
    ],
  },
  {
    slug: 'scan-to-pdf', group: 'Convert', title: 'Scan to PDF', op: 'imagesToPdf', multiple: true, accept: 'image', capture: true,
    desc: 'Photograph paper documents with your phone and turn them into a clean, readable PDF.',
    fields: [
      { key: 'filter', label: 'Clean-up', type: 'select', value: 'gray', choices: { gray: 'Greyscale, white paper', bw: 'Black and white (text only)', color: 'Keep colours' } },
      { key: 'size', label: 'Page size', type: 'select', value: 'A4', choices: { A4: 'A4', Letter: 'US Letter', fit: 'Same as image' } },
      { key: 'orientation', label: 'Orientation', type: 'select', value: 'auto', choices: { auto: 'Automatic', portrait: 'Portrait', landscape: 'Landscape' }, when: (o) => o.size !== 'fit' },
      { key: 'margin', label: 'Margin', type: 'select', value: '0', choices: { 0: 'None', 20: 'Small', 50: 'Large' } },
    ],
  },
  {
    slug: 'office-to-pdf', group: 'Convert', title: 'Office to PDF', run: 'officeToPdf', multiple: true, accept: 'office',
    desc: 'Convert Word, Excel, PowerPoint and OpenDocument files to PDF with LibreOffice, running in your browser.',
    hint: 'The first time, this downloads the LibreOffice converter (about 80 MB), then keeps it in your browser for next time. Works best on a computer.',
  },
  {
    slug: 'pdf-to-jpg', group: 'Convert', title: 'PDF to JPG', run: 'pdfToJpg', multiple: true,
    desc: 'Save every page of a PDF as a JPG image.',
    fields: [
      { key: 'dpi', label: 'Resolution', type: 'select', value: '150', choices: { 72: 'Low (72 dpi)', 150: 'Medium (150 dpi)', 300: 'High (300 dpi)' } },
      { key: 'quality', label: 'JPG quality', type: 'select', value: '0.85', choices: { 0.6: 'Smaller file', 0.85: 'Normal', 0.95: 'Best' } },
    ],
  },
  {
    slug: 'pdf-to-word', group: 'Convert', title: 'PDF to Word', run: 'pdfToWord', multiple: true,
    desc: 'Turn the text of a PDF into an editable Word document (.docx), with headings, paragraphs and lists.',
  },
  {
    slug: 'pdf-to-excel', group: 'Convert', title: 'PDF to Excel', run: 'pdfToExcel', multiple: true,
    desc: 'Pull tables out of a PDF into an Excel workbook (.xlsx), one sheet per page.',
  },
  {
    slug: 'pdf-to-powerpoint', group: 'Convert', title: 'PDF to PowerPoint', run: 'pdfToPptx', multiple: true,
    desc: 'Turn each page into a PowerPoint slide (.pptx).',
    fields: [{ key: 'dpi', label: 'Image quality', type: 'select', value: '150', choices: { 100: 'Smaller file', 150: 'Normal', 220: 'Sharp' } }],
  },
  {
    slug: 'pdf-to-markdown', group: 'Convert', title: 'PDF to Markdown', run: 'pdfToMarkdown', multiple: true,
    desc: 'Extract the text of a PDF as Markdown, with headings, paragraphs and lists.',
  },
  {
    slug: 'pdf-to-pdfa', group: 'Convert', title: 'PDF to PDF/A', run: 'pdfToPdfa', multiple: true,
    desc: 'Convert to PDF/A-2b, the ISO standard for long-term archiving.',
    fields: [{
      key: 'fonts', label: 'If some fonts are not embedded', type: 'select', value: 'flatten',
      choices: { flatten: 'Turn those pages into images (fully compliant)', keep: 'Keep the pages as they are and warn me' },
    }],
  },
  {
    slug: 'add-page-numbers', group: 'Edit', title: 'Add page numbers', op: 'pageNumbers', multiple: true,
    desc: 'Number the pages of a PDF, with the position and format you want.',
    fields: [
      {
        key: 'position', label: 'Position', type: 'select', value: 'bottom-center',
        choices: { 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right', 'bottom-left': 'Bottom left', 'top-center': 'Top centre', 'top-right': 'Top right', 'top-left': 'Top left' },
      },
      { key: 'format', label: 'Format', type: 'select', value: '{n}', choices: { '{n}': '1', '{n} / {total}': '1 / 10', 'Page {n}': 'Page 1', 'Page {n} of {total}': 'Page 1 of 10' } },
      { key: 'from', label: 'Start on page', type: 'number', value: 1, min: 1 },
      { key: 'start', label: 'First number', type: 'number', value: 1, min: 0 },
      { key: 'size', label: 'Font size', type: 'number', value: 11, min: 4, max: 72 },
    ],
  },
  {
    slug: 'add-watermark', group: 'Edit', title: 'Add watermark', op: 'watermark', multiple: true,
    desc: 'Stamp text across every page of a PDF.',
    fields: [
      { key: 'text', label: 'Text', type: 'text', value: 'CONFIDENTIAL' },
      { key: 'size', label: 'Font size', type: 'number', value: 48, min: 6, max: 300 },
      { key: 'angle', label: 'Angle', type: 'select', value: '45', choices: { 0: 'Horizontal', 45: 'Diagonal ↗', '-45': 'Diagonal ↘' } },
      { key: 'opacity', label: 'Opacity', type: 'select', value: '0.25', choices: { 0.1: '10%', 0.25: '25%', 0.5: '50%', 1: '100%' } },
      { key: 'color', label: 'Colour', type: 'color', value: '#c0392b' },
    ],
  },
  {
    slug: 'edit-pdf', group: 'Edit', title: 'Edit PDF', op: 'edit', view: 'edit',
    desc: 'Add text, images, shapes, highlights and drawings, or white out parts of a page.',
    opts: (state) => state, ready: (state) => state?.objects.length > 0,
  },
  {
    slug: 'pdf-forms', group: 'Edit', title: 'PDF forms', op: 'form', view: 'forms',
    desc: 'Fill in a PDF form, or turn any PDF into a fillable form.',
    opts: (state) => state, ready: (state) => state?.mode === 'fill' || state?.fields?.length > 0,
  },
  {
    slug: 'crop-pdf', group: 'Edit', title: 'Crop PDF', op: 'crop', multiple: true,
    desc: 'Trim the margins of every page.',
    fields: ['top', 'right', 'bottom', 'left'].map((key) => ({ key, label: `${key[0].toUpperCase()}${key.slice(1)} (mm)`, type: 'number', value: 10, min: 0 })),
  },
  {
    slug: 'sign-pdf', group: 'Security', title: 'Sign PDF', op: 'stamp', view: 'sign',
    desc: 'Draw, type or upload your signature and place it on the pages.',
    opts: (state) => state, ready: (state) => state?.image && state.marks.length > 0,
  },
  {
    slug: 'redact-pdf', group: 'Security', title: 'Redact PDF', run: 'redact', view: 'redact',
    desc: 'Black out text and areas for good: redacted pages are flattened so nothing hidden survives.',
    opts: (state) => state, ready: (state) => state?.marks.length > 0,
    fields: [
      { key: 'dpi', label: 'Redacted page quality', type: 'select', value: '200', choices: { 150: 'Smaller file', 200: 'Normal', 300: 'Sharp' } },
      { key: 'clean', label: 'Document details', type: 'select', value: 'yes', choices: { yes: 'Also remove metadata, bookmarks and attachments', no: 'Keep them' } },
    ],
  },
  {
    slug: 'protect-pdf', group: 'Security', title: 'Protect PDF', op: 'protect', multiple: true,
    desc: 'Add a password to a PDF (AES-256 encryption).',
    fields: [
      { key: 'password', label: 'Password', type: 'password', value: '', autoComplete: 'new-password' },
      { key: 'confirm', label: 'Repeat password', type: 'password', value: '', autoComplete: 'new-password' },
    ],
  },
  {
    slug: 'unlock-pdf', group: 'Security', title: 'Unlock PDF', op: 'unlock', multiple: true,
    desc: 'Remove the password and restrictions from a PDF you can open.',
    fields: [{ key: 'password', label: 'Password (leave empty if it opens without one)', type: 'password', value: '', autoComplete: 'off' }],
  },
  {
    slug: 'compare-pdf', group: 'Security', title: 'Compare PDF', view: 'compare', multiple: true, max: 2,
    desc: 'See what changed between two versions of a PDF, word by word, side by side.',
  },
]
