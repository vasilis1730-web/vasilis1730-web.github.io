/**
 * Εξαγωγείς απλού κειμένου: .txt, .srt, .vtt, .json για μεταγραφές και .txt
 * (Markdown) για περιλήψεις. Όλοι υλοποιούν τις θύρες TranscriptExporter και
 * SummaryExporter του application.
 */
import { buildSubtitleCues } from '../../domain/subtitles.js';
import { formatClock, formatSrtTimestamp, formatVttTimestamp } from '../../domain/time-format.js';
import { serializeTranscript } from '../../domain/transcript-codec.js';
import { findSpeaker } from '../../domain/transcript.js';
import { EXPORT_FORMATS } from '../../application/export-formats.js';
import { transcriptFacts, speakerNameOf, summaryHeading, titleOf } from './export-labels.js';

const TEXT_MIME = 'text/plain;charset=utf-8';

export class TxtTranscriptExporter {
  format = EXPORT_FORMATS.TXT;
  extension = 'txt';
  mimeType = TEXT_MIME;

  /** @param {{ labels: import('./export-labels.js').ExportLabels }} deps */
  constructor({ labels }) {
    this.labels = labels;
  }

  render(transcript) {
    const lines = [titleOf(transcript, this.labels), ''];
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
  format = EXPORT_FORMATS.SRT;
  extension = 'srt';
  mimeType = 'application/x-subrip;charset=utf-8';

  render(transcript) {
    return buildSubtitleCues(transcript.segments)
      .map(cue => `${cue.index}\r\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\r\n${cue.lines.join('\r\n')}\r\n`)
      .join('\r\n');
  }
}

export class VttTranscriptExporter {
  format = EXPORT_FORMATS.VTT;
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
  format = EXPORT_FORMATS.JSON;
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

/** Η περίληψη σε .txt, όπως την έγραψε το μοντέλο (Markdown), με τίτλο και σημείωση. */
export class TxtSummaryExporter {
  format = EXPORT_FORMATS.TXT;
  extension = 'txt';
  mimeType = TEXT_MIME;

  /** @param {{ labels: import('./export-labels.js').ExportLabels }} deps */
  constructor({ labels }) {
    this.labels = labels;
  }

  render(transcript, summary) {
    const header = `# ${summaryHeading(transcript, summary, this.labels)}`;
    return `${header}\r\n\r\n${summary.text.replace(/\r?\n/g, '\r\n')}\r\n\r\n${this.labels.summaryNotice}\r\n`;
  }
}

function escapeVtt(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
