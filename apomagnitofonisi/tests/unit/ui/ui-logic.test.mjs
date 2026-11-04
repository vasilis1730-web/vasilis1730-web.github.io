/**
 * Η λογική της διεπαφής που δεν θέλει DOM: πληρότητα των κειμένων για κάθε
 * κλειστό σύνολο τιμών (κωδικοί σφαλμάτων, αιτίες, μηχανές, μορφές, είδη,
 * στόχοι διαγραφής), μηνύματα σφαλμάτων, διαδρομές και παραλαβή αρχείου από
 * κοινή χρήση.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, errorMessage, messageForCode, exportFormatLabel, qualityLabel, speakerLabelFor } from '../../../src/ui/strings.js';
import { describeError, reportUnexpected, runAction, presentError, openFailureHeading } from '../../../src/ui/feedback.js';
import { createExportLabels, describeEngine, displayTitle, engineShortName, summaryFileSuffixFor } from '../../../src/ui/presentation.js';
import { ROUTE_PATTERNS, ROUTES, hrefFor } from '../../../src/ui/routes.js';
import { HashRouter } from '../../../src/ui/router.js';
import { takeSharedFile } from '../../../src/ui/launch-intake.js';
import { AppError, ERROR_CODES, INPUT_ISSUES, invalidInput } from '../../../src/application/errors.js';
import { EXPORT_FORMATS } from '../../../src/application/export-formats.js';
import { ERASE_TARGETS } from '../../../src/application/erase-targets.js';
import { ENGINE_KINDS, SUMMARY_KINDS } from '../../../src/domain/transcript.js';
import { LOCAL_QUALITY_PRESET_IDS, AUTO_LOCAL_QUALITY } from '../../../src/config/models.js';

const ANO_TELEIA = new RegExp(`[${String.fromCharCode(0x387, 0xb7)}]`);

test('κάθε κωδικός σφάλματος και κάθε αιτία λανθασμένης εισόδου έχει μήνυμα', () => {
  for (const code of Object.values(ERROR_CODES)) assert.ok(STRINGS.errors[code], code);
  for (const reason of Object.values(INPUT_ISSUES)) assert.ok(STRINGS.inputIssues[reason], reason);
  assert.equal(errorMessage(invalidInput(INPUT_ISSUES.EMPTY_SPEAKER_NAME)), STRINGS.inputIssues[INPUT_ISSUES.EMPTY_SPEAKER_NAME], 'ανά αιτία, όχι γενικό');
  assert.equal(errorMessage(new AppError(ERROR_CODES.INVALID_INPUT)), STRINGS.errors[ERROR_CODES.INVALID_INPUT]);
  assert.equal(errorMessage(new TypeError('x')), STRINGS.errors[ERROR_CODES.UNKNOWN], 'λάθος του κώδικα: γενικό μήνυμα');
  assert.equal(errorMessage(null), STRINGS.errors[ERROR_CODES.UNKNOWN]);
  assert.equal(errorMessage(new DOMException('x', 'AbortError')), STRINGS.errors[ERROR_CODES.UNKNOWN], 'αριθμητικός code του DOMException');
});

test('μήνυμα ανά κωδικό: χωρίς ψεύτικο αντικείμενο σφάλματος (API-020)', () => {
  assert.equal(messageForCode(ERROR_CODES.KEY_MISSING), STRINGS.errors[ERROR_CODES.KEY_MISSING]);
  assert.equal(messageForCode(ERROR_CODES.INVALID_INPUT, INPUT_ISSUES.EMPTY_KEY), STRINGS.inputIssues[INPUT_ISSUES.EMPTY_KEY]);
  assert.equal(messageForCode(ERROR_CODES.INVALID_INPUT, 'άγνωστη αιτία'), STRINGS.errors[ERROR_CODES.INVALID_INPUT]);
  assert.equal(messageForCode('providerSaid'), STRINGS.errors[ERROR_CODES.UNKNOWN], 'μόνο κωδικοί του ERROR_CODES');
  assert.equal(messageForCode(undefined), STRINGS.errors[ERROR_CODES.UNKNOWN]);
});

test('κάθε μηχανή, μορφή, είδος περίληψης, επίπεδο ποιότητας και στόχος διαγραφής έχει ονομασία', () => {
  for (const kind of Object.values(ENGINE_KINDS)) {
    const names = STRINGS.engines[kind];
    assert.ok(names && names.label && names.hint && names.short, kind);
    assert.match(names.documentName('m'), /\(m\)$/, kind);
  }
  for (const format of Object.values(EXPORT_FORMATS)) assert.notEqual(exportFormatLabel(format), format, format);
  for (const kind of Object.values(SUMMARY_KINDS)) {
    assert.ok(STRINGS.summary.kinds[kind], kind);
    assert.ok(STRINGS.summary.fileSuffix[kind], kind);
    assert.doesNotMatch(STRINGS.summary.fileSuffix[kind], /_/, 'ονόματα αρχείων με κενά');
  }
  for (const id of [AUTO_LOCAL_QUALITY, ...Object.values(LOCAL_QUALITY_PRESET_IDS)]) assert.notEqual(qualityLabel(id), id, id);
  for (const target of Object.values(ERASE_TARGETS)) assert.ok(STRINGS.settings.eraseTargets[target], target);
  assert.equal(speakerLabelFor(3), 'Ομιλητής 3');
});

test('κανένα κείμενο της διεπαφής δεν έχει άνω τελεία', () => {
  const texts = [];
  const walk = value => {
    if (typeof value === 'string') texts.push(value);
    else if (typeof value === 'function') texts.push(String(value(1, 2)));
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(STRINGS);
  assert.ok(texts.length > 100);
  for (const text of texts) assert.doesNotMatch(text, ANO_TELEIA, text);
});

test('μήνυμα σφάλματος: μήνυμα του παρόχου και ό,τι δεν σβήστηκε', () => {
  const rejected = new AppError(ERROR_CODES.PROVIDER_REJECTED, 'x', { details: { providerMessage: 'Your credit balance is too low' } });
  assert.equal(describeError(rejected), `${STRINGS.errors.PROVIDER_REJECTED} ${STRINGS.errors.providerSaid}: Your credit balance is too low`);
  const incomplete = new AppError(ERROR_CODES.ERASE_INCOMPLETE, 'x', { details: { failedTargets: [ERASE_TARGETS.TRANSCRIPTS, ERASE_TARGETS.MODELS] } });
  assert.match(describeError(incomplete), new RegExp(`${STRINGS.errors.notErased}: μεταγραφές, μοντέλα\\.$`));
});

/** Τα console.error όσο τρέχει το `run`. */
async function captureConsoleErrors(run) {
  const logged = [];
  const original = console.error;
  console.error = error => logged.push(error);
  try {
    await run();
  } finally {
    console.error = original;
  }
  return logged;
}

test('ενέργειες: ρητό αποτέλεσμα, μήνυμα επιτυχίας, μήνυμα σφάλματος, σιωπή στην ακύρωση (API-021)', async () => {
  const shown = [];
  const toasts = { show: (message, options) => shown.push([message, options.tone]) };
  assert.deepEqual(await runAction(toasts, () => 42, { success: 'Έγινε.' }), { ok: true, value: 42 });
  assert.deepEqual(await runAction(toasts, () => {}), { ok: true, value: undefined }, 'ενέργεια χωρίς τιμή: επιτυχία, όχι αποτυχία');
  assert.deepEqual(await runAction(toasts, async () => { throw invalidInput(INPUT_ISSUES.EMPTY_KEY); }), { ok: false });
  assert.deepEqual(await runAction(toasts, async () => { throw new AppError(ERROR_CODES.CANCELLED); }), { ok: false });
  assert.deepEqual(await runAction(toasts, () => { throw new DOMException('x', 'AbortError'); }), { ok: false });
  assert.deepEqual(shown, [['Έγινε.', 'success'], [STRINGS.inputIssues[INPUT_ISSUES.EMPTY_KEY], 'error']]);
  const logged = await captureConsoleErrors(() => runAction(toasts, () => { throw new TypeError('bug'); }));
  assert.equal(logged.length, 1, 'τα λάθη του κώδικα φαίνονται και στην κονσόλα');
  assert.deepEqual(shown.at(-1), [STRINGS.errors.UNKNOWN, 'error']);
});

test('απρόσμενα σφάλματα στην κονσόλα με την αρχική αιτία, τα γνωστά όχι (API-020)', async () => {
  const bug = new TypeError('x is not a function');
  const wrapped = new AppError(ERROR_CODES.UNKNOWN, bug.message, { cause: bug });
  const logged = await captureConsoleErrors(() => {
    assert.equal(reportUnexpected(wrapped), true, 'UNKNOWN από adapter');
    assert.equal(reportUnexpected(new RangeError('άγνωστο μοντέλο')), true, 'λάθος του κώδικα');
    assert.equal(reportUnexpected(new AppError(ERROR_CODES.KEY_INVALID)), false, 'γνωστό σφάλμα');
    assert.equal(reportUnexpected(new AppError(ERROR_CODES.CANCELLED)), false, 'ακύρωση');
    assert.equal(reportUnexpected(new DOMException('x', 'AbortError')), false, 'ακύρωση του browser');
  });
  assert.equal(logged.length, 2);
  assert.equal(logged[0], bug, 'η αιτία, όχι το περιτύλιγμα');
  const viaAction = await captureConsoleErrors(() => runAction({ show() {} }, () => { throw wrapped; }));
  assert.deepEqual(viaAction, [bug], 'και μέσα από το runAction');
});

test('presentError και επικεφαλίδα ανοίγματος: απρόσμενα στην κονσόλα, «δεν βρέθηκε» μόνο για NOT_FOUND (API-025)', async () => {
  const bug = new TypeError('broken record');
  let message;
  const logged = await captureConsoleErrors(() => { message = presentError(new AppError(ERROR_CODES.UNKNOWN, 'x', { cause: bug })); });
  assert.deepEqual(logged, [bug]);
  assert.equal(message, STRINGS.errors.UNKNOWN);
  const quiet = await captureConsoleErrors(() => { message = presentError(new AppError(ERROR_CODES.NOT_FOUND)); });
  assert.deepEqual(quiet, [], 'γνωστό σφάλμα: όχι στην κονσόλα');
  assert.equal(message, STRINGS.errors.NOT_FOUND);
  assert.equal(openFailureHeading(new AppError(ERROR_CODES.NOT_FOUND)), STRINGS.transcript.notFound);
  assert.equal(openFailureHeading(new AppError(ERROR_CODES.UNKNOWN)), STRINGS.transcript.openFailed);
  assert.equal(openFailureHeading(new TypeError('x')), STRINGS.transcript.openFailed);
});

test('παρουσίαση: ονόματα μηχανών, τίτλος χωρίς τίτλο, ετικέτες εγγράφων', () => {
  assert.equal(describeEngine({ kind: ENGINE_KINDS.LOCAL, model: 'onnx-community/whisper-base' }), 'Whisper στη συσκευή (whisper-base)');
  assert.equal(describeEngine({ kind: ENGINE_KINDS.ELEVENLABS, model: 'scribe_v2' }), 'ElevenLabs Scribe (scribe_v2)');
  assert.equal(engineShortName(ENGINE_KINDS.ELEVENLABS), 'ElevenLabs');
  assert.equal(displayTitle({ title: '' }), STRINGS.transcript.untitled);
  assert.equal(displayTitle({ title: 'Σύσκεψη' }), 'Σύσκεψη');
  const labels = createExportLabels();
  for (const key of ['appName', 'date', 'duration', 'speakers', 'engine', 'unknownSpeaker', 'untitled', 'transcriptNotice', 'summaryNotice']) assert.equal(typeof labels[key], 'string', key);
  assert.equal(labels.summaryTitleFor(SUMMARY_KINDS.MINUTES), STRINGS.summary.kinds.minutes);
  assert.equal(summaryFileSuffixFor(SUMMARY_KINDS.MINUTES), 'Πρακτικά');
  assert.equal(summaryFileSuffixFor('άγνωστο'), STRINGS.summary.fileSuffix.custom);
});

test('διαδρομές: κάθε σύνδεσμος βρίσκει τη διαδρομή του', () => {
  const location = { hash: '' };
  const window = { location, addEventListener() {} };
  const shown = [];
  const router = new HashRouter({
    window,
    fallback: () => shown.push(['fallback']),
    routes: Object.entries(ROUTE_PATTERNS).map(([name, pattern]) => ({ pattern, show: params => shown.push([name, params]) })),
  });
  const visit = path => { location.hash = hrefFor(path); router.navigate(path); };
  visit(ROUTES.home());
  visit(ROUTES.progress());
  visit(ROUTES.transcript('abc-1'));
  visit(ROUTES.summary('abc-1'));
  visit(ROUTES.history());
  visit(ROUTES.settings());
  location.hash = '#/κάπου';
  router.start();
  assert.deepEqual(shown, [
    ['HOME', {}], ['PROGRESS', {}], ['TRANSCRIPT', { id: 'abc-1' }], ['SUMMARY', { id: 'abc-1' }], ['HISTORY', {}], ['SETTINGS', {}], ['fallback'],
  ]);
  assert.equal(hrefFor(ROUTES.transcript('a/b')), '#/t/a%2Fb', 'το αναγνωριστικό κωδικοποιείται');
});

test('διαδρομές: κάθε αναγνωριστικό αποκωδικοποιείται μία φορά, το χαλασμένο hash πάει στην εναλλακτική (API-017)', () => {
  const location = { hash: '' };
  const window = { location, addEventListener() {} };
  const shown = [];
  const router = new HashRouter({
    window,
    fallback: () => shown.push(['fallback']),
    routes: [
      { pattern: ROUTE_PATTERNS.TRANSCRIPT, show: params => shown.push(['TRANSCRIPT', params.id]) },
      { pattern: ROUTE_PATTERNS.SUMMARY, show: params => shown.push(['SUMMARY', params.id]) },
    ],
  });
  for (const id of ['50%', '%41', 'a b', 'ά/β', 'Σύσκεψη #3?']) {
    shown.length = 0;
    const path = ROUTES.transcript(id);
    location.hash = hrefFor(path);
    router.navigate(path);
    assert.deepEqual(shown, [['TRANSCRIPT', id]], id);
    assert.equal(router.currentPath, path, `ίδια μορφή με τα ROUTES: ${id}`);
    shown.length = 0;
    location.hash = hrefFor(ROUTES.summary(id));
    router.navigate(ROUTES.summary(id));
    assert.deepEqual(shown, [['SUMMARY', id]], id);
  }
  for (const broken of ['#/t/%', '#/t/%E0%A4%A', '#/t/abc%zz/summary']) {
    shown.length = 0;
    location.hash = broken;
    assert.doesNotThrow(() => router.start(), broken);
    assert.deepEqual(shown, [['fallback']], broken);
  }
  location.hash = '';
  assert.equal(router.currentPath, '/', 'χωρίς hash: η αρχική');
});

test('κοινή χρήση: το αρχείο παραλαμβάνεται μία φορά και το ?shared=1 φεύγει από τη διεύθυνση', async () => {
  const file = { name: 'Σύσκεψη.mp3' };
  const replaced = [];
  const history = { replaceState: (state, title, url) => replaced.push(url) };
  let taken = 0;
  const inbox = { takeFiles: async () => { taken += 1; return [file]; } };
  assert.equal(await takeSharedFile({ location: { href: 'https://app/?shared=1' }, history, inbox }), file);
  assert.deepEqual(replaced, ['/#/']);
  assert.equal(await takeSharedFile({ location: { href: 'https://app/?x=2&shared=1#/history' }, history, inbox }), file);
  assert.equal(replaced.at(-1), '/?x=2#/history');
  assert.equal(await takeSharedFile({ location: { href: 'https://app/#/history' }, history, inbox }), null);
  assert.equal(taken, 2, 'χωρίς ?shared=1 δεν ανοίγει η θυρίδα');
  const broken = { takeFiles: async () => { throw new Error('χωρίς Cache Storage'); } };
  assert.equal(await takeSharedFile({ location: { href: 'https://app/?shared=1' }, history, inbox: broken }), null);
});
