/**
 * Composition root: το μόνο σημείο όπου οι υπηρεσίες του application
 * συνδέονται με τους adapters του infrastructure και με τη διεπαφή. Καμία
 * άλλη μονάδα δεν δημιουργεί adapters ή δεν διαβάζει globals του browser.
 */
import { VENDOR_MODULE_URLS } from './config/vendor.js';
import { APP_VERSION, PRIVACY_PAGE_PATH } from './config/app-info.js';

import { TranscriptionService } from './application/transcription-service.js';
import { SummaryService } from './application/summary-service.js';
import { ExportService } from './application/export-service.js';
import { LibraryService } from './application/library-service.js';
import { TranscriptEditor } from './application/transcript-editor.js';
import { SettingsService } from './application/settings-service.js';
import { ApiKeyService } from './application/api-key-service.js';

import { createModuleLoader } from './infrastructure/vendor-loader.js';
import { MediabunnyMediaReader } from './infrastructure/media/mediabunny-media-reader.js';
import { WebAudioMediaReader } from './infrastructure/media/web-audio-media-reader.js';
import { FallbackMediaReader } from './infrastructure/media/fallback-media-reader.js';
import { LocalWhisperEngine } from './infrastructure/transcription/local-whisper-engine.js';
import { describeLocalPresets } from './infrastructure/transcription/local-model-selection.js';
import { ElevenLabsEngine } from './infrastructure/transcription/elevenlabs-engine.js';
import { XhrUploader } from './infrastructure/http/xhr-uploader.js';
import { ClaudeSummarizer } from './infrastructure/summary/claude-summarizer.js';
import { ElevenLabsKeyVerifier } from './infrastructure/keys/elevenlabs-key-verifier.js';
import { AnthropicKeyVerifier } from './infrastructure/keys/anthropic-key-verifier.js';
import { IndexedDbTranscriptRepository } from './infrastructure/storage/indexeddb-transcript-repository.js';
import { LocalSettingsStore } from './infrastructure/storage/local-settings-store.js';
import { BrowserKeyStore } from './infrastructure/storage/browser-key-store.js';
import { BrowserStorageEstimator } from './infrastructure/platform/storage-estimator.js';
import { cachedCapabilities } from './infrastructure/platform/capabilities.js';
import { ScreenWakeLock } from './infrastructure/platform/wake-lock.js';
import { BrowserFileSaver } from './infrastructure/platform/file-saver.js';
import { SharedFileInbox, SHARE_INBOX_CACHE } from './infrastructure/platform/shared-file-inbox.js';
import { ModelCacheManager } from './infrastructure/platform/model-cache.js';
import { ServiceWorkerClient } from './infrastructure/platform/service-worker-client.js';
import { systemClock } from './infrastructure/platform/system-clock.js';
import { createRandomIds } from './infrastructure/platform/random-ids.js';
import { TxtTranscriptExporter, SrtTranscriptExporter, VttTranscriptExporter, JsonTranscriptExporter, MarkdownSummaryExporter } from './infrastructure/export/text-exporters.js';
import { DocxTranscriptExporter, DocxSummaryExporter } from './infrastructure/export/docx-exporters.js';

import { STRINGS, speakerDefaultLabel } from './ui/strings.js';
import { describeEngine, exportLabels } from './ui/presentation.js';
import { AppShell } from './ui/app-shell.js';
import { HashRouter } from './ui/router.js';
import { TranscriptionJob } from './ui/transcription-job.js';
import { SessionMedia } from './ui/session-media.js';
import { HomeView } from './ui/views/home-view.js';
import { ProgressView } from './ui/views/progress-view.js';
import { TranscriptView } from './ui/views/transcript-view.js';
import { SummaryView } from './ui/views/summary-view.js';
import { HistoryView } from './ui/views/history-view.js';
import { SettingsView } from './ui/views/settings-view.js';

/** Αποθήκη του browser, ή null όταν απαγορεύεται (π.χ. αποκλεισμένα cookies). */
function browserStorage(name) {
  try {
    const storage = window[name];
    storage.getItem('probe');
    return storage;
  } catch {
    return null;
  }
}

async function main() {
  /* ---------------------------------------------------------------- adapters */
  const loadModule = createModuleLoader();
  const loadMediabunny = () => loadModule(VENDOR_MODULE_URLS.mediabunny);
  const loadAnthropicSdk = () => loadModule(VENDOR_MODULE_URLS.anthropicSdk);
  const capabilities = cachedCapabilities();

  const repository = new IndexedDbTranscriptRepository({ indexedDB: window.indexedDB });
  const keyStore = new BrowserKeyStore({ deviceStorage: browserStorage('localStorage'), sessionStorage: browserStorage('sessionStorage') });
  const storage = new BrowserStorageEstimator({ storageManager: navigator.storage });
  const ids = createRandomIds(window.crypto);
  const mediaReader = new FallbackMediaReader({
    primary: new MediabunnyMediaReader({ loadMediabunny }),
    fallback: new WebAudioMediaReader({ createOfflineContext: (channels, length, rate) => new OfflineAudioContext(channels, length, rate) }),
  });
  const engines = [
    new LocalWhisperEngine({
      createWorker: () => new Worker(new URL('./infrastructure/transcription/whisper-worker.js', import.meta.url), { type: 'module', name: 'whisper' }),
      mediaReader,
      capabilities,
    }),
    new ElevenLabsEngine({
      getApiKey: () => keyStore.getKey('elevenlabs'),
      uploader: new XhrUploader({ createXhr: () => new XMLHttpRequest() }),
      mediaReader,
    }),
  ];
  const labels = exportLabels();
  const fileSaver = new BrowserFileSaver({ document, navigator, URL });
  const modelCache = new ModelCacheManager({ caches: window.caches });
  const sessionMedia = new SessionMedia({ URL });

  /* ---------------------------------------------------------------- υπηρεσίες */
  const settings = new SettingsService({ store: new LocalSettingsStore({ storage: browserStorage('localStorage') }) });
  const apiKeys = new ApiKeyService({
    keyStore,
    verifiers: [new ElevenLabsKeyVerifier({ fetch: window.fetch.bind(window) }), new AnthropicKeyVerifier({ loadSdk: loadAnthropicSdk })],
  });
  const transcription = new TranscriptionService({ engines, repository, clock: systemClock, idGenerator: ids, speakerLabel: speakerDefaultLabel, storage });
  const summaries = new SummaryService({
    summarizer: new ClaudeSummarizer({ loadSdk: loadAnthropicSdk, getApiKey: () => keyStore.getKey('anthropic') }),
    repository, clock: systemClock, idGenerator: ids, unknownSpeakerLabel: STRINGS.transcript.unknownSpeaker,
  });
  const exports = new ExportService({
    transcriptExporters: [
      new DocxTranscriptExporter({ labels }),
      new TxtTranscriptExporter({ labels }),
      new SrtTranscriptExporter(),
      new VttTranscriptExporter(),
      new JsonTranscriptExporter({ clock: systemClock, appVersion: APP_VERSION }),
    ],
    summaryExporters: [new DocxSummaryExporter({ labels }), new MarkdownSummaryExporter({ labels })],
    summaryNameSuffix: kind => STRINGS.summary.fileSuffix[kind] || STRINGS.summary.fileSuffix.custom,
  });
  const library = new LibraryService({ repository, idGenerator: ids, storage });
  const editor = new TranscriptEditor({ repository, clock: systemClock });
  const job = new TranscriptionJob({ service: transcription, wakeLock: new ScreenWakeLock({ navigator, document }) });

  const eraseAllData = async () => {
    await library.removeAll();
    apiKeys.clearAll();
    settings.reset();
    await modelCache.clear();
    if (window.caches) await window.caches.delete(SHARE_INBOX_CACHE);
    sessionMedia.clear();
  };

  /* ---------------------------------------------------------------- διεπαφή */
  const shell = new AppShell({ document, root: document.getElementById('app'), privacyHref: PRIVACY_PAGE_PATH });
  const toasts = shell.toasts;

  let sharedFile = null;
  const url = new URL(window.location.href);
  if (url.searchParams.has('shared')) {
    const files = await new SharedFileInbox({ caches: window.caches }).takeFiles().catch(() => []);
    sharedFile = files[0] || null;
    url.searchParams.delete('shared');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash || '#/'}`);
  }

  const router = new HashRouter({
    window,
    fallback: () => router.navigate('/'),
    routes: [
      {
        pattern: '/',
        show: () => {
          const initialFile = sharedFile;
          sharedFile = null;
          shell.show(new HomeView({ settings, apiKeys, job, mediaReader, capabilities, describeLocalPresets, sessionMedia, router, toasts, initialFile }));
        },
      },
      { pattern: '/progress', show: () => shell.show(new ProgressView({ job, router })) },
      { pattern: '/t/:id', show: ({ id }) => shell.show(new TranscriptView({ library, editor, exports, fileSaver, sessionMedia, router, toasts, describeEngine, document }, id)) },
      { pattern: '/t/:id/summary', show: ({ id }) => shell.show(new SummaryView({ library, summaries, editor, exports, settings, apiKeys, fileSaver, toasts, document }, id)) },
      { pattern: '/history', show: () => shell.show(new HistoryView({ library, router, toasts, document })) },
      {
        pattern: '/settings',
        show: () => shell.show(new SettingsView({ apiKeys, settings, modelCache, eraseAllData, toasts, document, about: { version: APP_VERSION, privacyHref: PRIVACY_PAGE_PATH } })),
      },
    ],
  });
  router.start();

  const serviceWorker = new ServiceWorkerClient({ serviceWorker: navigator.serviceWorker, location: window.location });
  serviceWorker.register({
    scriptUrl: './sw.js',
    onUpdateReady: () => toasts.show(STRINGS.update.ready, { sticky: true, action: { label: STRINGS.update.reload, run: () => serviceWorker.applyUpdate() } }),
  }).catch(() => {
    // Χωρίς service worker η εφαρμογή δουλεύει κανονικά, απλώς όχι εκτός σύνδεσης.
  });
}

main();
