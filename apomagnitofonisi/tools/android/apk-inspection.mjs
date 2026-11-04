/**
 * Τι πρέπει να ισχύει σε ένα APK της εφαρμογής, όπως το βλέπει το Android.
 *
 * Καθαρές συναρτήσεις πάνω στο κείμενο που τυπώνουν τα εργαλεία του Android
 * SDK (aapt2, apksigner) και του JDK (keytool): ανάγνωση της εξόδου τους και
 * έλεγχος package, targetSdk, δικαιωμάτων, host, scope και share target. Η
 * εκτέλεση των εργαλείων είναι στο tools/android.mjs.
 */
import { SHARE_TARGET_METADATA, SHARED_MIME_TYPES, scopePathOf } from './project.mjs';
import { formatFingerprint } from './asset-links.mjs';

/** Το Google Play δέχεται νέες εκδόσεις μόνο με targetSdk 36 (Android 16) από 31/08/2026. */
export const TARGET_SDK = 36;

/** Η «Αυτόματη προστασία» του Play Console απορρίπτει AAB με minSdk κάτω από 24 (ΡΟΔΙΟΣ, 18/10/2026). */
export const MIN_SDK = 24;

/* ---------- Ανάγνωση της εξόδου των εργαλείων ---------- */

/** aapt2 dump badging → { package, versionCode, versionName, minSdk, targetSdk, permissions }. */
export function parseBadging(text) {
  const pkg = text.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m);
  if (!pkg) throw new Error('aapt2 dump badging: δεν βρέθηκε η γραμμή package');
  const sdk = name => {
    const match = text.match(new RegExp(`^${name}:'(\\d+)'`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return {
    package: pkg[1],
    versionCode: Number(pkg[2]),
    versionName: pkg[3],
    minSdk: sdk('minSdkVersion'),
    targetSdk: sdk('targetSdkVersion'),
    permissions: [...text.matchAll(/^uses-permission: name='([^']+)'/gm)].map(m => m[1]),
  };
}

/** aapt2 dump resources → τιμή κάθε πόρου string/bool/color/integer ανά όνομα, π.χ. values['string/hostName']. */
export function parseResources(text) {
  const values = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\s+resource 0x[0-9a-f]+ ((?:string|bool|color|integer)\/\w+)\s*$/);
    if (!head) continue;
    const value = (lines[i + 1] || '').match(/^\s+\(\) (.*)$/);
    if (!value) continue;
    const raw = value[1];
    values[head[1]] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return values;
}

/**
 * apksigner verify --print-certs → τα διαφορετικά αποτυπώματα SHA-256 των πιστοποιητικών
 * υπογραφής (AB:CD:…). Έως τα build-tools 36: «Signer #1 certificate SHA-256 digest: …»,
 * από τα 37: «V3.0 Signer: certificate SHA-256 digest: …». Όχι το «public key SHA-256
 * digest» του --verbose, ούτε το Source Stamp.
 */
export function parseApksignerCerts(text) {
  const found = [...text.matchAll(/^(?![^\n]*stamp)[^\n]*\bsigner\b[^\n]*\bcertificate SHA-256 digest: ([0-9a-f]{64})\s*$/gim)];
  return [...new Set(found.map(m => formatFingerprint(m[1])))];
}

/** keytool -printcert -jarfile → τα αποτυπώματα SHA-256 των πιστοποιητικών (AB:CD:…). */
export function parseKeytoolCerts(text) {
  return [...text.matchAll(/^\s*SHA256: ((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\s*$/gm)].map(m => m[1]);
}

/* ---------- Έλεγχος ---------- */

/**
 * Το share target όπως το περιμένει το android-browser-helper: ίδια διαδρομή,
 * μέθοδος και αρχεία με το shareTarget του twa-manifest.json, meta-data και
 * intent filter SEND για ήχο και βίντεο. Επιστρέφει τη λίστα προβλημάτων.
 */
export function findShareTargetProblems({ app, twa, resources, manifestTree }) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(`${app}: ${message}`); };
  const wanted = twa.shareTarget;
  expect(!!wanted, 'το twa-manifest.json δεν έχει shareTarget');
  if (!wanted) return problems;

  let declared = null;
  try { declared = JSON.parse(resources['string/shareTarget'] || 'null'); } catch { problems.push(`${app}: το shareTarget του APK δεν είναι JSON`); }
  expect(!!declared, 'λείπει ο πόρος string/shareTarget');
  if (declared) {
    const base = `https://${twa.host}/`;
    const action = new URL(declared.action, base);
    expect(action.origin === `https://${twa.host}` && action.pathname === new URL(wanted.action, base).pathname,
      `share target action ${declared.action} αντί για ${wanted.action}`);
    expect(String(declared.method).toUpperCase() === 'POST', `share target method ${declared.method} αντί για POST`);
    expect(declared.enctype === 'multipart/form-data', `share target enctype ${declared.enctype}`);
    const files = (declared.params && declared.params.files) || [];
    expect(files.length === 1 && files[0].name === wanted.params.files[0].name, `share target αρχεία ${JSON.stringify(files)}`);
  }
  expect(manifestTree.includes(SHARE_TARGET_METADATA), `λείπει η meta-data ${SHARE_TARGET_METADATA}`);
  expect(/android\.intent\.action\.SEND\b/.test(manifestTree), 'λείπει το intent filter SEND για την κοινοποίηση αρχείων');
  for (const mime of SHARED_MIME_TYPES) {
    expect(manifestTree.includes(`"${mime}"`), `το intent filter της κοινοποίησης δεν δέχεται ${mime}`);
  }
  return problems;
}

/**
 * Όσα πρέπει να ισχύουν στο APK. Παίρνει την έξοδο των εργαλείων ήδη
 * διαβασμένη (parseBadging, parseResources, aapt2 dump xmltree) και επιστρέφει
 * τη λίστα προβλημάτων (κενή = εντάξει).
 */
export function findApkProblems({ app, twa, badging, resources, manifestTree, versionCode }) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(`${app}: ${message}`); };
  const origin = `https://${twa.host}`;
  const scopePath = scopePathOf(twa);

  expect(badging.package === twa.packageId, `package ${badging.package} αντί για ${twa.packageId}`);
  expect(badging.targetSdk === TARGET_SDK, `targetSdk ${badging.targetSdk} αντί για ${TARGET_SDK} (απαίτηση Google Play)`);
  expect(badging.minSdk === twa.minSdkVersion, `minSdk ${badging.minSdk} αντί για ${twa.minSdkVersion} του twa-manifest.json`);
  if (versionCode !== undefined) expect(badging.versionCode === Number(versionCode), `versionCode ${badging.versionCode} αντί για ${versionCode}`);

  // Κανένα δικαίωμα Android: ειδοποιήσεις, τοποθεσία και μικρόφωνο δεν χρειάζονται.
  const internal = `${twa.packageId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
  const extra = badging.permissions.filter(p => p !== internal);
  expect(extra.length === 0, `απρόσμενα δικαιώματα: ${extra.join(', ')}`);

  expect(resources['string/hostName'] === twa.host, `hostName ${resources['string/hostName']} αντί για ${twa.host}`);
  expect(resources['string/launchUrl'] === `${origin}${twa.startUrl}`, `launchUrl ${resources['string/launchUrl']} αντί για ${origin}${twa.startUrl}`);
  expect(resources['string/fullScopeUrl'] === `${origin}${scopePath}`, `fullScopeUrl ${resources['string/fullScopeUrl']}`);
  expect(resources['bool/enableNotification'] === 'false', 'οι ειδοποιήσεις πρέπει να είναι κλειστές');
  expect(resources['string/fallbackType'] === 'customtabs', `fallbackType ${resources['string/fallbackType']} αντί για customtabs`);
  let statements = [];
  try { statements = JSON.parse(resources['string/assetStatements'] || '[]'); } catch { problems.push(`${app}: το assetStatements δεν είναι JSON`); }
  const sites = statements.flat().map(s => s && s.target && s.target.site);
  expect(sites.length === 1 && sites[0] === origin, `asset statements για ${sites.join(', ') || 'κανένα site'} αντί για ${origin}`);

  // Τα links ανοίγουν την εφαρμογή μόνο για τη διαδρομή της. Στη ρίζα του domain
  // το Bubblewrap δεν βάζει καθόλου διαδρομή στο intent filter.
  const prefixes = [...manifestTree.matchAll(/:pathPrefix\([^)]*\)="([^"]*)"/g)].map(m => m[1]);
  if (scopePath === '/') expect(prefixes.length === 0 || (prefixes.length === 1 && prefixes[0] === '/'), `intent filter με pathPrefix ${prefixes.join(', ')}`);
  else expect(prefixes.length === 1 && prefixes[0] === scopePath, `intent filter με pathPrefix ${prefixes.join(', ') || '(κανένα)'} αντί για ${scopePath}`);
  expect(!/:(path|pathPattern|pathAdvancedPattern|pathSuffix)\(/.test(manifestTree), 'intent filter με διαδρομή εκτός pathPrefix');
  expect(/:autoVerify\([^)]*\)=true/.test(manifestTree), 'το intent filter δεν έχει autoVerify');

  problems.push(...findShareTargetProblems({ app, twa, resources, manifestTree }));
  return problems;
}
