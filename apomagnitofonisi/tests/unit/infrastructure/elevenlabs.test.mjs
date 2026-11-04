import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenLabsEngine } from '../../../src/infrastructure/elevenlabs/elevenlabs-engine.js';
import { readScribeResponse, appErrorFromElevenLabsResponse } from '../../../src/infrastructure/elevenlabs/elevenlabs-response.js';
import { XhrUploader } from '../../../src/infrastructure/http/xhr-uploader.js';
import { ElevenLabsKeyVerifier } from '../../../src/infrastructure/elevenlabs/elevenlabs-key-verifier.js';
import { AppError, ERROR_CODES } from '../../../src/application/errors.js';
import { KEY_PROVIDERS } from '../../../src/application/key-providers.js';
import { ENGINE_KINDS } from '../../../src/domain/transcript.js';

const scribeBody = {
  language_code: 'ell',
  audio_duration_secs: 8.5,
  words: [
    { text: 'Καλημέρα', type: 'word', start: 0.1, end: 0.6, speaker_id: 'speaker_0' },
    { text: ' ', type: 'spacing', start: 0.6, end: 0.7, speaker_id: 'speaker_0' },
    { text: 'σας.', type: 'word', start: 0.7, end: 1.0, speaker_id: 'speaker_0' },
    { text: '(laughter)', type: 'audio_event', start: 1.1, end: 1.8, speaker_id: 'speaker_0' },
    { text: 'Καλημέρα.', type: 'word', start: 2.0, end: 2.6, speaker_id: 'speaker_1' },
  ],
};

class FakeUploader {
  constructor(response) { this.response = response; this.calls = []; }
  async post(url, request) {
    this.calls.push({ url, request });
    request.onUploadProgress?.(50, 100);
    request.onUploadComplete?.();
    return this.response;
  }
}

const options = { languageCode: 'el', diarize: true, expectedSpeakers: 2 };
/** Τα ονόματα των ηχητικών συμβάντων τα δίνει η διεπαφή (εδώ ένα μικρό δείγμα). */
const audioEventLabels = { byEvent: { laughter: 'γέλια' }, unknown: 'ήχος' };

function media({ type = 'audio/mpeg', size = 1000, name = 'Σύσκεψη.mp3' } = {}) {
  return new File([new Uint8Array(size)], name, { type });
}

test('απάντηση Scribe → tokens: χωρίς κενά, συμβάντα με τα ονόματα της διεπαφής, γλώσσα ISO 639-1', () => {
  const { tokens, languageCode, durationSec } = readScribeResponse(scribeBody, { audioEventLabels });
  assert.deepEqual(tokens.map(t => [t.text, t.kind, t.speakerKey]), [
    ['Καλημέρα', 'word', 'speaker_0'], ['σας.', 'word', 'speaker_0'], ['[γέλια]', 'event', 'speaker_0'], ['Καλημέρα.', 'word', 'speaker_1'],
  ]);
  assert.equal(languageCode, 'el');
  assert.equal(durationSec, 8.5);
  assert.deepEqual(readScribeResponse({}).tokens, []);
  assert.equal(readScribeResponse(scribeBody).tokens[2].text, '[laughter]', 'χωρίς ετικέτες μένει το όνομα του ElevenLabs');
  const unnamed = readScribeResponse({ words: [{ text: '()', type: 'audio_event', start: 0, end: 1 }] }, { audioEventLabels });
  assert.equal(unnamed.tokens[0].text, '[ήχος]');
});

test('σφάλματα HTTP → κωδικοί', () => {
  const body = (status, message) => JSON.stringify({ detail: { status, message } });
  assert.equal(appErrorFromElevenLabsResponse(401, body('invalid_api_key', 'Invalid API key')).code, ERROR_CODES.KEY_INVALID);
  assert.equal(appErrorFromElevenLabsResponse(401, body('quota_exceeded', 'no credits')).code, ERROR_CODES.QUOTA_EXCEEDED);
  assert.equal(appErrorFromElevenLabsResponse(402, '').code, ERROR_CODES.QUOTA_EXCEEDED);
  assert.equal(appErrorFromElevenLabsResponse(403, '').code, ERROR_CODES.KEY_INVALID);
  assert.equal(appErrorFromElevenLabsResponse(413, '').code, ERROR_CODES.FILE_TOO_LARGE);
  assert.equal(appErrorFromElevenLabsResponse(429, body('too_many_concurrent_requests', 'x')).code, ERROR_CODES.RATE_LIMITED);
  const invalid = appErrorFromElevenLabsResponse(422, JSON.stringify({ detail: [{ msg: 'file is required' }] }));
  assert.equal(invalid.code, ERROR_CODES.PROVIDER_REJECTED, 'το απέρριψε ο πάροχος, όχι η φόρμα της εφαρμογής');
  assert.equal(invalid.details.providerMessage, 'file is required');
  assert.equal(appErrorFromElevenLabsResponse(400, body('invalid_language', 'bad language')).code, ERROR_CODES.PROVIDER_REJECTED);
  assert.equal(appErrorFromElevenLabsResponse(503, 'oops').code, ERROR_CODES.OVERLOADED);
  assert.equal(appErrorFromElevenLabsResponse(500, '').code, ERROR_CODES.UNKNOWN);
});

test('μεταγραφή: πεδία του αιτήματος, πρόοδος και τμήματα ανά ομιλητή', async () => {
  const uploader = new FakeUploader({ status: 200, bodyText: JSON.stringify(scribeBody) });
  const engine = new ElevenLabsEngine({ getApiKey: () => 'xi-key', uploader, audioEventLabels, mediaReader: { async extractCompactAudio() { throw new Error('δεν έπρεπε να κληθεί'); } } });
  assert.equal(engine.kind, ENGINE_KINDS.ELEVENLABS);
  const stages = [];
  const result = await engine.recognize({ media: media(), options, onProgress: p => stages.push([p.stage, p.fraction]) });
  const { url, request } = uploader.calls[0];
  assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.deepEqual(request.headers, { 'xi-api-key': 'xi-key' });
  const fields = Object.fromEntries([...request.body.entries()].filter(([k]) => k !== 'file'));
  assert.deepEqual(fields, { model_id: 'scribe_v2', language_code: 'el', diarize: 'true', num_speakers: '2', timestamps_granularity: 'word', tag_audio_events: 'true' });
  assert.equal(request.body.get('file').name, 'Σύσκεψη.mp3');
  assert.deepEqual(stages, [['uploading', 0], ['uploading', 0.5], ['transcribing', undefined]]);
  assert.deepEqual(result.segments.map(s => [s.speakerKey, s.text]), [['speaker_0', 'Καλημέρα σας. [γέλια]'], ['speaker_1', 'Καλημέρα.']]);
  assert.equal(result.languageCode, 'el');
  assert.equal(result.modelId, 'scribe_v2');
});

test('αυτόματη γλώσσα και χωρίς ομιλητές: χωρίς language_code/num_speakers, χωρίς κλειδιά ομιλητή', async () => {
  const uploader = new FakeUploader({ status: 200, bodyText: JSON.stringify(scribeBody) });
  const engine = new ElevenLabsEngine({ getApiKey: () => 'k', uploader, mediaReader: {} });
  const result = await engine.recognize({ media: media(), options: { languageCode: 'auto', diarize: false, expectedSpeakers: 3 } });
  const body = uploader.calls[0].request.body;
  assert.equal(body.has('language_code'), false);
  assert.equal(body.has('num_speakers'), false);
  assert.equal(body.get('diarize'), 'false');
  assert.ok(result.segments.every(s => s.speakerKey === null));
});

test('βίντεο: στέλνεται μόνο ο ήχος, με το σωστό όνομα και πρόοδο ανάγνωσης', async () => {
  const uploader = new FakeUploader({ status: 200, bodyText: JSON.stringify(scribeBody) });
  const compact = new Blob([new Uint8Array(10)], { type: 'audio/ogg' });
  let extracted = 0;
  const engine = new ElevenLabsEngine({ getApiKey: () => 'k', uploader, mediaReader: { async extractCompactAudio(m, { onFraction }) { extracted += 1; onFraction(0.5); return { audio: compact, compacted: true }; } } });
  const reading = [];
  await engine.recognize({ media: media({ type: 'video/mp4', name: 'Βίντεο.mp4' }), options, onProgress: p => { if (p.stage === 'reading') reading.push(p.fraction); } });
  assert.equal(extracted, 1);
  assert.deepEqual(reading, [0, 0.5]);
  assert.equal(uploader.calls[0].request.body.get('file').name, 'Βίντεο.ogg');
  assert.equal(uploader.calls[0].request.body.get('file').size, 10);
});

test('βίντεο: χωρίς συμπίεση ή όταν αποτύχει στέλνεται το αρχικό, η ακύρωση όμως σταματά', async () => {
  const send = async extractCompactAudio => {
    const uploader = new FakeUploader({ status: 200, bodyText: JSON.stringify(scribeBody) });
    const engine = new ElevenLabsEngine({ getApiKey: () => 'k', uploader, mediaReader: { extractCompactAudio } });
    await engine.recognize({ media: media({ type: 'video/mp4', name: 'Βίντεο.mp4', size: 20 }), options });
    return uploader.calls[0].request.body.get('file');
  };
  const notCompacted = await send(async m => ({ audio: m, compacted: false }));
  assert.deepEqual([notCompacted.name, notCompacted.size], ['Βίντεο.mp4', 20]);
  const failed = await send(async () => { throw new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'χωρίς κωδικοποιητή'); });
  assert.deepEqual([failed.name, failed.size], ['Βίντεο.mp4', 20], 'η εφεδρεία αποφασίζεται μόνο στη μηχανή');
  await assert.rejects(send(async () => { throw new AppError(ERROR_CODES.CANCELLED, 'stop'); }), e => e.code === ERROR_CODES.CANCELLED);
});

test('χωρίς κλειδί, σφάλμα του παρόχου και άκυρη απάντηση', async () => {
  const noKey = new ElevenLabsEngine({ getApiKey: () => null, uploader: new FakeUploader(), mediaReader: {} });
  assert.deepEqual(await noKey.checkAvailability(), { available: false, reason: ERROR_CODES.KEY_MISSING });
  await assert.rejects(noKey.recognize({ media: media(), options }), e => e.code === ERROR_CODES.KEY_MISSING);
  const denied = new ElevenLabsEngine({ getApiKey: () => 'k', uploader: new FakeUploader({ status: 401, bodyText: '{"detail":{"status":"invalid_api_key"}}' }), mediaReader: {} });
  await assert.rejects(denied.recognize({ media: media(), options }), e => e.code === ERROR_CODES.KEY_INVALID);
  const garbage = new ElevenLabsEngine({ getApiKey: () => 'k', uploader: new FakeUploader({ status: 200, bodyText: '<html>' }), mediaReader: {} });
  await assert.rejects(garbage.recognize({ media: media(), options }), e => e.code === ERROR_CODES.UNKNOWN);
});

class FakeXhr {
  static last;
  constructor() { FakeXhr.last = this; this.headers = {}; this.upload = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(n, v) { this.headers[n] = v; }
  send(body) { this.body = body; }
  abort() { this.onabort(); }
}

test('XhrUploader: πρόοδος, απάντηση, σφάλμα δικτύου και ακύρωση', async () => {
  const uploader = new XhrUploader({ createXhr: () => new FakeXhr() });
  const progress = [];
  const pending = uploader.post('https://api.example/x', { headers: { a: 'b' }, body: 'data', onUploadProgress: (l, t) => progress.push(l / t) });
  const xhr = FakeXhr.last;
  xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 4 });
  xhr.status = 200; xhr.responseText = 'ok';
  xhr.onload();
  assert.deepEqual(await pending, { status: 200, bodyText: 'ok' });
  assert.deepEqual(progress, [0.25]);
  assert.equal(xhr.headers.a, 'b');

  const failing = uploader.post('https://api.example/x', { body: 'd' });
  FakeXhr.last.onerror();
  await assert.rejects(failing, e => e.code === ERROR_CODES.NETWORK);

  const controller = new AbortController();
  const cancelled = uploader.post('https://api.example/x', { body: 'd', signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, e => e.code === ERROR_CODES.CANCELLED);
  await assert.rejects(uploader.post('u', { body: 'd', signal: controller.signal }), e => e.code === ERROR_CODES.CANCELLED);
});

test('έλεγχος κλειδιού: έγκυρο, περιορισμένο, άκυρο, χωρίς δίκτυο', async () => {
  const response = (status, body = '') => ({ ok: status === 200, status, text: async () => body });
  const calls = [];
  const verifier = status => new ElevenLabsKeyVerifier({ fetch: async (url, init) => { calls.push([url, init.headers]); return status; } });
  assert.equal(verifier(response(200)).provider, KEY_PROVIDERS.ELEVENLABS);
  await verifier(response(200)).verify('k1');
  assert.deepEqual(calls[0], ['https://api.elevenlabs.io/v1/user', { 'xi-api-key': 'k1' }]);
  await verifier(response(401, '{"detail":{"status":"missing_permissions","message":"missing user_read"}}')).verify('k');
  await assert.rejects(verifier(response(401, '{"detail":{"status":"invalid_api_key"}}')).verify('k'), e => e.code === ERROR_CODES.KEY_INVALID);
  const offline = new ElevenLabsKeyVerifier({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.verify('k'), e => e.code === ERROR_CODES.NETWORK);
});
