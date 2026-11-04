# Εφαρμογή Android (Google Play)

Η Απομαγνητοφώνηση διατίθεται και ως εφαρμογή Android. Είναι **Trusted Web
Activity** (TWA, με το Bubblewrap της Google): η εφαρμογή ανοίγει το
`https://apomagnitofonisi.texnikes.app/` σε πλήρη οθόνη μέσα στο Chrome, χωρίς
γραμμή διευθύνσεων. Ό,τι βλέπει ο χρήστης είναι το ίδιο το site, οπότε **κάθε
deploy στο `main` φτάνει αμέσως και στα κινητά**. Νέα έκδοση στο Play χρειάζεται
μόνο όταν αλλάζει το ίδιο το «κέλυφος» Android (§8).

| | |
|---|---|
| Package (μόνιμο στο Play) | `gr.rhodes.apomagnitofonisi` |
| Ανοίγει | `https://apomagnitofonisi.texnikes.app/` |
| Όνομα / στην αρχική οθόνη | Απομαγνητοφώνηση (στην αρχική οθόνη μπορεί να κόβεται, είναι μεγάλο) |
| Project | `android/apomagnitofonisi/` (Bubblewrap 1.25.0, targetSdk 36, minSdk 24) |
| Εικονίδιο | `assets/icons/icon-512.png` και `icon-maskable-512.png` (`npm run icons`) |
| Κοινοποίηση | δέχεται αρχεία ήχου και βίντεο από άλλες εφαρμογές (§7) |
| Δικαιώματα Android | κανένα |

## 1. Πώς δουλεύει

- Το APK περιέχει μόνο το «κέλυφος»: όνομα, χρώματα, εικονίδιο, splash, το
  domain και το share target. Ο κώδικας της εφαρμογής είναι στο site.
- Για να ανοίγει το Chrome την εφαρμογή **χωρίς γραμμή διευθύνσεων**, το domain
  σερβίρει το `/.well-known/assetlinks.json` με το package και το αποτύπωμα
  SHA-256 κάθε κλειδιού που υπογράφει την εφαρμογή (§4). Το παράγει το
  `npm run build` από το `fingerprints` του `android/apomagnitofonisi/twa-manifest.json`.
- Χωρίς Chrome (ή άλλον browser με TWA) η εφαρμογή ανοίγει σε Custom Tab με
  γραμμή διευθύνσεων (`fallbackType: customtabs`).
- Η μεταγραφή στη συσκευή τρέχει μέσα στο Chrome (WebGPU ή WASM), όπως στον
  browser. Κανένα δικαίωμα Android δεν χρειάζεται: τα αρχεία τα επιλέγει ο
  χρήστης από το σύστημα επιλογής αρχείων ή τα μοιράζεται από άλλη εφαρμογή.

## 2. Τι υπάρχει στο repository

| Αρχείο | Ρόλος |
|---|---|
| `android/apomagnitofonisi/` | Το project του Bubblewrap 1.25.0 με τις διορθώσεις της §9 (σχόλια `ΑΠΟΜΑΓΝΗΤΟΦΩΝΗΣΗ:`) |
| `android/apomagnitofonisi/twa-manifest.json` | Μοναδική πηγή για package, host, χρώματα, share target και αποτυπώματα |
| `tools/android/` | `project.mjs` (διαδρομές, twa-manifest), `asset-links.mjs` (το assetlinks.json του build), `play-version.mjs` (versionCode), `apk-inspection.mjs` (έλεγχος APK: package, targetSdk, δικαιώματα, host, share target) |
| `tools/android.mjs` | Οι εντολές `version`, `inspect` και `release` (υπογραφή, επαλήθευση, σύνοψη) με τα εργαλεία του Android SDK. Το versionCode δίνεται σε όλες με την ίδια παράμετρο `--version-code` και ελέγχεται μία φορά, πριν από κάθε δουλειά (ακέραιος από 1 έως 2.100.000.000, υποχρεωτικός στο `release`). Κάθε εντολή απορρίπτει όποια παράμετρο δεν είναι δική της. Το `release` γράφει στο `--out` (προαιρετικό, προεπιλογή `android-release`): αρνείται φάκελο που περιέχει το repository ή το keystore, ελέγχει πρώτα ότι υπάρχουν οι έξοδοι του Gradle και σβήνει από εκεί μόνο ό,τι φτιάχνει το ίδιο (`*.apk`, `*.aab`, `SHA256SUMS`) |
| `.github/workflows/android.yml` | Χειροκίνητο, μόνο από το `main`: tests → έκδοση → Gradle → υπογραφή → artifact 30 ημερών |
| `.github/workflows/test.yml` (job `android`) | Build χωρίς υπογραφή σε κάθε push, `inspect`, και έλεγχος ότι το build δεν αφήνει αλλαγές |
| `tests/infra/android.test.mjs` | Συνέπεια με το web manifest, Gradle wrapper, αποτυπώματα, κανένα κλειδί στο repository |

## 3. Κλειδί υπογραφής και secrets (μία φορά)

Το Play δέχεται μόνο AAB υπογεγραμμένα με το **upload key** του λογαριασμού.
Χρησιμοποιείται **το ίδιο keystore με τις εφαρμογές ΡΟΔΙΟΣ** (upload key
`3E:0F:E0:35:…:FB:1B:5F:79`). Το Play ξαναϋπογράφει την εφαρμογή για τα κινητά
με τα δικά του κλειδιά «Υπογραφή εφαρμογής» (§4).

**Το keystore και οι κωδικοί του δεν μπαίνουν ποτέ στο repository.** Το
`.gitignore` αποκλείει `*.keystore`, `*.jks`, `*.p12`, `*.pfx`,
`signing-key-info.txt`, και το `npm test` αποτυγχάνει αν βρει τέτοιο αρχείο.

GitHub → repo `apomagnitofonisi` → **Settings → Secrets and variables → Actions
→ New repository secret**, με τις **ίδιες τιμές** που έχουν τα secrets του repo
`rodios-aitimata-entoles` (τα secrets δεν αντιγράφονται από repo σε repo, ξαναγράφονται):

| Secret | Τιμή |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | το keystore σε base64, σε μία γραμμή |
| `ANDROID_KEYSTORE_PASSWORD` | ο κωδικός του keystore |
| `ANDROID_KEY_ALIAS` | το alias του κλειδιού |
| `ANDROID_KEY_PASSWORD` | ο κωδικός του κλειδιού (κενό = ίδιος με του keystore) |

Το base64: Linux `base64 -w0 signing.keystore > keystore.b64`, macOS
`base64 -i signing.keystore -o keystore.b64`, Windows (PowerShell στον φάκελο του
keystore) `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\signing.keystore")) | Set-Clipboard`.
Μετά, διαγραφή του `keystore.b64`.

## 4. Αποτυπώματα (assetlinks.json)

Σήμερα το `twa-manifest.json` έχει **μόνο το upload key**, ώστε το `.apk` δοκιμής
του `android.yml` να ανοίγει χωρίς γραμμή διευθύνσεων από την πρώτη μέρα.

Οι εγκαταστάσεις από το Play υπογράφονται με τα κλειδιά «Υπογραφή εφαρμογής»
της Google, που υπάρχουν **μόνο αφού δημιουργηθεί η εφαρμογή στο Play Console και
ανέβει το πρώτο AAB**. Οι νέες εφαρμογές του 2026 έχουν υπογραφή «έτοιμη για
κβαντική υπολογιστική» με **τρία** κλειδιά (όπως οι Εντολές και ο Προμηθευτής του ΡΟΔΙΟΣ):

| Κλειδί στη σελίδα | Κινητά |
|---|---|
| «Κλασικό κλειδί» (RSA 4096) | Android 13 έως 16 |
| «Κλειδί μετακβαντικής κρυπτογράφησης» | Android 17 και νεότερα |
| «Προηγούμενα κλειδιά» | Android 12 και παλαιότερα |

Πού: Play Console → η εφαρμογή → **Προστατεύεται με το Play** → «Υπογραφή
εφαρμογής» (ή αναζήτηση «app signing»). Τα δύο πρώτα έχουν το καθένα δικό του
«Αποτύπωμα πιστοποιητικού SHA-256». Το τρίτο είναι αυτό του έτοιμου JSON «Digital
Asset Links» της σελίδας, που γι' αυτό **δεν αρκεί** μόνο του. Το πλαίσιο στο
κάτω μέρος της σελίδας είναι το upload key, που υπάρχει ήδη.

Μπαίνουν και τα τρία στο `android/apomagnitofonisi/twa-manifest.json`, πριν από
το upload key, και ακολουθεί push στο `main`:

```json
"fingerprints": [
  { "name": "Play App signing key, κλασικό κλειδί (Android 13-16, Play Console ΗΗ/ΜΜ/ΕΕΕΕ)", "value": "AB:CD:…:EF" },
  { "name": "Play App signing key, μετακβαντικό κλειδί (Android 17+, Play Console ΗΗ/ΜΜ/ΕΕΕΕ)", "value": "…" },
  { "name": "Play App signing key, προηγούμενο κλειδί (Android 12 και παλαιότερα)", "value": "…" },
  { "name": "Upload key (ίδιο με των εφαρμογών ΡΟΔΙΟΣ)", "value": "3E:0F:E0:35:CA:50:D6:EF:79:FA:97:2F:6B:1B:F7:77:A4:61:C9:A9:35:A5:DF:BC:42:39:A8:22:FB:1B:5F:79" }
]
```

Μορφή: 32 byte σε κεφαλαία με `:`. Το build αρνείται οτιδήποτε άλλο. Μετά το
push, το deploy δημοσιεύει το `/.well-known/assetlinks.json` και ελέγχει ότι
σερβίρεται ίδιο, με 200 και `application/json`. Χωρίς τα κλειδιά του Play, όποιος
εγκαταστήσει την εφαρμογή από το Play τη βλέπει **με γραμμή διευθύνσεων**.

Τι βλέπει η Google:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://apomagnitofonisi.texnikes.app&relation=delegate_permission/common.handle_all_urls`

## 5. Έκδοση για το Play (κάθε φορά)

1. Οι αλλαγές είναι στο `main` και το *Deploy to Cloudflare Pages* πέρασε.
2. **Actions → Android (Google Play) → Run workflow** (branch `main`). Το
   `version_code` μένει κενό, εκτός αν χρειάζεται συγκεκριμένος αριθμός.
3. Το workflow τρέχει τα tests, χτίζει, υπογράφει με το upload key, επαληθεύει
   υπογραφές, package, `targetSdk`, share target και host, και γράφει στη σύνοψη
   το αποτύπωμα του κλειδιού και αν το γνωρίζουν το repo, το domain και η Google.
4. Artifact `apomagnitofonisi-android-<versionCode>` (30 ημέρες):
   `apomagnitofonisi-<versionCode>.aab` για το Play Console,
   `apomagnitofonisi-<versionCode>.apk` για απευθείας δοκιμή σε κινητό, και `SHA256SUMS`.
5. Play Console → η εφαρμογή → **Δοκιμή και κυκλοφορία** → το κανάλι
   (Εσωτερική δοκιμή, Κλειστές δοκιμές ή Παραγωγή) → **Δημιουργία νέας
   κυκλοφορίας** → «Πακέτα εφαρμογών» → **Μεταφόρτωση** του `.aab` (ή **Προσθήκη
   από τη βιβλιοθήκη**, αν έχει ήδη ανέβει) → **Επόμενο** → **Αποθήκευση και
   δημοσίευση** → **Επισκόπηση δημοσίευσης** για ό,τι περιμένει αποστολή.

**Έκδοση**: `versionCode` = ώρα UTC του build σε μορφή ΕΕΕΕΜΜΗΗΩΩ (π.χ.
`2026110414`), `versionName` = `2026.11.04.14`. Κάθε build έχει μεγαλύτερο
αριθμό χωρίς commit. Δύο builds στην ίδια ώρα παίρνουν τον ίδιο αριθμό και το
Play δέχεται μόνο το πρώτο: τότε δίνεται ρητός αριθμός στο `version_code`. Στην
πρώτη κυκλοφορία το Play γράφει ότι ο κωδικός είναι «σημαντικά υψηλότερος»:
**«Συνέχεια ούτως ή άλλως»**.

Τοπικά, η ίδια έκδοση με το workflow:

```sh
node tools/android.mjs version                           # versionCode από την ώρα UTC
node tools/android.mjs version --version-code 2026110415 # ρητός αριθμός
```

## 6. Δοκιμή με το `.apk`

Το `.apk` του artifact εγκαθίσταται απευθείας (μεταφορά στο κινητό, άνοιγμα,
«Εγκατάσταση από άγνωστες πηγές» για τον browser ή τα Αρχεία). Είναι
υπογεγραμμένο με το upload key, που είναι ήδη στο assetlinks, οπότε ανοίγει
χωρίς γραμμή διευθύνσεων **μόλις το site είναι ζωντανό στο custom domain**. Αν
στο κινητό υπάρχει ήδη η εφαρμογή από το Play, απεγκατάσταση πρώτα («Η εφαρμογή
δεν εγκαταστάθηκε» σημαίνει άλλη υπογραφή).

## 7. Κοινοποίηση ήχου και βίντεο (share target)

Από το Viber, το WhatsApp, την εγγραφή ήχου ή τα Αρχεία: **Κοινοποίηση →
Απομαγνητοφώνηση**. Το Android δίνει το αρχείο στην εφαρμογή, το
android-browser-helper το στέλνει στο Chrome ως `POST /share-target`
(multipart, πεδίο `media`), ο service worker της εφαρμογής το κρατά και ανοίγει
την αρχική σελίδα με το αρχείο έτοιμο για μεταγραφή.

- Το Android δηλώνει μόνο `audio/*` και `video/*` (όχι απλό κείμενο), ώστε η
  εφαρμογή να μην εμφανίζεται όταν ο χρήστης μοιράζεται συνδέσμους.
- Το share target ορίζεται σε τρία σημεία που πρέπει να συμφωνούν: στο
  `share_target` του `manifest.json`, στο `shareTarget` του `twa-manifest.json`
  και στο `app/build.gradle` (πόρος `shareTarget`). Το ελέγχει το `npm test`, και
  στο APK το `tools/android.mjs inspect`.

## 8. Πότε χρειάζεται νέα έκδοση στο Play

- Αλλαγή στο site (HTML, JS, CSS, μοντέλα, κείμενα): **καμία**, φτάνει με το deploy.
- Όνομα, χρώματα, εικονίδιο, share target, domain, `targetSdk`: νέα έκδοση.
- Το Play δέχεται νέες εκδόσεις μόνο με `targetSdk` το πολύ ένα χρόνο πίσω από
  την τελευταία έκδοση Android: προθεσμία κάθε **31 Αυγούστου** (API 37 από
  31/08/2027). Πριν από την προθεσμία: νεότερο Bubblewrap, αναγέννηση (§9).

## 9. Αναγέννηση του project (π.χ. για νέο targetSdk)

Το project παράχθηκε με το `@bubblewrap/core@1.25.0` από το web manifest της
εφαρμογής, όπως το `generate_twa.cjs` του skill «android-play-metafora», με αυτές
τις ρυθμίσεις: host `apomagnitofonisi.texnikes.app`, `startUrl` `/`, χρώματα όλα
`#0E3B43`, `orientation: default`, `minSdkVersion: 24`, ειδοποιήσεις κλειστές,
`fallbackType: customtabs`, share target μόνο με αρχεία (`media`, `audio/*` και
`video/*`, χωρίς `title`/`text`). Το Bubblewrap κατεβάζει το web manifest από το
`webManifestUrl` την ώρα της παραγωγής, οπότε σε περιβάλλον χωρίς πρόσβαση στο
domain σερβίρεται τοπικά και η διεύθυνση της παραγωγής γράφεται μετά στο
`twa-manifest.json` και στο `app/build.gradle`.

Μετά την παραγωγή, οι διορθώσεις (με σχόλιο `ΑΠΟΜΑΓΝΗΤΟΦΩΝΗΣΗ:` όπου αλλάζει κώδικας):

1. `build.gradle`: `jcenter()` → `mavenCentral()` και στα δύο σημεία.
2. Gradle wrapper: το επίσημο της 8.11.1 (jar με SHA-256
   `2db75c40…88448046`, `distributionSha256Sum` στο properties), όπως στο ΡΟΔΙΟΣ.
3. `app/build.gradle`: έκδοση από το workflow
   (`-PapomagnitofonisiVersionCode`, `-PapomagnitofonisiVersionName`) και σχόλιο για το minSdk 24.
4. `app/src/main/res/xml/shortcuts.xml` στη μορφή που το ξαναγράφει το Gradle.
5. Τα αποτυπώματα του `twa-manifest.json` ξαναμπαίνουν όπως ήταν.

Το `npm test` (`tests/infra/android.test.mjs`) θυμίζει όποια διόρθωση ξεχαστεί.

## 10. Αντιμετώπιση προβλημάτων

| Σύμπτωμα | Αιτία | Λύση |
|---|---|---|
| Η εφαρμογή ανοίγει με γραμμή διευθύνσεων | Λείπει από το assetlinks το αποτύπωμα του κλειδιού που υπέγραψε την εγκατάσταση (Play: τα τρία κλειδιά, `.apk`: το upload key) | §4, deploy, απεγκατάσταση και ξανά εγκατάσταση |
| Το Play απορρίπτει το AAB για minSdk | minSdk κάτω από 24 μετά από αναγέννηση | `minSdkVersion 24` στο `twa-manifest.json` και στο `app/build.gradle` |
| «Θα πρέπει να ανεβάσετε ένα APK ή AAB» | Το AAB είναι στη βιβλιοθήκη αλλά όχι στην κυκλοφορία | «Προσθήκη από τη βιβλιοθήκη», όχι νέο ανέβασμα |
| 404 στον σύνδεσμο δοκιμής | Πρώτη δημοσίευση, θέλει ώρες έως 1 με 2 ημέρες | Στο μεταξύ δοκιμή με το `.apk` |
| Η εφαρμογή δεν εμφανίζεται στην «Κοινοποίηση» | Παλιά έκδοση χωρίς share target, ή αρχείο που δεν είναι ήχος/βίντεο | Νέα έκδοση από το `android.yml`, έλεγχος τύπου αρχείου |
| Το Gradle αποτυγχάνει με 429 από το Maven Central | Όριο αιτημάτων | Νέα προσπάθεια σε λίγο |

## 11. Τοπικό build (προαιρετικό)

Χρειάζονται JDK 17 ή νεότερο και Android SDK με `platforms;android-36` και
`build-tools;36.0.0`:

```sh
export ANDROID_HOME=/opt/android-sdk
# command-line tools από https://dl.google.com/android/repository/ (commandlinetools-linux-…_latest.zip)
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME "platforms;android-36" "build-tools;36.0.0"
cd android/apomagnitofonisi && ./gradlew --no-daemon -PapomagnitofonisiVersionCode=2026010100 -PapomagnitofonisiVersionName=ci assembleRelease bundleRelease
cd ../.. && node tools/android.mjs inspect --version-code 2026010100
```

Για τοπική υπογραφή, μόνο με δοκιμαστικό keystore έξω από το repository.
