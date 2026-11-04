/**
 * Τα αρχεία ήχου της τρέχουσας συνεδρίας, ανά μεταγραφή, για αναπαραγωγή.
 * Τα αρχικά αρχεία δεν αποθηκεύονται ποτέ (μπορεί να είναι GB): για παλιές
 * μεταγραφές ο χρήστης ξαναδιαλέγει το αρχείο («Σύνδεση με αρχείο ήχου»).
 */
export class SessionMedia {
  #files = new Map();
  #urls = new Map();
  #url;

  /** @param {{ URL: typeof URL }} deps */
  constructor({ URL }) {
    this.#url = URL;
  }

  attach(transcriptId, file) {
    this.detach(transcriptId);
    this.#files.set(transcriptId, file);
  }

  /** Object URL για το <audio>/<video>, ή null αν δεν υπάρχει αρχείο. */
  urlFor(transcriptId) {
    if (!this.#files.has(transcriptId)) return null;
    if (!this.#urls.has(transcriptId)) this.#urls.set(transcriptId, this.#url.createObjectURL(this.#files.get(transcriptId)));
    return this.#urls.get(transcriptId);
  }

  fileFor(transcriptId) {
    return this.#files.get(transcriptId) || null;
  }

  detach(transcriptId) {
    const url = this.#urls.get(transcriptId);
    if (url) this.#url.revokeObjectURL(url);
    this.#urls.delete(transcriptId);
    this.#files.delete(transcriptId);
  }

  clear() {
    for (const id of [...this.#files.keys()]) this.detach(id);
  }
}
