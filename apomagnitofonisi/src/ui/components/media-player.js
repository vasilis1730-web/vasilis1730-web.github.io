/**
 * Η αναπαραγωγή του αρχείου μιας μεταγραφής. Το στοιχείο <audio>/<video>
 * φτιάχνεται ΜΙΑ φορά και δεν ξαναφτιάχνεται όταν αλλάζει κάτι άλλο στη σελίδα
 * (OO-001): η αναπαραγωγή συνεχίζει όσο ο χρήστης διορθώνει ομιλητές και κείμενο.
 * Όταν δεν υπάρχει αρχείο (παλιά μεταγραφή), δείχνει «Σύνδεση με αρχείο ήχου».
 */
import { h, uid } from '../dom.js';
import { STRINGS } from '../strings.js';

export class MediaPlayer {
  #sessionMedia;
  #transcriptId;
  #onTime;
  #root = null;
  #media = null;

  /**
   * @param {Object} deps
   * @param {import('../session-media.js').SessionMedia} deps.sessionMedia
   * @param {string} deps.transcriptId
   * @param {(seconds: number) => void} deps.onTime  ο τρέχων χρόνος όσο παίζει
   */
  constructor({ sessionMedia, transcriptId, onTime }) {
    this.#sessionMedia = sessionMedia;
    this.#transcriptId = transcriptId;
    this.#onTime = onTime;
  }

  /** @returns {HTMLElement} */
  element() {
    this.#root ??= h('div', { class: 'card player-card' });
    if (!this.#root.childElementCount) this.#fill();
    return this.#root;
  }

  get isPlaying() {
    return Boolean(this.#media && !this.#media.paused);
  }

  /** Αναπαραγωγή από το σημείο `seconds`. */
  playFrom(seconds) {
    if (!this.#media) return;
    this.#media.currentTime = seconds;
    this.#media.play().catch(() => {});
  }

  dispose() {
    this.#media?.pause();
  }

  #fill() {
    const url = this.#sessionMedia.urlFor(this.#transcriptId);
    if (url) { this.#root.replaceChildren(this.#player(url)); return; }
    const input = h('input', { type: 'file', accept: 'audio/*,video/*', id: uid('link-audio'), class: 'visually-hidden' });
    input.addEventListener('change', () => {
      if (!input.files || !input.files[0]) return;
      this.#sessionMedia.attach(this.#transcriptId, input.files[0]);
      this.#fill();
    });
    this.#root.replaceChildren(
      h('label', { for: input.id, class: 'button secondary' }, STRINGS.transcript.linkAudio),
      input,
      h('p', { class: 'hint' }, STRINGS.transcript.linkAudioHint));
  }

  #player(url) {
    const file = this.#sessionMedia.fileFor(this.#transcriptId);
    const isVideo = file && String(file.type).startsWith('video/');
    this.#media = h(isVideo ? 'video' : 'audio', { controls: true, preload: 'metadata', src: url, class: 'player', playsInline: true });
    this.#media.addEventListener('timeupdate', () => this.#onTime(this.#media.currentTime));
    return this.#media;
  }
}
