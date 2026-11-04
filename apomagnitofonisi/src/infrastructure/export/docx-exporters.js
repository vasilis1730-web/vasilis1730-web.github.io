/**
 * Εξαγωγείς Word (.docx) για μεταγραφές και περιλήψεις.
 */
import { parseMarkdown } from '../../domain/markdown.js';
import { formatClock } from '../../domain/time-format.js';
import { buildDocx } from './docx-document.js';
import { transcriptFacts, speakerNameOf } from './export-labels.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MUTED = '6B7280';

/** Τίτλος, στοιχεία, ομιλητές, και μία παράγραφος ανά τμήμα (ομιλητής έντονα, χρόνος γκρι). */
export class DocxTranscriptExporter {
  format = 'docx';
  extension = 'docx';
  mimeType = DOCX_MIME;

  /** @param {{ labels: import('./export-labels.js').ExportLabels }} deps */
  constructor({ labels }) {
    this.labels = labels;
  }

  render(transcript) {
    const blocks = [
      { kind: 'paragraph', style: 'Title', runs: [{ text: transcript.title }] },
      ...transcriptFacts(transcript, this.labels).map(fact => ({
        kind: 'paragraph', style: 'Subtitle', runs: [{ text: `${fact.label}: `, bold: true }, { text: fact.value }],
      })),
      { kind: 'paragraph', style: 'Note', runs: [{ text: this.labels.transcriptNotice }] },
    ];
    for (const segment of transcript.segments) {
      const speaker = speakerNameOf(transcript, segment, this.labels);
      const runs = [{ text: `[${formatClock(segment.start)}] `, color: MUTED, sizePt: 9 }];
      if (speaker) runs.push({ text: `${speaker}: `, bold: true });
      runs.push({ text: segment.text });
      blocks.push({ kind: 'paragraph', runs });
    }
    return buildDocx(blocks, { title: transcript.title, creator: this.labels.appName, createdAt: new Date(transcript.updatedAt) });
  }
}

/** Η περίληψη (Markdown) ως έγγραφο Word με επικεφαλίδες, λίστες και πίνακες. */
export class DocxSummaryExporter {
  format = 'docx';
  extension = 'docx';
  mimeType = DOCX_MIME;

  /** @param {{ labels: import('./export-labels.js').ExportLabels }} deps */
  constructor({ labels }) {
    this.labels = labels;
  }

  render(transcript, summary) {
    const title = `${this.labels.summaryTitle(summary.kind)}: ${transcript.title}`;
    const blocks = [
      { kind: 'paragraph', style: 'Title', runs: [{ text: title }] },
      { kind: 'paragraph', style: 'Subtitle', runs: [{ text: `${this.labels.date}: `, bold: true }, { text: this.labels.formatDate(summary.createdAt) }] },
      ...markdownToDocxBlocks(summary.text),
      { kind: 'paragraph', style: 'Note', runs: [{ text: this.labels.summaryNotice }] },
    ];
    return buildDocx(blocks, { title, creator: this.labels.appName, createdAt: new Date(summary.createdAt) });
  }
}

/**
 * Markdown → μπλοκ Word. Οι επικεφαλίδες # και ## γίνονται Heading1 και
 * Heading2 (ο τίτλος του εγγράφου είναι ήδη Title), οι βαθύτερες Heading3.
 */
export function markdownToDocxBlocks(markdown) {
  const toRuns = runs => runs.map(r => ({ text: r.text, bold: r.bold, italic: r.italic }));
  return parseMarkdown(markdown).flatMap(block => {
    switch (block.type) {
      case 'heading': return [{ kind: 'paragraph', style: `Heading${Math.min(3, block.level)}`, runs: toRuns(block.runs) }];
      case 'paragraph': return [{ kind: 'paragraph', runs: toRuns(block.runs) }];
      case 'list': return [{ kind: 'list', ordered: block.ordered, items: block.items.map(toRuns) }];
      case 'table': return [{ kind: 'table', header: block.header.map(toRuns), rows: block.rows.map(row => row.map(toRuns)) }];
      case 'rule': return [{ kind: 'paragraph', runs: [{ text: '' }] }];
      default: return [];
    }
  });
}
