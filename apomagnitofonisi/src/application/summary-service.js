/**
 * Περίπτωση χρήσης «Περίληψη και πρακτικά»: φτιάχνει το prompt από τη
 * μεταγραφή, ζητά από τον Summarizer (π.χ. Claude) να γράψει, δίνει το κείμενο
 * όσο γράφεται και αποθηκεύει την περίληψη μαζί με τη μεταγραφή.
 */
import { addSummary, SUMMARY_KINDS } from '../domain/transcript.js';
import { findClaudeModel } from '../config/models.js';
import { AppError, ERROR_CODES, throwIfAborted, toAppError } from './errors.js';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryInstruction, formatTranscriptForPrompt } from './summary-prompts.js';
import { estimateTokens, estimateSummaryCost } from './cost-estimate.js';

/**
 * @typedef {Object} SummaryJob
 * @property {import('../domain/transcript.js').SummaryKind} kind
 * @property {string} [customInstruction]  μόνο για kind 'custom'
 * @property {string} modelId
 * @property {AbortSignal} [signal]
 * @property {(delta: string) => void} [onText]
 * @property {() => void} [onRestart]
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
   * @param {SummaryJob} job
   * @returns {Promise<{ transcript: import('../domain/transcript.js').Transcript, summary: import('../domain/transcript.js').Summary }>}
   */
  async summarize(transcript, { kind, customInstruction = '', modelId, signal, onText, onRestart }) {
    requireModel(modelId);
    if (!transcript.segments.length) throw new AppError(ERROR_CODES.INVALID_INPUT, 'η μεταγραφή δεν έχει κείμενο');
    let instruction;
    try {
      instruction = buildSummaryInstruction(kind, customInstruction);
    } catch (error) {
      throw new AppError(ERROR_CODES.INVALID_INPUT, error.message, { cause: error });
    }

    let result;
    try {
      result = await this.#summarizer.summarize({
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        transcriptText: this.#transcriptText(transcript),
        instruction,
        model: modelId,
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
      model: result.model || modelId,
      createdAt: now,
      text: result.text,
      ...(result.truncated ? { truncated: true } : {}),
    };
    const updated = addSummary(transcript, summary, now);
    await this.#repository.save(updated);
    return { transcript: updated, summary };
  }

  #transcriptText(transcript) {
    return formatTranscriptForPrompt(transcript, { unknownSpeaker: this.#unknownSpeakerLabel });
  }
}

function requireModel(modelId) {
  const model = findClaudeModel(modelId);
  if (!model) throw new AppError(ERROR_CODES.INVALID_INPUT, `άγνωστο μοντέλο ${modelId}`);
  return model;
}
