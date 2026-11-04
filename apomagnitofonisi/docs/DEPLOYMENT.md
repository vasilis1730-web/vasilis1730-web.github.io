# Ανάρτηση στο Cloudflare Pages

Η Απομαγνητοφώνηση είναι στατική εφαρμογή (HTML, CSS, ES modules) χωρίς δικό
της backend. Σερβίρεται από το **Cloudflare Pages**, project `apomagnitofonisi`,
στη διεύθυνση **https://apomagnitofonisi.texnikes.app** (τεχνικό URL
`https://apomagnitofonisi.pages.dev`).

| Τι | Πού |
|---|---|
| Κώδικας | ιδιωτικό repo `vasilis1730-web/apomagnitofonisi`, branch `main` |
| Ανάρτηση | μόνο το `.github/workflows/deploy.yml`, σε κάθε push στο `main` |
| Headers και CSP | `public/_headers` (αντιγράφεται στη ρίζα του `dist/`) |
| Εφαρμογή Android | `docs/ANDROID.md`, με το `/.well-known/assetlinks.json` που παράγει το build |
| Google Play | `docs/PLAY.md` |

Ποτέ χειροκίνητο upload και ποτέ «Connect to Git» στο Cloudflare: έτσι κάθε
ανάρτηση περνά από τα ίδια tests και τους ίδιους ελέγχους.

## 1. Πώς δουλεύει η ανάρτηση

Σε κάθε push στο `main` το `deploy.yml`:

1. τρέχει `npm test` (λογική εφαρμογής, εργαλεία, workflows, Android, υγιεινή αρχείων),
2. χτίζει το `dist/` με `npm run build` για το `https://apomagnitofonisi.texnikes.app`
   (μόνο ό,τι σερβίρεται, μαζί με `_headers`, `sitemap.xml`, `robots.txt` και
   `.well-known/assetlinks.json`),
3. σταματά αν η πολιτική απορρήτου δεν έχει ακόμη email επικοινωνίας (§6),
4. δημιουργεί το Pages project την πρώτη φορά και ανεβάζει το `dist/` με `wrangler`,
5. ελέγχει και τις δύο διευθύνσεις: 200 με CSP, `X-Frame-Options`, `nosniff`,
   COOP και COEP, ίδια byte-προς-byte `sw.js`, `manifest.json` και
   `assetlinks.json`, και το `assetlinks.json` ως `application/json` χωρίς ανακατεύθυνση.

## 2. Νέο ιδιωτικό repository (μία φορά)

1. GitHub → **New repository** → όνομα `apomagnitofonisi`, **Private**, χωρίς
   README, .gitignore ή άδεια (άδειο repo).
2. Στη σελίδα της εγκατάστασης του **Claude GitHub App**
   (github.com → Settings → Applications → Claude → Configure) πρόσβαση και σε αυτό το repo.
3. Ο κώδικας ανεβαίνει με όλο το ιστορικό του. Από αντίγραφο όπου η εφαρμογή
   είναι στη ρίζα:
   ```sh
   git remote add origin https://github.com/vasilis1730-web/apomagnitofonisi.git
   git push -u origin main
   ```

## 3. Secrets του GitHub (μία φορά)

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Τιμή |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token με δικαίωμα **Account → Cloudflare Pages → Edit** (το ίδιο με των άλλων εφαρμογών του texnikes.app, αν έχει αυτό το δικαίωμα) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → **Workers & Pages** → στη δεξιά στήλη «Account ID» |

Νέο token: Cloudflare → εικονίδιο λογαριασμού → **My Profile → API Tokens →
Create Token → Create Custom Token** → Permissions: *Account, Cloudflare Pages,
Edit* → Account Resources: ο λογαριασμός του texnikes.app → **Continue to
summary → Create Token**. Το token φαίνεται μία φορά: κατευθείαν στο secret.

Για την εφαρμογή Android χρειάζονται και τα secrets `ANDROID_*` (`docs/ANDROID.md` §3).

## 4. Πρώτη ανάρτηση και custom domain

1. Push στο `main` (ή **Actions → Deploy to Cloudflare Pages → Run workflow**).
   Το workflow δημιουργεί το project `apomagnitofonisi` και ανεβάζει την εφαρμογή.
   Η εφαρμογή απαντά αμέσως στο `https://apomagnitofonisi.pages.dev`. Ο έλεγχος
   του custom domain αποτυγχάνει αυτή την πρώτη φορά, γιατί το domain δεν έχει
   συνδεθεί ακόμη: αναμενόμενο.
2. Cloudflare → **Workers & Pages** → `apomagnitofonisi` → καρτέλα **Custom domains**
   → **Set up a custom domain** → `apomagnitofonisi.texnikes.app` → **Continue**
   → **Activate domain**. Επειδή το `texnikes.app` είναι στον ίδιο λογαριασμό
   Cloudflare, η εγγραφή DNS (CNAME προς `apomagnitofonisi.pages.dev`) μπαίνει
   αυτόματα. Σε λίγα λεπτά η κατάσταση γίνεται **Active** και το πιστοποιητικό
   εκδίδεται μόνο του.
3. **Actions → Deploy to Cloudflare Pages → Run workflow** ξανά: τώρα περνούν και
   οι έλεγχοι του custom domain.

Αν το domain πρέπει να μείνει ασύνδετο για καιρό, το `PUBLIC_URL` του
`deploy.yml` γίνεται προσωρινά `''` και ελέγχεται μόνο το `pages.dev` (τότε όμως
και η εφαρμογή Android δεν μπορεί να δοκιμαστεί, γιατί δείχνει στο custom domain).

## 5. Έλεγχος με το χέρι

```sh
curl -sI https://apomagnitofonisi.texnikes.app/ | grep -i -E '^(HTTP|content-security|cross-origin|x-frame)'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://apomagnitofonisi.texnikes.app/.well-known/assetlinks.json
```

Στον browser: άνοιγμα της εφαρμογής, F12 → Console χωρίς μηνύματα «Refused to …»
(CSP) και `crossOriginIsolated` ίσο με `true`.

## 6. Email επικοινωνίας της πολιτικής απορρήτου

Μια δημόσια εφαρμογή στο Google Play χρειάζεται πολιτική απορρήτου με τρόπο
επικοινωνίας. Μέχρι να αποφασιστεί ποιο email θα φαίνεται δημόσια, τα αρχεία
έχουν το σημάδι `__CONTACT_EMAIL__` (στο `privacy.html` και στο
`src/config/app-info.js`). Το `npm run build` το επισημαίνει και το `deploy.yml`
**αρνείται** να ανεβάσει την εφαρμογή όσο υπάρχει. Ένα email αφιερωμένο στην
εφαρμογή είναι καλύτερο από το προσωπικό, γιατί εμφανίζεται δημόσια και στη
σελίδα του Play Store (`docs/PLAY.md` §7).

## 7. Τοπική δοκιμή

```sh
npm ci --ignore-scripts
npm test                 # λογική, εργαλεία, workflows, Android, υγιεινή αρχείων
npm run build            # dist/ για το pages.dev
npm run test:browser     # πραγματικός Chromium πάνω στο dist με την πραγματική CSP
npm run preview          # wrangler pages dev dist, στο http://localhost:8788
```

Μέσα από το περιβάλλον του Claude Code το HTTPS περνά από proxy με δικό του
πιστοποιητικό: `APOMAGN_BROWSER_IGNORE_TLS=1 npm run test:browser`. Στο CI δεν χρειάζεται.

## 8. Βιβλιοθήκες και CSP

- Οι βιβλιοθήκες τρίτων (Transformers.js, Mediabunny, Anthropic SDK) φορτώνονται
  από το jsDelivr, σε **ακριβείς** εκδόσεις, και τα URL τους ζουν **μόνο** στο
  `src/config/vendor.js`. Αναβάθμιση = αλλαγή εκεί και πλήρης δοκιμή στον browser.
- Κάθε νέο εξωτερικό host (API, CDN) μπαίνει στο `public/_headers`, αλλιώς το
  `npm run build` και το `npm test` αρνούνται. Οι σύνδεσμοι που απλώς ανοίγει ο
  χρήστης (π.χ. «Δημιουργία κλειδιού») δηλώνονται στο `NAVIGATION_HOSTS` του
  `tools/source-checks.mjs`.
- Τα μοντέλα Whisper κατεβαίνουν από το Hugging Face (`huggingface.co` και
  `*.hf.co`) και τα κρατά ο browser στην cache του. Κανένα δικό μας server δεν
  βλέπει ήχο, κείμενο ή κλειδιά.
