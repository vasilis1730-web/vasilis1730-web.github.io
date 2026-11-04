# apomagnitofonisi

**Απομαγνητοφώνηση**: στατική εφαρμογή (PWA) χωρίς bundler, που μετατρέπει
αρχεία ήχου και βίντεο σε κείμενο, με ομιλητές, χρόνους, υπότιτλους (.srt,
.vtt), εξαγωγή σε Word και περίληψη ή πρακτικά. **Δημόσια εφαρμογή** στο Google
Play (TWA, `android/`, `docs/ANDROID.md`, `docs/PLAY.md`).

- Μεταγραφή **στη συσκευή**: Whisper μέσω Transformers.js σε Web Worker (WebGPU ή WASM).
- Μεταγραφή **στο cloud**: ElevenLabs Scribe, με το κλειδί του ίδιου του χρήστη.
- Περίληψη και πρακτικά: Claude της Anthropic, με το κλειδί του ίδιου του χρήστη.
- Ανάγνωση αρχείων: Mediabunny. Ιστορικό και ρυθμίσεις μόνο στη συσκευή (IndexedDB, localStorage).
- **Κανένα δικό μας backend.** Ήχος, κείμενα και κλειδιά δεν περνούν ποτέ από δικό μας server.

**Δεν είναι εφαρμογή του Δήμου Ρόδου ή άλλου φορέα.** Είναι ανεξάρτητη εφαρμογή
του δημιουργού της. Κείμενα, καταχώριση καταστήματος και δηλώσεις («Κρατικές
εφαρμογές» στο Play Console: Όχι) δεν την παρουσιάζουν ως εφαρμογή φορέα.

## Φιλοξενία

- Διεύθυνση: **https://apomagnitofonisi.texnikes.app** (Cloudflare Pages project
  `apomagnitofonisi`, τεχνικό URL `https://apomagnitofonisi.pages.dev`).
- Deploy **μόνο** από το `.github/workflows/deploy.yml` σε κάθε push στο `main`:
  tests → `npm run build` → έλεγχος email επικοινωνίας → `wrangler pages deploy dist`
  → έλεγχος headers και αρχείων. Ποτέ χειροκίνητο upload, ποτέ «Connect to Git».
- Λεπτομέρειες, secrets και custom domain: `docs/DEPLOYMENT.md`.

## Πριν από κάθε αλλαγή

```sh
npm ci --ignore-scripts
npm test               # λογική εφαρμογής (tests/unit) και υποδομή (tests/infra)
npm run build          # dist/: μόνο ό,τι σερβίρεται + _headers + sitemap/robots + .well-known/assetlinks.json
npm run test:browser   # πραγματικός Chromium πάνω στο dist με την πραγματική CSP (θέλει δίκτυο)
```

Μέσα από το Claude Code: `APOMAGN_BROWSER_IGNORE_TLS=1 npm run test:browser` (proxy με δικό του πιστοποιητικό).

## Κανόνες

- **Χωρίς άνω τελεία.** Κανένα αρχείο (κώδικας, σχόλια, κείμενα, τεκμηρίωση,
  tests) δεν έχει τον χαρακτήρα U+0387 ή U+00B7: κόμμα ή τελεία ανάλογα με το
  νόημα. Τα tests που τον χρειάζονται τον γράφουν ως escape
  (`String.fromCharCode(0x387)`). Το ελέγχουν το `npm test` και το build.
- **CSP**: ζει στο `public/_headers`. Κάθε νέο εξωτερικό host που ζητά ο κώδικας
  μπαίνει εκεί, αλλιώς το `npm run build` αρνείται. Σύνδεσμοι που απλώς ανοίγει ο
  χρήστης δηλώνονται στο `NAVIGATION_HOSTS` του `tools/source-checks.mjs`. Όχι
  inline script ή style, όχι `on…=` και `style=` στο HTML, όχι import maps.
- **Βιβλιοθήκες τρίτων**: μόνο στο `src/config/vendor.js`, από το jsDelivr, σε
  **ακριβή** έκδοση (`pkg@X.Y.Z`). Φορτώνονται με δυναμικό `import()` μόνο όταν
  χρειάζονται, και μόνο μέσω του `src/infrastructure/vendor-loader.js`.
- **Στρώματα (Clean Architecture)**: `domain` → μόνο `domain`, `application` →
  `application`/`domain`/`config`, `infrastructure` → `infrastructure`/`application`/`domain`/`config`,
  `ui` → `ui`/`application`/`domain`/`config`, `config` → τίποτα. Μετρούν και οι
  τύποι JSDoc `import('…')`: μια προβολή δεν γράφει τύπο από το `infrastructure/`,
  ο τύπος μπαίνει ως θύρα στο `src/application/ports.js`. Επιπλέον:
  - δύο composition roots, που κανείς δεν εισάγει: το `src/main.js` (σελίδα, και
    μόνο εκεί `new Worker(`) και το `src/infrastructure/whisper/whisper-worker.js`
    (worker). Το `src/main.js` ξεκινά τον worker με `new URL('…', import.meta.url)`,
    που μετρά ως εξάρτηση αρχείου και πρέπει να υπάρχει,
  - κανένας κύκλος ανάμεσα σε modules, ούτε μέσω τύπων JSDoc (κοινές σταθερές σε
    δικό τους module, όπως `key-providers.js` και `export-formats.js`),
  - `domain` και `application` χωρίς globals του browser (`window`, `document`,
    `fetch`, `localStorage` κ.λπ.): ό,τι χρειάζονται τους δίνεται από θύρα,
  - τα `ui/components` δεν εξαρτώνται από `ui/views`,
  - κάθε πάροχος του `infrastructure` (`whisper`, `elevenlabs`, `anthropic`,
    `media`, `export`) βλέπει μόνο τον εαυτό του και τα κοινά (`platform`,
    `http`, `storage`, `vendor-loader.js`), και τα κοινά κανέναν πάροχο. Νέος
    φάκελος δηλώνεται ρητά στο `tools/import-graph.mjs`,
  - το `infrastructure` παίρνει από την `application` μόνο συμβόλαια και σταθερές
    (`APPLICATION_CONTRACTS`: `ports.js`, `errors.js`, `progress.js`, …), ποτέ υπηρεσίες,
  - τα `tools/` διαβάζουν από το `src/` μόνο το `src/config/`.

  Τα ελέγχει το `tests/infra/architecture.test.mjs` (κανόνες στο `tools/import-graph.mjs`).
- **COOP/COEP**: η σελίδα είναι cross-origin isolated (πολυνηματικό WASM). Κάθε
  πόρος τρίτου φορτώνεται με CORS.
- **Κλειδιά**: τα κλειδιά των χρηστών μένουν στη συσκευή τους. Κανένα κλειδί στο
  repository (το ελέγχει το `npm test`). Τα δικά μας (Cloudflare, keystore) μόνο στα GitHub secrets.
- **Πολιτική απορρήτου**: δημόσια εφαρμογή, άρα τα κείμενα του `privacy.html`
  πρέπει να γράφουν τους πραγματικούς παρόχους (ElevenLabs, Anthropic, Hugging
  Face, jsDelivr, Cloudflare). Το email επικοινωνίας ζει στο `CONTACT_EMAIL` του
  `src/config/app-info.js` (εκεί και το `SITE_URL`, που διαβάζει και το build) και
  πρέπει να γράφεται ίδιο στο `privacy.html`. Σήμερα είναι το `vasilis1730@gmail.com`.
  Αν λείπει ή διαφέρει, το `node tools/build-dist.mjs --check-contact` του deploy αρνείται (`docs/DEPLOYMENT.md` §6).
- **Ονόματα αρχείων που παράγει η εφαρμογή για τον χρήστη** (Word, υπότιτλοι,
  κείμενο): με κενά, ποτέ με κάτω παύλες.
- Workflows: μόνο `test.yml`, `deploy.yml` και το χειροκίνητο `android.yml`.
  Actions καρφιτσωμένα σε πλήρες SHA, `permissions: contents: read`, secrets και
  inputs μόνο μέσω `env:` (ποτέ `${{ }}` μέσα σε `run:`). Το ελέγχει test.

## Android (Google Play)

- `android/apomagnitofonisi` (`gr.rhodes.apomagnitofonisi`, **μόνιμο** στο Play):
  project του Bubblewrap 1.25.0, `targetSdk` 36, `minSdk` 24, κανένα δικαίωμα
  Android, share target για ήχο και βίντεο. Οι αλλαγές σε σχέση με το πρότυπο του
  Bubblewrap έχουν σχόλιο `ΑΠΟΜΑΓΝΗΤΟΦΩΝΗΣΗ:`.
- Μοναδική πηγή: `android/apomagnitofonisi/twa-manifest.json`. Από τα
  `fingerprints` του το build παράγει το `/.well-known/assetlinks.json`, που το
  deploy ελέγχει. Χωρίς σωστό αποτύπωμα η εφαρμογή ανοίγει με γραμμή διευθύνσεων.
  Σήμερα υπάρχει μόνο το upload key, τα τρία κλειδιά του Play μπαίνουν μετά το
  πρώτο AAB (`docs/ANDROID.md` §4).
- Αλλαγή σε όνομα, χρώματα ή share target του `manifest.json` θέλει την ίδια
  αλλαγή στο Android (το `npm test` κοκκινίζει) και νέα έκδοση στο Play. Αλλαγή
  σε HTML, JS ή CSS όχι.
- `tools/android.mjs`: `version`, `inspect` και `release` με την ίδια παράμετρο
  `--version-code` (π.χ. `node tools/android.mjs version --version-code 2026110415`),
  κάθε άλλη παράμετρος μιας εντολής απορρίπτεται.
- Το keystore και οι κωδικοί του **ποτέ** στο repository, μόνο στα GitHub secrets
  (ίδιο keystore με τις εφαρμογές ΡΟΔΙΟΣ).

## Τεκμηρίωση

- `docs/DEPLOYMENT.md`: νέο repository, secrets, Cloudflare Pages, custom domain, email επικοινωνίας, βιβλιοθήκες και CSP.
- `docs/ANDROID.md`: η εφαρμογή Android, υπογραφή, αποτυπώματα, έκδοση για το Play, share target, αναγέννηση, προβλήματα.
- `docs/PLAY.md`: Play Console για δημόσια εφαρμογή, δηλώσεις, ασφάλεια δεδομένων, κείμενα καταστήματος, κλειστή δοκιμή.
- Κοινό playbook μεταφοράς εφαρμογών στο Cloudflare: repo `vasilis1730-web/texnikes-playbook`, `docs/MIGRATION-PLAYBOOK.md`.
