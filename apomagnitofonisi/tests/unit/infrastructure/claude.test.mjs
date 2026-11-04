import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeSummarizer, buildMessagesRequest } from '../../../src/infrastructure/anthropic/claude-summarizer.js';
import { AnthropicKeyVerifier } from '../../../src/infrastructure/anthropic/anthropic-key-verifier.js';
import { ERROR_CODES } from '../../../src/application/errors.js';
import { KEY_PROVIDERS } from '../../../src/application/key-providers.js';

/** Ψεύτικο SDK με τις ίδιες κλάσεις σφαλμάτων και το ίδιο σχήμα ροής με το @anthropic-ai/sdk. */
function fakeSdk({ events = [], final, error } = {}) {
  class APIError extends Error { constructor(status, message) { super(message); this.status = status; } }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class APIUserAbortError extends APIError {}
  const record = { constructed: [], requests: [] };
  class Anthropic {
    constructor(options) {
      record.constructed.push(options);
      this.beta = { messages: { stream: (params, requestOptions) => {
        record.requests.push({ params, requestOptions });
        const listeners = {};
        return {
          on(name, fn) { (listeners[name] ||= []).push(fn); return this; },
          async finalMessage() {
            if (error) throw error;
            for (const event of events) {
              for (const fn of listeners.streamEvent || []) fn(event);
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') for (const fn of listeners.text || []) fn(event.delta.text);
            }
            return final;
          },
        };
      } } };
      this.models = { list: async () => { if (error) throw error; return { data: [] }; } };
    }
  }
  return {
    record,
    module: { default: Anthropic, APIError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError, APIConnectionError, APIUserAbortError },
  };
}

const request = { systemPrompt: 'Σύστημα', transcriptText: '<μεταγραφή>…</μεταγραφή>', promptInstruction: 'Γράψε πρακτικά.', modelId: 'claude-opus-5-5' };
const textEvent = text => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });

test('το αίτημα: μεταγραφή με cache_control, effort, εφεδρεία μόνο όπου υποστηρίζεται, χωρίς thinking/temperature', () => {
  const opus = buildMessagesRequest(request);
  assert.equal(opus.model, 'claude-opus-5-5');
  assert.equal(opus.max_tokens, 64000);
  assert.deepEqual(opus.output_config, { effort: 'medium' });
  assert.deepEqual(opus.system, [{ type: 'text', text: 'Σύστημα' }]);
  assert.deepEqual(opus.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(opus.messages[0].content[1].text, 'Γράψε πρακτικά.');
  assert.deepEqual(opus.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(opus.fallbacks, 'default');
  for (const field of ['thinking', 'temperature', 'top_p', 'top_k']) assert.equal(field in opus, false);
  const haiku = buildMessagesRequest({ ...request, modelId: 'claude-haiku-5-5' });
  assert.equal('fallbacks' in haiku, false);
  assert.equal('betas' in haiku, false);
  assert.deepEqual(buildMessagesRequest({ ...request, modelId: 'claude-sonnet-5-5' }).betas, ['server-side-fallback-2026-07-01']);
});

test('ροή κειμένου, κλειδί στον browser και τελικό κείμενο', async () => {
  const { module, record } = fakeSdk({
    events: [textEvent('## Πρακτικά\n'), textEvent('Έγινε.')],
    final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '## Πρακτικά\nΈγινε.' }] },
  });
  const summarizer = new ClaudeSummarizer({ loadSdk: async () => module, getApiKey: () => 'sk-ant-user' });
  const controller = new AbortController();
  const streamed = [];
  const result = await summarizer.summarize({ ...request, signal: controller.signal, onText: d => streamed.push(d) });
  assert.deepEqual(record.constructed, [{ apiKey: 'sk-ant-user', dangerouslyAllowBrowser: true }]);
  assert.equal(record.requests[0].requestOptions.signal, controller.signal);
  assert.equal(streamed.join(''), '## Πρακτικά\nΈγινε.');
  assert.deepEqual(result, { text: '## Πρακτικά\nΈγινε.', modelId: 'claude-opus-5-5', truncated: false, restarted: false });
});

test('εφεδρικό μοντέλο: νέα αρχή και κείμενο μόνο μετά το μπλοκ fallback', async () => {
  const { module } = fakeSdk({
    events: [textEvent('Μισό'), { type: 'content_block_start', index: 1, content_block: { type: 'fallback' } }, textEvent('Ολόκληρο')],
    final: { model: 'claude-opus-4-8', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Μισό' }, { type: 'fallback' }, { type: 'text', text: 'Ολόκληρο' }] },
  });
  let restarts = 0;
  const result = await new ClaudeSummarizer({ loadSdk: async () => module, getApiKey: () => 'k' }).summarize({ ...request, onRestart: () => { restarts += 1; } });
  assert.equal(restarts, 1);
  assert.deepEqual(result, { text: 'Ολόκληρο', modelId: 'claude-opus-4-8', truncated: true, restarted: true }, 'το μοντέλο που απάντησε τελικά');
});

test('άρνηση, χωρίς κλειδί και σφάλματα του SDK', async () => {
  const refusing = fakeSdk({ final: { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] } });
  await assert.rejects(new ClaudeSummarizer({ loadSdk: async () => refusing.module, getApiKey: () => 'k' }).summarize(request), e => e.code === ERROR_CODES.REFUSED);
  await assert.rejects(new ClaudeSummarizer({ loadSdk: async () => refusing.module, getApiKey: () => null }).summarize(request), e => e.code === ERROR_CODES.KEY_MISSING);
  const sdk = fakeSdk().module;
  const cases = [
    [new sdk.AuthenticationError(401, 'invalid x-api-key'), ERROR_CODES.KEY_INVALID],
    [new sdk.RateLimitError(429, 'slow down'), ERROR_CODES.RATE_LIMITED],
    [new sdk.APIError(529, 'overloaded'), ERROR_CODES.OVERLOADED],
    [new sdk.APIConnectionError(undefined, 'offline'), ERROR_CODES.NETWORK],
    [new sdk.APIUserAbortError(undefined, 'aborted'), ERROR_CODES.CANCELLED],
    [new sdk.BadRequestError(400, 'Your credit balance is too low'), ERROR_CODES.PROVIDER_REJECTED],
    [new sdk.APIError(404, 'model not found'), ERROR_CODES.PROVIDER_REJECTED],
    [new sdk.APIError(500, 'internal'), ERROR_CODES.UNKNOWN],
  ];
  for (const [error, code] of cases) {
    const failing = fakeSdk({ error });
    failing.module.APIError = sdk.APIError;
    Object.assign(failing.module, sdk);
    failing.module.default = fakeSdk({ error }).module.default;
    await assert.rejects(new ClaudeSummarizer({ loadSdk: async () => failing.module, getApiKey: () => 'k' }).summarize(request), e => e.code === code, code);
  }
  const lowCredit = fakeSdk();
  const rejecting = { ...lowCredit.module, default: fakeSdk({ error: new lowCredit.module.BadRequestError(400, 'Your credit balance is too low') }).module.default };
  await assert.rejects(new ClaudeSummarizer({ loadSdk: async () => rejecting, getApiKey: () => 'k' }).summarize(request),
    e => e.code === ERROR_CODES.PROVIDER_REJECTED && e.details.providerMessage === 'Your credit balance is too low', 'το μήνυμα του παρόχου φτάνει στον χρήστη');
});

test('διαθεσιμότητα: χωρίς κλειδί Anthropic δεν γράφεται περίληψη (OO-015)', async () => {
  const sdk = fakeSdk().module;
  assert.deepEqual(await new ClaudeSummarizer({ loadSdk: async () => sdk, getApiKey: () => null }).checkAvailability(), { available: false, reason: ERROR_CODES.KEY_MISSING });
  assert.deepEqual(await new ClaudeSummarizer({ loadSdk: async () => sdk, getApiKey: () => 'k' }).checkAvailability(), { available: true });
});

test('έλεγχος κλειδιού Anthropic', async () => {
  const ok = fakeSdk();
  assert.equal(new AnthropicKeyVerifier({ loadSdk: async () => ok.module }).provider, KEY_PROVIDERS.ANTHROPIC);
  await new AnthropicKeyVerifier({ loadSdk: async () => ok.module }).verify('k');
  const bad = fakeSdk();
  const failing = { ...bad.module, default: fakeSdk({ error: new bad.module.AuthenticationError(401, 'x') }).module.default };
  await assert.rejects(new AnthropicKeyVerifier({ loadSdk: async () => failing }).verify('k'), e => e.code === ERROR_CODES.KEY_INVALID);
});
