/**
 * Έλεγχος κλειδιού Anthropic με τη λίστα μοντέλων (δωρεάν αίτημα).
 * Υλοποιεί τη θύρα KeyVerifier.
 */
import { KEY_PROVIDERS } from '../../application/key-providers.js';
import { createAnthropicClient, appErrorFromAnthropicError } from './anthropic-client.js';

export class AnthropicKeyVerifier {
  provider = KEY_PROVIDERS.ANTHROPIC;
  #loadSdk;

  /** @param {{ loadSdk: () => Promise<any> }} deps */
  constructor({ loadSdk }) {
    this.#loadSdk = loadSdk;
  }

  async verify(key) {
    const { client, sdk } = await createAnthropicClient(this.#loadSdk, key);
    try {
      await client.models.list({ limit: 1 });
    } catch (error) {
      throw appErrorFromAnthropicError(error, sdk);
    }
  }
}
