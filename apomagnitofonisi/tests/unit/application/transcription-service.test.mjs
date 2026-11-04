import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptionService } from '../../../src/application/transcription-service.js';
import { AppError, ERROR_CODES, INPUT_ISSUES } from '../../../src/application/errors.js';
import { MemoryRepository, MemoryDeviceStorage, fixedClock, sequentialIds, FakeEngine, fakeMedia } from '../helpers/fakes.mjs';

const ANO = String.fromCharCode(0x387);
const options = { languageCode: 'el', diarize: true, expectedSpeakers: null };
const textOptions = { removeAnoTeleia: true };

function service(engine, repository = new MemoryRepository()) {
  const deviceStorage = new MemoryDeviceStorage();
  const engines = Array.isArray(engine) ? engine : [engine];
  return {
    repository, deviceStorage,
    service: new TranscriptionService({ engines, repository, clock: fixedClock(), idGenerator: sequentialIds('t'), speakerLabelFor: n => `Ομιλητής ${n}`, deviceStorage }),
  };
}

test('μεταγραφή: καθαρό κείμενο, ομιλητές με σειρά εμφάνισης, αποθήκευση', async () => {
  const engine = new FakeEngine('elevenlabs', {
    segments: [
      { start: 3, end: 4, speakerKey: 'speaker_0', text: 'Συμφωνώ.', words: [{ text: 'Συμφωνώ.', start: 3, end: 4 }] },
      { start: 0, end: 2.5, speakerKey: 'speaker_1', text: ` Καλημέρα${ANO} ξεκινάμε `, words: [{ text: `Καλημέρα${ANO}`, start: 0, end: 1 }, { text: 'ξεκινάμε', start: 1.2, end: 2.5 }] },
      { start: 5, end: 6, speakerKey: 'speaker_0', text: '   ' },
    ],
    languageCode: 'el', durationSec: 6, modelId: 'scribe_v2',
  });
  const { service: s, repository, deviceStorage } = service(engine);
  const progress = [];
  const t = await s.transcribe({ media: fakeMedia(), engineKind: 'elevenlabs', options, textOptions, onProgress: p => progress.push(p.stage) });
  assert.equal(t.id, 't-1');
  assert.equal(t.title, 'Σύσκεψη');
  assert.deepEqual(t.speakers.map(sp => sp.label), ['Ομιλητής 1', 'Ομιλητής 2']);
  assert.deepEqual(t.segments.map(sg => [sg.speakerId, sg.text]), [['S1', 'Καλημέρα, ξεκινάμε'], ['S2', 'Συμφωνώ.']]);
  assert.deepEqual(t.segments[0].words.map(w => w.text), ['Καλημέρα,', 'ξεκινάμε'], 'οι λέξεις ακολουθούν το καθαρό κείμενο');
  assert.equal(t.engine.model, 'scribe_v2');
  assert.equal(t.source.durationSec, 6);
  assert.deepEqual(progress, ['transcribing', 'saving']);
  assert.equal(repository.saves, 1);
  assert.equal(deviceStorage.persistenceRequests, 1, 'ζητείται να μη σβήσει ο browser τα δεδομένα');
  assert.equal(engine.requests[0].options, options);
  assert.equal(engine.availabilityRequests[0], options, 'η διαθεσιμότητα ελέγχεται με τις ίδιες επιλογές');
  assert.deepEqual(await repository.findById('t-1'), t);
});

test('χωρίς ομιλητές και με «αυτόματη» γλώσσα: languageCode null όταν δεν το δίνει η μηχανή', async () => {
  const engine = new FakeEngine('local', { segments: [{ start: 0, end: 1, speakerKey: null, text: 'ναι ναι ναι ναι ναι' }], languageCode: null, durationSec: null, modelId: 'whisper' });
  const { service: s } = service(engine);
  const t = await s.transcribe({ media: fakeMedia(), engineKind: 'local', options: { ...options, languageCode: 'auto' }, textOptions: { removeAnoTeleia: false } });
  assert.equal(t.languageCode, null);
  assert.deepEqual(t.speakers, []);
  assert.equal(t.segments[0].speakerId, null);
  assert.equal(t.segments[0].text, 'ναι');
});

test('άκυρα αιτήματα: το κενό αρχείο το διορθώνει ο χρήστης, τα υπόλοιπα είναι λάθη του κώδικα', async () => {
  const engine = new FakeEngine('local', { segments: [], modelId: 'm' });
  const { service: s, repository } = service(engine);
  const request = job => s.transcribe({ media: fakeMedia(), engineKind: 'local', options, textOptions, ...job });
  await assert.rejects(request({ media: fakeMedia({ size: 0 }) }), e => e instanceof AppError && e.code === ERROR_CODES.INVALID_INPUT && e.details.reason === INPUT_ISSUES.EMPTY_FILE);
  await assert.rejects(request({ media: undefined }), TypeError);
  await assert.rejects(request({ options: { ...options, languageCode: 'xx' } }), RangeError);
  await assert.rejects(request({ options: { ...options, expectedSpeakers: 40 } }), RangeError);
  await assert.rejects(request({ options: { ...options, expectedSpeakers: 1.5 } }), RangeError);
  await assert.rejects(request({ engineKind: 'whatever' }), RangeError);
  await assert.rejects(request({ options: { ...options, localQuality: 'ultra' } }), /άγνωστο επίπεδο ποιότητας ultra/, 'API-028: λάθος του κώδικα, όχι DEVICE_UNSUPPORTED');
  await assert.rejects(request({ textOptions: undefined }), TypeError);
  assert.equal(engine.requests.length, 0, 'κανένα άκυρο αίτημα δεν φτάνει στη μηχανή');
  assert.equal(repository.saves, 0);
});

test('μη διαθέσιμη μηχανή, σφάλματα μηχανής και ακύρωση', async () => {
  const missing = service(new FakeEngine('elevenlabs', { segments: [] }, { available: false, reason: ERROR_CODES.KEY_MISSING })).service;
  await assert.rejects(missing.transcribe({ media: fakeMedia(), engineKind: 'elevenlabs', options, textOptions }), e => e.code === ERROR_CODES.KEY_MISSING);

  const failing = service(new FakeEngine('elevenlabs', new Error('boom'))).service;
  await assert.rejects(failing.transcribe({ media: fakeMedia(), engineKind: 'elevenlabs', options, textOptions }), e => e instanceof AppError && e.code === ERROR_CODES.UNKNOWN);

  const controller = new AbortController();
  const engine = new FakeEngine('local', { segments: [{ start: 0, end: 1, speakerKey: null, text: 'α' }], modelId: 'm' });
  engine.recognize = async () => { controller.abort(); return { segments: [], modelId: 'm' }; };
  const { service: s, repository } = service(engine);
  await assert.rejects(s.transcribe({ media: fakeMedia(), engineKind: 'local', options, textOptions, signal: controller.signal }), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(repository.saves, 0, 'τίποτα δεν αποθηκεύεται μετά από ακύρωση');
});

test('διαθεσιμότητα, λίστα μηχανών και επίπεδα ποιότητας', async () => {
  const presets = { accelerated: false, autoPresetId: 'fast', presets: [{ id: 'fast', available: true, approxDownloadMb: 77 }] };
  const local = new FakeEngine('local', { segments: [] }, { qualityPresets: presets });
  const cloud = new FakeEngine('elevenlabs', { segments: [] }, { available: false, reason: ERROR_CODES.KEY_MISSING });
  const { service: s } = service([local, cloud]);
  assert.deepEqual(s.engineKinds, ['local', 'elevenlabs'], 'με τη σειρά που δόθηκαν');
  assert.deepEqual(await s.checkAvailability('local', { ...options, localQuality: 'fast' }), { available: true });
  assert.equal(local.availabilityRequests[0].localQuality, 'fast');
  assert.deepEqual(await s.checkAvailability('elevenlabs'), { available: false, reason: ERROR_CODES.KEY_MISSING });
  assert.deepEqual(await s.describeQualityPresets('local'), presets);
  assert.equal(await s.describeQualityPresets('elevenlabs'), null, 'μηχανή χωρίς επίπεδα ποιότητας');
  await assert.rejects(s.checkAvailability('whatever'), RangeError);
  await assert.rejects(s.checkAvailability('local', { ...options, localQuality: 'ultra' }), RangeError, 'API-028');
  await assert.rejects(s.describeQualityPresets('whatever'), RangeError);
});
