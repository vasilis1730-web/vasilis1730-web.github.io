/**
 * Περιλήψεις και πρακτικά με Claude (Anthropic Messages API) και το κλειδί
 * του χρήστη. Υλοποιεί τη θύρα Summarizer.
 *
 * - Ροή κειμένου (streaming): ο χρήστης βλέπει τα πρακτικά όσο γράφονται, και
 *   μεγάλες απαντήσεις δεν κόβονται από χρονικά όρια.
 * - Η μεταγραφή μπαίνει σε δικό της μπλοκ με cache_control: δεύτερη περίληψη
 *   της ίδιας μεταγραφής (π.χ. πρακτικά μετά από περίληψη) διαβάζει το μεγάλο
 *   κείμενο από την cache του παρόχου, με πολύ μικρότερο κόστος.
 * - Αυτόματη εφεδρεία σε άρνηση (fallbacks: "default") για τα μοντέλα που την
 *   υποστηρίζουν. Αν το πρώτο μοντέλο αρνηθεί στη μέση, το κείμενο ξεκινά από
 *   την αρχή (onRestart) και το τελικό είναι του εφεδρικού.
 * - Χωρίς thinking/temperature/top_p/top_k: το Opus 5.5 σκέφτεται πάντα
 *   προσαρμοστικά και η ένταση ρυθμίζεται μόνο με το effort.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';
import { findClaudeModel } from '../../config/models.js';
import { createAnthropicClient, anthropicErrorToAppError } from './anthropic-client.js';

export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_OUTPUT_TOKENS = 64_000;
const EFFORT = 'medium';

export class ClaudeSummarizer {
  #loadSdk;
  #getApiKey;

  /**
   * @param {Object} deps
   * @param {() => Promise<any>} deps.loadSdk
   * @param {() => string|null} deps.getApiKey
   */
  constructor({ loadSdk, getApiKey }) {
    this.#loadSdk = loadSdk;
    this.#getApiKey = getApiKey;
  }

  /**
   * @param {import('../../application/ports.js').SummaryRequest} request
   * @returns {Promise<import('../../application/ports.js').SummaryResult>}
   */
  async summarize({ systemPrompt, transcriptText, instruction, model, signal, onText, onRestart }) {
    const apiKey = this.#getApiKey();
    if (!apiKey) throw new AppError(ERROR_CODES.KEY_MISSING, 'λείπει το κλειδί Anthropic');
    const { client, sdk } = await createAnthropicClient(this.#loadSdk, apiKey);
    try {
      const stream = client.beta.messages.stream(buildRequest({ systemPrompt, transcriptText, instruction, model }), { signal });
      stream.on('streamEvent', event => {
        if (event.type === 'content_block_start' && event.content_block && event.content_block.type === 'fallback') onRestart?.();
      });
      stream.on('text', delta => onText?.(delta));
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new AppError(ERROR_CODES.REFUSED, 'το μοντέλο αρνήθηκε', { details: { category: message.stop_details && message.stop_details.category } });
      return { text: finalText(message.content), model: message.model || model, truncated: message.stop_reason === 'max_tokens' };
    } catch (error) {
      throw anthropicErrorToAppError(sdk, error);
    }
  }
}

/** Το σώμα του αιτήματος (εξάγεται για έλεγχο από τα tests). */
export function buildRequest({ systemPrompt, transcriptText, instruction, model }) {
  const request = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: transcriptText, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: instruction },
      ],
    }],
  };
  const info = findClaudeModel(model);
  if (info && info.supportsServerFallback) {
    request.betas = [SERVER_FALLBACK_BETA];
    request.fallbacks = 'default';
  }
  return request;
}

/** Το κείμενο μετά το τελευταίο μπλοκ εφεδρείας (αν υπάρχει), χωρίς σκέψεις. */
function finalText(content) {
  const blocks = Array.isArray(content) ? content : [];
  let start = 0;
  blocks.forEach((block, i) => { if (block.type === 'fallback') start = i + 1; });
  return blocks.slice(start).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}
