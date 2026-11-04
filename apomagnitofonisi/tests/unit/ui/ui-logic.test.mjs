/**
 * Η λογική της διεπαφής που δεν θέλει DOM: πληρότητα των κειμένων για κάθε
 * κλειστό σύνολο τιμών (κωδικοί σφαλμάτων, αιτίες, μηχανές, μορφές, είδη,
 * στόχοι διαγραφής), μηνύματα σφαλμάτων, διαδρομές και παραλαβή αρχείου από
 * κοινή χρήση.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, errorMessage, exportFormatLabel, qualityLabel, speakerLabelFor } from '../../../src/ui/strings.js';
import { describeError, runAction } from '../../../src/ui/feedback.js';
import { createExportLabels, describeEngine, displayTitle, engineShortName, summaryFileSuffixFor } from '../../../src/ui/presentation.js';
import { ROUTE_PATTERNS, ROUTES, hrefFor } from '../../../src/ui/routes.js';
import { HashRouter } from '../../../src/ui/router.js';
import { takeSharedFile } from '../../../src/ui/launch-intake.js';
import { AppError, ERROR_CODES, INPUT_ISSUES, invalidInput } from '../../../src/application/errors.js';
import { EXPORT_FORMATS } from '../../../src/application/export-formats.js';
import { ERASE_TARGETS } from '../../../src/application/data-erasure-service.js';
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

test('ενέργειες: μήνυμα επιτυχίας, μήνυμα σφάλματος, σιωπή στην ακύρωση', async () => {
  const shown = [];
  const toasts = { show: (message, options) => shown.push([message, options.tone]) };
  assert.equal(await runAction(toasts, () => 42, { success: 'Έγινε.' }), 42);
  assert.equal(await runAction(toasts, async () => { throw invalidInput(INPUT_ISSUES.EMPTY_KEY); }), undefined);
  assert.equal(await runAction(toasts, async () => { throw new AppError(ERROR_CODES.CANCELLED); }), undefined);
  assert.equal(await runAction(toasts, () => { throw new DOMException('x', 'AbortError'); }), undefined);
  assert.deepEqual(shown, [['Έγινε.', 'success'], [STRINGS.inputIssues[INPUT_ISSUES.EMPTY_KEY], 'error']]);
  const logged = [];
  const original = console.error;
  console.error = error => logged.push(error);
  try {
    await runAction(toasts, () => { throw new TypeError('bug'); });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1, 'τα λάθη του κώδικα φαίνονται και στην κονσόλα');
  assert.deepEqual(shown.at(-1), [STRINGS.errors.UNKNOWN, 'error']);
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
