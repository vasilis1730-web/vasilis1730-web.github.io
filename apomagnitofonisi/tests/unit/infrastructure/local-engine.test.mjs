import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWhisperEngine } from '../../../src/infrastructure/whisper/local-whisper-engine.js';
import { selectLocalModel, resolvePresetId, describeQualityPresets } from '../../../src/infrastructure/whisper/local-model-selection.js';
import { WorkerClient } from '../../../src/infrastructure/whisper/worker-client.js';
import { WORKER_REQUESTS, WORKER_REPLIES, WORKER_EVENTS } from '../../../src/infrastructure/whisper/worker-protocol.js';
import { createWhisperWorkerHandler, segmentSamples } from '../../../src/infrastructure/whisper/whisper-worker-handler.js';
import { configureTransformers, createDownloadProgress, WhisperRecognizer } from '../../../src/infrastructure/whisper/whisper-recognizer.js';
import { SpeakerEmbedder } from '../../../src/infrastructure/whisper/speaker-embedder.js';
import { AppError, ERROR_CODES } from '../../../src/application/errors.js';
import { PCM_SAMPLE_RATE } from '../../../src/domain/audio/pcm.js';
import { ENGINE_KINDS } from '../../../src/domain/transcript.js';

const WASM_ONLY = { webgpu: false, shaderF16: false, webAssembly: true, workers: true, crossOriginIsolated: true, hardwareConcurrency: 8 };
const WEBGPU_F16 = { ...WASM_ONLY, webgpu: true, shaderF16: true };

test('επιλογή μοντέλου ανά συσκευή και τα επίπεδα ποιότητας που βλέπει η διεπαφή', () => {
  assert.equal(resolvePresetId('auto', WASM_ONLY), 'fast');
  assert.equal(resolvePresetId(undefined, WASM_ONLY), 'fast', 'χωρίς επιλογή: αυτόματα');
  assert.equal(resolvePresetId('auto', WEBGPU_F16), 'balanced');
  assert.deepEqual(selectLocalModel('fast', WASM_ONLY), { presetId: 'fast', repo: 'onnx-community/whisper-base', device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, approxDownloadMb: 77 });
  assert.equal(selectLocalModel('balanced', WEBGPU_F16).device, 'webgpu');
  assert.equal(selectLocalModel('accurate', WASM_ONLY), null, 'το ακριβές θέλει WebGPU');
  assert.deepEqual(selectLocalModel('accurate', WEBGPU_F16).dtype, { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' });
  assert.deepEqual(selectLocalModel('accurate', { ...WEBGPU_F16, shaderF16: false }).dtype, { encoder_model: 'q4', decoder_model_merged: 'q4' });
  assert.equal(selectLocalModel('unknown', WASM_ONLY), null);
  assert.deepEqual(describeQualityPresets(WASM_ONLY), {
    accelerated: false,
    autoPresetId: 'fast',
    presets: [
      { id: 'fast', available: true, approxDownloadMb: 77 },
      { id: 'balanced', available: true, approxDownloadMb: 250 },
      { id: 'accurate', available: false, approxDownloadMb: null },
    ],
  });
  assert.equal(describeQualityPresets(WEBGPU_F16).accelerated, true);
  assert.equal(describeQualityPresets(WEBGPU_F16).autoPresetId, 'balanced');
});

/**
 * Worker με την πραγματική λογική του whisper-worker.js (createWhisperWorkerHandler)
 * και ψεύτικα μοντέλα: τα tests περνούν από ολόκληρο το πρωτόκολλο σελίδας και worker.
 */
class HandlerWorker {
  constructor({ transcribe, embed = null, loadError = null } = {}) {
    this.posted = [];
    this.loads = [];
    this.terminated = false;
    this.handler = createWhisperWorkerHandler({
      loadModels: async (payload, onProgress) => {
        this.loads.push(payload);
        if (loadError) throw loadError;
        onProgress(50, 100);
        return {
          recognizer: { transcribe: transcribe || ((samples, { startSec }) => [{ start: startSec + 0.5, end: startSec + samples.length / PCM_SAMPLE_RATE - 0.5, text: `παράθυρο ${Math.round(startSec)}` }]) },
          embedder: payload.speaker && embed ? { embed } : null,
          device: payload.speech.device,
        };
      },
      post: (message, transfer) => {
        queueMicrotask(() => { if (!this.terminated) this.onmessage({ data: message, transfer }); });
      },
    });
  }
  postMessage(message, transfer) {
    this.posted.push({ message, transfer });
    queueMicrotask(() => { if (!this.terminated) this.handler.onMessage(message); });
  }
  terminate() { this.terminated = true; }
}

function tone(seconds) {
  const out = new Float32Array(Math.round(seconds * PCM_SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin(i / 10);
  return out;
}

function reader(chunks, { durationSec = 60, hasAudio = true } = {}) {
  return {
    async probe() { return { durationSec, hasAudio, hasVideo: false, audioCodec: 'aac' }; },
    async *readMono16k() { for (const c of chunks) yield c; },
    async extractCompactAudio(m) { return { audio: m, compacted: false }; },
  };
}

const LOCAL_OPTIONS = { languageCode: 'el', diarize: false, expectedSpeakers: null, localQualityPreset: 'fast' };

test('ροή: παράθυρα στον worker με τη σειρά, πρόοδος, παραισθήσεις έξω, χωρίς ομιλητές', async () => {
  const workers = [];
  const engine = new LocalWhisperEngine({
    createWorker: () => {
      const w = new HandlerWorker({ transcribe: (samples, { startSec }) => [
        { start: startSec + 0.2, end: startSec + 3, text: `κείμενο ${Math.round(startSec)}` },
        { start: startSec + 4, end: startSec + samples.length / PCM_SAMPLE_RATE, text: 'Υπότιτλοι AUTHORWAVE' },
      ] });
      workers.push(w);
      return w;
    },
    mediaReader: reader([tone(20), tone(20), tone(20)]),
    detectCapabilities: async () => WASM_ONLY,
  });
  assert.equal(engine.kind, ENGINE_KINDS.LOCAL);
  const stages = [];
  const downloads = [];
  const partial = [];
  const result = await engine.recognize({
    media: {}, options: LOCAL_OPTIONS,
    onProgress: p => { stages.push(p.stage); if (p.stage === 'downloading-model') downloads.push(p.fraction); },
    onPartialSegments: s => partial.push(...s),
  });
  const load = workers[0].posted[0].message;
  assert.equal(load.type, WORKER_REQUESTS.LOAD_MODELS);
  assert.equal(load.payload.speech.repo, 'onnx-community/whisper-base');
  assert.equal(load.payload.speaker, null);
  assert.equal(load.payload.wasmThreads, 4);
  assert.deepEqual(downloads, [0, 0.5], 'η πρόοδος λήψης φτάνει από τον worker');
  const windows = workers[0].posted.slice(1).map(p => p.message);
  assert.ok(windows.length >= 2);
  assert.ok(windows.every(w => w.type === WORKER_REQUESTS.TRANSCRIBE_WINDOW && w.payload.whisperLanguage === 'greek' && w.payload.embedSpeakers === false));
  assert.ok(workers[0].posted.slice(1).every(p => p.transfer[0] === p.message.payload.samples.buffer), 'τα δείγματα μεταφέρονται, δεν αντιγράφονται');
  assert.ok(result.segments.length >= 2 && result.segments.every(s => s.text.startsWith('κείμενο')), 'οι γνωστές παραισθήσεις πετιούνται');
  assert.ok(result.segments.every(s => s.speakerKey === null && !('embedding' in s)));
  assert.deepEqual(result.segments.map(s => s.start), [...result.segments.map(s => s.start)].sort((a, b) => a - b));
  assert.equal(partial.length, result.segments.length);
  assert.ok(stages.includes('downloading-model') && stages.includes('transcribing'));
  assert.equal(result.model, 'onnx-community/whisper-base');
  assert.equal(result.languageCode, 'el');
  assert.equal(workers[0].terminated, true, 'ο worker τερματίζεται στο τέλος');
});

test('διαχωρισμός ομιλητών από αποτυπώματα, και μικρά τμήματα με τον κοντινότερο', async () => {
  const voiceA = Float32Array.from([1, 0, 0, 0]);
  const voiceB = Float32Array.from([0, 1, 0, 0]);
  let worker;
  const engine = new LocalWhisperEngine({
    createWorker: () => (worker = new HandlerWorker({
      transcribe: (samples, { startSec }) => [
        { start: startSec, end: startSec + 4, text: 'α' },
        { start: startSec + 4.1, end: startSec + 4.5, text: 'β' },
        { start: startSec + 6, end: startSec + 12, text: 'γ' },
      ],
      // Όπως το SpeakerEmbedder: κάτω από 1 s χωρίς αποτύπωμα. Το μήκος δείχνει ποιο τμήμα είναι.
      embed: async samples => {
        const seconds = samples.length / PCM_SAMPLE_RATE;
        if (seconds < 1) return null;
        return Float32Array.from(seconds < 5 ? voiceA : voiceB);
      },
    })),
    mediaReader: reader([tone(15)], { durationSec: 15 }),
    detectCapabilities: async () => WASM_ONLY,
  });
  const result = await engine.recognize({ media: {}, options: { languageCode: 'auto', diarize: true, expectedSpeakers: null, localQualityPreset: 'auto' } });
  assert.deepEqual(result.segments.map(s => [s.text, s.speakerKey]), [['α', 'local-0'], ['β', 'local-0'], ['γ', 'local-1']]);
  assert.equal(result.languageCode, null);
  assert.equal(worker.loads[0].speaker.repo, 'onnx-community/wespeaker-voxceleb-resnet34-LM');
  const window = worker.posted[1].message.payload;
  assert.equal(window.whisperLanguage, null, 'αυτόματη ανίχνευση γλώσσας');
  assert.equal(window.embedSpeakers, true);
});

test('χωρίς ήχο, χωρίς WebGPU για το «ακριβές», σφάλμα φόρτωσης και ακύρωση', async () => {
  const base = { createWorker: () => new HandlerWorker(), detectCapabilities: async () => WASM_ONLY };
  await assert.rejects(new LocalWhisperEngine({ ...base, mediaReader: reader([], { hasAudio: false }) }).recognize({ media: {}, options: LOCAL_OPTIONS }), e => e.code === ERROR_CODES.NO_AUDIO_TRACK);
  const engine = new LocalWhisperEngine({ ...base, mediaReader: reader([]) });
  assert.deepEqual(await engine.checkAvailability({ ...LOCAL_OPTIONS, localQualityPreset: 'accurate' }), { available: false, reason: ERROR_CODES.DEVICE_UNSUPPORTED });
  assert.deepEqual(await engine.checkAvailability({ ...LOCAL_OPTIONS, localQualityPreset: 'fast' }), { available: true });
  assert.deepEqual(await engine.checkAvailability(), { available: true }, 'χωρίς επιλογές: αυτόματη ποιότητα');
  await assert.rejects(engine.recognize({ media: {}, options: { ...LOCAL_OPTIONS, localQualityPreset: 'accurate' } }), e => e.code === ERROR_CODES.DEVICE_UNSUPPORTED);
  const noWorkers = new LocalWhisperEngine({ ...base, detectCapabilities: async () => ({ ...WASM_ONLY, workers: false }), mediaReader: reader([]) });
  assert.deepEqual(await noWorkers.checkAvailability(LOCAL_OPTIONS), { available: false, reason: ERROR_CODES.DEVICE_UNSUPPORTED });
  assert.deepEqual((await engine.describeQualityPresets()).presets.map(p => p.available), [true, true, false]);

  const failing = new LocalWhisperEngine({ ...base, createWorker: () => new HandlerWorker({ loadError: new Error('δεν κατέβηκε') }), mediaReader: reader([tone(1)]) });
  await assert.rejects(failing.recognize({ media: {}, options: LOCAL_OPTIONS }), e => e.code === ERROR_CODES.MODEL_LOAD_FAILED);
  const offline = new LocalWhisperEngine({ ...base, createWorker: () => new HandlerWorker({ loadError: new AppError(ERROR_CODES.NETWORK, 'offline') }), mediaReader: reader([tone(1)]) });
  await assert.rejects(offline.recognize({ media: {}, options: LOCAL_OPTIONS }), e => e.code === ERROR_CODES.NETWORK, 'γνωστός κωδικός περνά όπως είναι');

  const controller = new AbortController();
  const slow = {
    ...reader([]),
    async *readMono16k() { yield tone(30); controller.abort(); yield tone(30); },
  };
  let worker;
  const cancelled = new LocalWhisperEngine({ ...base, createWorker: () => (worker = new HandlerWorker()), mediaReader: slow });
  await assert.rejects(cancelled.recognize({ media: {}, options: LOCAL_OPTIONS, signal: controller.signal }), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(worker.terminated, true);
});

test('λογική του worker: σειρά, άγνωστο αίτημα, μεταγραφή πριν τη φόρτωση, σφάλμα μεταγραφής, μεταφορά αποτυπωμάτων', async () => {
  const replies = [];
  let active = 0;
  let maxActive = 0;
  const handler = createWhisperWorkerHandler({
    loadModels: async () => ({
      recognizer: {
        async transcribe(samples, { startSec }) {
          active += 1; maxActive = Math.max(maxActive, active);
          await new Promise(resolve => setTimeout(resolve, 5));
          active -= 1;
          if (startSec < 0) throw new Error('σπασμένο παράθυρο');
          return [{ start: startSec, end: startSec + 2, text: 'α' }];
        },
      },
      embedder: { embed: async samples => Float32Array.from([samples.length]) },
      device: 'wasm',
    }),
    post: (message, transfer) => replies.push({ ...message, transfer }),
  });
  const window = (requestId, startSec) => ({ requestId, type: WORKER_REQUESTS.TRANSCRIBE_WINDOW, payload: { startSec, samples: tone(3), whisperLanguage: 'greek', embedSpeakers: true } });

  await handler.onMessage(window(1, 0));
  assert.deepEqual(replies.at(-1).payload, { code: ERROR_CODES.MODEL_LOAD_FAILED, message: 'δεν έχει φορτωθεί μοντέλο' });
  await handler.onMessage({ requestId: 2, type: 'κάτι άλλο', payload: {} });
  assert.equal(replies.at(-1).type, WORKER_REPLIES.ERROR);
  assert.equal(replies.at(-1).payload.code, ERROR_CODES.UNKNOWN);

  await handler.onMessage({ requestId: 3, type: WORKER_REQUESTS.LOAD_MODELS, payload: { speech: { device: 'wasm' }, speaker: {}, wasmThreads: 1 } });
  assert.deepEqual(replies.at(-1), { requestId: 3, type: WORKER_REPLIES.RESULT, payload: { device: 'wasm' }, transfer: [] });

  await Promise.all([handler.onMessage(window(4, 10)), handler.onMessage(window(5, 20)), handler.onMessage(window(6, -1))]);
  assert.equal(maxActive, 1, 'το μοντέλο δεν τρέχει ποτέ δύο φορές παράλληλα');
  const [four, five, six] = replies.slice(-3);
  assert.deepEqual([four.requestId, five.requestId, six.requestId], [4, 5, 6], 'οι απαντήσεις με τη σειρά των αιτημάτων');
  assert.equal(four.type, WORKER_REPLIES.RESULT);
  assert.equal(four.payload.segments[0].embedding[0], 2 * PCM_SAMPLE_RATE, 'αποτύπωμα από τα δείγματα του τμήματος');
  assert.deepEqual(four.transfer, [four.payload.segments[0].embedding.buffer], 'τα αποτυπώματα μεταφέρονται');
  assert.deepEqual([six.type, six.payload.code], [WORKER_REPLIES.ERROR, ERROR_CODES.TRANSCRIPTION_FAILED]);
});

test('κομμάτι ήχου ενός τμήματος μέσα στο παράθυρο', () => {
  const samples = Float32Array.from({ length: 10 * PCM_SAMPLE_RATE }, (_, i) => i);
  const part = segmentSamples(samples, 100, { start: 102, end: 103.5 });
  assert.equal(part.length, 1.5 * PCM_SAMPLE_RATE);
  assert.equal(part[0], 2 * PCM_SAMPLE_RATE);
  assert.equal(segmentSamples(samples, 100, { start: 95, end: 99 }).length, 0, 'έξω από το παράθυρο');
  assert.equal(segmentSamples(samples, 100, { start: 109, end: 120 }).length, PCM_SAMPLE_RATE, 'κόβεται στο τέλος του παραθύρου');
});

test('WorkerClient: απαντήσεις ανά αίτημα, ειδοποιήσεις, σφάλματα και τερματισμός', async () => {
  const worker = { posted: [], postMessage(m) { this.posted.push(m); }, terminate() { this.terminated = true; } };
  const client = new WorkerClient(worker);
  const events = [];
  const first = client.request(WORKER_REQUESTS.LOAD_MODELS, 1, { onEvent: e => events.push(e) });
  const second = client.request(WORKER_REQUESTS.TRANSCRIBE_WINDOW, 2);
  worker.onmessage({ data: { requestId: 2, type: WORKER_REPLIES.RESULT, payload: 'Β' } });
  worker.onmessage({ data: { requestId: 1, type: WORKER_REPLIES.EVENT, payload: { event: WORKER_EVENTS.MODEL_PROGRESS, loadedBytes: 1, totalBytes: 2 } } });
  worker.onmessage({ data: { requestId: 1, type: WORKER_REPLIES.ERROR, payload: { code: 'NETWORK', message: 'x' } } });
  worker.onmessage({ data: { requestId: 99, type: WORKER_REPLIES.RESULT, payload: 'ορφανό' } });
  assert.equal(await second, 'Β');
  await assert.rejects(first, e => e.code === ERROR_CODES.NETWORK);
  assert.deepEqual(events, [{ event: WORKER_EVENTS.MODEL_PROGRESS, loadedBytes: 1, totalBytes: 2 }]);
  assert.deepEqual(worker.posted[0], { requestId: 1, type: WORKER_REQUESTS.LOAD_MODELS, payload: 1 });
  const third = client.request(WORKER_REQUESTS.TRANSCRIBE_WINDOW, 3);
  client.terminate();
  await assert.rejects(third, e => e.code === ERROR_CODES.CANCELLED);
  await assert.rejects(client.request(WORKER_REQUESTS.TRANSCRIBE_WINDOW, 4), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(worker.terminated, true);
});

test('WorkerClient: όταν ο worker καταρρεύσει, κάθε αίτημα παίρνει τον κωδικό της φάσης του', async () => {
  const worker = { postMessage() {}, terminate() {} };
  const client = new WorkerClient(worker);
  const loading = client.request(WORKER_REQUESTS.LOAD_MODELS, {});
  const transcribing = client.request(WORKER_REQUESTS.TRANSCRIBE_WINDOW, {});
  let prevented = false;
  worker.onerror({ message: 'out of memory', preventDefault: () => { prevented = true; } });
  await assert.rejects(loading, e => e.code === ERROR_CODES.MODEL_LOAD_FAILED);
  await assert.rejects(transcribing, e => e.code === ERROR_CODES.TRANSCRIPTION_FAILED && e.message === 'out of memory');
  assert.equal(prevented, true);
});

test('Transformers.js: ρυθμίσεις, συνολική πρόοδος λήψης και αποτέλεσμα του pipeline', async () => {
  const transformers = { env: { backends: { onnx: { wasm: {} } } } };
  configureTransformers(transformers, { wasmThreads: 3 });
  assert.equal(transformers.env.allowLocalModels, false);
  assert.equal(transformers.env.useBrowserCache, true);
  assert.equal(transformers.env.backends.onnx.wasm.numThreads, 3);

  const totals = [];
  const progress = createDownloadProgress((l, t) => totals.push([l, t]));
  progress({ status: 'progress', file: 'a.onnx', loaded: 10, total: 100 });
  progress({ status: 'progress', file: 'b.onnx', loaded: 5, total: 50 });
  progress({ status: 'done', file: 'a.onnx' });
  assert.deepEqual(totals, [[10, 100], [15, 150]]);

  const calls = [];
  const pipe = async (samples, opts) => { calls.push(opts); return { text: ' α β', chunks: [{ timestamp: [0.5, 2], text: ' α ' }, { timestamp: [2.1, null], text: 'β' }, { timestamp: [3, 4], text: '  ' }] }; };
  const recognizer = new WhisperRecognizer(pipe);
  const segments = await recognizer.transcribe(new Float32Array(PCM_SAMPLE_RATE * 5), { startSec: 100, whisperLanguage: 'greek' });
  assert.deepEqual(segments, [{ start: 100.5, end: 102, text: 'α' }, { start: 102.1, end: 105, text: 'β' }]);
  assert.deepEqual(calls[0], { task: 'transcribe', return_timestamps: true, language: 'greek' });
  await recognizer.transcribe(new Float32Array(PCM_SAMPLE_RATE), { startSec: 0, whisperLanguage: null });
  assert.equal('language' in calls[1], false, 'αυτόματη ανίχνευση γλώσσας');
});

test('αποτύπωμα φωνής: μικρά τμήματα null, μεγάλα από το μέσο', async () => {
  const seen = [];
  const embedder = new SpeakerEmbedder(async samples => { seen.push(samples.length); return { input: samples }; }, async () => ({ embeddings: { data: [0.1, 0.2] } }));
  assert.equal(await embedder.embed(new Float32Array(8000)), null);
  assert.deepEqual(Array.from(await embedder.embed(new Float32Array(PCM_SAMPLE_RATE * 20))), [0.10000000149011612, 0.20000000298023224]);
  assert.deepEqual(seen, [160000]);
});
