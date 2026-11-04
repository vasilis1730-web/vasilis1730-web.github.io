/**
 * Το Anthropic SDK (@anthropic-ai/sdk, φορτώνεται από το jsDelivr) με το
 * κλειδί του χρήστη, και η μετάφραση των σφαλμάτων του σε AppError.
 *
 * Το `dangerouslyAllowBrowser: true` είναι εδώ σωστή επιλογή: η εφαρμογή δεν
 * έχει server, κάθε χρήστης βάζει το ΔΙΚΟ του κλειδί, που μένει στη συσκευή
 * του και πηγαίνει μόνο στο api.anthropic.com. Δεν υπάρχει κοινό κλειδί που
 * θα μπορούσε να διαρρεύσει σε τρίτους.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';

/**
 * @param {() => Promise<any>} loadSdk  επιστρέφει το module του SDK
 * @param {string} apiKey
 */
export async function createAnthropicClient(loadSdk, apiKey) {
  const sdk = await loadSdk();
  const Anthropic = sdk.default || sdk.Anthropic;
  return { client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }), sdk };
}

/**
 * Τα τυπωμένα σφάλματα του SDK σε κωδικούς της εφαρμογής, από το πιο ειδικό
 * στο πιο γενικό (το SDK έχει ήδη ξαναδοκιμάσει 429 και 5xx). Όσα απορρίπτει ο
 * πάροχος (400, 404, π.χ. «χαμηλό υπόλοιπο») γίνονται PROVIDER_REJECTED, με το
 * μήνυμά του στο details.providerMessage.
 *
 * @param {unknown} error  το σφάλμα (πρώτο όρισμα, API-012)
 * @param {any} sdk  το module του SDK, για τις κλάσεις σφαλμάτων
 * @returns {AppError}
 */
export function anthropicErrorToAppError(error, sdk) {
  if (error instanceof AppError) return error;
  const providerMessage = error && error.error && error.error.error ? error.error.error.message : (error && error.message) || null;
  const make = code => new AppError(code, `Anthropic: ${providerMessage || code}`, { cause: error, details: { status: error && error.status, providerMessage } });
  if (sdk.APIUserAbortError && error instanceof sdk.APIUserAbortError) return make(ERROR_CODES.CANCELLED);
  if (sdk.AuthenticationError && error instanceof sdk.AuthenticationError) return make(ERROR_CODES.KEY_INVALID);
  if (sdk.PermissionDeniedError && error instanceof sdk.PermissionDeniedError) return make(ERROR_CODES.KEY_INVALID);
  if (sdk.RateLimitError && error instanceof sdk.RateLimitError) return make(ERROR_CODES.RATE_LIMITED);
  if (sdk.BadRequestError && error instanceof sdk.BadRequestError) return make(ERROR_CODES.PROVIDER_REJECTED);
  if (sdk.APIConnectionError && error instanceof sdk.APIConnectionError) return make(ERROR_CODES.NETWORK);
  if (sdk.APIError && error instanceof sdk.APIError) {
    if (error.status === 529 || error.status === 503) return make(ERROR_CODES.OVERLOADED);
    if (error.status === 404) return make(ERROR_CODES.PROVIDER_REJECTED);
    return make(ERROR_CODES.UNKNOWN);
  }
  if (error && error.name === 'AbortError') return make(ERROR_CODES.CANCELLED);
  return make(ERROR_CODES.UNKNOWN);
}
