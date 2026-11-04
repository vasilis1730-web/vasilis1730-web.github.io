import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatCompactClock, formatSrtTimestamp, formatVttTimestamp } from '../../../src/domain/time-format.js';

test('μορφές χρόνου', () => {
  assert.equal(formatClock(0), '00:00:00');
  assert.equal(formatClock(3723.4), '01:02:03');
  assert.equal(formatCompactClock(65), '1:05');
  assert.equal(formatCompactClock(3723), '1:02:03');
  assert.equal(formatSrtTimestamp(62.3456), '00:01:02,346');
  assert.equal(formatVttTimestamp(62.3456), '00:01:02.346');
  assert.equal(formatSrtTimestamp(-5), '00:00:00,000');
  assert.equal(formatVttTimestamp(Number.NaN), '00:00:00.000');
  assert.equal(formatSrtTimestamp(359999.9995), '100:00:00,000');
});
