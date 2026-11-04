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
