/**
 * Τα τμήματα μιας μεταγραφής: χρόνος που πηγαίνει στο σημείο, ομιλητής,
 * κείμενο που διορθώνεται επί τόπου, αναζήτηση με επισήμανση και επισήμανση
 * του τμήματος που ακούγεται.
 *
 * Οι γραμμές φτιάχνονται μία φορά ανά μεταγραφή (setTranscript) και μετά
 * ενημερώνονται μόνο όσες αλλάζουν (OO-001): μια αλλαγή ομιλητή ή κειμένου
 * δεν ξαναχτίζει χίλιες γραμμές, και η επισήμανση του τρέχοντος τμήματος
 * ξεκινά πάντα από την αρχή όταν ξαναχτιστεί η λίστα.
 */
import { h, field } from '../dom.js';
import { STRINGS, matchesFound } from '../strings.js';
import { formatClock } from '../../domain/time-format.js';
import { findSpeaker, segmentIndexAt } from '../../domain/transcript.js';
import { findMatches, matchesQuery } from '../../domain/text-search.js';

export class SegmentList {
  #onSeek;
  #onEditText;
  #onChooseSpeaker;
  #root = null;
  #list = null;
  #count = null;
  #transcript = null;
  /** @type {Map<string, { item: HTMLElement, chip: HTMLElement|null, text: HTMLElement }>} */
  #rows = new Map();
  #order = [];
  #query = '';
  #currentIndex = -1;

  /**
   * @param {Object} handlers
   * @param {(seconds: number) => void} handlers.onSeek
   * @param {(segmentId: string, text: string) => void} handlers.onEditText
   * @param {(segmentId: string) => void} handlers.onChooseSpeaker
   */
  constructor({ onSeek, onEditText, onChooseSpeaker }) {
    this.#onSeek = onSeek;
    this.#onEditText = onEditText;
    this.#onChooseSpeaker = onChooseSpeaker;
  }

  /** @returns {HTMLElement} */
  element() {
    if (!this.#root) {
      const search = h('input', { type: 'search', autocomplete: 'off' });
      search.addEventListener('input', () => { this.#query = search.value; this.#applySearch(); });
      this.#count = h('p', { class: 'meta', 'aria-live': 'polite' });
      this.#list = h('ol', { class: 'segments' });
      this.#root = h('section', { class: 'transcript-body', 'aria-labelledby': 'body-title' },
        h('h2', { id: 'body-title', class: 'visually-hidden' }, STRINGS.transcript.titleLabel),
        h('p', { class: 'hint' }, STRINGS.transcript.autoNotice),
        field(STRINGS.transcript.search, search), this.#count,
        this.#list);
    }
    return this.#root;
  }

  /** Νέα μεταγραφή: οι γραμμές χτίζονται από την αρχή. */
  setTranscript(transcript) {
    this.element();
    this.#transcript = transcript;
    this.#rows.clear();
    this.#order = transcript.segments.map(s => s.id);
    this.#currentIndex = -1;
    this.#list.replaceChildren(...transcript.segments.map(segment => this.#createRow(segment)));
    this.#applySearch();
  }

  /** Ενημέρωση μίας γραμμής μετά από αλλαγή του τμήματός της. */
  updateSegment(transcript, segmentId) {
    this.#transcript = transcript;
    const segment = transcript.segments.find(s => s.id === segmentId);
    const row = this.#rows.get(segmentId);
    if (!segment || !row) return;
    this.#renderSpeaker(row, segment);
    if (document.activeElement !== row.text) this.#renderText(row, segment.text);
    row.item.hidden = !matchesQuery(segment.text, this.#query);
  }

  /** Ενημέρωση των ονομάτων και χρωμάτων ομιλητών σε όλες τις γραμμές (χωρίς νέες γραμμές). */
  updateSpeakers(transcript) {
    this.#transcript = transcript;
    for (const segment of transcript.segments) {
      const row = this.#rows.get(segment.id);
      if (row) this.#renderSpeaker(row, segment);
    }
  }

  /** Επισήμανση του τμήματος που ακούγεται τη στιγμή `seconds`. */
  highlightAt(seconds, { follow }) {
    if (!this.#transcript) return;
    const index = segmentIndexAt(this.#transcript, seconds);
    if (index === this.#currentIndex) return;
    this.#rowAt(this.#currentIndex)?.item.classList.remove('current');
    this.#currentIndex = index;
    const row = this.#rowAt(index);
    if (!row) return;
    row.item.classList.add('current');
    const editing = document.activeElement && document.activeElement.isContentEditable;
    if (follow && !editing) row.item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  #rowAt(index) {
    return index >= 0 ? this.#rows.get(this.#order[index]) : undefined;
  }

  #createRow(segment) {
    const time = h('button', { type: 'button', class: 'time', 'aria-label': `${STRINGS.transcript.playFrom} ${formatClock(segment.start)}`, onclick: () => this.#onSeek(segment.start) }, formatClock(segment.start));
    const chip = this.#transcript.speakers.length
      ? h('button', { type: 'button', class: 'speaker-chip', onclick: () => this.#onChooseSpeaker(segment.id) })
      : null;
    const text = h('p', { class: 'text', tabIndex: 0, lang: this.#transcript.languageCode || 'el', 'aria-label': STRINGS.transcript.editSegment });
    text.setAttribute('contenteditable', 'plaintext-only');
    if (text.contentEditable !== 'plaintext-only') text.setAttribute('contenteditable', 'true');
    text.addEventListener('focus', () => { text.textContent = this.#segmentText(segment.id); });
    text.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); text.blur(); } });
    text.addEventListener('blur', () => {
      const value = text.textContent.replace(/\s+/g, ' ').trim();
      const row = this.#rows.get(segment.id);
      if (value === this.#segmentText(segment.id)) { this.#renderText(row, value); return; }
      this.#onEditText(segment.id, value);
    });
    const item = h('li', { class: 'segment' }, time, chip, text);
    const row = { item, chip, text };
    this.#rows.set(segment.id, row);
    this.#renderSpeaker(row, segment);
    this.#renderText(row, segment.text);
    return item;
  }

  #renderSpeaker(row, segment) {
    const speaker = segment.speakerId ? findSpeaker(this.#transcript, segment.speakerId) : null;
    const isCurrent = row.item.classList.contains('current');
    row.item.className = ['segment', speaker ? `speaker-color-${speaker.colorIndex}` : 'no-speaker', isCurrent ? 'current' : ''].filter(Boolean).join(' ');
    if (!row.chip) return;
    const label = speaker ? speaker.label : STRINGS.transcript.noSpeaker;
    row.chip.textContent = label;
    row.chip.setAttribute('aria-label', `${STRINGS.transcript.speakerOfSegment}: ${label}`);
  }

  /** Κείμενο με επισήμανση (<mark>) των εμφανίσεων της αναζήτησης, πάντα με textContent. */
  #renderText(row, text) {
    const matches = findMatches(text, this.#query);
    if (!matches.length) { row.text.textContent = text; return; }
    const parts = [];
    let cursor = 0;
    for (const { start, end } of matches) {
      if (start > cursor) parts.push(text.slice(cursor, start));
      parts.push(h('mark', {}, text.slice(start, end)));
      cursor = end;
    }
    parts.push(text.slice(cursor));
    row.text.replaceChildren(...parts);
  }

  #applySearch() {
    if (!this.#transcript) return;
    const query = this.#query.trim();
    let matches = 0;
    for (const segment of this.#transcript.segments) {
      const row = this.#rows.get(segment.id);
      if (!row) continue;
      const hit = matchesQuery(segment.text, query);
      row.item.hidden = !hit;
      if (hit && query) matches += 1;
      if (row.text !== document.activeElement) this.#renderText(row, segment.text);
    }
    this.#count.textContent = query ? (matches ? matchesFound(matches) : STRINGS.transcript.noMatches) : '';
  }

  #segmentText(segmentId) {
    const segment = this.#transcript.segments.find(s => s.id === segmentId);
    return segment ? segment.text : '';
  }
}
