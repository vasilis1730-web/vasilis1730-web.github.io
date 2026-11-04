/**
 * Εκτίμηση κόστους μιας περίληψης πριν σταλεί, για να ξέρει ο χρήστης τι
 * πληρώνει με το κλειδί του. Η εκτίμηση είναι χονδρική («περίπου»): στα
 * ελληνικά ένα token αντιστοιχεί περίπου σε 2,7 χαρακτήρες.
 */
import { SUMMARY_KINDS } from '../domain/transcript.js';

const CHARS_PER_TOKEN = 2.7;

/** Τυπικό μήκος απάντησης ανά είδος περίληψης, σε tokens (κλειδιά από τα SUMMARY_KINDS). */
export const EXPECTED_OUTPUT_TOKENS = Object.freeze({
  [SUMMARY_KINDS.BRIEF]: 900,
  [SUMMARY_KINDS.MINUTES]: 3500,
  [SUMMARY_KINDS.ACTIONS]: 1500,
  [SUMMARY_KINDS.CUSTOM]: 2500,
});

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

/**
 * @param {Object} input
 * @param {number} input.inputTokens
 * @param {import('../domain/transcript.js').SummaryKind} input.kind
 * @param {{ inputUsdPerMTok: number, outputUsdPerMTok: number, longPrompt?: { thresholdTokens: number, inputUsdPerMTok: number, outputUsdPerMTok: number } }} input.pricing
 * @returns {{ inputTokens: number, outputTokens: number, usd: number }}
 */
export function estimateSummaryCost({ inputTokens, kind, pricing }) {
  const outputTokens = EXPECTED_OUTPUT_TOKENS[kind];
  if (outputTokens === undefined) throw new RangeError(`άγνωστο είδος περίληψης ${kind}`);
  const rates = pricing.longPrompt && inputTokens > pricing.longPrompt.thresholdTokens ? pricing.longPrompt : pricing;
  const usd = (inputTokens * rates.inputUsdPerMTok + outputTokens * rates.outputUsdPerMTok) / 1_000_000;
  return { inputTokens, outputTokens, usd };
}
