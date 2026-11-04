import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportService } from '../../../src/application/export-service.js';
import { LibraryService } from '../../../src/application/library-service.js';
import { TranscriptEditor } from '../../../src/application/transcript-editor.js';
import { SettingsService, DEFAULT_SETTINGS } from '../../../src/application/settings-service.js';
import { ApiKeyService } from '../../../src/application/api-key-service.js';
import { AppError, ERROR_CODES, toAppError, isCancellation } from '../../../src/application/errors.js';
import { createTranscript, addSummary } from '../../../src/domain/transcript.js';
import { serializeTranscript } from '../../../src/domain/transcript-codec.js';
import { MemoryRepository, fixedClock, sequentialIds, MemorySettingsStore, MemoryKeyStore } from '../helpers/fakes.mjs';

const base = createTranscript({
  id: 't1', title: 'Σύσκεψη_Έργων', createdAt: '2026-11-04T09:00:00.000Z',
  source: { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1, durationSec: 10 },
  languageCode: 'el', engine: { kind: 'local', model: 'whisper' },
  speakers: [{ id: 'S1', label: 'Ομιλητής 1', colorIndex: 0 }],
  segments: [{ id: 'seg-1', start: 0, end: 2, speakerId: 'S1', text: 'Γεια.' }],
});

test('εξαγωγή: όνομα αρχείου με κενά, άγνωστη μορφή και περίληψη', () => {
  const service = new ExportService({
    transcriptExporters: [{ format: 'txt', extension: 'txt', mimeType: 'text/plain', render: t => `κείμενο ${t.id}` }],
    summaryExporters: [{ format: 'docx', extension: 'docx', mimeType: 'application/x', render: (t, s) => new Uint8Array([s.text.length]) }],
    summaryNameSuffix: kind => ({ minutes: 'Πρακτικά' }[kind] || 'Περίληψη'),
  });
  assert.deepEqual(service.transcriptFormats, ['txt']);
  assert.deepEqual(service.exportTranscript(base, 'txt'), { fileName: 'Σύσκεψη Έργων.txt', mimeType: 'text/plain', data: 'κείμενο t1' });
  assert.throws(() => service.exportTranscript(base, 'pdf'), e => e.code === ERROR_CODES.INVALID_INPUT);
  const withSummary = addSummary(base, { id: 's1', kind: 'minutes', model: 'm', createdAt: 'x', text: 'abc' }, '2026-11-04T10:00:00.000Z');
  assert.equal(service.exportSummary(withSummary, 's1', 'docx').fileName, 'Σύσκεψη Έργων Πρακτικά.docx');
  assert.throws(() => service.exportSummary(withSummary, 'nope', 'docx'), e => e.code === ERROR_CODES.NOT_FOUND);
});

test('ιστορικό: άνοιγμα, εισαγωγή με νέο αναγνωριστικό όταν υπάρχει ήδη, διαγραφές', async () => {
  const repository = new MemoryRepository();
  const library = new LibraryService({ repository, idGenerator: sequentialIds('new'), storage: { async estimate() { return { usageBytes: 5, quotaBytes: 10 }; } } });
  await assert.rejects(library.open('t1'), e => e.code === ERROR_CODES.NOT_FOUND);
  const json = serializeTranscript(base, { exportedAt: 'x', appVersion: '1' });
  const first = await library.importFromJson(json);
  assert.equal(first.id, 't1');
  const second = await library.importFromJson(json);
  assert.equal(second.id, 'new-1');
  assert.equal((await library.listNewestFirst()).length, 2);
  await assert.rejects(library.importFromJson('{}'), e => e.code === ERROR_CODES.INVALID_INPUT);
  assert.equal((await library.open('t1')).title, 'Σύσκεψη_Έργων');
  await library.remove('t1');
  assert.equal((await library.listNewestFirst()).length, 1);
  await library.removeAll();
  assert.deepEqual(await library.listNewestFirst(), []);
  assert.deepEqual(await library.storageUsage(), { usageBytes: 5, quotaBytes: 10 });
});

test('διορθώσεις: κάθε αλλαγή αποθηκεύεται, λάθη κανόνων γίνονται INVALID_INPUT', async () => {
  const repository = new MemoryRepository();
  const editor = new TranscriptEditor({ repository, clock: fixedClock('2026-11-05T00:00:00.000Z') });
  let t = await editor.setTitle(base, 'Νέος τίτλος');
  t = await editor.renameSpeaker(t, 'S1', 'Δήμαρχος');
  const added = await editor.addSpeaker(t, 'Γραμματέας');
  t = await editor.assignSpeaker(added.transcript, 'seg-1', added.speakerId);
  t = await editor.editSegmentText(t, 'seg-1', 'Γεια σας.');
  assert.equal(t.title, 'Νέος τίτλος');
  assert.equal(t.speakers[0].label, 'Δήμαρχος');
  assert.equal(t.segments[0].speakerId, 'S2');
  assert.equal(t.updatedAt, '2026-11-05T00:00:00.000Z');
  assert.equal(repository.saves, 5);
  await assert.rejects(editor.renameSpeaker(t, 'S9', 'x'), e => e instanceof AppError && e.code === ERROR_CODES.INVALID_INPUT);
});

test('ρυθμίσεις: προεπιλογές, απόρριψη άκυρων τιμών και παλιών αποθηκευμένων', () => {
  const store = new MemorySettingsStore({ engineKind: 'elevenlabs', languageCode: 'zz', removeAnoTeleia: 'yes', stale: 1 });
  const settings = new SettingsService({ store });
  assert.equal(settings.current.engineKind, 'elevenlabs');
  assert.equal(settings.current.languageCode, DEFAULT_SETTINGS.languageCode);
  assert.equal(settings.current.removeAnoTeleia, true);
  assert.equal('stale' in settings.current, false);
  assert.equal(settings.current.claudeModelId, 'claude-opus-5-5');
  settings.update({ expectedSpeakers: 3, diarizeByEngine: { local: true, elevenlabs: true } });
  assert.equal(store.value.expectedSpeakers, 3);
  assert.throws(() => settings.update({ expectedSpeakers: 0 }), RangeError);
  assert.throws(() => settings.update({ claudeModelId: 'gpt-5' }), RangeError);
  assert.throws(() => settings.update({ whatever: 1 }), RangeError);
  assert.throws(() => { settings.current.engineKind = 'x'; }, TypeError, 'οι ρυθμίσεις είναι αμετάβλητες');
  settings.reset();
  assert.equal(store.value, null);
  assert.equal(settings.current.engineKind, 'local');
});

test('κλειδιά: αποθήκευση, ένδειξη, έλεγχος και μετάφραση σφαλμάτων', async () => {
  const keyStore = new MemoryKeyStore();
  const verified = [];
  const service = new ApiKeyService({
    keyStore,
    verifiers: [{ provider: 'elevenlabs', async verify(k) { verified.push(k); if (k === 'bad') throw new AppError(ERROR_CODES.KEY_INVALID); } }],
  });
  assert.equal(service.hasKey('elevenlabs'), false);
  await assert.rejects(service.verify('elevenlabs'), e => e.code === ERROR_CODES.KEY_MISSING);
  service.saveKey('elevenlabs', '  sk_abcdef1234  ');
  assert.equal(service.keyHint('elevenlabs'), '1234');
  await service.verify('elevenlabs');
  assert.deepEqual(verified, ['sk_abcdef1234']);
  await assert.rejects(service.verify('elevenlabs', 'bad'), e => e.code === ERROR_CODES.KEY_INVALID);
  await assert.rejects(service.verify('anthropic', 'k'), e => e.code === ERROR_CODES.INVALID_INPUT);
  assert.throws(() => service.saveKey('elevenlabs', 'a b'), e => e.code === ERROR_CODES.INVALID_INPUT);
  service.setPersistent(false);
  assert.equal(service.isPersistent(), false);
  service.clearAll();
  assert.equal(service.hasKey('elevenlabs'), false);
});

test('σφάλματα: μετατροπή άγνωστων και ακυρώσεων', () => {
  assert.equal(toAppError(new Error('x')).code, ERROR_CODES.UNKNOWN);
  const abort = new DOMException('stop', 'AbortError');
  assert.equal(isCancellation(abort), true);
  assert.equal(toAppError(abort).code, ERROR_CODES.CANCELLED);
  assert.equal(new AppError('NOPE').code, ERROR_CODES.UNKNOWN);
  const known = new AppError(ERROR_CODES.QUOTA_EXCEEDED, 'q', { details: { providerMessage: 'no credits' } });
  assert.equal(toAppError(known), known);
  assert.equal(known.details.providerMessage, 'no credits');
});
