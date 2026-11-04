/**
 * Περίπτωση χρήσης «Ιστορικό»: λίστα, άνοιγμα, διαγραφή, εισαγωγή από .json
 * και χώρος αποθήκευσης. Οι αλλαγές στο περιεχόμενο μιας μεταγραφής είναι
 * στο TranscriptEditor.
 */
import { createTranscript } from '../domain/transcript.js';
import { deserializeTranscript, TranscriptFileError } from '../domain/transcript-codec.js';
import { AppError, ERROR_CODES } from './errors.js';

export class LibraryService {
  #repository;
  #ids;
  #storage;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').TranscriptRepository} deps.repository
   * @param {import('./ports.js').IdGenerator} deps.idGenerator
   * @param {import('./ports.js').StorageEstimator} deps.storage
   */
  constructor({ repository, idGenerator, storage }) {
    this.#repository = repository;
    this.#ids = idGenerator;
    this.#storage = storage;
  }

  /** @returns {Promise<import('./ports.js').TranscriptListItem[]>} */
  listNewestFirst() {
    return this.#repository.listNewestFirst();
  }

  /** @returns {Promise<import('../domain/transcript.js').Transcript>} */
  async open(id) {
    const transcript = await this.#repository.findById(id);
    if (!transcript) throw new AppError(ERROR_CODES.NOT_FOUND, `δεν βρέθηκε η μεταγραφή ${id}`);
    return transcript;
  }

  remove(id) {
    return this.#repository.remove(id);
  }

  removeAll() {
    return this.#repository.removeAll();
  }

  /**
   * Εισάγει μεταγραφή από αρχείο .json της εφαρμογής. Αν υπάρχει ήδη άλλη με
   * το ίδιο αναγνωριστικό, η εισαγόμενη παίρνει νέο (δεν σβήνεται τίποτα).
   * @param {string} text
   */
  async importFromJson(text) {
    let transcript;
    try {
      transcript = deserializeTranscript(text);
    } catch (error) {
      if (error instanceof TranscriptFileError) throw new AppError(ERROR_CODES.INVALID_INPUT, error.message, { cause: error });
      throw error;
    }
    if (await this.#repository.findById(transcript.id)) {
      transcript = createTranscript({ ...transcript, id: this.#ids.newId() });
    }
    await this.#repository.save(transcript);
    return transcript;
  }

  /** @returns {Promise<import('./ports.js').StorageUsage>} */
  storageUsage() {
    return this.#storage.estimate();
  }
}
