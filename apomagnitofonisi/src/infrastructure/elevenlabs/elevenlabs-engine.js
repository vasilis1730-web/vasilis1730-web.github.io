/**
 * Μηχανή μεταγραφής στο cloud: ElevenLabs Scribe v2, με το κλειδί του
 * χρήστη. Υλοποιεί τη θύρα TranscriptionEngine.
 *
 * Τα βίντεο και τα αρχεία πάνω από 25 MB στέλνονται ως ήχος Opus (λίγα MB
 * ανά ώρα), αν το επιτρέπει ο browser: λιγότερα δεδομένα από το κινητό και
 * γρηγορότερη αποστολή. Η απόφαση για την εφεδρεία παίρνεται μόνο εδώ
 * (API-005): όταν η συμπίεση δεν γίνεται ή αποτύχει, στέλνεται το αρχικό αρχείο
 * (το ElevenLabs δέχεται έως 3 GB, 10 ώρες, και βίντεο).
 */
import { AppError, ERROR_CODES, isCancellation, throwIfAborted } from '../../application/errors.js';
import { PROGRESS_STAGES, clampFraction } from '../../application/progress.js';
import { explicitLanguageCode } from '../../config/languages.js';
import { ELEVENLABS_API } from '../../config/endpoints.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';
import { groupTokensIntoSegments } from '../../domain/words-to-segments.js';
import { readScribeResponse, elevenLabsErrorFor } from './elevenlabs-response.js';

const COMPACT_AUDIO_ABOVE_BYTES = 25 * 1024 * 1024;

export class ElevenLabsEngine {
  kind = ENGINE_KINDS.ELEVENLABS;

  #getApiKey;
  #uploader;
  #mediaReader;
  #audioEventLabels;

  /**
   * @param {Object} deps
   * @param {() => string|null} deps.getApiKey
   * @param {import('../http/xhr-uploader.js').XhrUploader} deps.uploader
   * @param {import('../../application/ports.js').MediaReader} deps.mediaReader
   * @param {import('./elevenlabs-response.js').AudioEventLabels} [deps.audioEventLabels]  ονόματα ηχητικών συμβάντων (από τη διεπαφή)
   */
  constructor({ getApiKey, uploader, mediaReader, audioEventLabels }) {
    this.#getApiKey = getApiKey;
    this.#uploader = uploader;
    this.#mediaReader = mediaReader;
    this.#audioEventLabels = audioEventLabels;
  }

  async checkAvailability() {
    return this.#getApiKey() ? { available: true } : { available: false, reason: ERROR_CODES.KEY_MISSING };
  }

  /**
   * @param {import('../../application/ports.js').RecognitionRequest} request
   * @returns {Promise<import('../../application/ports.js').RecognitionResult>}
   */
  async recognize({ media, options, signal, onProgress }) {
    const key = this.#getApiKey();
    if (!key) throw new AppError(ERROR_CODES.KEY_MISSING, 'λείπει το κλειδί ElevenLabs');

    const upload = await this.#prepareUpload(media, signal, onProgress);
    throwIfAborted(signal);

    const form = new FormData();
    form.append('model_id', ELEVENLABS_API.speechToTextModelId);
    form.append('file', upload.audio, uploadName(media, upload));
    const languageCode = explicitLanguageCode(options.languageCode);
    if (languageCode) form.append('language_code', languageCode);
    form.append('diarize', options.diarize ? 'true' : 'false');
    if (options.diarize && options.expectedSpeakers) form.append('num_speakers', String(options.expectedSpeakers));
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'true');

    onProgress?.({ stage: PROGRESS_STAGES.UPLOADING, fraction: 0, detail: { loadedBytes: 0, totalBytes: upload.audio.size } });
    const response = await this.#uploader.post(ELEVENLABS_API.speechToTextUrl, {
      headers: { [ELEVENLABS_API.keyHeader]: key },
      body: form,
      signal,
      onUploadProgress: (loaded, total) => onProgress?.({ stage: PROGRESS_STAGES.UPLOADING, fraction: clampFraction(loaded / total), detail: { loadedBytes: loaded, totalBytes: total } }),
      onUploadComplete: () => onProgress?.({ stage: PROGRESS_STAGES.TRANSCRIBING }),
    });
    if (response.status < 200 || response.status >= 300) throw elevenLabsErrorFor(response.status, response.bodyText);

    let body;
    try {
      body = JSON.parse(response.bodyText);
    } catch (error) {
      throw new AppError(ERROR_CODES.UNKNOWN, 'μη αναγνώσιμη απάντηση του ElevenLabs', { cause: error });
    }
    const { tokens, languageCode: detected, durationSec } = readScribeResponse(body, this.#audioEventLabels ? { audioEventLabels: this.#audioEventLabels } : {});
    return {
      segments: groupTokensIntoSegments(tokens).map(s => (options.diarize ? s : { ...s, speakerKey: null })),
      languageCode: detected,
      durationSec,
      model: ELEVENLABS_API.speechToTextModelId,
    };
  }

  /** @returns {Promise<import('../../application/ports.js').CompactAudio>} */
  async #prepareUpload(media, signal, onProgress) {
    const original = { audio: media, compacted: false };
    const isVideo = String(media.type || '').startsWith('video/');
    if (!isVideo && media.size <= COMPACT_AUDIO_ABOVE_BYTES) return original;
    onProgress?.({ stage: PROGRESS_STAGES.READING, fraction: 0 });
    try {
      return await this.#mediaReader.extractCompactAudio(media, {
        signal,
        onFraction: fraction => onProgress?.({ stage: PROGRESS_STAGES.READING, fraction: clampFraction(fraction) }),
      });
    } catch (error) {
      if (isCancellation(error)) throw error;
      // Η μόνη απόφαση εφεδρείας (API-005): το ElevenLabs διαβάζει και το αρχικό αρχείο, ακόμη και βίντεο.
      return original;
    }
  }
}

/** Το όνομα του αρχείου που ανεβαίνει: το αρχικό, ή με κατάληξη .ogg όταν στάλθηκε ο συμπιεσμένος ήχος. */
function uploadName(original, upload) {
  if (!upload.compacted) return original.name || 'audio';
  const base = String(original.name || 'audio').replace(/\.[^.]+$/, '');
  return `${base}.${String(upload.audio.type).includes('ogg') ? 'ogg' : 'webm'}`;
}
