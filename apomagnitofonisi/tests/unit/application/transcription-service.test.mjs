import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptionService } from '../../../src/application/transcription-service.js';
import { AppError, ERROR_CODES } from '../../../src/application/errors.js';
import { MemoryRepository, fixedClock, sequentialIds, FakeEngine, fakeMedia } from '../helpers/fakes.mjs';

const ANO = String.fromCharCode(0x387);
const options = { languageCode: 'el', diarize: true, expectedSpeakers: null };
const textOptions = { removeAnoTeleia: true };

function service(engine, repository = new MemoryRepository()) {
  const storage = { requested: 0, async requestPersistence() { this.requested += 1; return true; }, async estimate() { return {}; } };
  return {
    repository, storage,
    service: new TranscriptionService({ engines: [engine], repository, clock: fixedClock(), idGenerator: sequentialIds('t'), speakerLabel: n => `Ομιλητής ${n}`, storage }),
  };
}

test('μεταγραφή: καθαρό κείμενο, ομιλητές με σειρά εμφάνισης, αποθήκευση', async () => {
  const engine = new FakeEngine('elevenlabs', {
    segments: [
      { start: 3, end: 4, speakerKey: 'speaker_0', text: 'Συμφωνώ.', words: [{ text: 'Συμφωνώ.', start: 3, end: 4 }] },
      { start: 0, end: 2.5, speakerKey: 'speaker_1', text: ` Καλημέρα${ANO} ξεκινάμε `, words: [{ text: `Καλημέρα${ANO}`, start: 0, end: 1 }, { text: 'ξεκινάμε', start: 1.2, end: 2.5 }] },
      { start: 5, end: 6, speakerKey: 'speaker_0', text: '   ' },
    ],
    languageCode: 'el', durationSec: 6, model: 'scribe_v2',
  });
  const { service: s, repository, storage } = service(engine);
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
  assert.equal(storage.requested, 1);
  assert.equal(engine.requests[0].options, options);
});

test('χωρίς ομιλητές και με «αυτόματη» γλώσσα: languageCode null όταν δεν το δίνει η μηχανή', async () => {
  const engine = new FakeEngine('local', { segments: [{ start: 0, end: 1, speakerKey: null, text: 'ναι ναι ναι ναι ναι' }], languageCode: null, durationSec: null, model: 'whisper' });
  const { service: s } = service(engine);
  const t = await s.transcribe({ media: fakeMedia(), engineKind: 'local', options: { ...options, languageCode: 'auto' }, textOptions: { removeAnoTeleia: false } });
  assert.equal(t.languageCode, null);
  assert.deepEqual(t.speakers, []);
  assert.equal(t.segments[0].speakerId, null);
  assert.equal(t.segments[0].text, 'ναι');
});

test('άκυρα αιτήματα', async () => {
  const { service: s } = service(new FakeEngine('local', { segments: [], model: 'm' }));
  const reject = (job, code) => assert.rejects(s.transcribe({ media: fakeMedia(), engineKind: 'local', options, textOptions, ...job }), e => e instanceof AppError && e.code === code);
  await reject({ media: fakeMedia({ size: 0 }) }, ERROR_CODES.INVALID_INPUT);
  await reject({ options: { ...options, languageCode: 'xx' } }, ERROR_CODES.INVALID_INPUT);
  await reject({ options: { ...options, expectedSpeakers: 40 } }, ERROR_CODES.INVALID_INPUT);
  await reject({ engineKind: 'whatever' }, ERROR_CODES.INVALID_INPUT);
  await reject({ textOptions: undefined }, ERROR_CODES.INVALID_INPUT);
});

test('μη διαθέσιμη μηχανή, σφάλματα μηχανής και ακύρωση', async () => {
  const missing = service(new FakeEngine('elevenlabs', { segments: [] }, { available: false, reason: ERROR_CODES.KEY_MISSING })).service;
  await assert.rejects(missing.transcribe({ media: fakeMedia(), engineKind: 'elevenlabs', options, textOptions }), e => e.code === ERROR_CODES.KEY_MISSING);

  const failing = service(new FakeEngine('elevenlabs', new Error('boom'))).service;
  await assert.rejects(failing.transcribe({ media: fakeMedia(), engineKind: 'elevenlabs', options, textOptions }), e => e instanceof AppError && e.code === ERROR_CODES.UNKNOWN);

  const controller = new AbortController();
  const engine = new FakeEngine('local', { segments: [{ start: 0, end: 1, speakerKey: null, text: 'α' }], model: 'm' });
  engine.recognize = async () => { controller.abort(); return { segments: [], model: 'm' }; };
  const { service: s, repository } = service(engine);
  await assert.rejects(s.transcribe({ media: fakeMedia(), engineKind: 'local', options, textOptions, signal: controller.signal }), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(repository.saves, 0, 'τίποτα δεν αποθηκεύεται μετά από ακύρωση');
});

test('διαθεσιμότητα και λίστα μηχανών', async () => {
  const { service: s } = service(new FakeEngine('local', { segments: [] }));
  assert.deepEqual(s.engineKinds, ['local']);
  assert.deepEqual(await s.checkAvailability('local'), { available: true });
});
