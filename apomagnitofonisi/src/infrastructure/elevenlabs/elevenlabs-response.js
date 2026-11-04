/**
 * Το κοινό λεξιλόγιο του ElevenLabs για τη μηχανή και τον έλεγχο κλειδιού:
 * λέξεις του Scribe → RecognizedToken του domain, και σφάλματα HTTP του
 * ElevenLabs → AppError με σταθερούς κωδικούς.
 *
 * Απάντηση (μονοκάναλη): { language_code, text, words: [{ text, type: 'word'
 * | 'spacing' | 'audio_event', start, end, speaker_id }], audio_duration_secs }.
 *
 * @typedef {Object} AudioEventLabels  ονόματα για τα ηχητικά συμβάντα, από τη διεπαφή (CA-009)
 * @property {Record<string, string>} byEvent  π.χ. { laughter: 'γέλια' }
 * @property {string} unknown  για συμβάν χωρίς όνομα
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';
import { findLanguage } from '../../config/languages.js';
import { TOKEN_KINDS } from '../../domain/words-to-segments.js';

/** Χωρίς ετικέτες από τη διεπαφή, το συμβάν μένει με το όνομα του ElevenLabs. */
const RAW_EVENT_LABELS = Object.freeze({ byEvent: Object.freeze({}), unknown: '?' });

/**
 * @param {any} body  το JSON της απάντησης
 * @param {{ audioEventLabels?: AudioEventLabels }} [options]
 * @returns {{ tokens: import('../../domain/words-to-segments.js').RecognizedToken[], languageCode: string|null, durationSec: number|null }}
 */
export function readScribeResponse(body, { audioEventLabels = RAW_EVENT_LABELS } = {}) {
  const words = Array.isArray(body && body.words)
    ? body.words
    : (Array.isArray(body && body.transcripts) ? body.transcripts.flatMap(t => t.words || []) : []);
  const tokens = [];
  for (const word of words) {
    if (!word || word.type === 'spacing') continue;
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start)) continue;
    const isEvent = word.type === 'audio_event';
    const text = isEvent ? `[${audioEventName(word.text, audioEventLabels)}]` : String(word.text ?? '').trim();
    if (!text) continue;
    tokens.push({ text, start, end: Number.isFinite(end) ? end : start, speakerKey: word.speaker_id ?? null, kind: isEvent ? TOKEN_KINDS.EVENT : TOKEN_KINDS.WORD });
  }
  const language = findLanguage(body && body.language_code);
  const duration = Number(body && body.audio_duration_secs);
  return { tokens, languageCode: language ? language.code : null, durationSec: Number.isFinite(duration) ? duration : null };
}

/**
 * Σφάλμα HTTP του ElevenLabs (οποιουδήποτε endpoint) ως AppError. Ίδιο μοτίβο
 * ονόματος με το appErrorFromAnthropicError (API-022).
 * @param {number} status
 * @param {string} bodyText
 * @returns {AppError}
 */
export function appErrorFromElevenLabsResponse(status, bodyText) {
  const detail = parseDetail(bodyText);
  const details = { status, providerStatus: detail.status, providerMessage: detail.message };
  const error = code => new AppError(code, `ElevenLabs ${status}: ${detail.message || detail.status || ''}`.trim(), { details });
  if (status === 401) return error(detail.status === 'quota_exceeded' ? ERROR_CODES.QUOTA_EXCEEDED : ERROR_CODES.KEY_INVALID);
  if (status === 402) return error(ERROR_CODES.QUOTA_EXCEEDED);
  if (status === 403) return error(ERROR_CODES.KEY_INVALID);
  if (status === 413) return error(ERROR_CODES.FILE_TOO_LARGE);
  if (status === 429) return error(ERROR_CODES.RATE_LIMITED);
  if (status === 400 || status === 422) return error(ERROR_CODES.PROVIDER_REJECTED);
  if (status === 503 || status === 529) return error(ERROR_CODES.OVERLOADED);
  return error(ERROR_CODES.UNKNOWN);
}

/** Το detail των σφαλμάτων: { status, message } ή λίστα επικύρωσης [{ msg }]. */
function parseDetail(bodyText) {
  try {
    const detail = JSON.parse(bodyText).detail;
    if (Array.isArray(detail)) return { status: 'validation_error', message: detail.map(d => d && d.msg).filter(Boolean).join('; ') };
    if (detail && typeof detail === 'object') return { status: detail.status ?? null, message: detail.message ?? null };
    if (typeof detail === 'string') return { status: null, message: detail };
  } catch {
    // όχι JSON
  }
  return { status: null, message: null };
}

function audioEventName(raw, labels) {
  const clean = String(raw ?? '').replace(/[()[\]]/g, '').trim();
  return labels.byEvent[clean.toLowerCase()] || clean || labels.unknown;
}
