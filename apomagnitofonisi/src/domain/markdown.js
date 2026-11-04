/**
 * Ανάλυση του Markdown που γράφει το Claude σε περιλήψεις και πρακτικά, σε
 * απλή δομή μπλοκ. Από τη δομή αυτή τα σχεδιάζουν και η διεπαφή (με
 * textContent, χωρίς ποτέ innerHTML) και ο εξαγωγέας Word, οπότε κανένα HTML
 * από το μοντέλο δεν φτάνει ποτέ στη σελίδα.
 *
 * Υποστηρίζονται: επικεφαλίδες (#, ##, ###…), παράγραφοι, λίστες με κουκκίδες
 * και αριθμημένες, πίνακες με «|», οριζόντιες γραμμές, **έντονα**, *πλάγια*,
 * `κώδικας` (ως απλό κείμενο) και σύνδεσμοι [κείμενο](url) (ως «κείμενο (url)»).
 *
 * @typedef {{ text: string, bold?: boolean, italic?: boolean }} InlineRun
 *
 * @typedef {{ type: 'heading', level: number, runs: InlineRun[] }} HeadingBlock
 * @typedef {{ type: 'paragraph', runs: InlineRun[] }} ParagraphBlock
 * @typedef {{ type: 'list', ordered: boolean, items: InlineRun[][] }} ListBlock
 * @typedef {{ type: 'table', header: InlineRun[][], rows: InlineRun[][][] }} TableBlock
 * @typedef {{ type: 'rule' }} RuleBlock
 * @typedef {HeadingBlock|ParagraphBlock|ListBlock|TableBlock|RuleBlock} MarkdownBlock
 */

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+•–]\s+(.*)$/;
const ORDERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * @param {string} source
 * @returns {MarkdownBlock[]}
 */
export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const closeParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', runs: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const closeList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { closeParagraph(); closeList(); continue; }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      closeParagraph(); closeList();
      const header = splitTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(splitTableRow(lines[i++]));
      i -= 1;
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      closeParagraph(); closeList();
      blocks.push({ type: 'heading', level: heading[1].length, runs: parseInline(heading[2]) });
      continue;
    }
    if (RULE.test(line)) { closeParagraph(); closeList(); blocks.push({ type: 'rule' }); continue; }

    const bullet = line.match(BULLET);
    const ordered = bullet ? null : line.match(ORDERED);
    if (bullet || ordered) {
      closeParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) { closeList(); list = { type: 'list', ordered: isOrdered, items: [] }; }
      list.items.push(parseInline((bullet || ordered)[1]));
      continue;
    }

    if (list && /^\s{2,}\S/.test(line)) {
      // Συνέχεια του τελευταίου στοιχείου λίστας σε νέα γραμμή.
      const last = list.items[list.items.length - 1];
      list.items[list.items.length - 1] = [...last, { text: ' ' }, ...parseInline(line.trim())];
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  return blocks;
}

const INLINE = /(\*\*|__)(.+?)\1|\*(?![\s*])(.+?)(?<![\s*])\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * @param {string} text
 * @returns {InlineRun[]}
 */
export function parseInline(text) {
  const runs = [];
  let cursor = 0;
  const source = String(text ?? '');
  for (const match of source.matchAll(INLINE)) {
    if (match.index > cursor) runs.push({ text: source.slice(cursor, match.index) });
    if (match[2] !== undefined) runs.push({ text: match[2], bold: true });
    else if (match[3] !== undefined) runs.push({ text: match[3], italic: true });
    else if (match[4] !== undefined) runs.push({ text: match[4] });
    else runs.push({ text: `${match[5]} (${match[6]})` });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) runs.push({ text: source.slice(cursor) });
  return mergePlainRuns(runs.filter(r => r.text));
}

/** Το απλό κείμενο ενός μπλοκ ή μιας σειράς runs, χωρίς μορφοποίηση. */
export function runsToText(runs) {
  return runs.map(r => r.text).join('');
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => parseInline(cell.trim()));
}

function mergePlainRuns(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && !last.bold && !last.italic && !run.bold && !run.italic) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}
