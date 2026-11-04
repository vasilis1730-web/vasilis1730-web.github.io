/**
 * Έλεγχος κλειδιού Anthropic με τη λίστα μοντέλων (δωρεάν αίτημα).
 * Υλοποιεί τη θύρα KeyVerifier.
 */
import { createAnthropicClient, anthropicErrorToAppError } from '../summary/anthropic-client.js';

export class AnthropicKeyVerifier {
  provider = 'anthropic';
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
      throw anthropicErrorToAppError(sdk, error);
    }
  }
}
