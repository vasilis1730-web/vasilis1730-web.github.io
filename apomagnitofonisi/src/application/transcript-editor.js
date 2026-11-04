/**
 * Περίπτωση χρήσης «Διόρθωση μεταγραφής»: κάθε αλλαγή του χρήστη (τίτλος,
 * ονόματα ομιλητών, κείμενο, ομιλητής τμήματος) εφαρμόζεται με τους κανόνες
 * του domain και αποθηκεύεται αμέσως.
 *
 * Μόνο το κενό όνομα ομιλητή οφείλεται στον χρήστη και γίνεται INVALID_INPUT
 * με την αιτία του. Τα υπόλοιπα (άγνωστο τμήμα ή ομιλητής) είναι λάθη του
 * κώδικα και περνούν ως έχουν (API-001).
 */
import {
  setTitle, renameSpeaker, addSpeaker, assignSpeaker, editSegmentText, removeSummary, TranscriptRuleError, TRANSCRIPT_RULES,
} from '../domain/transcript.js';
import { INPUT_ISSUES, invalidInput } from './errors.js';

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
    return this.#apply(now => setTitle(transcript, title, now));
  }

  renameSpeaker(transcript, speakerId, label) {
    return this.#apply(now => renameSpeaker(transcript, speakerId, label, now));
  }

  /** @returns {Promise<{ transcript: import('../domain/transcript.js').Transcript, speakerId: string }>} */
  async addSpeaker(transcript, label) {
    let created;
    const updated = await this.#apply(now => {
      created = addSpeaker(transcript, label, now);
      return created.transcript;
    });
    return { transcript: updated, speakerId: created.speakerId };
  }

  assignSpeaker(transcript, segmentId, speakerId) {
    return this.#apply(now => assignSpeaker(transcript, segmentId, speakerId, now));
  }

  editSegmentText(transcript, segmentId, text) {
    return this.#apply(now => editSegmentText(transcript, segmentId, text, now));
  }

  removeSummary(transcript, summaryId) {
    return this.#apply(now => removeSummary(transcript, summaryId, now));
  }

  async #apply(change) {
    let updated;
    try {
      updated = change(this.#clock.nowIso());
    } catch (error) {
      if (error instanceof TranscriptRuleError && error.rule === TRANSCRIPT_RULES.EMPTY_SPEAKER_NAME) {
        throw invalidInput(INPUT_ISSUES.EMPTY_SPEAKER_NAME, error.message);
      }
      throw error;
    }
    await this.#repository.save(updated);
    return updated;
  }
}
