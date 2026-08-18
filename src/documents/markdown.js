// A deliberately small Markdown subset -- only the constructs the client documents in
// ./templates actually use. It exists so the contract text can live in plain .md files an
// attorney can read and redline, instead of inside JS string literals.
//
// ponytail: hand-rolled rather than pulling in marked/markdown-it, because supporting nine
// block types is ~80 lines and a full CommonMark parser would emit HTML we'd then have to
// translate into pdfkit calls anyway. Add a real parser only if the documents start needing
// links, images, nested lists or blockquote nesting.
//
// Pure: no pdfkit, no fs. parse() is a total function from text to blocks.

// Inline runs. **bold** is the only inline mark -- legal text uses it for defined terms.
function inline(str) {
  const runs = [];
  let last = 0;
  for (const m of str.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > last) runs.push({ text: str.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < str.length) runs.push({ text: str.slice(last), bold: false });
  return runs.length ? runs : [{ text: '', bold: false }];
}

const cells = (line) =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => inline(c.trim()));

const isTableRow = (line) => line.startsWith('|');
// The |---|---| separator under a table's header row; never content.
const isTableDivider = (line) => /^\|[\s:|-]+\|$/.test(line) && line.includes('-');

function parse(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    // Standalone markers.
    if (line === '[[PAGEBREAK]]') {
      blocks.push({ type: 'pagebreak' });
      i += 1;
      continue;
    }
    if (line === '[[SIGNATURE]]') {
      blocks.push({ type: 'signature' });
      i += 1;
      continue;
    }
    if (/^(---+|\*\*\*+)$/.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    // Headings.
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: `h${heading[1].length}`, runs: inline(heading[2].trim()) });
      i += 1;
      continue;
    }

    // Callout: a "> " block. Consecutive > lines join into one paragraph.
    if (line.startsWith('>')) {
      const parts = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        parts.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'callout', runs: inline(parts.join(' ').trim()) });
      continue;
    }

    // Table: a run of | rows, with the divider row dropped.
    if (isTableRow(line)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        const row = lines[i].trim();
        if (!isTableDivider(row)) rows.push(cells(row));
        i += 1;
      }
      blocks.push({ type: 'table', head: rows[0] || [], rows: rows.slice(1) });
      continue;
    }

    // Lists. A checklist is a bullet list whose items all open with [ ], and it renders
    // with drawn boxes so the client can tick one on paper.
    const bullet = /^[-*]\s+(.*)$/;
    const numbered = /^\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line);
      const pattern = ordered ? numbered : bullet;
      const items = [];
      let checklist = true;
      while (i < lines.length && pattern.test(lines[i].trim())) {
        const item = pattern.exec(lines[i].trim())[1];
        const box = /^\[[ xX]?\]\s*/.exec(item);
        if (!box) checklist = false;
        items.push(inline(box ? item.slice(box[0].length) : item));
        i += 1;
      }
      blocks.push({ type: checklist && !ordered ? 'checklist' : ordered ? 'ol' : 'ul', items });
      continue;
    }

    // Anything else is a paragraph: consecutive plain lines joined into one flowing block.
    const parts = [];
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.startsWith('#') ||
        next.startsWith('>') ||
        isTableRow(next) ||
        bullet.test(next) ||
        numbered.test(next) ||
        next.startsWith('[[') ||
        /^(---+|\*\*\*+)$/.test(next)
      ) {
        break;
      }
      parts.push(next);
      i += 1;
    }
    blocks.push({ type: 'p', runs: inline(parts.join(' ')) });
  }

  return blocks;
}

// Runs back to flat text -- for measuring, for tests, and for matching on block content.
const plain = (runs) => (runs || []).map((r) => r.text).join('');

module.exports = { parse, inline, plain };
