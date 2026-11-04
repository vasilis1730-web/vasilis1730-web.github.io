import test from 'node:test';
import assert from 'node:assert/strict';
import { SummaryService } from '../../../src/application/summary-service.js';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryInstruction, formatTranscriptForPrompt } from '../../../src/application/summary-prompts.js';
import { estimateSummaryCost, estimateTokens, EXPECTED_OUTPUT_TOKENS } from '../../../src/application/cost-estimate.js';
import { ERROR_CODES, INPUT_ISSUES } from '../../../src/application/errors.js';
import { createTranscript, SUMMARY_KINDS } from '../../../src/domain/transcript.js';
import { MemoryRepository, fixedClock, sequentialIds } from '../helpers/fakes.mjs';

const transcript = createTranscript({
  id: 't1', title: 'Συμβούλιο', createdAt: '2026-11-04T09:00:00.000Z',
  source: { fileName: 'a.m4a', mimeType: 'audio/mp4', sizeBytes: 1, durationSec: 3725 },
  languageCode: 'el', engine: { kind: 'elevenlabs', model: 'scribe_v2' },
  speakers: [{ id: 'S1', label: 'Πρόεδρος', colorIndex: 0 }],
  segments: [
    { id: 'seg-1', start: 1, end: 5, speakerId: 'S1', text: 'Καλημέρα, ξεκινάμε.' },
    { id: 'seg-2', start: 3700, end: 3705, speakerId: null, text: 'Τέλος.' },
  ],
});

test('το prompt: γραμμές με χρόνο και όνομα, και οδηγίες ανά είδος', () => {
  const text = formatTranscriptForPrompt(transcript, { unknownSpeaker: 'Άγνωστος ομιλητής' });
  assert.match(text, /^<μεταγραφή>\nΤίτλος: Συμβούλιο\nΔιάρκεια: 01:02:05\nΟμιλητές: Πρόεδρος\n/);
  assert.match(text, /\[00:00:01\] Πρόεδρος: Καλημέρα, ξεκινάμε\./);
  assert.match(text, /\[01:01:40\] Άγνωστος ομιλητής: Τέλος\./);
  assert.match(buildSummaryInstruction('minutes'), /## Αποφάσεις/);
  assert.match(buildSummaryInstruction('custom', ' Μόνο τα οικονομικά. '), /Μόνο τα οικονομικά\.$/);
  assert.throws(() => buildSummaryInstruction('custom', '  '), e => e.code === ERROR_CODES.INVALID_INPUT && e.details.reason === INPUT_ISSUES.EMPTY_INSTRUCTION, 'κενή οδηγία: τη διορθώνει ο χρήστης');
  assert.throws(() => buildSummaryInstruction('poem'), RangeError, 'άγνωστο είδος: λάθος του κώδικα');
  const untitled = formatTranscriptForPrompt({ ...transcript, title: '' }, { unknownSpeaker: '?' });
  assert.doesNotMatch(untitled, /Τίτλος:/, 'χωρίς τίτλο, χωρίς γραμμή τίτλου');
  assert.match(SUMMARY_SYSTEM_PROMPT, /άνω τελεία/);
  for (const t of [SUMMARY_SYSTEM_PROMPT, buildSummaryInstruction('brief'), buildSummaryInstruction('minutes'), buildSummaryInstruction('actions')]) {
    assert.doesNotMatch(t, new RegExp(`[${String.fromCharCode(0x387, 0xb7)}]`));
  }
});

test('κάθε είδος περίληψης έχει οδηγία και αναμενόμενο μήκος απάντησης', () => {
  for (const kind of Object.values(SUMMARY_KINDS)) {
    assert.ok(buildSummaryInstruction(kind, 'Οδηγία.').length > 10, kind);
    assert.ok(EXPECTED_OUTPUT_TOKENS[kind] > 0, kind);
  }
  assert.deepEqual(Object.keys(EXPECTED_OUTPUT_TOKENS).sort(), Object.values(SUMMARY_KINDS).sort());
  assert.throws(() => estimateSummaryCost({ inputTokens: 1, kind: 'poem', pricing: { inputUsdPerMTok: 1, outputUsdPerMTok: 1 } }), RangeError);
});

test('εκτίμηση κόστους, και η υψηλότερη τιμή του Haiku πάνω από 100K tokens', () => {
  assert.equal(estimateTokens('α'.repeat(27)), 10);
  const opus = estimateSummaryCost({ inputTokens: 100_000, kind: 'minutes', pricing: { inputUsdPerMTok: 4, outputUsdPerMTok: 20 } });
  assert.equal(opus.outputTokens, 3500);
  assert.ok(Math.abs(opus.usd - (0.4 + 0.07)) < 1e-9);
  const haiku = { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, longPrompt: { thresholdTokens: 100_000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 } };
  assert.ok(estimateSummaryCost({ inputTokens: 200_000, kind: 'brief', pricing: haiku }).usd > estimateSummaryCost({ inputTokens: 99_000, kind: 'brief', pricing: haiku }).usd * 4);
});

test('περίληψη: στέλνει prompt, μεταφέρει το κείμενο και αποθηκεύει', async () => {
  const requests = [];
  const summarizer = {
    async summarize(request) {
      requests.push(request);
      request.onText?.('## Περίληψη\n');
      request.onText?.('Έγινε συνεδρίαση.');
      return { text: '## Περίληψη\nΈγινε συνεδρίαση.', modelId: 'claude-opus-5-5', truncated: true, restarted: false };
    },
  };
  const repository = new MemoryRepository();
  const service = new SummaryService({ summarizer, repository, clock: fixedClock('2026-11-04T12:00:00.000Z'), idGenerator: sequentialIds('s'), unknownSpeakerLabel: 'Άγνωστος ομιλητής' });
  const streamed = [];
  const { transcript: updated, summary, restarted } = await service.summarize(transcript, { kind: 'brief', modelId: 'claude-opus-5-5', onText: d => streamed.push(d) });
  assert.equal(restarted, false);
  assert.equal(streamed.join(''), '## Περίληψη\nΈγινε συνεδρίαση.');
  assert.equal(requests[0].systemPrompt, SUMMARY_SYSTEM_PROMPT);
  assert.equal(requests[0].modelId, 'claude-opus-5-5');
  assert.match(requests[0].transcriptText, /Πρόεδρος: Καλημέρα/);
  assert.deepEqual(summary, { id: 's-1', kind: 'brief', model: 'claude-opus-5-5', createdAt: '2026-11-04T12:00:00.000Z', text: '## Περίληψη\nΈγινε συνεδρίαση.', truncated: true });
  assert.equal(updated.summaries[0].id, 's-1');
  assert.equal((await repository.findById('t1')).summaries.length, 1);
  const cost = service.estimateCost(transcript, { kind: 'minutes', modelId: 'claude-haiku-5-5' });
  assert.ok(cost.usd > 0 && cost.inputTokens > 50);
});

test('περίληψη: εφεδρικό μοντέλο, και η οδηγία του χρήστη αποθηκεύεται', async () => {
  const summarizer = { async summarize(request) { request.onRestart?.(); return { text: 'Κείμενο.', modelId: 'claude-opus-4-8', truncated: false, restarted: true }; } };
  const service = new SummaryService({ summarizer, repository: new MemoryRepository(), clock: fixedClock(), idGenerator: sequentialIds('s'), unknownSpeakerLabel: '?' });
  let restarts = 0;
  const outcome = await service.summarize(transcript, { kind: 'custom', customInstruction: '  Μόνο τα οικονομικά. ', modelId: 'claude-opus-5-5', onRestart: () => { restarts += 1; } });
  assert.equal(restarts, 1);
  assert.equal(outcome.restarted, true);
  assert.equal(outcome.summary.model, 'claude-opus-4-8', 'το μοντέλο που απάντησε τελικά');
  assert.equal(outcome.summary.instruction, 'Μόνο τα οικονομικά.');
  assert.equal('truncated' in outcome.summary, false);
});

test('περίληψη: άγνωστο μοντέλο, κενή οδηγία, κενή μεταγραφή και σφάλμα παρόχου', async () => {
  let calls = 0;
  const service = new SummaryService({
    summarizer: { async summarize() { calls += 1; throw Object.assign(new Error('x'), { name: 'AbortError' }); } },
    repository: new MemoryRepository(), clock: fixedClock(), idGenerator: sequentialIds(), unknownSpeakerLabel: '?',
  });
  await assert.rejects(service.summarize(transcript, { kind: 'brief', modelId: 'gpt' }), RangeError, 'άγνωστο μοντέλο: λάθος του κώδικα');
  assert.throws(() => service.estimateCost(transcript, { kind: 'brief', modelId: 'gpt' }), RangeError);
  await assert.rejects(service.summarize(transcript, { kind: 'custom', customInstruction: '', modelId: 'claude-opus-5-5' }), e => e.code === ERROR_CODES.INVALID_INPUT && e.details.reason === INPUT_ISSUES.EMPTY_INSTRUCTION);
  await assert.rejects(service.summarize({ ...transcript, segments: [] }, { kind: 'brief', modelId: 'claude-opus-5-5' }), e => e.code === ERROR_CODES.EMPTY_TRANSCRIPT);
  assert.equal(calls, 0, 'τίποτα δεν στέλνεται στον πάροχο');
  await assert.rejects(service.summarize(transcript, { kind: 'brief', modelId: 'claude-opus-5-5' }), e => e.code === ERROR_CODES.CANCELLED);
  assert.equal(service.estimateCost(transcript, { kind: 'custom', customInstruction: '', modelId: 'claude-opus-5-5' }).outputTokens, 2500);
});
