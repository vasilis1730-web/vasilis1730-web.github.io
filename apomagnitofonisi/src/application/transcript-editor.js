/**
 * Περίπτωση χρήσης «Διόρθωση μεταγραφής»: κάθε αλλαγή του χρήστη (τίτλος,
 * ονόματα ομιλητών, κείμενο, ομιλητής τμήματος) εφαρμόζεται με τους κανόνες
 * του domain και αποθηκεύεται αμέσως. Λάθη κανόνων γίνονται INVALID_INPUT.
 */
import {
  setTitle, renameSpeaker, addSpeaker, assignSpeaker, editSegmentText, removeSummary, TranscriptRuleError,
} from '../domain/transcript.js';
import { AppError, ERROR_CODES } from './errors.js';

export class TranscriptEditor {
  #repository;
  #clock;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').TranscriptRepository} deps.repository
   * @param {import('./ports.js').Clock} deps.clock
   */
  constructor({ repository, clock }) {
    this.#repository = repository;
    this.#clock = clock;
  }

  setTitle(transcript, title) {
    return this.#apply(transcript, now => setTitle(transcript, title, now));
  }

  renameSpeaker(transcript, speakerId, label) {
    return this.#apply(transcript, now => renameSpeaker(transcript, speakerId, label, now));
  }

  /** @returns {Promise<{ transcript: import('../domain/transcript.js').Transcript, speakerId: string }>} */
  async addSpeaker(transcript, label) {
    let created;
    const updated = await this.#apply(transcript, now => {
      created = addSpeaker(transcript, label, now);
      return created.transcript;
    });
    return { transcript: updated, speakerId: created.speakerId };
  }

  assignSpeaker(transcript, segmentId, speakerId) {
    return this.#apply(transcript, now => assignSpeaker(transcript, segmentId, speakerId, now));
  }

  editSegmentText(transcript, segmentId, text) {
    return this.#apply(transcript, now => editSegmentText(transcript, segmentId, text, now));
  }

  removeSummary(transcript, summaryId) {
    return this.#apply(transcript, now => removeSummary(transcript, summaryId, now));
  }

  async #apply(transcript, change) {
    let updated;
    try {
      updated = change(this.#clock.nowIso());
    } catch (error) {
      if (error instanceof TranscriptRuleError) throw new AppError(ERROR_CODES.INVALID_INPUT, error.message, { cause: error });
      throw error;
    }
    await this.#repository.save(updated);
    return updated;
  }
}
