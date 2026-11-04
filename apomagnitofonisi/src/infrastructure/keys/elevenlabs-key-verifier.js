/**
 * Έλεγχος κλειδιού ElevenLabs με GET /v1/user. Κλειδιά με περιορισμένα
 * δικαιώματα (π.χ. μόνο speech_to_text) απαντούν 401 «missing_permissions»:
 * το κλειδί υπάρχει και ισχύει, απλώς δεν διαβάζει το προφίλ, οπότε
 * θεωρείται έγκυρο. Υλοποιεί τη θύρα KeyVerifier.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';
import { ELEVENLABS_API } from '../../config/endpoints.js';
import { scribeErrorFor } from '../transcription/elevenlabs-response.js';

export class ElevenLabsKeyVerifier {
  provider = 'elevenlabs';
  #fetch;

  /** @param {{ fetch: typeof fetch }} deps */
  constructor({ fetch }) {
    this.#fetch = fetch;
  }

  async verify(key) {
    let response;
    try {
      response = await this.#fetch(ELEVENLABS_API.userUrl, { headers: { [ELEVENLABS_API.keyHeader]: key } });
    } catch (error) {
      throw new AppError(ERROR_CODES.NETWORK, 'αποτυχία δικτύου προς ElevenLabs', { cause: error });
    }
    if (response.ok) return;
    const text = await response.text().catch(() => '');
    const error = scribeErrorFor(response.status, text);
    if (response.status === 401 && error.details.providerStatus === 'missing_permissions') return;
    throw error;
  }
}
