/**
 * Σχεδίαση των μπλοκ Markdown (domain/markdown.js) σε DOM με textContent.
 * Καμία ετικέτα HTML από το κείμενο του μοντέλου δεν φτάνει ποτέ στη σελίδα.
 */
import { h } from '../dom.js';
import { parseMarkdown } from '../../domain/markdown.js';

/** @returns {DocumentFragment} */
export function renderMarkdown(markdown) {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(markdown)) fragment.append(renderBlock(block));
  return fragment;
}

function renderBlock(block) {
  switch (block.type) {
    case 'heading': return h(`h${Math.min(6, block.level + 1)}`, {}, renderRuns(block.runs));
    case 'paragraph': return h('p', {}, renderRuns(block.runs));
    case 'list': return h(block.ordered ? 'ol' : 'ul', {}, block.items.map(item => h('li', {}, renderRuns(item))));
    case 'table': return h('div', { class: 'table-scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, block.header.map(cell => h('th', { scope: 'col' }, renderRuns(cell))))),
      h('tbody', {}, block.rows.map(row => h('tr', {}, row.map(cell => h('td', {}, renderRuns(cell))))))));
    case 'rule': return h('hr');
    default: return document.createTextNode('');
  }
}

function renderRuns(runs) {
  return runs.map(run => {
    if (run.bold) return h('strong', {}, run.text);
    if (run.italic) return h('em', {}, run.text);
    return run.text;
  });
}
