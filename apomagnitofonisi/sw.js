/*
 * Service worker της Απομαγνητοφώνησης.
 *
 * - Κέλυφος εφαρμογής εκτός σύνδεσης: οι σελίδες, το CSS, όλα τα modules του
 *   src/ και τα εικονίδια προαποθηκεύονται ανά έκδοση (SHELL_CACHE).
 * - Σελίδες: πρώτα το δίκτυο (για να φτάνει αμέσως κάθε νέα έκδοση), αλλιώς η
 *   αποθηκευμένη. Υπόλοιπα αρχεία της εφαρμογής: stale-while-revalidate.
 * - Βιβλιοθήκες του jsDelivr με ακριβή έκδοση (αμετάβλητες): πρώτα η cache.
 * - Δεν αγγίζει ποτέ Hugging Face (τα μοντέλα τα αποθηκεύει το Transformers.js),
 *   ElevenLabs, Anthropic ή οποιοδήποτε αίτημα εκτός από GET, εκτός από το
 *   POST του share target.
 * - Share target: τα αρχεία που μοιράζεται ο χρήστης από άλλες εφαρμογές
 *   μπαίνουν στην SHARE_INBOX_CACHE και η εφαρμογή ανοίγει με ?shared=1
 *   (κοινό συμβόλαιο με το src/infrastructure/platform/shared-file-inbox.js).
 */
'use strict';

/** Πρέπει να ταυτίζεται με το APP_VERSION του src/config/app-info.js (το ελέγχει unit test). */
const APP_VERSION = '1.0.0';
const SHELL_CACHE = `apomagnitofonisi-shell-${APP_VERSION}`;
const CDN_CACHE = 'apomagnitofonisi-cdn-v1';
const SHARE_INBOX_CACHE = 'apomagnitofonisi-share-inbox';
const SHARED_FILE_NAME_HEADER = 'X-Shared-File-Name';
const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';
const PINNED_CDN_PATH = /^\/npm\/(@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\//;

/** Το κέλυφος της εφαρμογής. Κάθε αρχείο του src/ είναι εδώ (το ελέγχει unit test). */
const SHELL_FILES = [
  './',
  './privacy',
  './manifest.json',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './src/application/api-key-service.js',
  './src/application/cost-estimate.js',
  './src/application/data-erasure-service.js',
  './src/application/erase-targets.js',
  './src/application/errors.js',
  './src/application/export-formats.js',
  './src/application/export-service.js',
  './src/application/key-providers.js',
  './src/application/library-service.js',
  './src/application/limits.js',
  './src/application/ports.js',
  './src/application/progress.js',
  './src/application/settings-service.js',
  './src/application/summary-prompts.js',
  './src/application/summary-service.js',
  './src/application/transcript-editor.js',
  './src/application/transcription-service.js',
  './src/config/app-info.js',
  './src/config/endpoints.js',
  './src/config/external-links.js',
  './src/config/languages.js',
  './src/config/models.js',
  './src/config/vendor.js',
  './src/domain/audio/audio-window-assembler.js',
  './src/domain/audio/pcm.js',
  './src/domain/audio/streaming-resampler.js',
  './src/domain/diarization/speaker-clustering.js',
  './src/domain/file-naming.js',
  './src/domain/markdown.js',
  './src/domain/subtitles.js',
  './src/domain/text-normalize.js',
  './src/domain/text-search.js',
  './src/domain/time-format.js',
  './src/domain/transcript-codec.js',
  './src/domain/transcript.js',
  './src/domain/words-to-segments.js',
  './src/infrastructure/anthropic/anthropic-client.js',
  './src/infrastructure/anthropic/anthropic-key-verifier.js',
  './src/infrastructure/anthropic/claude-summarizer.js',
  './src/infrastructure/elevenlabs/elevenlabs-engine.js',
  './src/infrastructure/elevenlabs/elevenlabs-key-verifier.js',
  './src/infrastructure/elevenlabs/elevenlabs-response.js',
  './src/infrastructure/export/docx-document.js',
  './src/infrastructure/export/docx-exporters.js',
  './src/infrastructure/export/export-labels.js',
  './src/infrastructure/export/text-exporters.js',
  './src/infrastructure/export/zip-store-writer.js',
  './src/infrastructure/http/xhr-uploader.js',
  './src/infrastructure/media/fallback-media-reader.js',
  './src/infrastructure/media/mediabunny-media-reader.js',
  './src/infrastructure/media/web-audio-media-reader.js',
  './src/infrastructure/platform/capabilities.js',
  './src/infrastructure/platform/clipboard.js',
  './src/infrastructure/platform/device-storage.js',
  './src/infrastructure/platform/file-delivery.js',
  './src/infrastructure/platform/model-cache.js',
  './src/infrastructure/platform/random-ids.js',
  './src/infrastructure/platform/service-worker-client.js',
  './src/infrastructure/platform/shared-file-inbox.js',
  './src/infrastructure/platform/system-clock.js',
  './src/infrastructure/platform/wake-lock.js',
  './src/infrastructure/storage/browser-key-store.js',
  './src/infrastructure/storage/idb.js',
  './src/infrastructure/storage/indexeddb-transcript-repository.js',
  './src/infrastructure/storage/local-settings-store.js',
  './src/infrastructure/storage/web-storage.js',
  './src/infrastructure/vendor-loader.js',
  './src/infrastructure/whisper/local-model-selection.js',
  './src/infrastructure/whisper/local-whisper-engine.js',
  './src/infrastructure/whisper/speaker-embedder.js',
  './src/infrastructure/whisper/whisper-recognizer.js',
  './src/infrastructure/whisper/whisper-worker-handler.js',
  './src/infrastructure/whisper/whisper-worker.js',
  './src/infrastructure/whisper/worker-client.js',
  './src/infrastructure/whisper/worker-protocol.js',
  './src/main.js',
  './src/styles/app.css',
  './src/ui/app-shell.js',
  './src/ui/components/confirm-dialog.js',
  './src/ui/components/export-toolbar.js',
  './src/ui/components/key-editor.js',
  './src/ui/components/markdown-view.js',
  './src/ui/components/media-player.js',
  './src/ui/components/quality-options.js',
  './src/ui/components/saved-summaries-list.js',
  './src/ui/components/segment-list.js',
  './src/ui/components/speakers-panel.js',
  './src/ui/components/toast.js',
  './src/ui/dom.js',
  './src/ui/feedback.js',
  './src/ui/formatters.js',
  './src/ui/launch-intake.js',
  './src/ui/number-format.js',
  './src/ui/presentation.js',
  './src/ui/router.js',
  './src/ui/routes.js',
  './src/ui/session-media.js',
  './src/ui/strings.js',
  './src/ui/transcription-job.js',
  './src/ui/views/history-view.js',
  './src/ui/views/home-view.js',
  './src/ui/views/progress-view.js',
  './src/ui/views/settings-view.js',
  './src/ui/views/summary-view.js',
  './src/ui/views/transcript-view.js',
];

self.addEventListener('install', event => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CDN_CACHE, SHARE_INBOX_CACHE]);
    for (const name of await caches.keys()) {
      if (name.startsWith('apomagnitofonisi-') && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === SKIP_WAITING_MESSAGE) self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveSharedFiles(request));
    return;
  }
  if (request.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    event.respondWith(request.mode === 'navigate' ? networkFirst(request) : staleWhileRevalidate(request));
    return;
  }
  if (url.origin === 'https://cdn.jsdelivr.net' && PINNED_CDN_PATH.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Όλα τα υπόλοιπα (μοντέλα, API) πηγαίνουν κατευθείαν στο δίκτυο.
});

/** Κάθε αρχείο χωριστά: ένα αρχείο που λείπει δεν ακυρώνει όλη την εγκατάσταση. */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_FILES.map(async path => {
    try {
      const response = await fetch(new Request(path, { cache: 'reload' }));
      if (response.ok) await cache.put(path, response);
    } catch {
      // εκτός σύνδεσης κατά την εγκατάσταση: θα αποθηκευτεί στην πρώτη χρήση
    }
  }));
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true }) || await cache.match('./');
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async response => {
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    refresh.catch(() => {});
    return cached;
  }
  return refresh;
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'cors') await cache.put(request, response.clone());
  return response;
}

async function receiveSharedFiles(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('media').filter(item => typeof item === 'object' && item && item.size > 0);
    const cache = await caches.open(SHARE_INBOX_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
    let index = 0;
    for (const file of files) {
      index += 1;
      await cache.put(new Request(`./shared-inbox/${Date.now()}-${index}`), new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', [SHARED_FILE_NAME_HEADER]: encodeURIComponent(file.name || 'αρχείο') },
      }));
    }
  } catch {
    // Αν η κοινή χρήση αποτύχει, η εφαρμογή ανοίγει κανονικά χωρίς αρχείο.
  }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
}
