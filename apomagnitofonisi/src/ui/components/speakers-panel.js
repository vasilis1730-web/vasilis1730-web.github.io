/**
 * Ο πίνακας ομιλητών μιας μεταγραφής: χρώμα, όνομα που αλλάζει, χρόνος
 * ομιλίας και «Νέος ομιλητής». Κάθε γραμμή φτιάχνεται μία φορά και ενημερώνεται
 * επί τόπου (OO-001): μια μετονομασία δεν ξαναχτίζει τη σελίδα.
 *
 * Παίρνει κάθε νέα έκδοση της μεταγραφής με το setTranscript, όπως και τα
 * άλλα μέρη της σελίδας (OO-016, API-011), και δεν κάνει τίποτα όταν δεν
 * άλλαξαν ούτε οι ομιλητές ούτε τα τμήματα (από τα τμήματα βγαίνει ο χρόνος ομιλίας).
 */
import { h } from '../dom.js';
import { STRINGS } from '../strings.js';
import { formatDuration } from '../formatters.js';
import { speakerTalkTime, MAX_SPEAKER_LABEL_LENGTH } from '../../domain/transcript.js';

export class SpeakersPanel {
  #onRename;
  #onAdd;
  #root = null;
  #list = null;
  #transcript = null;
  /** @type {Map<string, { item: HTMLElement, input: HTMLInputElement, meta: HTMLElement, rendered: string }>} */
  #rows = new Map();

  /**
   * @param {Object} handlers
   * @param {(speakerId: string, label: string) => void} handlers.onRename
   * @param {() => void} handlers.onAdd
   */
  constructor({ onRename, onAdd }) {
    this.#onRename = onRename;
    this.#onAdd = onAdd;
  }

  /** @returns {HTMLElement} */
  element() {
    if (!this.#root) {
      this.#list = h('ul');
      this.#root = h('section', { class: 'card speakers', 'aria-labelledby': 'speakers-title' },
        h('h2', { id: 'speakers-title' }, STRINGS.transcript.speakers),
        this.#list,
        h('button', { type: 'button', class: 'secondary', onclick: () => this.#onAdd() }, STRINGS.transcript.addSpeaker));
    }
    return this.#root;
  }

  /** Νέα έκδοση της μεταγραφής: νέες γραμμές, ονόματα, χρώματα και χρόνοι, μόνο αν άλλαξαν. */
  setTranscript(transcript) {
    this.element();
    const previous = this.#transcript;
    this.#transcript = transcript;
    if (previous && previous.speakers === transcript.speakers && previous.segments === transcript.segments) return;
    const talk = speakerTalkTime(transcript);
    const seen = new Set();
    for (const speaker of transcript.speakers) {
      seen.add(speaker.id);
      let row = this.#rows.get(speaker.id);
      if (!row) {
        // Νέοι ομιλητές μπαίνουν στο τέλος. Οι υπάρχουσες γραμμές δεν μετακινούνται,
        // ώστε ένα πεδίο που γράφει ο χρήστης να μη χάνει την εστίαση.
        row = this.#createRow(speaker.id);
        this.#rows.set(speaker.id, row);
        this.#list.append(row.item);
      }
      row.item.className = `speaker speaker-color-${speaker.colorIndex}`;
      const editing = document.activeElement === row.input && row.input.value !== row.rendered;
      if (!editing) row.input.value = speaker.label;
      row.rendered = speaker.label;
      row.input.setAttribute('aria-label', `${STRINGS.transcript.renameSpeaker} ${speaker.label}`);
      row.meta.textContent = `${formatDuration(talk.get(speaker.id) || 0)} ${STRINGS.transcript.talkTime}`;
    }
    for (const [id, row] of this.#rows) {
      if (!seen.has(id)) { row.item.remove(); this.#rows.delete(id); }
    }
    this.#root.hidden = transcript.speakers.length === 0;
  }

  /** Επαναφορά του ονόματος όπως είναι αποθηκευμένο (π.χ. μετά από άκυρη μετονομασία). */
  restore(speakerId) {
    const row = this.#rows.get(speakerId);
    if (row) row.input.value = row.rendered;
  }

  #createRow(speakerId) {
    const input = h('input', { type: 'text', maxLength: MAX_SPEAKER_LABEL_LENGTH });
    input.addEventListener('change', () => this.#onRename(speakerId, input.value));
    const meta = h('span', { class: 'meta' });
    const item = h('li', {}, h('span', { class: 'swatch', 'aria-hidden': 'true' }), input, meta);
    return { item, input, meta, rendered: '' };
  }
}
