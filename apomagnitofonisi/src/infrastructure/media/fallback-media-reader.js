/**
 * Ανάγνωση με εφεδρεία: δοκιμάζει πρώτα τον κύριο αναγνώστη (Mediabunny) και,
 * μόνο αν αυτός πει ότι η μορφή δεν υποστηρίζεται, τον εφεδρικό (Web Audio).
 * Υλοποιεί τη θύρα MediaReader (σύνθεση, Composite).
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';

const isUnsupported = error => error instanceof AppError && error.code === ERROR_CODES.UNSUPPORTED_MEDIA;

export class FallbackMediaReader {
  #primary;
  #fallback;

  /**
   * @param {Object} deps
   * @param {import('../../application/ports.js').MediaReader} deps.primary
   * @param {import('../../application/ports.js').MediaReader} deps.fallback
   */
  constructor({ primary, fallback }) {
    this.#primary = primary;
    this.#fallback = fallback;
  }

  async probe(media) {
    try {
      return await this.#primary.probe(media);
    } catch (error) {
      if (!isUnsupported(error)) throw error;
      return this.#fallback.probe(media);
    }
  }

  async *readMono16k(media, options) {
    let yielded = false;
    try {
      for await (const chunk of this.#primary.readMono16k(media, options)) {
        yielded = true;
        yield chunk;
      }
    } catch (error) {
      if (yielded || !isUnsupported(error)) throw error;
      yield* this.#fallback.readMono16k(media, options);
    }
  }

  async extractCompactAudio(media, options) {
    try {
      return await this.#primary.extractCompactAudio(media, options);
    } catch (error) {
      if (!isUnsupported(error)) throw error;
      return media;
    }
  }
}
