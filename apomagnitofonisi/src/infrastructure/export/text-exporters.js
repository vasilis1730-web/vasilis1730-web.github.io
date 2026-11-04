/**
 * Εξαγωγείς απλού κειμένου: .txt, .srt, .vtt, .json για μεταγραφές και .txt
 * (Markdown) για περιλήψεις. Όλοι υλοποιούν τις θύρες TranscriptExporter και
 * SummaryExporter του application.
 */
import { buildSubtitleCues } from '../../domain/subtitles.js';
import { formatClock, formatSrtTimestamp, formatVttTimestamp } from '../../domain/time-format.js';
import { serializeTranscript } from '../../domain/transcript-codec.js';
import { findSpeaker } from '../../domain/transcript.js';
import { transcriptFacts, speakerNameOf } from './export-labels.js';

const TEXT_MIME = 'text/plain;charset=utf-8';

export class TxtTranscriptExporter {
  format = 'txt';
  extension = 'txt';
  mimeType = TEXT_MIME;

  /** @param {{ labels: import('./export-labels.js').ExportLabels }} deps */
  constructor({ labels }) {
    this.labels = labels;
  }

  render(transcript) {
    const lines = [transcript.title, ''];
    for (const fact of transcriptFacts(transcript, this.labels)) lines.push(`${fact.label}: ${fact.value}`);
    lines.push('', this.labels.transcriptNotice, '');
    for (const segment of transcript.segments) {
      const speaker = speakerNameOf(transcript, segment, this.labels);
      lines.push(`[${formatClock(segment.start)}] ${speaker ? `${speaker}: ` : ''}${segment.text}`);
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}

export class SrtTranscriptExporter {
  format = 'srt';
  extension = 'srt';
  mimeType = 'application/x-subrip;charset=utf-8';

  render(transcript) {
    return buildSubtitleCues(transcript.segments)
      .map(cue => `${cue.index}\r\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\r\n${cue.lines.join('\r\n')}\r\n`)
      .join('\r\n');
  }
}

export class VttTranscriptExporter {
  format = 'vtt';
  extension = 'vtt';
  mimeType = 'text/vtt;charset=utf-8';

  render(transcript) {
    const blocks = buildSubtitleCues(transcript.segments).map(cue => {
      const speaker = cue.speakerId ? findSpeaker(transcript, cue.speakerId) : null;
      const text = cue.lines.map(escapeVtt).join('\n');
      return `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${speaker ? `<v ${escapeVtt(speaker.label)}>` : ''}${text}`;
    });
    return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
  }
}

export class JsonTranscriptExporter {
  format = 'json';
  extension = 'json';
  mimeType = 'application/json';

  /** @param {{ clock: import('../../application/ports.js').Clock, appVersion: string }} deps */
  constructor({ clock, appVersion }) {
    this.clock = clock;
    this.appVersion = appVersion;
  }

  render(transcript) {
    return serializeTranscript(transcript, { exportedAt: this.clock.nowIso(), appVersion: this.appVersion });
  }
}

/** Η περίληψη όπως την έγραψε το μοντέλο (Markdown), με τίτλο και σημείωση. */
export class MarkdownSummaryExporter {
  format = 'txt';
  extension = 'txt';
  mimeType = TEXT_MIME;

  /** @param {{ labels: import('./export-labels.js').ExportLabels }} deps */
  constructor({ labels }) {
    this.labels = labels;
  }

  render(transcript, summary) {
    const header = `# ${this.labels.summaryTitle(summary.kind)}: ${transcript.title}`;
    return `${header}\r\n\r\n${summary.text.replace(/\r?\n/g, '\r\n')}\r\n\r\n${this.labels.summaryNotice}\r\n`;
  }
}

function escapeVtt(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
