/**
 * Η μεταγραφή που τρέχει (TranscriptionJob) μαζί με την πραγματική υπηρεσία
 * μεταγραφής και τη διαγραφή δεδομένων: καταστάσεις, ακύρωση με αναμονή
 * (cancelAndSettle), και «Διαγραφή όλων» όσο τρέχει μεταγραφή, που δεν πρέπει
 * να αφήνει τίποτα αποθηκευμένο (OO-014, CA-013).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptionJob, JOB_STATUSES } from '../../../src/ui/transcription-job.js';
import { TranscriptionService } from '../../../src/application/transcription-service.js';
import { DataErasureService } from '../../../src/application/data-erasure-service.js';
import { ERASE_TARGETS } from '../../../src/application/erase-targets.js';
import { AppError, ERROR_CODES } from '../../../src/application/errors.js';
import { ENGINE_KINDS } from '../../../src/domain/transcript.js';
import { MemoryRepository, fixedClock, sequentialIds, fakeMedia } from '../helpers/fakes.mjs';

const RESULT = Object.freeze({ segments: [{ start: 0, end: 1, text: 'Καλημέρα.' }], languageCode: 'el', durationSec: 1, modelId: 'scribe_v2' });
const REQUEST = Object.freeze({
  media: fakeMedia(),
  engineKind: ENGINE_KINDS.ELEVENLABS,
  options: { languageCode: 'el', diarize: false, expectedSpeakers: null, localQuality: 'auto' },
  textOptions: { removeAnoTeleia: true },
});

const noWakeLock = { acquire: async () => {}, release: async () => {} };

/**
 * Μηχανή που «τρέχει» μέχρι να την αφήσει το test, ή μέχρι την ακύρωση. Στη
 * χειρότερη περίπτωση (ignoreAbort) δεν σταματά στην ακύρωση και τελειώνει
 * κανονικά, όπως μια μηχανή που δεν ελέγχει το signal.
 */
class HeldEngine {
  kind = ENGINE_KINDS.ELEVENLABS;
  #finish = null;

  constructor({ ignoreAbort = false } = {}) {
    this.ignoreAbort = ignoreAbort;
    this.started = new Promise(resolve => { this.markStarted = resolve; });
  }

  async checkAvailability() { return { available: true }; }

  recognize({ signal, onProgress }) {
    onProgress?.({ stage: 'uploading', fraction: 0.5 });
    this.markStarted();
    return new Promise((resolve, reject) => {
      this.#finish = () => resolve(RESULT);
      signal.addEventListener('abort', () => {
        if (this.ignoreAbort) resolve(RESULT);
        else reject(new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε'));
      }, { once: true });
    });
  }

  finish() { this.#finish(); }
}

function setup(engine, repository = new MemoryRepository()) {
  const service = new TranscriptionService({ engines: [engine], repository, clock: fixedClock(), idGenerator: sequentialIds('t'), speakerLabelFor: n => `Ομιλητής ${n}` });
  const job = new TranscriptionJob({ service, wakeLock: noWakeLock });
  return { job, repository };
}

/** Όλοι οι στόχοι διαγραφής, με καταγραφή της σειράς. */
function erasure(job, repository, events) {
  const targets = Object.values(ERASE_TARGETS).map(name => ({
    name,
    erase: async () => {
      events.push(`erase:${name}`);
      if (name === ERASE_TARGETS.TRANSCRIPTS) await repository.clear();
    },
  }));
  return new DataErasureService({ beforeErase: [() => job.cancelAndSettle()], targets });
}

test('μεταγραφή: τρέχει, ολοκληρώνεται, και δεύτερη έναρξη όσο τρέχει απορρίπτεται', async () => {
  const engine = new HeldEngine();
  const { job, repository } = setup(engine);
  const statuses = [];
  job.subscribe(state => { if (statuses.at(-1) !== state.status) statuses.push(state.status); });
  const running = job.start(REQUEST);
  assert.equal(job.isRunning, true, 'τρέχει αμέσως, πριν από κάθε αναμονή');
  await assert.rejects(job.start(REQUEST), /τρέχει ήδη/);
  await engine.started;
  engine.finish();
  const final = await running;
  assert.equal(final.status, JOB_STATUSES.DONE);
  assert.equal(final.transcript.segments[0].text, 'Καλημέρα.');
  assert.equal(repository.saves, 1);
  assert.deepEqual(statuses, [JOB_STATUSES.IDLE, JOB_STATUSES.RUNNING, JOB_STATUSES.DONE]);
  assert.equal((await job.cancelAndSettle()).status, JOB_STATUSES.DONE, 'χωρίς μεταγραφή που τρέχει: η τρέχουσα κατάσταση');
});

test('cancelAndSettle: ακυρώνει και περιμένει το τέλος της μεταγραφής', async () => {
  const engine = new HeldEngine();
  const { job, repository } = setup(engine);
  const running = job.start(REQUEST);
  await engine.started;
  const settled = await job.cancelAndSettle();
  assert.equal(settled.status, JOB_STATUSES.CANCELLED);
  assert.equal(job.isRunning, false);
  assert.equal(await running, settled, 'η ίδια τελική κατάσταση με το start()');
  assert.equal(repository.saves, 0);
});

test('«Διαγραφή όλων» όσο τρέχει μεταγραφή: πρώτα σταματά, μετά σβήνει, και δεν μένει τίποτα (OO-014, CA-013)', async () => {
  // Η χειρότερη περίπτωση: η μηχανή αγνοεί την ακύρωση και επιστρέφει κανονικά αποτέλεσμα.
  const engine = new HeldEngine({ ignoreAbort: true });
  const { job, repository } = setup(engine);
  const events = [];
  job.subscribe(state => { if (state.status !== JOB_STATUSES.RUNNING && state.status !== JOB_STATUSES.IDLE) events.push(`job:${state.status}`); });
  const running = job.start(REQUEST);
  await engine.started;
  await erasure(job, repository, events).eraseAll();
  assert.equal(events[0], `job:${JOB_STATUSES.CANCELLED}`, 'η μεταγραφή σταμάτησε πριν σβηστεί οτιδήποτε');
  assert.equal(events.length, 1 + Object.values(ERASE_TARGETS).length);
  assert.equal((await running).status, JOB_STATUSES.CANCELLED);
  assert.equal(repository.saves, 0, 'η ακυρωμένη μεταγραφή δεν αποθηκεύτηκε');
  assert.deepEqual(await repository.listNewestFirst(), []);
});

test('«Διαγραφή όλων» όταν η μεταγραφή είναι ήδη στην αποθήκευση: περιμένει να τελειώσει και τη σβήνει', async () => {
  // Η αποθήκευση έχει ξεκινήσει όταν πατιέται η διαγραφή: δεν ακυρώνεται, αλλά η διαγραφή την περιμένει.
  let releaseSave;
  const repository = new MemoryRepository();
  const save = repository.save.bind(repository);
  const saving = new Promise(resolve => {
    repository.save = async transcript => { resolve(); await new Promise(release => { releaseSave = release; }); await save(transcript); };
  });
  const engine = new HeldEngine();
  const { job } = setup(engine, repository);
  const running = job.start(REQUEST);
  await engine.started;
  engine.finish();
  await saving;
  const erased = erasure(job, repository, []).eraseAll();
  releaseSave();
  await erased;
  assert.equal((await running).status, JOB_STATUSES.DONE);
  assert.equal(repository.saves, 1);
  assert.deepEqual(await repository.listNewestFirst(), [], 'η μεταγραφή σβήστηκε μετά την αποθήκευσή της');
});

test('σφάλμα μηχανής: αποτυχία με κωδικό, και στην κονσόλα μόνο τα απρόσμενα (API-020)', async () => {
  const failing = kindError => ({
    kind: ENGINE_KINDS.ELEVENLABS,
    checkAvailability: async () => ({ available: true }),
    recognize: async () => { throw kindError; },
  });
  const logged = [];
  const original = console.error;
  console.error = error => logged.push(error);
  try {
    const known = await setup(failing(new AppError(ERROR_CODES.QUOTA_EXCEEDED))).job.start(REQUEST);
    assert.equal(known.status, JOB_STATUSES.FAILED);
    assert.equal(known.error.code, ERROR_CODES.QUOTA_EXCEEDED);
    const bug = new TypeError('undefined is not a function');
    const unexpected = await setup(failing(bug)).job.start(REQUEST);
    assert.equal(unexpected.error.code, ERROR_CODES.UNKNOWN);
    assert.deepEqual(logged, [bug], 'μόνο το απρόσμενο, με την αρχική αιτία');
  } finally {
    console.error = original;
  }
});
