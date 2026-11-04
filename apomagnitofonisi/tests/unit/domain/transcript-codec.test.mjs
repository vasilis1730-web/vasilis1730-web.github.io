import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscript } from '../../../src/domain/transcript.js';
import { serializeTranscript, deserializeTranscript, TranscriptFileError } from '../../../src/domain/transcript-codec.js';

const transcript = createTranscript({
  id: 't1', title: 'Δοκιμή', createdAt: '2026-11-04T10:00:00.000Z',
  source: { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10, durationSec: 2 },
  languageCode: 'el', engine: { kind: 'local', model: 'onnx-community/whisper-base' },
  speakers: [{ id: 'S1', label: 'Α', colorIndex: 0 }],
  segments: [{ id: 'seg-1', start: 0, end: 2, speakerId: 'S1', text: 'Γεια.' }],
});

test('μεταγραφή → JSON → μεταγραφή χωρίς απώλειες', () => {
  const text = serializeTranscript(transcript, { exportedAt: '2026-11-04T11:00:00.000Z', appVersion: '1.0.0' });
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'apomagnitofonisi-transcript');
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(deserializeTranscript(text), transcript);
});

test('άκυρα αρχεία απορρίπτονται με TranscriptFileError', () => {
  assert.throws(() => deserializeTranscript('{'), TranscriptFileError);
  assert.throws(() => deserializeTranscript('{"format":"other"}'), TranscriptFileError);
  assert.throws(() => deserializeTranscript('{"format":"apomagnitofonisi-transcript","schemaVersion":99}'), TranscriptFileError);
  assert.throws(() => deserializeTranscript(JSON.stringify({ format: 'apomagnitofonisi-transcript', schemaVersion: 1, transcript: { id: '' } })), TranscriptFileError);
});

test('άκυρες ημερομηνίες απορρίπτονται στην εισαγωγή, όχι αργότερα στην εξαγωγή (API-027)', () => {
  const file = changes => serializeTranscript({ ...transcript, ...changes }, { exportedAt: '2026-11-04T11:00:00.000Z', appVersion: '1.0.0' });
  assert.throws(() => deserializeTranscript(file({ createdAt: 'χθες' })), /μη έγκυρη ημερομηνία στο createdAt/);
  assert.throws(() => deserializeTranscript(file({ updatedAt: 'ποτέ' })), /μη έγκυρη ημερομηνία στο updatedAt/);
  assert.throws(() => deserializeTranscript(file({ summaries: [{ id: 's1', kind: 'brief', model: 'm', createdAt: '', text: 'x' }] })), TranscriptFileError, 'περίληψη χωρίς ημερομηνία');
  assert.throws(() => deserializeTranscript(file({ summaries: [{ id: 's1', kind: 'brief', model: 'm', createdAt: '31/12', text: 'x' }] })), /summary\.createdAt/);
  assert.doesNotThrow(() => deserializeTranscript(file({ summaries: [{ id: 's1', kind: 'brief', model: 'm', createdAt: '2026-11-04T12:00:00.000Z', text: 'x' }] })));
});
