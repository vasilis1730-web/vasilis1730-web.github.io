import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportService } from '../../../src/application/export-service.js';
import { EXPORT_FORMATS, SHARE_FORMAT_PREFERENCE } from '../../../src/application/export-formats.js';
import { LibraryService } from '../../../src/application/library-service.js';
import { TranscriptEditor } from '../../../src/application/transcript-editor.js';
import { SettingsService, DEFAULT_SETTINGS } from '../../../src/application/settings-service.js';
import { ApiKeyService } from '../../../src/application/api-key-service.js';
import { KEY_PROVIDERS, KEY_RETENTIONS } from '../../../src/application/key-providers.js';
import { DataErasureService } from '../../../src/application/data-erasure-service.js';
import { ERASE_TARGETS } from '../../../src/application/erase-targets.js';
import { AppError, ERROR_CODES, INPUT_ISSUES, invalidInput, isAppError, toAppError, isCancellation, throwIfAborted } from '../../../src/application/errors.js';
import { createTranscript, addSummary, TranscriptRuleError, TRANSCRIPT_RULES } from '../../../src/domain/transcript.js';
import { serializeTranscript } from '../../../src/domain/transcript-codec.js';
import { MemoryRepository, MemoryDeviceStorage, fixedClock, sequentialIds, MemorySettingsStore, MemoryKeyStore } from '../helpers/fakes.mjs';

const base = createTranscript({
  id: 't1', title: 'Σύσκεψη_Έργων', createdAt: '2026-11-04T09:00:00.000Z',
  source: { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1, durationSec: 10 },
  languageCode: 'el', engine: { kind: 'local', model: 'whisper' },
  speakers: [{ id: 'S1', label: 'Ομιλητής 1', colorIndex: 0 }],
  segments: [{ id: 'seg-1', start: 0, end: 2, speakerId: 'S1', text: 'Γεια.' }],
});

const isInputIssue = reason => e => e instanceof AppError && e.code === ERROR_CODES.INVALID_INPUT && e.details.reason === reason;

function exportService({ rendered = [] } = {}) {
  const exporter = (format, extension, mimeType, render) => ({ format, extension, mimeType, render: (...args) => { rendered.push(format); return render(...args); } });
  return new ExportService({
    transcriptExporters: [
      exporter(EXPORT_FORMATS.DOCX, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', () => new Uint8Array([1])),
      exporter(EXPORT_FORMATS.TXT, 'txt', 'text/plain', t => `κείμενο ${t.id}`),
    ],
    summaryExporters: [exporter(EXPORT_FORMATS.DOCX, 'docx', 'application/x', (t, s) => new Uint8Array([s.text.length]))],
    summaryFileSuffixFor: kind => ({ minutes: 'Πρακτικά' }[kind] || 'Περίληψη'),
    untitledFileName: 'Μεταγραφή',
  });
}

test('εξαγωγή: όνομα αρχείου με κενά, άγνωστη μορφή και περίληψη', () => {
  const service = exportService();
  assert.deepEqual(service.transcriptFormats, ['docx', 'txt']);
  assert.deepEqual(service.summaryFormats, ['docx']);
  assert.deepEqual(service.exportTranscript(base, 'txt'), { fileName: 'Σύσκεψη Έργων.txt', mimeType: 'text/plain', data: 'κείμενο t1' });
  assert.throws(() => service.exportTranscript(base, 'pdf'), RangeError, 'άγνωστη μορφή είναι λάθος του κώδικα');
  const withSummary = addSummary(base, { id: 's1', kind: 'minutes', model: 'm', createdAt: 'x', text: 'abc' }, '2026-11-04T10:00:00.000Z');
  const file = service.exportSummary(withSummary, withSummary.summaries[0], 'docx');
  assert.equal(file.fileName, 'Σύσκεψη Έργων Πρακτικά.docx');
  assert.deepEqual(Array.from(file.data), [3]);
  assert.throws(() => service.exportSummary(withSummary, withSummary.summaries[0], 'txt'), RangeError);
  const untitled = { ...base, title: '' };
  assert.equal(service.exportTranscript(untitled, 'txt').fileName, 'Μεταγραφή.txt', 'χωρίς τίτλο: το όνομα της διεπαφής');
  assert.equal(service.exportSummary(untitled, withSummary.summaries[0], 'docx').fileName, 'Πρακτικά.docx');
});

test('εξαγωγή: κείμενο για το πρόχειρο, και μορφή κοινής χρήσης χωρίς να φτιαχτεί το αρχείο', () => {
  const rendered = [];
  const service = exportService({ rendered });
  assert.equal(service.exportClipboardText(base), 'κείμενο t1');
  rendered.length = 0;
  const asked = [];
  const share = accepted => service.shareFormatFor(base, file => { asked.push(file); return accepted.includes(file.mimeType); });
  assert.deepEqual(SHARE_FORMAT_PREFERENCE, [EXPORT_FORMATS.DOCX, EXPORT_FORMATS.TXT]);
  assert.equal(share(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']), EXPORT_FORMATS.DOCX);
  assert.deepEqual(asked[0], { fileName: 'Σύσκεψη Έργων.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(share(['text/plain']), EXPORT_FORMATS.TXT, 'αλλιώς κείμενο');
  assert.equal(share([]), null, 'καμία, όταν η συσκευή δεν μοιράζεται αρχεία');
  assert.deepEqual(rendered, [], 'ο έλεγχος δεν φτιάχνει κανένα αρχείο');
});

test('ιστορικό: άνοιγμα, εισαγωγή με νέο αναγνωριστικό όταν υπάρχει ήδη, διαγραφές, χώρος', async () => {
  const repository = new MemoryRepository();
  const library = new LibraryService({ repository, idGenerator: sequentialIds('new'), deviceStorage: new MemoryDeviceStorage({ usageBytes: 5, quotaBytes: 10 }) });
  await assert.rejects(library.open('t1'), e => e.code === ERROR_CODES.NOT_FOUND);
  const json = serializeTranscript(base, { exportedAt: 'x', appVersion: '1' });
  const first = await library.importFromJson(json);
  assert.equal(first.id, 't1');
  const second = await library.importFromJson(json);
  assert.equal(second.id, 'new-1');
  assert.equal((await library.listNewestFirst()).length, 2);
  await assert.rejects(library.importFromJson('{}'), e => e.code === ERROR_CODES.INVALID_TRANSCRIPT_FILE);
  await assert.rejects(library.importFromJson('όχι json'), e => e.code === ERROR_CODES.INVALID_TRANSCRIPT_FILE);
  assert.equal((await library.open('t1')).title, 'Σύσκεψη_Έργων');
  await library.remove('t1');
  assert.equal((await library.listNewestFirst()).length, 1);
  await library.clear();
  assert.deepEqual(await library.listNewestFirst(), []);
  assert.deepEqual(await library.estimateStorageUsage(), { usageBytes: 5, quotaBytes: 10 });
});

test('διορθώσεις: κάθε αλλαγή αποθηκεύεται, μόνο το κενό όνομα γίνεται INVALID_INPUT', async () => {
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
  await assert.rejects(editor.renameSpeaker(t, 'S1', '   '), isInputIssue(INPUT_ISSUES.EMPTY_SPEAKER_NAME), 'το διορθώνει ο χρήστης');
  await assert.rejects(editor.addSpeaker(t, ''), isInputIssue(INPUT_ISSUES.EMPTY_SPEAKER_NAME));
  await assert.rejects(editor.renameSpeaker(t, 'S9', 'x'), e => e instanceof TranscriptRuleError && e.rule === TRANSCRIPT_RULES.UNKNOWN_SPEAKER, 'λάθος του κώδικα: περνά όπως είναι');
  await assert.rejects(editor.removeSummary(t, 'καμία'), e => e instanceof TranscriptRuleError && e.rule === TRANSCRIPT_RULES.UNKNOWN_SUMMARY);
  assert.equal(repository.saves, 5, 'τίποτα δεν αποθηκεύεται όταν η αλλαγή απορρίπτεται');
  const withSummary = addSummary(t, { id: 's1', kind: 'brief', model: 'm', createdAt: 'x', text: 'α' }, 'x');
  assert.deepEqual((await editor.removeSummary(withSummary, 's1')).summaries, []);
});

test('νέος ομιλητής σε τμήμα: μία αλλαγή, μία αποθήκευση (OO-013)', async () => {
  const repository = new MemoryRepository();
  const editor = new TranscriptEditor({ repository, clock: fixedClock('2026-11-05T00:00:00.000Z') });
  const { transcript, speakerId } = await editor.addSpeakerToSegment(base, 'seg-1', 'Γραμματέας');
  assert.equal(speakerId, 'S2');
  assert.equal(transcript.speakers.at(-1).label, 'Γραμματέας');
  assert.equal(transcript.segments[0].speakerId, 'S2');
  assert.equal(repository.saves, 1, 'μία αποθήκευση για όλη την αλλαγή');
  assert.deepEqual((await repository.findById('t1')).segments[0].speakerId, 'S2');
  await assert.rejects(editor.addSpeakerToSegment(base, 'seg-9', 'Χ'), e => e instanceof TranscriptRuleError && e.rule === TRANSCRIPT_RULES.UNKNOWN_SEGMENT);
  await assert.rejects(editor.addSpeakerToSegment(base, 'seg-1', ' '), isInputIssue(INPUT_ISSUES.EMPTY_SPEAKER_NAME));
  assert.equal(repository.saves, 1, 'καμία αποθήκευση όταν απορρίπτεται, ούτε μισή');
});

test('ρυθμίσεις: προεπιλογές, απόρριψη άκυρων τιμών και παλιών αποθηκευμένων', () => {
  const store = new MemorySettingsStore({ engineKind: 'elevenlabs', languageCode: 'zz', removeAnoTeleia: 'yes', localQuality: 'turbo', stale: 1 });
  const settings = new SettingsService({ store });
  assert.equal(settings.current.engineKind, 'elevenlabs');
  assert.equal(settings.current.languageCode, DEFAULT_SETTINGS.languageCode);
  assert.equal(settings.current.removeAnoTeleia, true);
  assert.equal(settings.current.localQuality, 'auto');
  assert.equal('stale' in settings.current, false);
  assert.equal(settings.current.claudeModelId, 'claude-opus-5-5');
  assert.deepEqual(settings.current.diarizeByEngine, { local: false, elevenlabs: true });
  settings.update({ expectedSpeakers: 3, diarizeByEngine: { local: true, elevenlabs: true }, localQuality: 'accurate' });
  assert.equal(store.value.expectedSpeakers, 3);
  assert.equal(store.value.localQuality, 'accurate');
  assert.throws(() => settings.update({ expectedSpeakers: 0 }), RangeError);
  assert.throws(() => settings.update({ claudeModelId: 'gpt-5' }), RangeError);
  assert.throws(() => settings.update({ localQuality: 'turbo' }), RangeError);
  assert.throws(() => settings.update({ localQualityPreset: 'fast' }), RangeError, 'το παλιό όνομα δεν γράφεται πια');
  assert.throws(() => settings.update({ diarizeByEngine: { local: true } }), RangeError, 'μία σημαία για κάθε μηχανή');
  assert.throws(() => settings.update({ whatever: 1 }), RangeError);
  assert.throws(() => settings.update({ engineKind: 'cloud', removeAnoTeleia: false }), RangeError);
  assert.equal(settings.current.removeAnoTeleia, true, 'άκυρη τιμή: καμία αλλαγή, ούτε στις έγκυρες');
  assert.throws(() => { settings.current.engineKind = 'x'; }, TypeError, 'οι ρυθμίσεις είναι αμετάβλητες');
  assert.throws(() => { settings.current.diarizeByEngine.local = false; }, TypeError);
  settings.clear();
  assert.equal(store.value, null);
  assert.equal(settings.current.engineKind, 'local');
  assert.equal(settings.current.expectedSpeakers, null);
  const legacy = new SettingsService({ store: new MemorySettingsStore({ localQualityPreset: 'balanced' }) });
  assert.equal(legacy.current.localQuality, 'balanced', 'η παλιά αποθηκευμένη ρύθμιση διαβάζεται με το νέο όνομα');
  assert.equal('localQualityPreset' in legacy.current, false);
});

test('κλειδιά: αποθήκευση, ένδειξη, έλεγχος, διατήρηση και μετάφραση σφαλμάτων', async () => {
  const keyStore = new MemoryKeyStore();
  const verified = [];
  const service = new ApiKeyService({
    keyStore,
    verifiers: [{ provider: KEY_PROVIDERS.ELEVENLABS, async verify(k) { verified.push(k); if (k === 'bad') throw new AppError(ERROR_CODES.KEY_INVALID); if (k === 'boom') throw new Error('x'); } }],
  });
  assert.equal(service.hasKey(KEY_PROVIDERS.ELEVENLABS), false);
  await assert.rejects(service.verify(KEY_PROVIDERS.ELEVENLABS), e => e.code === ERROR_CODES.KEY_MISSING);
  service.saveKey(KEY_PROVIDERS.ELEVENLABS, '  sk_abcdef1234  ');
  assert.equal(service.getKeyHint(KEY_PROVIDERS.ELEVENLABS), '1234');
  assert.equal(service.getKeyHint(KEY_PROVIDERS.ANTHROPIC), null);
  await service.verify(KEY_PROVIDERS.ELEVENLABS);
  assert.deepEqual(verified, ['sk_abcdef1234']);
  await assert.rejects(service.verify(KEY_PROVIDERS.ELEVENLABS, 'bad'), e => e.code === ERROR_CODES.KEY_INVALID);
  await assert.rejects(service.verify(KEY_PROVIDERS.ELEVENLABS, 'boom'), e => e instanceof AppError && e.code === ERROR_CODES.UNKNOWN);
  await assert.rejects(service.verify(KEY_PROVIDERS.ANTHROPIC, 'k'), RangeError, 'χωρίς έλεγχο για τον πάροχο: λάθος του κώδικα');
  assert.throws(() => service.saveKey(KEY_PROVIDERS.ELEVENLABS, 'a b'), isInputIssue(INPUT_ISSUES.KEY_WHITESPACE));
  assert.throws(() => service.saveKey(KEY_PROVIDERS.ELEVENLABS, '   '), isInputIssue(INPUT_ISSUES.EMPTY_KEY));
  for (const call of [() => service.hasKey('openai'), () => service.getKeyHint('openai'), () => service.saveKey('openai', 'k'), () => service.removeKey('openai')]) {
    assert.throws(call, RangeError, 'άγνωστος πάροχος');
  }
  await assert.rejects(service.verify('openai', 'k'), RangeError);
  assert.throws(() => new ApiKeyService({ keyStore, verifiers: [{ provider: 'openai', verify() {} }] }), RangeError);
  assert.equal(service.getKeyRetention(), KEY_RETENTIONS.DEVICE);
  service.setKeyRetention(KEY_RETENTIONS.SESSION);
  assert.equal(service.getKeyRetention(), KEY_RETENTIONS.SESSION);
  assert.throws(() => service.setKeyRetention('forever'), RangeError);
  service.removeKey(KEY_PROVIDERS.ELEVENLABS);
  assert.equal(service.hasKey(KEY_PROVIDERS.ELEVENLABS), false);
  service.saveKey(KEY_PROVIDERS.ANTHROPIC, 'sk-ant-1');
  service.clear();
  assert.equal(service.hasKey(KEY_PROVIDERS.ANTHROPIC), false);
  assert.equal(service.getKeyRetention(), KEY_RETENTIONS.DEVICE, 'το clear σβήνει και την επιλογή διατήρησης');
});

test('διαγραφή όλων: κάθε στόχος σβήνεται ακόμη κι αν κάποιος αποτύχει, και το σφάλμα λέει ποιοι έμειναν', async () => {
  const erased = [];
  const target = (name, erase = () => { erased.push(name); }) => ({ name, erase });
  const failing = {
    [ERASE_TARGETS.TRANSCRIPTS]: async () => { throw new DOMException('blocked', 'InvalidStateError'); },
    [ERASE_TARGETS.SETTINGS]: () => { throw new Error('σύγχρονο σφάλμα'); },
  };
  const service = new DataErasureService({ targets: Object.values(ERASE_TARGETS).map(name => target(name, failing[name])) });
  assert.deepEqual(service.targetNames, Object.values(ERASE_TARGETS));
  await assert.rejects(service.eraseAll(), e => e instanceof AppError && e.code === ERROR_CODES.ERASE_INCOMPLETE
    && JSON.stringify(e.details.failedTargets) === JSON.stringify([ERASE_TARGETS.TRANSCRIPTS, ERASE_TARGETS.SETTINGS]));
  assert.deepEqual(erased, Object.values(ERASE_TARGETS).filter(name => !failing[name]), 'οι υπόλοιποι σβήστηκαν κανονικά');

  erased.length = 0;
  await service.erase([ERASE_TARGETS.MODELS]);
  assert.deepEqual(erased, [ERASE_TARGETS.MODELS], 'μόνο ό,τι ζητήθηκε');
  await assert.rejects(service.erase(['όλα']), RangeError);
});

test('διαγραφή όλων: λείπει, περισσεύει ή επαναλαμβάνεται στόχος → λάθος σύνδεσης', () => {
  const targets = Object.values(ERASE_TARGETS).map(name => ({ name, erase() {} }));
  assert.throws(() => new DataErasureService({ targets: targets.slice(1) }), RangeError, 'ξεχασμένη αποθήκη');
  assert.throws(() => new DataErasureService({ targets: [...targets, { name: 'cookies', erase() {} }] }), RangeError);
  assert.throws(() => new DataErasureService({ targets: [...targets, targets[0]] }), RangeError);
});

test('διαγραφή: πρώτα σταματά ό,τι γράφει ακόμη, ακόμη κι αν το σταμάτημα αποτύχει', async () => {
  const order = [];
  const service = new DataErasureService({
    beforeErase: [async () => { order.push('stop'); }, () => { throw new Error('δεν σταμάτησε'); }],
    targets: Object.values(ERASE_TARGETS).map(name => ({ name, erase: () => { order.push(name); } })),
  });
  await service.eraseAll();
  assert.deepEqual(order, ['stop', ...Object.values(ERASE_TARGETS)]);
});

test('σφάλματα: μετατροπή άγνωστων και ακυρώσεων, αιτίες εισόδου', () => {
  assert.equal(toAppError(new Error('x')).code, ERROR_CODES.UNKNOWN);
  const abort = new DOMException('stop', 'AbortError');
  assert.equal(isCancellation(abort), true);
  assert.equal(toAppError(abort).code, ERROR_CODES.CANCELLED);
  const typo = new AppError('NOPE');
  assert.equal(typo.code, ERROR_CODES.UNKNOWN);
  assert.equal(typo.details.unrecognizedCode, 'NOPE', 'ο άγνωστος κωδικός δεν χάνεται');
  const known = new AppError(ERROR_CODES.QUOTA_EXCEEDED, 'q', { details: { providerMessage: 'no credits' } });
  assert.equal(toAppError(known), known);
  assert.equal(known.details.providerMessage, 'no credits');
  assert.equal(isAppError(known), true);
  assert.equal(isAppError(new Error('x')), false);
  const issue = invalidInput(INPUT_ISSUES.EMPTY_FILE, 'κενό');
  assert.deepEqual([issue.code, issue.details.reason, issue.message], [ERROR_CODES.INVALID_INPUT, 'empty-file', 'κενό']);
  const controller = new AbortController();
  throwIfAborted(controller.signal);
  controller.abort();
  assert.throws(() => throwIfAborted(controller.signal), e => e.code === ERROR_CODES.CANCELLED);
});
