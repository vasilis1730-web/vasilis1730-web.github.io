import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserKeyStore, KEYS_STORAGE_KEY } from '../../../src/infrastructure/storage/browser-key-store.js';
import { LocalSettingsStore } from '../../../src/infrastructure/storage/local-settings-store.js';
import { FallbackMediaReader } from '../../../src/infrastructure/media/fallback-media-reader.js';
import { createModuleLoader } from '../../../src/infrastructure/vendor-loader.js';
import { detectCapabilities, cachedCapabilities } from '../../../src/infrastructure/platform/capabilities.js';
import { BrowserStorageEstimator } from '../../../src/infrastructure/platform/storage-estimator.js';
import { AppError, ERROR_CODES } from '../../../src/application/errors.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

test('κλειδιά: στη συσκευή ή μόνο στην καρτέλα, με μεταφορά ανάμεσα', () => {
  const device = new MemoryStorage();
  const session = new MemoryStorage();
  const store = new BrowserKeyStore({ deviceStorage: device, sessionStorage: session });
  assert.equal(store.isPersistent(), true);
  store.setKey('elevenlabs', 'e1');
  store.setKey('anthropic', 'a1');
  assert.deepEqual(JSON.parse(device.getItem(KEYS_STORAGE_KEY)), { elevenlabs: 'e1', anthropic: 'a1' });
  store.setPersistent(false);
  assert.equal(device.getItem(KEYS_STORAGE_KEY), null, 'φεύγουν από τη συσκευή');
  assert.equal(store.getKey('anthropic'), 'a1');
  assert.ok(session.getItem(KEYS_STORAGE_KEY));
  store.removeKey('anthropic');
  assert.equal(store.getKey('anthropic'), null);
  store.setPersistent(true);
  assert.equal(store.getKey('elevenlabs'), 'e1');
  store.clearAll();
  assert.equal(store.getKey('elevenlabs'), null);
  const broken = new BrowserKeyStore({ deviceStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} }, sessionStorage: null });
  broken.setKey('elevenlabs', 'x');
  assert.equal(broken.getKey('elevenlabs'), null, 'χωρίς αποθήκευση δεν σπάει');
});

test('ρυθμίσεις: JSON, άκυρο περιεχόμενο και χωρίς αποθήκευση', () => {
  const storage = new MemoryStorage();
  const store = new LocalSettingsStore({ storage });
  assert.equal(store.load(), null);
  store.save({ a: 1 });
  assert.deepEqual(store.load(), { a: 1 });
  storage.setItem('apomagnitofonisi.settings.v1', '{oops');
  assert.equal(store.load(), null);
  store.clear();
  assert.equal(storage.getItem('apomagnitofonisi.settings.v1'), null);
  assert.equal(new LocalSettingsStore({ storage: null }).load(), null);
});

test('εφεδρικός αναγνώστης: μόνο όταν ο κύριος δεν υποστηρίζει τη μορφή', async () => {
  const unsupported = () => new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'x');
  const primary = {
    async probe(m) { if (m.kind === 'amr') throw unsupported(); return { from: 'primary' }; },
    async *readMono16k(m) { if (m.kind === 'amr') throw unsupported(); yield 'p'; if (m.kind === 'broken') throw unsupported(); },
    async extractCompactAudio(m) { if (m.kind === 'amr') throw unsupported(); return 'compact'; },
  };
  const fallback = { async probe() { return { from: 'fallback' }; }, async *readMono16k() { yield 'f'; }, async extractCompactAudio(m) { return m; } };
  const reader = new FallbackMediaReader({ primary, fallback });
  const collect = async it => { const out = []; for await (const x of it) out.push(x); return out; };
  assert.deepEqual(await reader.probe({ kind: 'mp3' }), { from: 'primary' });
  assert.deepEqual(await reader.probe({ kind: 'amr' }), { from: 'fallback' });
  assert.deepEqual(await collect(reader.readMono16k({ kind: 'mp3' })), ['p']);
  assert.deepEqual(await collect(reader.readMono16k({ kind: 'amr' })), ['f']);
  await assert.rejects(collect(reader.readMono16k({ kind: 'broken' })), e => e.code === ERROR_CODES.UNSUPPORTED_MEDIA, 'όχι εφεδρεία στη μέση της ροής');
  const amr = { kind: 'amr' };
  assert.equal(await reader.extractCompactAudio(amr), amr);
});

test('φόρτωση βιβλιοθηκών: μία φορά, και νέα δοκιμή μετά από αποτυχία', async () => {
  let calls = 0;
  let fail = true;
  const load = createModuleLoader(async url => { calls += 1; if (fail) throw new Error('offline'); return { url }; });
  await assert.rejects(load('https://cdn/x.js'), e => e.code === ERROR_CODES.NETWORK);
  fail = false;
  assert.deepEqual(await load('https://cdn/x.js'), { url: 'https://cdn/x.js' });
  await load('https://cdn/x.js');
  assert.equal(calls, 2);
});

test('δυνατότητες συσκευής', async () => {
  const env = {
    navigator: { gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) }, hardwareConcurrency: 6, deviceMemory: 8 },
    AudioDecoder: function AudioDecoder() {}, WebAssembly: {}, Worker: function Worker() {}, crossOriginIsolated: true,
  };
  assert.deepEqual(await detectCapabilities(env), { webgpu: true, shaderF16: true, webCodecs: true, webAssembly: true, workers: true, crossOriginIsolated: true, hardwareConcurrency: 6, deviceMemoryGb: 8 });
  const noGpu = await detectCapabilities({ navigator: { gpu: { requestAdapter: async () => { throw new Error('x'); } } } });
  assert.equal(noGpu.webgpu, false);
  let n = 0;
  const cached = cachedCapabilities(async () => ({ n: ++n }));
  assert.equal((await cached()).n, 1);
  assert.equal((await cached()).n, 1);
});

test('χώρος αποθήκευσης', async () => {
  const estimator = new BrowserStorageEstimator({ storageManager: { estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => false, persist: async () => true } });
  assert.deepEqual(await estimator.estimate(), { usageBytes: 10, quotaBytes: 100 });
  assert.equal(await estimator.requestPersistence(), true);
  const none = new BrowserStorageEstimator({ storageManager: undefined });
  assert.deepEqual(await none.estimate(), { usageBytes: null, quotaBytes: null });
  assert.equal(await none.requestPersistence(), false);
});
