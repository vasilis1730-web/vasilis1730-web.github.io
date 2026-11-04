/**
 * Εφεδρική ανάγνωση με το Web Audio API (decodeAudioData) για μορφές που δεν
 * διαβάζει το Mediabunny. Αποκωδικοποιεί όλο το αρχείο στη μνήμη (1 ώρα ≈
 * 230 MB στα 16 kHz του PCM_SAMPLE_RATE), άρα είναι μόνο για ό,τι δεν διαβάζεται αλλιώς. Μόνο στο
 * κύριο νήμα (το OfflineAudioContext δεν υπάρχει σε workers).
 * Υλοποιεί τη θύρα MediaReader.
 */
import { AppError, ERROR_CODES, throwIfAborted } from '../../application/errors.js';
import { downmixToMono, PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';

const CHUNK_SECONDS = 10;

export class WebAudioMediaReader {
  #createContext;
  #decoded = new WeakMap();

  /** @param {{ createOfflineContext: (channels: number, length: number, sampleRate: number) => BaseAudioContext }} deps */
  constructor({ createOfflineContext }) {
    this.#createContext = createOfflineContext;
  }

  async probe(media) {
    const buffer = await this.#decode(media);
    return { durationSec: buffer.duration, hasAudio: buffer.length > 0, hasVideo: String(media.type || '').startsWith('video/'), audioCodec: null };
  }

  async *readMonoPcm(media, { signal } = {}) {
    const buffer = await this.#decode(media);
    throwIfAborted(signal);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const mono = downmixToMono(channels);
    const step = CHUNK_SECONDS * PCM_SAMPLE_RATE;
    for (let offset = 0; offset < mono.length; offset += step) {
      throwIfAborted(signal);
      yield mono.slice(offset, offset + step);
    }
    this.#decoded.delete(media);
  }

  /**
   * Χωρίς κωδικοποιητή: δεν γίνεται συμπίεση.
   * @returns {Promise<import('../../application/ports.js').CompactAudio>}
   */
  async extractCompactAudio(media) {
    return { audio: media, compacted: false };
  }

  #decode(media) {
    if (!this.#decoded.has(media)) {
      const decoding = media.arrayBuffer()
        .then(bytes => this.#createContext(1, 1, PCM_SAMPLE_RATE).decodeAudioData(bytes))
        .catch(error => {
          this.#decoded.delete(media);
          throw new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'ο browser δεν διαβάζει αυτό το αρχείο', { cause: error });
        });
      this.#decoded.set(media, decoding);
    }
    return this.#decoded.get(media);
  }
}
