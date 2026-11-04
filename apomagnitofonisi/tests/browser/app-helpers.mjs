/**
 * Βοηθήματα για τα tests της εφαρμογής σε πραγματικό Chromium: ψεύτικες
 * απαντήσεις ElevenLabs και Anthropic (με CORS, όπως οι πραγματικές),
 * δοκιμαστικό αρχείο WAV χωρίς δίκτυο και ανάγνωση των αρχείων εξαγωγής.
 */
import zlib from 'node:zlib';

// Ο Chromium γράφει ελληνικά ονόματα αρχείων (λήψεις, επιλογή αρχείων) μόνο με
// locale UTF-8. Ο runner του GitHub έχει ήδη C.UTF-8, ένα σκέτο container όχι.
if (!process.env.LANG && !process.env.LC_ALL) process.env.LANG = 'C.UTF-8';

/**
 * WAV 16 kHz ένα κανάλι με ημίτονο, ως αρχείο για το page.setInputFiles().
 * Δίνεται ως buffer με όνομα (όχι διαδρομή), ώστε τα ελληνικά ονόματα να
 * φτάνουν σωστά ανεξάρτητα από το locale του συστήματος αρχείων.
 */
export function toneWavFile(name, seconds = 2) {
  const rate = 16000;
  const frames = rate * seconds;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + frames * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  return { name, mimeType: 'audio/wav', buffer };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': '*',
  };
}

/**
 * Ψεύτικο api.elevenlabs.io: /v1/user (έλεγχος κλειδιού) και /v1/speech-to-text.
 * Καταγράφει τα αιτήματα (headers και πεδία) για έλεγχο από το test.
 */
export async function mockElevenLabs(page, base, { words, languageCode = 'ell', durationSec = 2 }) {
  const calls = [];
  await page.route('https://api.elevenlabs.io/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: corsHeaders(base) }); return; }
    const url = new URL(request.url());
    calls.push({ path: url.pathname, method: request.method(), headers: request.headers(), body: request.postDataBuffer() });
    if (url.pathname === '/v1/user') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(base), body: JSON.stringify({ subscription: { tier: 'creator' } }) });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: corsHeaders(base),
      body: JSON.stringify({ language_code: languageCode, language_probability: 0.99, text: words.map(w => w.text).join(' '), words, audio_duration_secs: durationSec }),
    });
  });
  return calls;
}

/** Ροή SSE όπως του Messages API, που τη διαβάζει το @anthropic-ai/sdk. */
export function messagesStream(chunks, { model = 'claude-opus-5-5', stopReason = 'end_turn' } = {}) {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...chunks.map(text => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 42 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

/** Ψεύτικο api.anthropic.com: /v1/models (έλεγχος κλειδιού) και /v1/messages (ροή). */
export async function mockAnthropic(page, base, { chunks }) {
  const calls = [];
  await page.route('https://api.anthropic.com/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: corsHeaders(base) }); return; }
    const url = new URL(request.url());
    calls.push({ path: url.pathname, search: url.search, headers: request.headers(), json: request.postData() ? JSON.parse(request.postData()) : null });
    if (url.pathname === '/v1/models') {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(base), body: JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) });
      return;
    }
    await route.fulfill({ status: 200, headers: { ...corsHeaders(base), 'Content-Type': 'text/event-stream' }, body: messagesStream(chunks) });
  });
  return calls;
}

/** Τα αρχεία ενός .docx (ZIP χωρίς συμπίεση, όπως τα γράφει η εφαρμογή). */
export function readStoredZip(bytes) {
  const files = new Map();
  const end = bytes.length - 22;
  const count = bytes.readUInt16LE(end + 10);
  let position = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const size = bytes.readUInt32LE(position + 24);
    const crc = bytes.readUInt32LE(position + 16);
    const nameLength = bytes.readUInt16LE(position + 28);
    const offset = bytes.readUInt32LE(position + 42);
    const name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const data = bytes.subarray(offset + 30 + localNameLength, offset + 30 + localNameLength + size);
    if (zlib.crc32(data) !== crc) throw new Error(`λάθος CRC στο ${name}`);
    files.set(name, data.toString('utf8'));
    position += 46 + nameLength;
  }
  return files;
}

/** Κλείνει την κάρτα καλωσορίσματος αν εμφανίζεται. */
export async function dismissOnboarding(page) {
  const button = page.getByRole('button', { name: 'Κατάλαβα' });
  if (await button.count()) await button.click();
}

/** Περιμένει μέχρι η αποθηκευμένη μεταγραφή (IndexedDB) να περιέχει το κείμενο. */
export async function waitForStoredText(page, text) {
  await page.waitForFunction(async wanted => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('apomagnitofonisi');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = await new Promise(resolve => {
      const request = db.transaction('transcripts', 'readonly').objectStore('transcripts').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return all.some(t => t.segments.some(s => s.text === wanted));
  }, text);
}
