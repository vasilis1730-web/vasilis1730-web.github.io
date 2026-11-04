/**
 * Ανάγνωση αρχείων ήχου και βίντεο με το Mediabunny (WebCodecs). Υλοποιεί τη
 * θύρα MediaReader.
 *
 * - Το αρχείο διαβάζεται τμηματικά (BlobSource): ένα βίντεο 2 GB δεν φορτώνεται
 *   ποτέ ολόκληρο στη μνήμη.
 * - Ο ήχος αποκωδικοποιείται σε ροή και γίνεται PCM (PCM_SAMPLE_RATE) ένα κανάλι
 *   (StreamingResampler), όπως τον θέλει το Whisper. Κενά στη ροή γεμίζουν με
 *   σιωπή και ήχος που ξεκινά αργότερα από το βίντεο μετατοπίζεται, ώστε οι
 *   χρόνοι της μεταγραφής να ταιριάζουν με το αρχείο (σωστοί υπότιτλοι).
 * - Για αποστολή στο cloud βγάζει μόνο τον ήχο ως Ogg Opus ένα κανάλι ~32 kbps
 *   (περίπου 14 MB ανά ώρα).
 */
import { AppError, ERROR_CODES, onAbort, throwIfAborted } from '../../application/errors.js';
import { StreamingResampler } from '../../domain/audio/streaming-resampler.js';
import { downmixToMono, PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';
const UPLOAD_BITRATE = 32_000;
const UPLOAD_SAMPLE_RATE = 48_000;
/** Κενό στη ροή πάνω από αυτό γεμίζει με σιωπή (s). */
const GAP_TOLERANCE_SEC = 0.05;
/** Αρχική καθυστέρηση ήχου πάνω από αυτό θεωρείται λάθος μεταδεδομένων και αγνοείται (s). */
const MAX_LEADING_SILENCE_SEC = 600;

export class MediabunnyMediaReader {
  #loadMediabunny;

  /** @param {{ loadMediabunny: () => Promise<any> }} deps */
  constructor({ loadMediabunny }) {
    this.#loadMediabunny = loadMediabunny;
  }

  /** @returns {Promise<import('../../application/ports.js').MediaInfo>} */
  async probe(media) {
    const mb = await this.#loadMediabunny();
    const input = openInput(mb, media);
    try {
      if (!(await input.canRead())) throw new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'άγνωστη μορφή αρχείου');
      const audio = await input.getPrimaryAudioTrack();
      const video = await input.getPrimaryVideoTrack();
      const durationSec = await input.computeDuration().catch(() => null);
      return {
        durationSec: Number.isFinite(durationSec) ? durationSec : null,
        hasAudio: Boolean(audio),
        hasVideo: Boolean(video),
        audioCodec: audio ? await audio.getCodec() : null,
      };
    } catch (error) {
      throw toMediaError(mb, error);
    } finally {
      input.dispose();
    }
  }

  /**
   * @param {Blob} media
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {AsyncGenerator<Float32Array>}
   */
  async *readMonoPcm(media, { signal } = {}) {
    const mb = await this.#loadMediabunny();
    const input = openInput(mb, media);
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new AppError(ERROR_CODES.NO_AUDIO_TRACK, 'το αρχείο δεν έχει ήχο');
      if (!(await track.canDecode())) {
        throw new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'ο browser δεν αποκωδικοποιεί αυτόν τον ήχο', { details: { codec: await track.getCodec() } });
      }
      let resampler = null;
      let expectedTime = 0;
      for await (const sample of new mb.AudioSampleSink(track).samples()) {
        try {
          throwIfAborted(signal);
          resampler ??= new StreamingResampler({ inputRate: sample.sampleRate, outputRate: PCM_SAMPLE_RATE });
          const { pcm, endTime } = alignedSamples(sample, expectedTime);
          expectedTime = endTime;
          const output = pcm.length ? resampler.push(pcm) : null;
          if (output && output.length) yield output;
        } finally {
          sample.close();
        }
      }
      if (resampler) {
        const tail = resampler.flush();
        if (tail.length) yield tail;
      }
    } catch (error) {
      throw toMediaError(mb, error);
    } finally {
      input.dispose();
    }
  }

  /**
   * Μόνο ο ήχος ως Ogg Opus για αποστολή. Όταν ο browser δεν κωδικοποιεί Opus
   * ή η μετατροπή δεν είναι δυνατή για αυτό το αρχείο, επιστρέφεται
   * `{ audio: media, compacted: false }`. Σφάλματα ανάγνωσης πετιούνται: το τι
   * θα σταλεί τότε το αποφασίζει η μηχανή (API-005).
   *
   * @returns {Promise<import('../../application/ports.js').CompactAudio>}
   */
  async extractCompactAudio(media, { signal, onFraction } = {}) {
    const mb = await this.#loadMediabunny();
    const settings = { numberOfChannels: 1, sampleRate: UPLOAD_SAMPLE_RATE };
    const notCompacted = { audio: media, compacted: false };
    if (!(await mb.canEncodeAudio('opus', { ...settings, quality: new mb.Quality({ bitrate: UPLOAD_BITRATE }) }))) return notCompacted;
    const input = openInput(mb, media);
    const output = new mb.Output({ format: new mb.OggOutputFormat(), target: new mb.BufferTarget() });
    let conversion = null;
    let unsubscribe = () => {};
    try {
      conversion = await mb.Conversion.init({
        input,
        output,
        tracks: 'primary',
        video: { discard: true },
        audio: { codec: 'opus', ...settings, quality: new mb.Quality({ bitrate: UPLOAD_BITRATE }) },
        showWarnings: false,
      });
      if (!conversion.isValid) return notCompacted;
      conversion.onProgress = progress => onFraction?.(progress);
      const running = conversion;
      // Ακύρωση που έγινε πριν από αυτό το σημείο πιάνεται κι αυτή (OO-018).
      unsubscribe = onAbort(signal, () => { running.cancel(); });
      throwIfAborted(signal);
      await conversion.execute();
      return { audio: new Blob([output.target.buffer], { type: 'audio/ogg' }), compacted: true };
    } catch (error) {
      if ((signal && signal.aborted) || error instanceof mb.ConversionCanceledError) throw new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε', { cause: error });
      throw toMediaError(mb, error);
    } finally {
      unsubscribe();
      input.dispose();
    }
  }
}

function openInput(mb, media) {
  return new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(media) });
}

/**
 * Τα δείγματα ενός AudioSample ως ένα κανάλι, ευθυγραμμισμένα με τον χρόνο του
 * αρχείου: σιωπή μπροστά για κενά ή καθυστερημένη αρχή, περικοπή αρνητικών χρόνων
 * (priming) και επικαλύψεων.
 */
function alignedSamples(sample, expectedTime) {
  const rate = sample.sampleRate;
  const planes = [];
  for (let channel = 0; channel < sample.numberOfChannels; channel++) {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
    planes.push(plane);
  }
  let mono = downmixToMono(planes);
  let start = sample.timestamp;
  if (start < expectedTime) {
    const skip = Math.min(mono.length, Math.round((expectedTime - start) * rate));
    mono = mono.subarray(skip);
    start = expectedTime;
  }
  const gap = start - expectedTime;
  if (gap > GAP_TOLERANCE_SEC && gap < MAX_LEADING_SILENCE_SEC) {
    const padded = new Float32Array(Math.round(gap * rate) + mono.length);
    padded.set(mono, padded.length - mono.length);
    mono = padded;
  }
  return { pcm: mono, endTime: Math.max(expectedTime, sample.timestamp + sample.duration) };
}

function toMediaError(mb, error) {
  if (error instanceof AppError) return error;
  if (mb.UnsupportedInputFormatError && error instanceof mb.UnsupportedInputFormatError) {
    return new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'άγνωστη μορφή αρχείου', { cause: error });
  }
  if (error && (error.name === 'EncodingError' || error.name === 'NotSupportedError')) {
    return new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, error.message, { cause: error });
  }
  return new AppError(ERROR_CODES.UNKNOWN, error && error.message ? error.message : String(error), { cause: error });
}
