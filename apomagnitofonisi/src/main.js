/**
 * Composition root: το μόνο σημείο όπου οι υπηρεσίες του application
 * συνδέονται με τους adapters του infrastructure και με τη διεπαφή, και το
 * μόνο που δημιουργεί worker (`new Worker`). Εδώ μόνο συνδέονται τα κομμάτια:
 * κανένας κανόνας εφαρμογής δεν ζει σε αυτό το αρχείο.
 *
 * Ο worker των μοντέλων (infrastructure/whisper/whisper-worker.js) είναι
 * δεύτερο σημείο σύνδεσης για ό,τι τρέχει μέσα του. Η διεπαφή (ui/) φτιάχνει
 * DOM με το document της σελίδας (dom.js) και δέχεται όλα τα υπόλοιπα από εδώ.
 */
import { VENDOR_MODULE_URLS } from './config/vendor.js';
import { APP_VERSION, PRIVACY_PAGE_PATH } from './config/app-info.js';

import { TranscriptionService } from './application/transcription-service.js';
import { SummaryService } from './application/summary-service.js';
import { ExportService } from './application/export-service.js';
import { LibraryService } from './application/library-service.js';
import { TranscriptEditor } from './application/transcript-editor.js';
import { SettingsService } from './application/settings-service.js';
import { ApiKeyService, KEY_PROVIDERS } from './application/api-key-service.js';
import { DataErasureService, ERASE_TARGETS } from './application/data-erasure-service.js';

import { createModuleLoader } from './infrastructure/vendor-loader.js';
import { MediabunnyMediaReader } from './infrastructure/media/mediabunny-media-reader.js';
import { WebAudioMediaReader } from './infrastructure/media/web-audio-media-reader.js';
import { FallbackMediaReader } from './infrastructure/media/fallback-media-reader.js';
import { LocalWhisperEngine } from './infrastructure/whisper/local-whisper-engine.js';
import { ElevenLabsEngine } from './infrastructure/elevenlabs/elevenlabs-engine.js';
import { ElevenLabsKeyVerifier } from './infrastructure/elevenlabs/elevenlabs-key-verifier.js';
import { ClaudeSummarizer } from './infrastructure/anthropic/claude-summarizer.js';
import { AnthropicKeyVerifier } from './infrastructure/anthropic/anthropic-key-verifier.js';
import { XhrUploader } from './infrastructure/http/xhr-uploader.js';
import { IndexedDbTranscriptRepository } from './infrastructure/storage/indexeddb-transcript-repository.js';
import { LocalSettingsStore } from './infrastructure/storage/local-settings-store.js';
import { BrowserKeyStore } from './infrastructure/storage/browser-key-store.js';
import { BrowserDeviceStorage } from './infrastructure/platform/device-storage.js';
import { createCachedCapabilityDetector } from './infrastructure/platform/capabilities.js';
import { ScreenWakeLock } from './infrastructure/platform/wake-lock.js';
import { BrowserFileDelivery } from './infrastructure/platform/file-delivery.js';
import { BrowserClipboard } from './infrastructure/platform/clipboard.js';
import { SharedFileInbox } from './infrastructure/platform/shared-file-inbox.js';
import { ModelCache } from './infrastructure/platform/model-cache.js';
import { ServiceWorkerClient } from './infrastructure/platform/service-worker-client.js';
import { systemClock } from './infrastructure/platform/system-clock.js';
import { createRandomIdGenerator } from './infrastructure/platform/random-ids.js';
import { TxtTranscriptExporter, SrtTranscriptExporter, VttTranscriptExporter, JsonTranscriptExporter, MarkdownSummaryExporter } from './infrastructure/export/text-exporters.js';
import { DocxTranscriptExporter, DocxSummaryExporter } from './infrastructure/export/docx-exporters.js';

import { STRINGS, speakerLabelFor } from './ui/strings.js';
import { createExportLabels, summaryFileSuffixFor } from './ui/presentation.js';
import { AppShell } from './ui/app-shell.js';
import { HashRouter } from './ui/router.js';
import { ROUTE_PATTERNS, ROUTES } from './ui/routes.js';
import { takeSharedFile } from './ui/launch-intake.js';
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
  const detectCapabilities = createCachedCapabilityDetector();

  const repository = new IndexedDbTranscriptRepository({ indexedDB: window.indexedDB });
  const keyStore = new BrowserKeyStore({ deviceStorage: browserStorage('localStorage'), sessionStorage: browserStorage('sessionStorage') });
  const deviceStorage = new BrowserDeviceStorage({ storageManager: navigator.storage });
  const ids = createRandomIdGenerator(window.crypto);
  const mediaReader = new FallbackMediaReader({
    primary: new MediabunnyMediaReader({ loadMediabunny }),
    fallback: new WebAudioMediaReader({ createOfflineContext: (channels, length, rate) => new OfflineAudioContext(channels, length, rate) }),
  });
  const engines = [
    new LocalWhisperEngine({
      createWorker: () => new Worker(new URL('./infrastructure/whisper/whisper-worker.js', import.meta.url), { type: 'module', name: 'whisper' }),
      mediaReader,
      detectCapabilities,
    }),
    new ElevenLabsEngine({
      getApiKey: () => keyStore.getKey(KEY_PROVIDERS.ELEVENLABS),
      uploader: new XhrUploader({ createXhr: () => new XMLHttpRequest() }),
      mediaReader,
      audioEventLabels: STRINGS.audioEvents,
    }),
  ];
  const labels = createExportLabels();
  const fileDelivery = new BrowserFileDelivery({ document, navigator, URL });
  const clipboard = new BrowserClipboard({ navigator });
  const modelCache = new ModelCache({ caches: window.caches });
  const sharedInbox = new SharedFileInbox({ caches: window.caches });
  const sessionMedia = new SessionMedia({ URL });

  /* ---------------------------------------------------------------- υπηρεσίες */
  const settings = new SettingsService({ store: new LocalSettingsStore({ storage: browserStorage('localStorage') }) });
  const apiKeys = new ApiKeyService({
    keyStore,
    verifiers: [new ElevenLabsKeyVerifier({ fetch: window.fetch.bind(window) }), new AnthropicKeyVerifier({ loadSdk: loadAnthropicSdk })],
  });
  const transcription = new TranscriptionService({ engines, repository, clock: systemClock, idGenerator: ids, speakerLabelFor, deviceStorage });
  const summaries = new SummaryService({
    summarizer: new ClaudeSummarizer({ loadSdk: loadAnthropicSdk, getApiKey: () => keyStore.getKey(KEY_PROVIDERS.ANTHROPIC) }),
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
    summaryFileSuffixFor,
    untitledFileName: STRINGS.transcript.untitled,
  });
  const library = new LibraryService({ repository, idGenerator: ids, deviceStorage });
  const editor = new TranscriptEditor({ repository, clock: systemClock });
  const dataErasure = new DataErasureService({
    targets: [
      { name: ERASE_TARGETS.TRANSCRIPTS, erase: () => library.clear() },
      { name: ERASE_TARGETS.KEYS, erase: () => apiKeys.clear() },
      { name: ERASE_TARGETS.SETTINGS, erase: () => settings.clear() },
      { name: ERASE_TARGETS.MODELS, erase: () => modelCache.clear() },
      { name: ERASE_TARGETS.SHARED_FILES, erase: () => sharedInbox.clear() },
      { name: ERASE_TARGETS.SESSION_MEDIA, erase: () => sessionMedia.clear() },
    ],
  });
  const job = new TranscriptionJob({ service: transcription, wakeLock: new ScreenWakeLock({ navigator, document }) });

  /* ---------------------------------------------------------------- διεπαφή */
  const shell = new AppShell({ document, root: document.getElementById('app'), privacyHref: PRIVACY_PAGE_PATH });
  const toasts = shell.toasts;
  let sharedFile = await takeSharedFile({ location: window.location, history: window.history, inbox: sharedInbox });

  const router = new HashRouter({
    window,
    fallback: () => router.navigate(ROUTES.home()),
    routes: [
      {
        pattern: ROUTE_PATTERNS.HOME,
        show: () => {
          const initialFile = sharedFile;
          sharedFile = null;
          shell.show(new HomeView({ settings, transcription, job, mediaReader, sessionMedia, router, toasts }, { initialFile }));
        },
      },
      { pattern: ROUTE_PATTERNS.PROGRESS, show: () => shell.show(new ProgressView({ job, router })) },
      { pattern: ROUTE_PATTERNS.TRANSCRIPT, show: params => shell.show(new TranscriptView({ library, editor, exports, fileDelivery, clipboard, sessionMedia, toasts }, params)) },
      { pattern: ROUTE_PATTERNS.SUMMARY, show: params => shell.show(new SummaryView({ library, summaries, editor, exports, settings, apiKeys, fileDelivery, clipboard, toasts }, params)) },
      { pattern: ROUTE_PATTERNS.HISTORY, show: () => shell.show(new HistoryView({ library, router, toasts })) },
      {
        pattern: ROUTE_PATTERNS.SETTINGS,
        show: () => shell.show(new SettingsView({ apiKeys, settings, transcription, modelCache, dataErasure, toasts, about: { version: APP_VERSION, privacyHref: PRIVACY_PAGE_PATH } })),
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
