import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWhisperEngine } from '../../../src/infrastructure/transcription/local-whisper-engine.js';
import { selectLocalModel, resolvePresetId, describeLocalPresets } from '../../../src/infrastructure/transcription/local-model-selection.js';
import { WorkerClient } from '../../../src/infrastructure/transcription/worker-client.js';
import { WORKER_REQUESTS, WORKER_REPLIES, WORKER_EVENTS } from '../../../src/infrastructure/transcription/worker-protocol.js';
import { configureTransformers, createDownloadProgress, WhisperRecognizer } from '../../../src/infrastructure/transcription/whisper-recognizer.js';
import { SpeakerEmbedder } from '../../../src/infrastructure/diarization/speaker-embedder.js';
import { ERROR_CODES } from '../../../src/application/errors.js';

const WASM_ONLY = { webgpu: false, shaderF16: false, webAssembly: true, workers: true, crossOriginIsolated: true, hardwareConcurrency: 8 };
const WEBGPU_F16 = { ...WASM_ONLY, webgpu: true, shaderF16: true };

test('επιλογή μοντέλου ανά συσκευή', () => {
  assert.equal(resolvePresetId('auto', WASM_ONLY), 'fast');
  assert.equal(resolvePresetId('auto', WEBGPU_F16), 'balanced');
  assert.deepEqual(selectLocalModel('fast', WASM_ONLY), { presetId: 'fast', repo: 'onnx-community/whisper-base', device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, approxDownloadMb: 77 });
  assert.equal(selectLocalModel('balanced', WEBGPU_F16).device, 'webgpu');
  assert.equal(selectLocalModel('accurate', WASM_ONLY), null, 'το ακριβές θέλει WebGPU');
  assert.deepEqual(selectLocalModel('accurate', WEBGPU_F16).dtype, { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' });
  assert.deepEqual(selectLocalModel('accurate', { ...WEBGPU_F16, shaderF16: false }).dtype, { encoder_model: 'q4', decoder_model_merged: 'q4' });
  assert.equal(selectLocalModel('unknown', WASM_ONLY), null);
  assert.deepEqual(describeLocalPresets(WASM_ONLY).map(p => [p.presetId, p.choice && p.choice.approxDownloadMb]), [['fast', 77], ['balanced', 250], ['accurate', null]]);
});

/** Ψεύτικος worker που απαντά όπως ο whisper-worker.js. */
class FakeWorker {
  constructor({ embeddingFor = () => null, segmentsFor } = {}) {
    this.posted = [];
    this.terminated = false;
    this.embeddingFor = embeddingFor;
    this.segmentsFor = segmentsFor || (({ startSec, samples }) => [{ start: startSec + 0.5, end: startSec + samples.length / 16000 - 0.5, text: `παράθυρο ${Math.round(startSec)}` }]);
  }
  postMessage(message, transfer) {
    this.posted.push({ message, transfer });
    queueMicrotask(() => {
      if (this.terminated) return;
      const { requestId, type, payload } = message;
      const send = (kind, body) => this.onmessage({ data: { requestId, kind, payload: body } });
      if (type === WORKER_REQUESTS.LOAD_MODELS) {
        send(WORKER_REPLIES.EVENT, { type: WORKER_EVENTS.MODEL_PROGRESS, loadedBytes: 50, totalBytes: 100 });
        send(WORKER_REPLIES.RESULT, { device: payload.speech.device });
      } else {
        const segments = this.segmentsFor(payload).map(s => ({ ...s, embedding: this.embeddingFor(s) }));
        send(WORKER_REPLIES.RESULT, { segments });
      }
    });
  }
  terminate() { this.terminated = true; }
}

function tone(seconds) {
  const out = new Float32Array(Math.round(seconds * 16000));
  for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin(i / 10);
  return out;
}

function reader(chunks, { durationSec = 60, hasAudio = true } = {}) {
  return {
    async probe() { return { durationSec, hasAudio, hasVideo: false, audioCodec: 'aac' }; },
    async *readMono16k() { for (const c of chunks) yield c; },
    async extractCompactAudio(m) { return m; },
  };
}

test('ροή: παράθυρα στον worker με τη σειρά, πρόοδος, παραισθήσεις έξω, χωρίς ομιλητές', async () => {
  const workers = [];
  const engine = new LocalWhisperEngine({
    createWorker: () => {
      const w = new FakeWorker({ segmentsFor: ({ startSec, samples }) => [
        { start: startSec + 0.2, end: startSec + 3, text: `κείμενο ${Math.round(startSec)}` },
        { start: startSec + 4, end: startSec + samples.length / 16000, text: 'Υπότιτλοι AUTHORWAVE' },
      ] });
      workers.push(w);
      return w;
    },
    mediaReader: reader([tone(20), tone(20), tone(20)]),
    capabilities: async () => WASM_ONLY,
  });
  const stages = [];
  const partial = [];
  const result = await engine.recognize({
    media: {}, options: { languageCode: 'el', diarize: false, expectedSpeakers: null, qualityPreset: 'fast' },
    onProgress: p => stages.push(p.stage), onPartialSegments: s => partial.push(...s),
  });
  const load = workers[0].posted[0].message;
  assert.equal(load.type, WORKER_REQUESTS.LOAD_MODELS);
  assert.equal(load.payload.speech.repo, 'onnx-community/whisper-base');
  assert.equal(load.payload.speaker, null);
  assert.equal(load.payload.wasmThreads, 4);
  const windows = workers[0].posted.slice(1).map(p => p.message);
  assert.ok(windows.length >= 2);
  assert.ok(windows.every(w => w.payload.language === 'greek'));
  assert.ok(workers[0].posted.slice(1).every(p => p.transfer[0] === p.message.payload.samples.buffer), 'τα δείγματα μεταφέρονται, δεν αντιγράφονται');
  assert.ok(result.segments.every(s => s.text.startsWith('κείμενο')), 'οι γνωστές παραισθήσεις πετιούνται');
  assert.ok(result.segments.every(s => s.speakerKey === null));
  assert.equal(partial.length, result.segments.length);
  assert.ok(stages.includes('downloading-model') && stages.includes('transcribing'));
  assert.equal(result.model, 'onnx-community/whisper-base');
  assert.equal(workers[0].terminated, true, 'ο worker τερματίζεται στο τέλος');
});

test('διαχωρισμός ομιλητών από αποτυπώματα, και μικρά τμήματα με τον κοντινότερο', async () => {
  const voiceA = [1, 0, 0, 0];
  const voiceB = [0, 1, 0, 0];
  const engine = new LocalWhisperEngine({
    createWorker: () => new FakeWorker({
      segmentsFor: ({ startSec }) => [
        { start: startSec, end: startSec + 4, text: 'α' },
        { start: startSec + 4.1, end: startSec + 4.5, text: 'β' },
        { start: startSec + 6, end: startSec + 12, text: 'γ' },
      ],
      embeddingFor: s => (s.end - s.start < 1 ? null : Float32Array.from(s.text === 'α' ? voiceA : voiceB)),
    }),
    mediaReader: reader([tone(15)], { durationSec: 15 }),
    capabilities: async () => WASM_ONLY,
  });
  const result = await engine.recognize({ media: {}, options: { languageCode: 'auto', diarize: true, expectedSpeakers: null, qualityPreset: 'auto' } });
  assert.deepEqual(result.segments.map(s => [s.text, s.speakerKey]), [['α', 'local-0'], ['β', 'local-0'], ['γ', 'local-1']]);
  assert.equal(result.languageCode, null);
});

test('χωρίς ήχο, χωρίς WebGPU για το «ακριβές», σφάλμα worker και ακύρωση', async () => {
  const base = { createWorker: () => new FakeWorker(), capabilities: async () => WASM_ONLY };
  const options = { languageCode: 'el', diarize: false, expectedSpeakers: null, qualityPreset: 'fast' };
  await assert.rejects(new LocalWhisperEngine({ ...base, mediaReader: reader([], { hasAudio: false }) }).recognize({ media: {}, options }), e => e.code === ERROR_CODES.NO_AUDIO_TRACK);
  const accurate = new LocalWhisperEngine({ ...base, mediaReader: reader([]) });
  assert.deepEqual(await accurate.checkAvailability({ qualityPreset: 'accurate' }), { available: false, reason: ERROR_CODES.DEVICE_UNSUPPORTED });
  assert.deepEqual(await accurate.checkAvailability({ qualityPreset: 'fast' }), { available: true });

  class FailingWorker extends FakeWorker {
    postMessage(message) {
      queueMicrotask(() => this.onmessage({ data: { requestId: message.requestId, kind: WORKER_REPLIES.ERROR, payload: { code: 'MODEL_LOAD_FAILED', message: 'δεν κατέβηκε' } } }));
    }
  }
  await assert.rejects(new LocalWhisperEngine({ ...base, createWorker: () => new FailingWorker(), mediaReader: reader([tone(1)]) }).recognize({ media: {}, options }), e => e.code === ERROR_CODES.MODEL_LOAD_FAILED);

  const controller = new AbortController();
  const slow = {
    ...reader([]),
    async *readMono16k() { yield tone(30); controller.abort(); yield tone(30); },
  };
  let worker;
  const engine = new LocalWhisperEngine({ ...base, createWorker: () => (worker = new FakeWorker()), mediaReader: slow });
  await assert.rejects(engine.recognize({ media: {}, options, signal: controller.signal }), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(worker.terminated, true);
});

test('WorkerClient: απαντήσεις ανά αίτημα, ειδοποιήσεις, σφάλματα και τερματισμός', async () => {
  const worker = { posted: [], postMessage(m) { this.posted.push(m); }, terminate() { this.terminated = true; } };
  const client = new WorkerClient(worker);
  const events = [];
  const first = client.request('a', 1, { onEvent: e => events.push(e) });
  const second = client.request('b', 2);
  worker.onmessage({ data: { requestId: 2, kind: 'result', payload: 'Β' } });
  worker.onmessage({ data: { requestId: 1, kind: 'event', payload: 'πρόοδος' } });
  worker.onmessage({ data: { requestId: 1, kind: 'error', payload: { code: 'NETWORK', message: 'x' } } });
  assert.equal(await second, 'Β');
  await assert.rejects(first, e => e.code === ERROR_CODES.NETWORK);
  assert.deepEqual(events, ['πρόοδος']);
  const third = client.request('c', 3);
  client.terminate();
  await assert.rejects(third, e => e.code === ERROR_CODES.CANCELLED);
  await assert.rejects(client.request('d', 4), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(worker.terminated, true);
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
  const segments = await recognizer.transcribe(new Float32Array(16000 * 5), { startSec: 100, language: 'greek' });
  assert.deepEqual(segments, [{ start: 100.5, end: 102, text: 'α' }, { start: 102.1, end: 105, text: 'β' }]);
  assert.deepEqual(calls[0], { task: 'transcribe', return_timestamps: true, language: 'greek' });
  await recognizer.transcribe(new Float32Array(16000), { startSec: 0, language: null });
  assert.equal('language' in calls[1], false, 'αυτόματη ανίχνευση γλώσσας');
});

test('αποτύπωμα φωνής: μικρά τμήματα null, μεγάλα από το μέσο', async () => {
  const seen = [];
  const embedder = new SpeakerEmbedder(async samples => { seen.push(samples.length); return { input: samples }; }, async () => ({ embeddings: { data: [0.1, 0.2] } }));
  assert.equal(await embedder.embed(new Float32Array(8000)), null);
  assert.deepEqual(Array.from(await embedder.embed(new Float32Array(16000 * 20))), [0.10000000149011612, 0.20000000298023224]);
  assert.deepEqual(seen, [160000]);
});
