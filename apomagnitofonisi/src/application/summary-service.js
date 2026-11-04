/**
 * Περίπτωση χρήσης «Περίληψη και πρακτικά»: φτιάχνει το prompt από τη
 * μεταγραφή, ζητά από τον Summarizer να γράψει, δίνει το κείμενο όσο
 * γράφεται και αποθηκεύει την περίληψη μαζί με τη μεταγραφή.
 *
 * Οι περιλήψεις γίνονται μόνο με Claude (απόφαση του έργου), γι' αυτό η
 * υπηρεσία ελέγχει και τιμολογεί τα μοντέλα από τον κατάλογο CLAUDE_MODELS.
 */
import { addSummary, SUMMARY_KINDS } from '../domain/transcript.js';
import { findClaudeModel } from '../config/models.js';
import { AppError, ERROR_CODES, throwIfAborted, toAppError } from './errors.js';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryInstruction, formatTranscriptForPrompt } from './summary-prompts.js';
import { estimateTokens, estimateSummaryCost } from './cost-estimate.js';

/**
 * Οι επιλογές μιας περίληψης (API-003).
 *
 * @typedef {Object} SummaryOptions
 * @property {import('../domain/transcript.js').SummaryKind} kind
 * @property {string} [customInstruction]  μόνο για kind 'custom'
 * @property {string} modelId
 * @property {AbortSignal} [signal]
 * @property {(delta: string) => void} [onText]
 * @property {() => void} [onRestart]
 *
 * @typedef {Object} SummaryOutcome
 * @property {import('../domain/transcript.js').Transcript} transcript  με την περίληψη αποθηκευμένη
 * @property {import('../domain/transcript.js').Summary} summary
 * @property {boolean} restarted  ξαναγράφτηκε από εφεδρικό μοντέλο
 */
export class SummaryService {
  #summarizer;
  #repository;
  #clock;
  #ids;
  #unknownSpeakerLabel;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').Summarizer} deps.summarizer
   * @param {import('./ports.js').TranscriptRepository} deps.repository
   * @param {import('./ports.js').Clock} deps.clock
   * @param {import('./ports.js').IdGenerator} deps.idGenerator
   * @param {string} deps.unknownSpeakerLabel  π.χ. «Άγνωστος ομιλητής»
   */
  constructor({ summarizer, repository, clock, idGenerator, unknownSpeakerLabel }) {
    this.#summarizer = summarizer;
    this.#repository = repository;
    this.#clock = clock;
    this.#ids = idGenerator;
    this.#unknownSpeakerLabel = unknownSpeakerLabel;
  }

  /**
   * Χονδρική εκτίμηση κόστους πριν από την αποστολή.
   * @param {import('../domain/transcript.js').Transcript} transcript
   * @param {Pick<SummaryOptions, 'kind'|'customInstruction'|'modelId'>} options
   * @returns {{ inputTokens: number, outputTokens: number, usd: number }}
   */
  estimateCost(transcript, { kind, customInstruction = '', modelId }) {
    const model = requireModel(modelId);
    const instruction = kind === SUMMARY_KINDS.CUSTOM && !String(customInstruction).trim() ? '' : buildSummaryInstruction(kind, customInstruction);
    const inputTokens = estimateTokens(SUMMARY_SYSTEM_PROMPT) + estimateTokens(this.#transcriptText(transcript)) + estimateTokens(instruction);
    return estimateSummaryCost({ inputTokens, kind, pricing: model });
  }

  /**
   * @param {import('../domain/transcript.js').Transcript} transcript
   * @param {SummaryOptions} options
   * @returns {Promise<SummaryOutcome>}
   */
  async summarize(transcript, { kind, customInstruction = '', modelId, signal, onText, onRestart }) {
    requireModel(modelId);
    if (!transcript.segments.length) throw new AppError(ERROR_CODES.EMPTY_TRANSCRIPT, 'η μεταγραφή δεν έχει κείμενο');
    const instruction = buildSummaryInstruction(kind, customInstruction);

    let result;
    try {
      result = await this.#summarizer.summarize({
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        transcriptText: this.#transcriptText(transcript),
        instruction,
        modelId,
        signal,
        onText,
        onRestart,
      });
    } catch (error) {
      throw toAppError(error);
    }
    throwIfAborted(signal);

    const now = this.#clock.nowIso();
    const summary = {
      id: this.#ids.newId(),
      kind,
      ...(kind === SUMMARY_KINDS.CUSTOM ? { instruction: String(customInstruction).trim() } : {}),
      model: result.modelId || modelId,
      createdAt: now,
      text: result.text,
      ...(result.truncated ? { truncated: true } : {}),
    };
    const updated = addSummary(transcript, summary, now);
    await this.#repository.save(updated);
    return { transcript: updated, summary, restarted: Boolean(result.restarted) };
  }

  #transcriptText(transcript) {
    return formatTranscriptForPrompt(transcript, { unknownSpeaker: this.#unknownSpeakerLabel });
  }
}

/** Άγνωστο μοντέλο είναι λάθος προγραμματισμού (API-001): η διεπαφή δείχνει μόνο τον κατάλογο. */
function requireModel(modelId) {
  const model = findClaudeModel(modelId);
  if (!model) throw new RangeError(`άγνωστο μοντέλο ${modelId}`);
  return model;
}
