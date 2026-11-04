import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserKeyStore, KEYS_STORAGE_KEY, KEYS_MODE_STORAGE_KEY } from '../../../src/infrastructure/storage/browser-key-store.js';
import { LocalSettingsStore } from '../../../src/infrastructure/storage/local-settings-store.js';
import { FallbackMediaReader } from '../../../src/infrastructure/media/fallback-media-reader.js';
import { createModuleLoader } from '../../../src/infrastructure/vendor-loader.js';
import { detectCapabilities, createCachedCapabilityDetector } from '../../../src/infrastructure/platform/capabilities.js';
import { BrowserDeviceStorage } from '../../../src/infrastructure/platform/device-storage.js';
import { BrowserFileDelivery } from '../../../src/infrastructure/platform/file-delivery.js';
import { BrowserClipboard } from '../../../src/infrastructure/platform/clipboard.js';
import { BrowserModelCache, MODEL_CACHE_NAMES } from '../../../src/infrastructure/platform/model-cache.js';
import { BrowserSharedFileInbox, SHARE_INBOX_CACHE, SHARED_FILE_NAME_HEADER } from '../../../src/infrastructure/platform/shared-file-inbox.js';
import { createRandomIdGenerator } from '../../../src/infrastructure/platform/random-ids.js';
import { AppError, ERROR_CODES } from '../../../src/application/errors.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

/** Ψεύτικη Cache Storage: ονόματα cache → Map(url → Response). */
class MemoryCaches {
  constructor() { this.stores = new Map(); }
  async has(name) { return this.stores.has(name); }
  async delete(name) { return this.stores.delete(name); }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const store = this.stores.get(name);
    return {
      async keys() { return [...store.keys()].map(url => ({ url })); },
      async match(request) { const r = store.get(request.url); return r ? r.clone() : undefined; },
      async put(url, response) { store.set(url, response); },
      async delete(request) { return store.delete(request.url); },
    };
  }
}

test('κλειδιά: στη συσκευή ή μόνο στην καρτέλα, με μεταφορά ανάμεσα', () => {
  const device = new MemoryStorage();
  const session = new MemoryStorage();
  const store = new BrowserKeyStore({ localStorage: device, sessionStorage: session });
  assert.equal(store.getKeyRetention(), 'device');
  store.setKey('elevenlabs', 'e1');
  store.setKey('anthropic', 'a1');
  assert.deepEqual(JSON.parse(device.getItem(KEYS_STORAGE_KEY)), { elevenlabs: 'e1', anthropic: 'a1' });
  store.setKeyRetention('session');
  assert.equal(store.getKeyRetention(), 'session');
  assert.equal(device.getItem(KEYS_STORAGE_KEY), null, 'φεύγουν από τη συσκευή');
  assert.equal(store.getKey('anthropic'), 'a1');
  assert.ok(session.getItem(KEYS_STORAGE_KEY));
  store.removeKey('anthropic');
  assert.equal(store.getKey('anthropic'), null);
  store.setKeyRetention('device');
  assert.equal(store.getKey('elevenlabs'), 'e1');
  assert.equal(session.getItem(KEYS_STORAGE_KEY), null, 'φεύγουν από την καρτέλα');
  const broken = new BrowserKeyStore({ localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} }, sessionStorage: null });
  broken.setKey('elevenlabs', 'x');
  assert.equal(broken.getKey('elevenlabs'), null, 'χωρίς αποθήκευση δεν σπάει');
});

test('κλειδιά: το clear σβήνει κλειδιά και επιλογή διατήρησης και από τις δύο αποθήκες', () => {
  const device = new MemoryStorage();
  const session = new MemoryStorage();
  const store = new BrowserKeyStore({ localStorage: device, sessionStorage: session });
  store.setKey('elevenlabs', 'e1');
  store.setKeyRetention('session');
  store.setKey('anthropic', 'a1');
  session.setItem('άλλο', 'μένει');
  store.clear();
  assert.equal(device.getItem(KEYS_STORAGE_KEY), null);
  assert.equal(session.getItem(KEYS_STORAGE_KEY), null);
  assert.equal(device.getItem(KEYS_MODE_STORAGE_KEY), null, 'ούτε η επιλογή «μόνο στην καρτέλα» μένει');
  assert.equal(store.getKeyRetention(), 'device');
  assert.equal(store.getKey('elevenlabs'), null);
  assert.equal(session.getItem('άλλο'), 'μένει', 'σβήνει μόνο τα δικά του');
});

test('κλειδιά: λάθος σύνδεση (όχι Web Storage) απορρίπτεται αμέσως, δεν χάνονται σιωπηλά τα κλειδιά (API-018)', () => {
  const deviceStoragePort = { estimateUsage: async () => ({}), requestPersistence: async () => true };
  assert.throws(() => new BrowserKeyStore({ localStorage: deviceStoragePort, sessionStorage: null }), TypeError);
  assert.throws(() => new BrowserKeyStore({ localStorage: null, sessionStorage: undefined }), TypeError, 'undefined δεν είναι «χωρίς αποθήκη»');
  const withoutStorage = new BrowserKeyStore({ localStorage: null, sessionStorage: null });
  withoutStorage.setKey('elevenlabs', 'x');
  assert.equal(withoutStorage.getKey('elevenlabs'), null, 'null: ο browser δεν επιτρέπει αποθήκη');
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

test('εφεδρικός αναγνώστης: μόνο όταν ο κύριος δεν υποστηρίζει τη μορφή, η συμπίεση μόνο από τον κύριο', async () => {
  const unsupported = () => new AppError(ERROR_CODES.UNSUPPORTED_MEDIA, 'x');
  const compactCalls = [];
  const primary = {
    async probe(m) { if (m.kind === 'amr') throw unsupported(); return { from: 'primary' }; },
    async *readMonoPcm(m) { if (m.kind === 'amr') throw unsupported(); yield 'p'; if (m.kind === 'broken') throw unsupported(); },
    async extractCompactAudio(m, options) { compactCalls.push(options); if (m.kind === 'amr') throw unsupported(); return { audio: 'compact', compacted: true }; },
  };
  const fallback = {
    async probe() { return { from: 'fallback' }; },
    async *readMonoPcm() { yield 'f'; },
    async extractCompactAudio() { throw new Error('ο εφεδρικός δεν πρέπει να καλείται για συμπίεση'); },
  };
  const reader = new FallbackMediaReader({ primary, fallback });
  const collect = async it => { const out = []; for await (const x of it) out.push(x); return out; };
  assert.deepEqual(await reader.probe({ kind: 'mp3' }), { from: 'primary' });
  assert.deepEqual(await reader.probe({ kind: 'amr' }), { from: 'fallback' });
  assert.deepEqual(await collect(reader.readMonoPcm({ kind: 'mp3' })), ['p']);
  assert.deepEqual(await collect(reader.readMonoPcm({ kind: 'amr' })), ['f']);
  await assert.rejects(collect(reader.readMonoPcm({ kind: 'broken' })), e => e.code === ERROR_CODES.UNSUPPORTED_MEDIA, 'όχι εφεδρεία στη μέση της ροής');
  const onFraction = () => {};
  assert.deepEqual(await reader.extractCompactAudio({ kind: 'mp3' }, { onFraction }), { audio: 'compact', compacted: true });
  assert.equal(compactCalls[0].onFraction, onFraction, 'οι επιλογές περνούν στον κύριο');
  await assert.rejects(reader.extractCompactAudio({ kind: 'amr' }), e => e.code === ERROR_CODES.UNSUPPORTED_MEDIA, 'την εφεδρεία την αποφασίζει η μηχανή');
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

test('δυνατότητες συσκευής, με μία ανίχνευση ανά σελίδα', async () => {
  const env = {
    navigator: { gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) }, hardwareConcurrency: 6, deviceMemory: 8 },
    AudioDecoder: function AudioDecoder() {}, WebAssembly: {}, Worker: function Worker() {}, crossOriginIsolated: true,
  };
  assert.deepEqual(await detectCapabilities(env), { webgpu: true, shaderF16: true, webCodecs: true, webAssembly: true, workers: true, crossOriginIsolated: true, hardwareConcurrency: 6, deviceMemoryGb: 8 });
  const noGpu = await detectCapabilities({ navigator: { gpu: { requestAdapter: async () => { throw new Error('x'); } } } });
  assert.equal(noGpu.webgpu, false);
  let n = 0;
  const detect = createCachedCapabilityDetector(async () => ({ n: ++n }));
  assert.equal((await detect()).n, 1);
  assert.equal((await detect()).n, 1);
});

test('χώρος αποθήκευσης της συσκευής', async () => {
  const storage = new BrowserDeviceStorage({ storageManager: { estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => false, persist: async () => true } });
  assert.deepEqual(await storage.estimateUsage(), { usageBytes: 10, quotaBytes: 100 });
  assert.equal(await storage.requestPersistence(), true);
  const none = new BrowserDeviceStorage({ storageManager: undefined });
  assert.deepEqual(await none.estimateUsage(), { usageBytes: null, quotaBytes: null });
  assert.equal(await none.requestPersistence(), false);
  const failing = new BrowserDeviceStorage({ storageManager: { estimate: async () => { throw new Error('x'); }, persist: async () => { throw new Error('x'); } } });
  assert.deepEqual(await failing.estimateUsage(), { usageBytes: null, quotaBytes: null });
  assert.equal(await failing.requestPersistence(), false);
});

test('παράδοση αρχείων: λήψη, έλεγχος κοινής χρήσης χωρίς το πραγματικό αρχείο, σφάλματα κοινής χρήσης', async () => {
  const appended = [];
  const document = {
    createElement: () => ({ click() { this.clicked = true; }, remove() { this.removed = true; } }),
    body: { append: a => appended.push(a) },
  };
  const urls = { created: [], createObjectURL(blob) { this.created.push(blob); return 'blob:1'; }, revokeObjectURL() {} };
  const probes = [];
  let shareFailure = null;
  const navigator = {
    canShare: ({ files }) => { probes.push(files.map(f => [f.name, f.type, f.size])); return files[0].type !== 'application/json'; },
    share: async ({ files, title }) => { if (shareFailure) throw shareFailure; probes.push(['shared', files[0].name, title]); },
  };
  const delivery = new BrowserFileDelivery({ document, navigator, URL: urls });
  delivery.download({ fileName: 'Σύσκεψη Έργων.txt', mimeType: 'text/plain', data: 'α' });
  assert.equal(appended[0].download, 'Σύσκεψη Έργων.txt');
  assert.equal(appended[0].href, 'blob:1');
  assert.ok(appended[0].clicked && appended[0].removed);
  assert.equal(urls.created[0].type, 'text/plain');

  assert.equal(delivery.canShare({ fileName: 'Σύσκεψη.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), true);
  assert.equal(delivery.canShare({ fileName: 'Σύσκεψη.json', mimeType: 'application/json' }), false);
  assert.deepEqual(probes[0], [['Σύσκεψη.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 0]], 'κενό αρχείο ίδιου ονόματος και τύπου');
  assert.equal(new BrowserFileDelivery({ document, navigator: {}, URL: urls }).canShare({ fileName: 'a.txt', mimeType: 'text/plain' }), false);

  await delivery.share({ fileName: 'a.txt', mimeType: 'text/plain', data: 'x' }, 'Τίτλος');
  assert.deepEqual(probes.at(-1), ['shared', 'a.txt', 'Τίτλος']);
  const shareWith = async error => { shareFailure = error; try { await delivery.share({ fileName: 'a.txt', mimeType: 'text/plain', data: 'x' }, 't'); } finally { shareFailure = null; } };
  await assert.rejects(shareWith(new DOMException('x', 'AbortError')), e => e.code === ERROR_CODES.CANCELLED);
  await assert.rejects(shareWith(new DOMException('x', 'NotAllowedError')), e => e.code === ERROR_CODES.DEVICE_UNSUPPORTED);
  await assert.rejects(shareWith(new Error('κάτι άλλο')), e => e.code === ERROR_CODES.UNKNOWN);
});

test('πρόχειρο: αντιγραφή, και DEVICE_UNSUPPORTED όταν δεν υπάρχει ή δεν επιτρέπεται', async () => {
  const written = [];
  await new BrowserClipboard({ navigator: { clipboard: { writeText: async t => { written.push(t); } } } }).copyText('κείμενο');
  assert.deepEqual(written, ['κείμενο']);
  await assert.rejects(new BrowserClipboard({ navigator: {} }).copyText('x'), e => e.code === ERROR_CODES.DEVICE_UNSUPPORTED);
  await assert.rejects(new BrowserClipboard({ navigator: { clipboard: { writeText: async () => { throw new DOMException('x', 'NotAllowedError'); } } } }).copyText('x'), e => e.code === ERROR_CODES.DEVICE_UNSUPPORTED);
});

test('μοντέλα στη συσκευή: μέγεθος από τα Content-Length και διαγραφή', async () => {
  const caches = new MemoryCaches();
  const models = new BrowserModelCache({ caches });
  assert.equal(await models.estimateSizeBytes(), 0);
  const cache = await caches.open(MODEL_CACHE_NAMES[0]);
  await cache.put('https://hf/a.onnx', new Response('abc', { headers: { 'Content-Length': '1000' } }));
  await cache.put('https://hf/b.json', new Response('{}', { headers: { 'Content-Length': '24' } }));
  assert.equal(await models.estimateSizeBytes(), 1024);
  await models.clear();
  assert.equal(await caches.has(MODEL_CACHE_NAMES[0]), false);
  assert.equal(await new BrowserModelCache({ caches: undefined }).estimateSizeBytes(), null);
});

test('αρχεία από κοινή χρήση: παραλαβή μία φορά, και διαγραφή', async () => {
  const caches = new MemoryCaches();
  const inbox = new BrowserSharedFileInbox({ caches });
  const cache = await caches.open(SHARE_INBOX_CACHE);
  await cache.put('https://app/shared/1', new Response(new Blob(['ήχος'], { type: 'audio/mpeg' }), { headers: { [SHARED_FILE_NAME_HEADER]: encodeURIComponent('Σύσκεψη Έργων.mp3') } }));
  const files = await inbox.takeFiles();
  assert.deepEqual(files.map(f => [f.name, f.type]), [['Σύσκεψη Έργων.mp3', 'audio/mpeg']]);
  assert.deepEqual(await inbox.takeFiles(), [], 'σβήνονται μόλις παραληφθούν');
  await cache.put('https://app/shared/2', new Response('x'));
  await inbox.clear();
  assert.equal(await caches.has(SHARE_INBOX_CACHE), false);
  assert.deepEqual(await new BrowserSharedFileInbox({ caches: undefined }).takeFiles(), []);
});

test('αναγνωριστικά από το crypto.randomUUID', () => {
  let n = 0;
  const ids = createRandomIdGenerator({ randomUUID: () => `uuid-${++n}` });
  assert.equal(ids.newId(), 'uuid-1');
  assert.equal(ids.newId(), 'uuid-2');
});

test('service worker: ξαναφόρτωση μόνο όταν ο χρήστης ζήτησε την ενημέρωση', async () => {
  const { ServiceWorkerClient, SKIP_WAITING_MESSAGE } = await import('../../../src/infrastructure/platform/service-worker-client.js');
  const listeners = {};
  const waiting = { state: 'installed', posted: [], postMessage(m) { this.posted.push(m); }, addEventListener() {} };
  const container = {
    controller: {},
    addEventListener(name, fn) { listeners[name] = fn; },
    async register() { return { waiting, installing: null, addEventListener() {} }; },
  };
  let reloads = 0;
  let offered = 0;
  const client = new ServiceWorkerClient({ serviceWorker: container, location: { reload: () => { reloads += 1; } } });
  await client.register({ scriptUrl: './sw.js', onUpdateReady: () => { offered += 1; } });
  assert.equal(offered, 1);
  listeners.controllerchange();
  assert.equal(reloads, 0, 'η ανάληψη στην πρώτη επίσκεψη δεν ξαναφορτώνει');
  client.applyUpdate();
  assert.deepEqual(waiting.posted, [{ type: SKIP_WAITING_MESSAGE }]);
  listeners.controllerchange();
  assert.equal(reloads, 1);
  await new ServiceWorkerClient({ serviceWorker: undefined, location: {} }).register({ scriptUrl: 'x', onUpdateReady() {} });
});
