import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterEmbeddings, fillMissingLabels } from '../../../src/domain/diarization/speaker-clustering.js';

/** Ψευδοτυχαίοι αριθμοί με σπόρο, για ντετερμινιστικά δεδομένα. */
function random(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function voices(count, dims, seed) {
  const rnd = random(seed);
  return Array.from({ length: count }, () => Array.from({ length: dims }, () => rnd() * 2 - 1));
}

function around(center, noise, rnd) {
  return center.map(v => v + (rnd() * 2 - 1) * noise);
}

test('τρεις φωνές με θόρυβο: σωστές ομάδες με όριο απόστασης και με γνωστό πλήθος', () => {
  const centers = voices(3, 64, 7);
  const rnd = random(99);
  const order = [0, 0, 1, 0, 2, 2, 1, 0, 1, 2, 0, 1];
  const embeddings = order.map(i => around(centers[i], 0.15, rnd));
  const expected = [0, 0, 1, 0, 2, 2, 1, 0, 1, 2, 0, 1];
  assert.deepEqual(clusterEmbeddings(embeddings), expected);
  assert.deepEqual(clusterEmbeddings(embeddings, { speakerCount: 3 }), expected);
  const two = clusterEmbeddings(embeddings, { speakerCount: 2 });
  assert.equal(new Set(two).size, 2);
  assert.equal(two[0], 0);
});

test('γνωστό πλήθος μεγαλύτερο από τα τμήματα, ένα τμήμα και κανένα', () => {
  assert.deepEqual(clusterEmbeddings([[1, 0], [0, 1]], { speakerCount: 5 }), [0, 1]);
  assert.deepEqual(clusterEmbeddings([[1, 0]]), [0]);
  assert.deepEqual(clusterEmbeddings([]), []);
});

test('ντετερμινιστικό: ίδια είσοδος, ίδιο αποτέλεσμα', () => {
  const rnd = random(5);
  const embeddings = Array.from({ length: 200 }, () => Array.from({ length: 32 }, () => rnd()));
  assert.deepEqual(clusterEmbeddings(embeddings, { speakerCount: 4 }), clusterEmbeddings(embeddings, { speakerCount: 4 }));
});

test('μεγάλη σύσκεψη (1.500 τμήματα) σε λογικό χρόνο', () => {
  const centers = voices(5, 192, 11);
  const rnd = random(12);
  const embeddings = Array.from({ length: 1500 }, (_, i) => around(centers[i % 5], 0.2, rnd));
  const started = performance.now();
  const labels = clusterEmbeddings(embeddings);
  const elapsed = performance.now() - started;
  assert.equal(new Set(labels).size, 5);
  assert.ok(elapsed < 8000, `${elapsed} ms`);
});

test('τα μικρά τμήματα παίρνουν τον ομιλητή του κοντινότερου τμήματος', () => {
  const segments = [
    { start: 0, end: 5 }, { start: 5.1, end: 5.6 }, { start: 9, end: 12 }, { start: 12.5, end: 12.9 }, { start: 20, end: 21 },
  ];
  assert.deepEqual(fillMissingLabels([0, null, 1, null, null], segments), [0, 0, 1, 1, 1]);
  assert.deepEqual(fillMissingLabels([null, null], segments.slice(0, 2)), [0, 0]);
  assert.throws(() => fillMissingLabels([0], segments), RangeError);
});
