/**
 * Μηχανή μεταγραφής στο cloud: ElevenLabs Scribe v2, με το κλειδί του
 * χρήστη. Υλοποιεί τη θύρα TranscriptionEngine.
 *
 * Τα βίντεο και τα αρχεία πάνω από 25 MB στέλνονται ως ήχος Opus (λίγα MB
 * ανά ώρα), αν το επιτρέπει ο browser: λιγότερα δεδομένα από το κινητό και
 * γρηγορότερη αποστολή. Αλλιώς στέλνεται το αρχικό αρχείο (το ElevenLabs
 * δέχεται έως 3 GB και 10 ώρες).
 */
import { AppError, ERROR_CODES, throwIfAborted } from '../../application/errors.js';
import { PROGRESS_STAGES, clampFraction } from '../../application/progress.js';
import { AUTO_LANGUAGE_CODE } from '../../config/languages.js';
import { ELEVENLABS_API } from '../../config/endpoints.js';
import { groupTokensIntoSegments } from '../../domain/words-to-segments.js';
import { readScribeResponse, scribeErrorFor } from './elevenlabs-response.js';

const COMPACT_AUDIO_ABOVE_BYTES = 25 * 1024 * 1024;

export class ElevenLabsEngine {
  kind = 'elevenlabs';

  #getApiKey;
  #uploader;
  #mediaReader;

  /**
   * @param {Object} deps
   * @param {() => string|null} deps.getApiKey
   * @param {import('../http/xhr-uploader.js').XhrUploader} deps.uploader
   * @param {import('../../application/ports.js').MediaReader} deps.mediaReader
   */
  constructor({ getApiKey, uploader, mediaReader }) {
    this.#getApiKey = getApiKey;
    this.#uploader = uploader;
    this.#mediaReader = mediaReader;
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
    form.append('file', upload, uploadName(media, upload));
    if (options.languageCode && options.languageCode !== AUTO_LANGUAGE_CODE) form.append('language_code', options.languageCode);
    form.append('diarize', options.diarize ? 'true' : 'false');
    if (options.diarize && options.expectedSpeakers) form.append('num_speakers', String(options.expectedSpeakers));
    form.append('timestamps_granularity', 'word');
    form.append('tag_audio_events', 'true');

    onProgress?.({ stage: PROGRESS_STAGES.UPLOADING, fraction: 0, detail: { loadedBytes: 0, totalBytes: upload.size } });
    const response = await this.#uploader.post(ELEVENLABS_API.speechToTextUrl, {
      headers: { [ELEVENLABS_API.keyHeader]: key },
      body: form,
      signal,
      onUploadProgress: (loaded, total) => onProgress?.({ stage: PROGRESS_STAGES.UPLOADING, fraction: clampFraction(loaded / total), detail: { loadedBytes: loaded, totalBytes: total } }),
      onUploadComplete: () => onProgress?.({ stage: PROGRESS_STAGES.TRANSCRIBING }),
    });
    if (response.status < 200 || response.status >= 300) throw scribeErrorFor(response.status, response.bodyText);

    let body;
    try {
      body = JSON.parse(response.bodyText);
    } catch (error) {
      throw new AppError(ERROR_CODES.UNKNOWN, 'μη αναγνώσιμη απάντηση του ElevenLabs', { cause: error });
    }
    const { tokens, languageCode, durationSec } = readScribeResponse(body);
    return {
      segments: groupTokensIntoSegments(tokens).map(s => (options.diarize ? s : { ...s, speakerKey: null })),
      languageCode,
      durationSec,
      model: ELEVENLABS_API.speechToTextModelId,
    };
  }

  async #prepareUpload(media, signal, onProgress) {
    const isVideo = String(media.type || '').startsWith('video/');
    if (!isVideo && media.size <= COMPACT_AUDIO_ABOVE_BYTES) return media;
    onProgress?.({ stage: PROGRESS_STAGES.READING, fraction: 0 });
    try {
      return await this.#mediaReader.extractCompactAudio(media, {
        signal,
        onProgress: fraction => onProgress?.({ stage: PROGRESS_STAGES.READING, fraction: clampFraction(fraction) }),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.CANCELLED) throw error;
      // Αν η εξαγωγή ήχου δεν γίνεται, στέλνεται το αρχικό αρχείο: το ElevenLabs διαβάζει και βίντεο.
      return media;
    }
  }
}

function uploadName(original, upload) {
  const base = String(original.name || 'audio').replace(/\.[^.]+$/, '');
  if (upload === original) return original.name || 'audio';
  return `${base}.${upload.type.includes('ogg') ? 'ogg' : 'webm'}`;
}
