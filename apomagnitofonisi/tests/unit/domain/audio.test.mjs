import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingResampler } from '../../../src/domain/audio/streaming-resampler.js';
import { ChunkAssembler, findQuietestCut } from '../../../src/domain/audio/chunk-assembler.js';
import { downmixToMono, rms } from '../../../src/domain/audio/pcm.js';

function sine(rate, seconds, freq, amplitude = 0.5) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / rate);
  return out;
}

function resampleInChunks(input, inputRate, chunkSizes) {
  const r = new StreamingResampler({ inputRate, outputRate: 16000 });
  const parts = [];
  let offset = 0;
  let i = 0;
  while (offset < input.length) {
    const size = chunkSizes[i++ % chunkSizes.length];
    parts.push(r.process(input.subarray(offset, offset + size)));
    offset += size;
  }
  parts.push(r.flush());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

test('48 kHz → 16 kHz: σωστό μήκος, πλάτος και ίδιο αποτέλεσμα όποιο κι αν είναι το μέγεθος των κομματιών', () => {
  const input = sine(48000, 2, 440);
  const whole = resampleInChunks(input, 48000, [input.length]);
  const pieces = resampleInChunks(input, 48000, [1, 7, 1024, 333, 4096]);
  assert.equal(whole.length, 32000);
  assert.equal(pieces.length, whole.length);
  let maxDiff = 0;
  for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - pieces[i]));
  assert.ok(maxDiff < 1e-6, `συνέχεια ανάμεσα στα κομμάτια (διαφορά ${maxDiff})`);
  const level = rms(whole, 1000, 31000);
  assert.ok(Math.abs(level - 0.5 / Math.SQRT2) < 0.01, `πλάτος ${level}`);
  // Η φάση μένει σωστή: σύγκριση με ιδανικό ημίτονο στα 16 kHz.
  const ideal = sine(16000, 2, 440);
  let err = 0;
  for (let i = 1000; i < 31000; i++) err = Math.max(err, Math.abs(whole[i] - ideal[i]));
  assert.ok(err < 0.02, `σφάλμα έναντι ιδανικού ${err}`);
});

test('συχνότητες πάνω από 8 kHz κόβονται (χωρίς aliasing)', () => {
  const out = resampleInChunks(sine(48000, 1, 12000), 48000, [4096]);
  assert.ok(rms(out, 500, 15500) < 0.01, `διαρροή ${rms(out, 500, 15500)}`);
});

test('44,1 kHz, 8 kHz (αύξηση) και ίδια συχνότητα', () => {
  assert.equal(resampleInChunks(sine(44100, 1, 300), 44100, [1000]).length, 16000);
  const up = resampleInChunks(sine(8000, 1, 300), 8000, [500]);
  assert.equal(up.length, 16000);
  assert.ok(Math.abs(rms(up, 500, 15500) - 0.5 / Math.SQRT2) < 0.01);
  const same = new StreamingResampler({ inputRate: 16000 });
  assert.equal(same.process(new Float32Array([0.1, 0.2])).length, 2);
  assert.equal(same.flush().length, 0);
});

test('σάρωση συχνοτήτων σε μικρά κομμάτια χωρίς ασυνέχειες', () => {
  const rate = 44100;
  const input = new Float32Array(rate * 2);
  for (let i = 0; i < input.length; i++) {
    const t = i / rate;
    input[i] = 0.4 * Math.sin(2 * Math.PI * (100 * t + 900 * t * t));
  }
  const a = resampleInChunks(input, rate, [input.length]);
  const b = resampleInChunks(input, rate, [128, 129, 4000]);
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  assert.ok(maxDiff < 1e-6);
});

test('μετά το flush δεν δέχεται άλλα δείγματα', () => {
  const r = new StreamingResampler({ inputRate: 48000 });
  r.flush();
  assert.throws(() => r.process(new Float32Array(10)));
  assert.throws(() => new StreamingResampler({ inputRate: 0 }), RangeError);
});

test('downmix και rms', () => {
  const mono = downmixToMono([Float32Array.from([1, 0.5]), Float32Array.from([0, 0.5])]);
  assert.deepEqual(Array.from(mono), [0.5, 0.5]);
  assert.equal(downmixToMono([]).length, 0);
  assert.equal(rms(new Float32Array(0)), 0);
  assert.ok(Math.abs(rms(Float32Array.from([1, -1, 1, -1])) - 1) < 1e-9);
});

function speechWithPauses(seconds, pauseEverySec) {
  const rate = 16000;
  const out = sine(rate, seconds, 220, 0.3);
  for (let t = pauseEverySec; t < seconds; t += pauseEverySec) {
    const from = Math.round((t - 0.25) * rate);
    out.fill(0, from, from + Math.round(0.5 * rate));
  }
  return out;
}

test('τα παράθυρα κόβονται σε παύση ανάμεσα σε 18 και 28 s και καλύπτουν όλο τον ήχο', () => {
  const audio = speechWithPauses(70, 21);
  const assembler = new ChunkAssembler();
  const windows = [];
  for (let i = 0; i < audio.length; i += 4000) windows.push(...assembler.push(audio.subarray(i, i + 4000)));
  windows.push(...assembler.flush());
  const total = windows.reduce((n, w) => n + w.samples.length, 0);
  assert.equal(total, audio.length);
  for (const w of windows.slice(0, -1)) {
    const seconds = w.samples.length / 16000;
    assert.ok(seconds >= 18 && seconds <= 28, `${seconds}`);
  }
  assert.ok(Math.abs(windows[0].samples.length / 16000 - 21) < 0.3, `κόψιμο στην παύση ${windows[0].samples.length / 16000}`);
  for (let i = 1; i < windows.length; i++) {
    assert.ok(Math.abs(windows[i].startSec - (windows[i - 1].startSec + windows[i - 1].samples.length / 16000)) < 1e-9);
  }
  assert.ok(windows.every(w => !w.isSilent));
  assert.equal(assembler.pendingSamples, 0);
});

test('σιωπηλό παράθυρο σημειώνεται και μικρή σιωπηλή ουρά πετιέται', () => {
  const assembler = new ChunkAssembler();
  const silent = assembler.push(new Float32Array(16000 * 30));
  assert.equal(silent.length, 1);
  assert.equal(silent[0].isSilent, true);
  const rest = assembler.flush();
  assert.equal(rest.length, 1, 'ουρά 2 s: βγαίνει, σημειωμένη ως σιωπή');
  assert.equal(rest[0].isSilent, true);
  const tiny = new ChunkAssembler();
  tiny.push(new Float32Array(1000));
  assert.deepEqual(tiny.flush(), [], 'σιωπηλή ουρά κάτω από 0,3 s πετιέται');
});

test('το τέλος της ροής βγαίνει πάντα, ακόμη και μικρό, αν έχει ήχο', () => {
  const assembler = new ChunkAssembler();
  assembler.push(sine(16000, 0.1, 300));
  const tail = assembler.flush();
  assert.equal(tail.length, 1);
  assert.equal(tail[0].samples.length, 1600);
  assert.throws(() => new ChunkAssembler({ minWindowSec: 30, maxWindowSec: 28 }), RangeError);
});

test('το πιο ήσυχο σημείο', () => {
  const audio = sine(16000, 3, 200, 0.5);
  audio.fill(0, 16000 * 2, 16000 * 2 + 1600);
  const cut = findQuietestCut(audio, { sampleRate: 16000, fromSec: 1, toSec: 3, frameSec: 0.1 });
  assert.equal(cut, 16000 * 2 + 800);
});
