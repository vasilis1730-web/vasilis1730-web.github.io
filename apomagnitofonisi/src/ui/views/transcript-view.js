/**
 * Προβολή μιας μεταγραφής: τίτλος, αναπαραγωγή με επισήμανση του τμήματος που
 * ακούγεται, ομιλητές (μετονομασία, χρόνος ομιλίας), τμήματα με χρόνο που
 * πηγαίνει στο σημείο, διόρθωση κειμένου, αλλαγή ομιλητή, αναζήτηση,
 * εξαγωγή, αντιγραφή και κοινή χρήση.
 */
import { h, clear, field } from '../dom.js';
import { STRINGS, matchesFound, errorMessage } from '../strings.js';
import { formatDateTime, formatDuration } from '../formatters.js';
import { formatClock } from '../../domain/time-format.js';
import { speakerTalkTime, transcriptDuration, segmentIndexAt, findSpeaker } from '../../domain/transcript.js';
import { promptText } from '../components/confirm-dialog.js';

const EXPORT_LABELS = Object.freeze({
  docx: STRINGS.transcript.exportDocx,
  txt: STRINGS.transcript.exportTxt,
  srt: STRINGS.transcript.exportSrt,
  vtt: STRINGS.transcript.exportVtt,
  json: STRINGS.transcript.exportJson,
});

export class TranscriptView {
  title = STRINGS.appName;

  #deps;
  #id;
  #transcript = null;
  #root = null;
  #list = null;
  #rows = [];
  #media = null;
  #query = '';
  #currentIndex = -1;

  /**
   * @param {Object} deps
   * @param {import('../../application/library-service.js').LibraryService} deps.library
   * @param {import('../../application/transcript-editor.js').TranscriptEditor} deps.editor
   * @param {import('../../application/export-service.js').ExportService} deps.exports
   * @param {import('../../infrastructure/platform/file-saver.js').BrowserFileSaver} deps.fileSaver
   * @param {import('../session-media.js').SessionMedia} deps.sessionMedia
   * @param {{ navigate: (path: string) => void }} deps.router
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {(engine: { kind: string, model: string }) => string} deps.describeEngine
   * @param {Document} deps.document
   * @param {string} transcriptId
   */
  constructor(deps, transcriptId) {
    this.#deps = deps;
    this.#id = transcriptId;
  }

  render() {
    this.#root = h('section', { class: 'view transcript-view' }, h('h1', {}, STRINGS.common.loading));
    this.#deps.library.open(this.#id).then(transcript => {
      this.#transcript = transcript;
      this.title = transcript.title;
      this.#deps.document.title = `${transcript.title} | ${STRINGS.appName}`;
      this.#draw();
    }, error => {
      clear(this.#root).append(h('h1', {}, STRINGS.transcript.notFound), h('p', {}, errorMessage(error)), h('a', { href: '#/history' }, STRINGS.nav.history));
    });
    return this.#root;
  }

  dispose() {
    if (this.#media) this.#media.pause();
  }

  /* ---------------------------------------------------------------- σχεδίαση */

  #draw() {
    const t = this.#transcript;
    const heading = h('h1', {}, t.title);
    clear(this.#root).append(
      heading,
      h('p', { class: 'meta' }, formatDateTime(t.createdAt), `, ${formatDuration(transcriptDuration(t))}, ${this.#deps.describeEngine(t.engine)}`),
      this.#toolbar(),
      this.#titleField(heading),
      this.#playerSection(),
      t.speakers.length ? this.#speakersPanel() : null,
      t.segments.length ? this.#segmentsSection() : h('p', { class: 'notice' }, STRINGS.transcript.empty),
    );
  }

  #toolbar() {
    const exportsMenu = h('details', { class: 'menu' },
      h('summary', { class: 'button secondary' }, STRINGS.transcript.export),
      h('div', { class: 'menu-items' }, this.#deps.exports.transcriptFormats.map(format =>
        h('button', { type: 'button', onclick: () => this.#download(format) }, EXPORT_LABELS[format] || format))));
    return h('div', { class: 'toolbar' },
      h('a', { class: 'button primary', href: `#/t/${encodeURIComponent(this.#id)}/summary` }, STRINGS.transcript.summaries),
      exportsMenu,
      h('button', { type: 'button', class: 'secondary', onclick: () => this.#copyAll() }, STRINGS.common.copy),
      this.#canShare() ? h('button', { type: 'button', class: 'secondary', onclick: () => this.#share() }, STRINGS.common.share) : null);
  }

  #titleField(heading) {
    const input = h('input', { type: 'text', value: this.#transcript.title, maxLength: 200, autocomplete: 'off' });
    input.addEventListener('change', () => this.#edit(t => this.#deps.editor.setTitle(t, input.value), () => {
      heading.textContent = this.#transcript.title;
      input.value = this.#transcript.title;
    }));
    return field(STRINGS.transcript.titleLabel, input);
  }

  #playerSection() {
    const url = this.#deps.sessionMedia.urlFor(this.#id);
    if (!url) {
      const input = h('input', { type: 'file', accept: 'audio/*,video/*', id: 'link-audio', class: 'visually-hidden' });
      input.addEventListener('change', () => {
        if (!input.files || !input.files[0]) return;
        this.#deps.sessionMedia.attach(this.#id, input.files[0]);
        this.#draw();
      });
      return h('div', { class: 'card player-card' },
        h('label', { for: 'link-audio', class: 'button secondary' }, STRINGS.transcript.linkAudio),
        input,
        h('p', { class: 'hint' }, STRINGS.transcript.linkAudioHint));
    }
    const file = this.#deps.sessionMedia.fileFor(this.#id);
    const isVideo = file && String(file.type).startsWith('video/');
    this.#media = h(isVideo ? 'video' : 'audio', { controls: true, preload: 'metadata', src: url, class: 'player', playsInline: true });
    this.#media.addEventListener('timeupdate', () => this.#highlightAt(this.#media.currentTime));
    return h('div', { class: 'card player-card' }, this.#media);
  }

  #speakersPanel() {
    const t = this.#transcript;
    const talk = speakerTalkTime(t);
    return h('section', { class: 'card speakers', 'aria-labelledby': 'speakers-title' },
      h('h2', { id: 'speakers-title' }, STRINGS.transcript.speakers),
      h('ul', {}, t.speakers.map(speaker => {
        const input = h('input', { type: 'text', value: speaker.label, maxLength: 80, 'aria-label': `${STRINGS.transcript.renameSpeaker} ${speaker.label}` });
        input.addEventListener('change', () => this.#edit(tr => this.#deps.editor.renameSpeaker(tr, speaker.id, input.value), () => this.#draw()));
        return h('li', { class: ['speaker', speakerClass(speaker)] },
          h('span', { class: 'swatch', 'aria-hidden': 'true' }), input,
          h('span', { class: 'meta' }, `${formatDuration(talk.get(speaker.id) || 0)} ${STRINGS.transcript.talkTime}`));
      })),
      h('button', { type: 'button', class: 'secondary', onclick: () => this.#addSpeaker() }, STRINGS.transcript.addSpeaker));
  }

  #segmentsSection() {
    const search = h('input', { type: 'search', value: this.#query, autocomplete: 'off' });
    const count = h('p', { class: 'meta', 'aria-live': 'polite' });
    search.addEventListener('input', () => { this.#query = search.value; this.#applySearch(count); });
    this.#list = h('ol', { class: 'segments' });
    this.#rows = this.#transcript.segments.map((segment, index) => this.#segmentRow(segment, index));
    this.#list.append(...this.#rows);
    const section = h('section', { class: 'transcript-body', 'aria-labelledby': 'body-title' },
      h('h2', { id: 'body-title', class: 'visually-hidden' }, STRINGS.transcript.titleLabel),
      h('p', { class: 'hint' }, STRINGS.transcript.autoNotice),
      field(STRINGS.transcript.search, search), count,
      this.#list);
    if (this.#query) this.#applySearch(count);
    return section;
  }

  #segmentRow(segment, index) {
    const t = this.#transcript;
    const speaker = segment.speakerId ? findSpeaker(t, segment.speakerId) : null;
    const time = h('button', { type: 'button', class: 'time', 'aria-label': `${STRINGS.transcript.playFrom} ${formatClock(segment.start)}`, onclick: () => this.#playFrom(segment.start) }, formatClock(segment.start));
    const chip = t.speakers.length
      ? h('button', { type: 'button', class: 'speaker-chip', 'aria-label': `${STRINGS.transcript.speakerOfSegment}: ${speaker ? speaker.label : STRINGS.transcript.noSpeaker}`, onclick: () => this.#chooseSpeaker(segment) },
        speaker ? speaker.label : STRINGS.transcript.noSpeaker)
      : null;
    const text = h('p', { class: 'text', tabIndex: 0, lang: t.languageCode || 'el', 'aria-label': STRINGS.transcript.editSegment });
    text.setAttribute('contenteditable', 'plaintext-only');
    if (text.contentEditable !== 'plaintext-only') text.setAttribute('contenteditable', 'true');
    renderText(text, segment.text, this.#query);
    text.addEventListener('focus', () => renderText(text, this.#segmentText(segment.id), ''));
    text.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); text.blur(); } });
    text.addEventListener('blur', () => {
      const value = text.textContent.replace(/\s+/g, ' ').trim();
      if (value === this.#segmentText(segment.id)) { renderText(text, value, this.#query); return; }
      this.#edit(tr => this.#deps.editor.editSegmentText(tr, segment.id, value), () => renderText(text, this.#segmentText(segment.id), this.#query));
    });
    const row = h('li', { class: ['segment', speaker ? speakerClass(speaker) : 'no-speaker'], dataset: { index: String(index) } }, time, chip, text);
    return row;
  }

  /* ---------------------------------------------------------------- ενέργειες */

  async #edit(change, after) {
    try {
      this.#transcript = await change(this.#transcript);
      after();
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  async #chooseSpeaker(segment) {
    const t = this.#transcript;
    const options = [...t.speakers.map(s => ({ id: s.id, label: s.label })), { id: null, label: STRINGS.transcript.noSpeaker }];
    const chosen = await pickSpeaker(this.#deps.document, options, segment.speakerId);
    if (chosen === undefined) return;
    if (chosen === NEW_SPEAKER) { await this.#addSpeaker(segment); return; }
    await this.#edit(tr => this.#deps.editor.assignSpeaker(tr, segment.id, chosen), () => this.#draw());
  }

  async #addSpeaker(segment = null) {
    const name = await promptText(this.#deps.document, { label: STRINGS.transcript.newSpeakerName });
    if (!name) return;
    try {
      const { transcript, speakerId } = await this.#deps.editor.addSpeaker(this.#transcript, name);
      this.#transcript = segment ? await this.#deps.editor.assignSpeaker(transcript, segment.id, speakerId) : transcript;
      this.#draw();
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  #playFrom(seconds) {
    if (!this.#media) return;
    this.#media.currentTime = seconds;
    this.#media.play().catch(() => {});
  }

  #highlightAt(seconds) {
    const index = segmentIndexAt(this.#transcript, seconds);
    if (index === this.#currentIndex) return;
    this.#rows[this.#currentIndex]?.classList.remove('current');
    this.#currentIndex = index;
    const row = this.#rows[index];
    if (!row) return;
    row.classList.add('current');
    const editing = this.#deps.document.activeElement && this.#deps.document.activeElement.isContentEditable;
    if (!editing && !this.#media.paused) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  #applySearch(countNode) {
    const query = normalizeForSearch(this.#query);
    let matches = 0;
    this.#transcript.segments.forEach((segment, i) => {
      const row = this.#rows[i];
      const hit = !query || normalizeForSearch(segment.text).includes(query);
      row.hidden = !hit;
      if (hit && query) matches += 1;
      const text = row.querySelector('.text');
      if (text !== this.#deps.document.activeElement) renderText(text, segment.text, this.#query);
    });
    countNode.textContent = query ? (matches ? matchesFound(matches) : STRINGS.transcript.noMatches) : '';
  }

  #download(format) {
    try {
      this.#deps.fileSaver.download(this.#deps.exports.exportTranscript(this.#transcript, format));
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  async #copyAll() {
    try {
      await this.#deps.fileSaver.copyText(String(this.#deps.exports.exportTranscript(this.#transcript, 'txt').data));
      this.#deps.toasts.show(STRINGS.common.copied, { tone: 'success' });
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  #canShare() {
    return this.#transcript && this.#deps.fileSaver.canShare(this.#deps.exports.exportTranscript(this.#transcript, 'txt'));
  }

  async #share() {
    try {
      await this.#deps.fileSaver.share(this.#deps.exports.exportTranscript(this.#transcript, 'docx'), this.#transcript.title);
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  #segmentText(segmentId) {
    const segment = this.#transcript.segments.find(s => s.id === segmentId);
    return segment ? segment.text : '';
  }
}

const NEW_SPEAKER = Symbol('new-speaker');

function speakerClass(speaker) {
  return `speaker-color-${speaker.colorIndex}`;
}

/** Κείμενο τμήματος με επισήμανση (<mark>) των εμφανίσεων της αναζήτησης. */
function renderText(node, text, query) {
  const needle = normalizeForSearch(query);
  if (!needle) { node.textContent = text; return; }
  const haystack = normalizeForSearch(text);
  const parts = [];
  let cursor = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(h('mark', {}, text.slice(at, at + needle.length)));
    cursor = at + needle.length;
  }
  parts.push(text.slice(cursor));
  node.replaceChildren(...parts);
}

/** Πεζά χωρίς τόνους, με το ίδιο μήκος με το αρχικό (για σωστές θέσεις επισήμανσης). */
function normalizeForSearch(text) {
  return Array.from(String(text ?? '')).map(ch => ch.normalize('NFD').replace(/\p{Mn}/gu, '').toLocaleLowerCase('el').slice(0, 1) || ch).join('');
}

/** Παράθυρο επιλογής ομιλητή. undefined = ακύρωση, NEW_SPEAKER = νέος ομιλητής. */
function pickSpeaker(doc, options, currentId) {
  return new Promise(resolve => {
    let result;
    const dialog = h('dialog', { class: 'confirm-dialog speaker-picker' },
      h('h2', {}, STRINGS.transcript.speakerOfSegment),
      h('div', { class: 'picker-options' },
        options.map(option => h('button', {
          type: 'button',
          class: option.id === currentId ? 'primary' : 'secondary',
          onclick: () => { result = option.id; dialog.close(); },
        }, option.label)),
        h('button', { type: 'button', class: 'secondary', onclick: () => { result = NEW_SPEAKER; dialog.close(); } }, `${STRINGS.transcript.addSpeaker}…`)),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, STRINGS.common.cancel)));
    dialog.addEventListener('close', () => { resolve(result); dialog.remove(); });
    doc.body.append(dialog);
    dialog.showModal();
  });
}

