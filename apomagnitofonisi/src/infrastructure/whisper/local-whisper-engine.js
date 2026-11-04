/**
 * Μηχανή μεταγραφής στη συσκευή: Whisper (Transformers.js) σε Web Worker,
 * χωρίς να φύγει ο ήχος από τη συσκευή. Υλοποιεί τη θύρα TranscriptionEngine,
 * μαζί με το describeQualityPresets (τα επίπεδα ποιότητας της συσκευής).
 *
 * Ροή: το αρχείο διαβάζεται σε ροή PCM (MediaReader, στο κύριο νήμα, με
 * εφεδρεία Web Audio) → AudioWindowAssembler (παράθυρα έως 28 s, κομμένα σε
 * παύσεις) → worker (Whisper, και αποτύπωμα φωνής όταν ζητείται διαχωρισμός
 * ομιλητών) → τμήματα με χρόνους του αρχείου → ομαδοποίηση ομιλητών (domain).
 * Στον worker βρίσκονται το πολύ `maxWindowsInFlight` παράθυρα, οπότε η μνήμη
 * μένει σταθερή όσο μεγάλο κι αν είναι το αρχείο. Ακύρωση = τερματισμός του
 * worker (άμεσος, και ελευθερώνει τη μνήμη του μοντέλου).
 */
import { AppError, ERROR_CODES, isCancellation, toAppError } from '../../application/errors.js';
import { PROGRESS_STAGES, clampFraction } from '../../application/progress.js';
import { AudioWindowAssembler } from '../../domain/audio/audio-window-assembler.js';
import { PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';
import { clusterEmbeddings, fillMissingLabels } from '../../domain/diarization/speaker-clustering.js';
import { isLikelyHallucination } from '../../domain/text-normalize.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';
import { explicitLanguageCode, whisperLanguageFor } from '../../config/languages.js';
import { SPEAKER_EMBEDDING_MODEL } from '../../config/models.js';
import { WorkerClient } from './worker-client.js';
import { selectLocalModel, describeQualityPresets } from './local-model-selection.js';

const MAX_WASM_THREADS = 4;

export class LocalWhisperEngine {
  kind = ENGINE_KINDS.LOCAL;

  #createWorker;
  #mediaReader;
  #detectCapabilities;
  #maxWindowsInFlight;

  /**
   * @param {Object} deps
   * @param {() => Worker} deps.createWorker
   * @param {import('../../application/ports.js').MediaReader} deps.mediaReader
   * @param {() => Promise<import('../platform/capabilities.js').DeviceCapabilities>} deps.detectCapabilities
   * @param {number} [deps.maxWindowsInFlight]
   */
  constructor({ createWorker, mediaReader, detectCapabilities, maxWindowsInFlight = 2 }) {
    this.#createWorker = createWorker;
    this.#mediaReader = mediaReader;
    this.#detectCapabilities = detectCapabilities;
    this.#maxWindowsInFlight = maxWindowsInFlight;
  }

  async checkAvailability(options = {}) {
    const caps = await this.#detectCapabilities();
    if (!caps.webAssembly || !caps.workers) return { available: false, reason: ERROR_CODES.DEVICE_UNSUPPORTED };
    if (!selectLocalModel(options.localQuality, caps)) return { available: false, reason: ERROR_CODES.DEVICE_UNSUPPORTED };
    return { available: true };
  }

  /** @returns {Promise<import('../../application/ports.js').QualityPresetsDescription>} */
  async describeQualityPresets() {
    return describeQualityPresets(await this.#detectCapabilities());
  }

  /**
   * @param {import('../../application/ports.js').RecognitionRequest} request
   * @returns {Promise<import('../../application/ports.js').RecognitionResult>}
   */
  async recognize({ media, options, signal, onProgress, onPartialSegments }) {
    const caps = await this.#detectCapabilities();
    const model = selectLocalModel(options.localQuality, caps);
    if (!model) throw new AppError(ERROR_CODES.DEVICE_UNSUPPORTED, 'το επίπεδο ποιότητας θέλει WebGPU');
    onProgress?.({ stage: PROGRESS_STAGES.READING });
    const info = await this.#mediaReader.probe(media);
    if (!info.hasAudio) throw new AppError(ERROR_CODES.NO_AUDIO_TRACK, 'το αρχείο δεν έχει ήχο');

    const worker = new WorkerClient(this.#createWorker());
    const stop = () => worker.terminate();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await this.#loadModels(worker, model, options, caps, onProgress);
      const recognized = await this.#transcribeStream(worker, media, options, info.durationSec, { signal, onProgress, onPartialSegments });
      if (options.diarize) onProgress?.({ stage: PROGRESS_STAGES.DIARIZING });
      return {
        segments: options.diarize ? withSpeakers(recognized, options.expectedSpeakers) : recognized.map(withoutSpeaker),
        languageCode: explicitLanguageCode(options.languageCode),
        durationSec: info.durationSec,
        modelId: model.repo,
      };
    } catch (error) {
      if ((signal && signal.aborted) || isCancellation(error)) throw new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε', { cause: error });
      throw toAppError(error);
    } finally {
      signal?.removeEventListener('abort', stop);
      worker.terminate();
    }
  }

  async #loadModels(worker, model, options, caps, onProgress) {
    onProgress?.({ stage: PROGRESS_STAGES.DOWNLOADING_MODEL, fraction: 0 });
    /** @type {import('./worker-protocol.js').LoadModelsPayload} */
    const payload = {
      speech: { repo: model.repo, device: model.device, dtype: model.dtype },
      speaker: options.diarize ? { repo: SPEAKER_EMBEDDING_MODEL.repo, dtype: SPEAKER_EMBEDDING_MODEL.dtype } : null,
      wasmThreads: caps.crossOriginIsolated ? Math.max(1, Math.min(MAX_WASM_THREADS, caps.hardwareConcurrency)) : 1,
    };
    await worker.loadModels(payload, {
      onModelProgress: ({ loadedBytes, totalBytes }) => onProgress?.({
        stage: PROGRESS_STAGES.DOWNLOADING_MODEL,
        fraction: clampFraction(loadedBytes / totalBytes),
        detail: { loadedBytes, totalBytes },
      }),
    });
  }

  async #transcribeStream(worker, media, options, durationSec, { signal, onProgress, onPartialSegments }) {
    const whisperLanguage = whisperLanguageFor(options.languageCode);
    const assembler = new AudioWindowAssembler();
    const inFlight = new Set();
    const recognized = [];
    let decodedSec = 0;
    let doneSec = 0;
    const reportProgress = () => onProgress?.({
      stage: PROGRESS_STAGES.TRANSCRIBING,
      fraction: durationSec ? clampFraction(doneSec / durationSec) : undefined,
      detail: { processedSec: doneSec, totalSec: durationSec ?? undefined },
    });

    const submit = async window => {
      const windowSec = window.samples.length / PCM_SAMPLE_RATE;
      if (window.isSilent) { doneSec += windowSec; reportProgress(); return; }
      while (inFlight.size >= this.#maxWindowsInFlight) await Promise.race(inFlight);
      /** @type {import('./worker-protocol.js').TranscribeWindowPayload} */
      const payload = { startSec: window.startSec, samples: window.samples, whisperLanguage, embedSpeakers: options.diarize };
      const pending = worker.transcribeWindow(payload).then(result => {
        const segments = result.segments.filter(s => !isLikelyHallucination(s.text));
        recognized.push(...segments);
        doneSec += windowSec;
        if (segments.length) onPartialSegments?.(segments.map(withoutSpeaker));
        reportProgress();
      });
      const tracked = pending.finally(() => inFlight.delete(tracked));
      // Το σφάλμα το βλέπουν τα Promise.race/all, εδώ μόνο να μη μείνει «unhandled» μετά από τερματισμό.
      tracked.catch(() => {});
      inFlight.add(tracked);
    };

    reportProgress();
    for await (const pcm of this.#mediaReader.readMonoPcm(media, { signal })) {
      decodedSec += pcm.length / PCM_SAMPLE_RATE;
      for (const window of assembler.push(pcm)) await submit(window);
    }
    for (const window of assembler.flush()) await submit(window);
    await Promise.all(inFlight);
    if (!durationSec) onProgress?.({ stage: PROGRESS_STAGES.TRANSCRIBING, fraction: 1, detail: { processedSec: decodedSec, totalSec: decodedSec } });
    return recognized.sort((a, b) => a.start - b.start);
  }
}

/** Ομαδοποίηση από τα αποτυπώματα: τμήματα χωρίς αποτύπωμα παίρνουν τον κοντινότερο ομιλητή. */
function withSpeakers(segments, expectedSpeakers) {
  const embedded = segments.map((s, i) => ({ s, i })).filter(x => x.s.embedding);
  const labels = segments.map(() => null);
  const clustered = clusterEmbeddings(embedded.map(x => x.s.embedding), { speakerCount: expectedSpeakers ?? null });
  embedded.forEach((x, k) => { labels[x.i] = clustered[k]; });
  const filled = fillMissingLabels(labels, segments);
  return segments.map((s, i) => ({ ...withoutSpeaker(s), speakerKey: `local-${filled[i]}` }));
}

function withoutSpeaker({ start, end, text }) {
  return { start, end, text, speakerKey: null };
}
