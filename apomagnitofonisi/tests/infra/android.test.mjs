import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../tools/paths.mjs';
import { ANDROID_DIR, ANDROID_APPS, SHARE_TARGET_METADATA, SHARED_MIME_TYPES, readTwaManifest, scopePathOf } from '../../tools/android/project.mjs';
import { ASSET_LINK_RELATIONS, assetLinks, assetLinksJson, formatFingerprint } from '../../tools/android/asset-links.mjs';
import { MAX_VERSION_CODE, versionFor } from '../../tools/android/play-version.mjs';
import {
  TARGET_SDK, MIN_SDK, parseBadging, parseResources, parseApksignerCerts, parseKeytoolCerts, checkApk, checkShareTarget,
} from '../../tools/android/apk-inspection.mjs';
import { parseArgs, releaseSummary, COMMAND_FLAGS } from '../../tools/android.mjs';
import { read, exists, skipWhileAppPending, tempDir } from './helpers.mjs';

/* Η εφαρμογή Android (Trusted Web Activity, project του Bubblewrap στο
   android/apomagnitofonisi). Ανοίγει το https://apomagnitofonisi.texnikes.app/
   μέσα στο Chrome, ό,τι βλέπει ο χρήστης είναι το ίδιο το site. Οι δοκιμές εγγυώνται:
   - package, host, όνομα, χρώματα και share target συμφωνούν σε
     twa-manifest.json, Gradle, AndroidManifest και web manifest,
   - targetSdk 36 (απαίτηση του Play), minSdk 24, κανένα δικαίωμα Android,
   - επίσημο Gradle wrapper με checksums,
   - σωστό /.well-known/assetlinks.json και έκδοση για το Play,
   - κανένα κλειδί υπογραφής στο repository.
   Το πραγματικό APK ελέγχεται στο CI (test.yml, job android) με το
   tools/android.mjs inspect. */

const APP = 'apomagnitofonisi';
const HOST = 'apomagnitofonisi.texnikes.app';
/** Το package είναι μόνιμο στο Google Play: δεν αλλάζει ποτέ μετά την πρώτη έκδοση. */
const PACKAGE = 'gr.rhodes.apomagnitofonisi';
/** Το upload key του λογαριασμού developer: ίδιο με των εφαρμογών ΡΟΔΙΟΣ (Play Console 24/09/2026). */
const UPLOAD_KEY = '3E:0F:E0:35:CA:50:D6:EF:79:FA:97:2F:6B:1B:F7:77:A4:61:C9:A9:35:A5:DF:BC:42:39:A8:22:FB:1B:5F:79';
/** Gradle 8.11.1 του Bubblewrap 1.25.0, επίσημα checksums του services.gradle.org. */
const GRADLE = Object.freeze({
  distributionUrl: 'https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip',
  distributionSha256Sum: 'f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6',
  wrapperJarSha256: '2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046',
});
const SHORTCUTS_XML = "<shortcuts xmlns:android='http://schemas.android.com/apk/res/android' />\n";
const MARKER = 'ΑΠΟΜΑΓΝΗΤΟΦΩΝΗΣΗ:';

const dir = `${ANDROID_DIR}/${APP}`;
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const webManifest = () => JSON.parse(read('manifest.json'));
const origin = `https://${HOST}`;

test('στο android/ υπάρχει μόνο η εφαρμογή του ANDROID_APPS, που ανοίγει τη ρίζα του domain της παραγωγής', () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, ANDROID_DIR)).sort(), [...ANDROID_APPS].sort());
  assert.deepEqual([...ANDROID_APPS], [APP]);
  const publicUrl = read('.github/workflows/deploy.yml').match(/^\s*PUBLIC_URL: '([^']*)'/m);
  assert.equal(publicUrl && publicUrl[1], origin, 'η εφαρμογή Android δείχνει στο domain της παραγωγής');

  const twa = readTwaManifest(APP);
  assert.equal(twa.packageId, PACKAGE, 'το package του Play δεν αλλάζει ποτέ');
  assert.equal(twa.host, HOST);
  assert.equal(twa.startUrl, '/');
  assert.equal(twa.fullScopeUrl, `${origin}/`, 'η εφαρμογή καλύπτει όλο το domain');
  assert.equal(scopePathOf(twa), '/');
  assert.equal(twa.webManifestUrl, `${origin}/manifest.json`);
  assert.equal(twa.iconUrl, `${origin}/assets/icons/icon-512.png`);
  assert.equal(twa.maskableIconUrl, `${origin}/assets/icons/icon-maskable-512.png`);
  for (const key of ['themeColorDark', 'navigationColor', 'navigationColorDark', 'navigationDividerColor', 'navigationDividerColorDark']) {
    assert.equal(twa[key], twa.themeColor, `${key} ίδιο με το χρώμα θέματος`);
  }
  /* Καμία ειδοποίηση και κανένα feature: η εφαρμογή δεν ζητά κανένα δικαίωμα Android. */
  assert.equal(twa.enableNotifications, false, 'χωρίς ειδοποιήσεις');
  assert.ok(Object.values(twa.features || {}).every(f => !f || f.enabled !== true), 'χωρίς features (π.χ. locationDelegation)');
  assert.equal(twa.fallbackType, 'customtabs', 'χωρίς Chrome ανοίγει σε Custom Tab, όχι σε WebView');
  assert.equal(twa.orientation, 'default', 'καμία κλειδωμένη προσανατολισμού (tablets και οριζόντια χρήση)');
  assert.deepEqual(twa.shortcuts, []);
  assert.deepEqual(twa.additionalTrustedOrigins, [], `μόνο το ${HOST}`);
  assert.equal(twa.minSdkVersion, MIN_SDK, 'minSdk 24 (Android 7.0), απαίτηση της «Αυτόματης προστασίας» του Play');
  /* Share target: η «Κοινοποίηση» ήχου ή βίντεο από άλλη εφαρμογή (Viber, WhatsApp,
     εγγραφή ήχου) ανοίγει την Απομαγνητοφώνηση με το αρχείο. Μόνο αρχεία, όχι
     απλό κείμενο, ώστε η εφαρμογή να μην εμφανίζεται στην κοινοποίηση συνδέσμων. */
  assert.deepEqual(twa.shareTarget, {
    action: `${origin}/share-target`,
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { files: [{ name: 'media', accept: [...SHARED_MIME_TYPES] }] },
  });
});

test('το twa-manifest.json συμφωνεί με το web manifest: όνομα, χρώματα, εικονίδια, προσανατολισμός και share target', t => {
  if (skipWhileAppPending(t)) return;
  const twa = readTwaManifest(APP);
  const web = webManifest();
  assert.equal(twa.name, web.name, 'ίδιο όνομα με το web manifest');
  assert.equal(twa.launcherName, web.short_name, 'ίδιο σύντομο όνομα με το web manifest');
  assert.equal(twa.display, web.display);
  assert.ok(!web.orientation || ['any', 'natural'].includes(web.orientation), 'ούτε το web manifest κλειδώνει τον προσανατολισμό');
  assert.equal(twa.themeColor.toLowerCase(), web.theme_color.toLowerCase(), 'ίδιο χρώμα θέματος');
  assert.equal(twa.backgroundColor.toLowerCase(), web.background_color.toLowerCase(), 'ίδιο χρώμα splash');
  const icon = purpose => {
    const found = web.icons.find(i => i.sizes === '512x512' && (i.purpose || 'any').split(/\s+/).includes(purpose));
    return found && new URL(found.src, `${origin}/`).href;
  };
  assert.equal(twa.iconUrl, icon('any'), 'ίδιο εικονίδιο 512 με το web manifest');
  assert.equal(twa.maskableIconUrl, icon('maskable'), 'ίδιο maskable εικονίδιο 512 με το web manifest');

  const share = web.share_target;
  assert.ok(share, 'το web manifest έχει share_target');
  assert.equal(new URL(share.action, `${origin}/`).href, twa.shareTarget.action, 'ίδια διαδρομή share target');
  assert.equal(String(share.method).toUpperCase(), twa.shareTarget.method);
  assert.equal(share.enctype, twa.shareTarget.enctype);
  assert.deepEqual(share.params.files, twa.shareTarget.params.files, 'ίδιο πεδίο αρχείων και ίδιοι τύποι');
});

test('το Gradle project συμφωνεί με το twa-manifest.json: package, host, share target, targetSdk 36, έκδοση από το workflow', () => {
  const twa = readTwaManifest(APP);
  const gradle = read(`${dir}/app/build.gradle`);
  const field = (name, value) => assert.ok(gradle.includes(`    ${name}: ${value},`), `app/build.gradle → ${name}: ${value}`);
  field('applicationId', `'${PACKAGE}'`);
  field('hostName', `'${HOST}'`);
  field('launchUrl', `'/'`);
  field('name', `'${twa.name}'`);
  field('launcherName', `'${twa.launcherName}'`);
  field('themeColor', `'${twa.themeColor}'`);
  field('backgroundColor', `'${twa.backgroundColor}'`);
  field('enableNotifications', 'false');
  field('fallbackType', `'customtabs'`);
  field('orientation', `'${twa.orientation}'`);
  const escaped = PACKAGE.replace(/\./g, '\\.');
  assert.match(gradle, new RegExp(`^\\s+namespace "${escaped}"$`, 'm'));
  assert.match(gradle, new RegExp(`^\\s+applicationId "${escaped}"$`, 'm'));
  assert.match(gradle, new RegExp(`^\\s+compileSdkVersion ${TARGET_SDK}$`, 'm'), `compileSdk ${TARGET_SDK}`);
  assert.match(gradle, new RegExp(`^\\s+targetSdkVersion ${TARGET_SDK}$`, 'm'), `targetSdk ${TARGET_SDK}, απαίτηση του Google Play`);
  assert.match(gradle, new RegExp(`^\\s+minSdkVersion ${MIN_SDK}$`, 'm'));
  assert.ok(gradle.includes(`resValue "string", "fullScopeUrl", '${origin}/'`), 'fullScopeUrl');
  assert.ok(gradle.includes(`resValue "string", "webManifestUrl", '${origin}/manifest.json'`), 'webManifestUrl');
  const shareTarget = gradle.match(/resValue "string", "shareTarget", '(.*)'$/m);
  assert.ok(shareTarget, 'ο πόρος shareTarget υπάρχει');
  assert.deepEqual(JSON.parse(shareTarget[1].replace(/\\\\"/g, '"')), twa.shareTarget, 'ίδιο share target με το twa-manifest.json');
  /* Η έκδοση έρχεται από το workflow (tools/android.mjs version). Το `bubblewrap
     update` ξαναγράφει το build.gradle, οπότε αυτό το test θυμίζει να ξαναμπεί. */
  assert.ok(gradle.includes("versionCode((project.findProperty('apomagnitofonisiVersionCode') ?: '1') as Integer)"), 'versionCode από -PapomagnitofonisiVersionCode');
  assert.ok(gradle.includes("versionName((project.findProperty('apomagnitofonisiVersionName') ?: '1') as String)"), 'versionName από -PapomagnitofonisiVersionName');
  assert.doesNotMatch(gradle, /^\s+version(Code|Name) ["'\d]/m, 'καμία σταθερή έκδοση');
  assert.match(gradle, /release \{\n\s+minifyEnabled true\n/, 'release με R8');
  assert.doesNotMatch(gradle, /signingConfig|storePassword|keyPassword|storeFile/, 'η υπογραφή γίνεται μόνο στο android.yml, με secrets');
  const deps = [...gradle.matchAll(/^\s+implementation '([^']+)'$/gm)].map(m => m[1]);
  assert.deepEqual(deps, ['com.google.androidbrowserhelper:androidbrowserhelper:2.6.2'], 'μόνο το androidbrowserhelper, σε ακριβή έκδοση');

  const rootGradle = read(`${dir}/build.gradle`);
  assert.match(rootGradle, /classpath 'com\.android\.tools\.build:gradle:8\.9\.1'/, 'AGP 8.9.1 του Bubblewrap 1.25.0');
  assert.doesNotMatch(rootGradle, /^\s*jcenter\(\)/m, 'το JCenter έχει καταργηθεί');
  assert.equal((rootGradle.match(/^\s+google\(\)\n(?:\s+\/\/.*\n)*\s+mavenCentral\(\)$/gm) || []).length, 2, 'google() και mavenCentral() για buildscript και allprojects');
  assert.equal(read(`${dir}/settings.gradle`).trim(), "include ':app'");
  /* Κάθε αλλαγή σε σχέση με το πρότυπο του Bubblewrap έχει σχόλιο-σήμα, ώστε να ξαναμπεί μετά από αναγέννηση. */
  assert.equal(rootGradle.split(MARKER).length - 1, 2, `${MARKER} στο build.gradle (mavenCentral ×2)`);
  assert.equal(gradle.split(MARKER).length - 1, 2, `${MARKER} στο app/build.gradle (minSdk, έκδοση)`);
});

test('το AndroidManifest ανοίγει μόνο το domain, δέχεται κοινοποίηση ήχου και βίντεο και δεν ζητά κανένα δικαίωμα', () => {
  const manifest = read(`${dir}/app/src/main/AndroidManifest.xml`);
  assert.match(manifest, /<intent-filter android:autoVerify="true">/, 'τα links επαληθεύονται (App Links)');
  assert.match(manifest, /android:host="@string\/hostName"/);
  assert.deepEqual([...manifest.matchAll(/android:path\w*="([^"]*)"/g)].map(m => m[1]), [], 'εφαρμογή στη ρίζα: καμία διαδρομή στο intent filter');
  assert.doesNotMatch(manifest, /<uses-permission/, 'κανένα δικαίωμα Android');
  assert.match(manifest, /android:enabled="@bool\/enableNotification"/, 'η DelegationService μένει κλειστή χωρίς ειδοποιήσεις');
  assert.match(manifest, new RegExp(`android:name="${SHARE_TARGET_METADATA.replace(/\./g, '\\.')}"\\s+android:resource="@string/shareTarget"`), 'meta-data του share target');
  const shareFilter = manifest.match(/<intent-filter>((?:(?!<\/intent-filter>)[\s\S])*android\.intent\.action\.SEND"[\s\S]*?)<\/intent-filter>/);
  assert.ok(shareFilter, 'intent filter για την κοινοποίηση');
  assert.deepEqual([...shareFilter[1].matchAll(/<action android:name="([^"]+)"/g)].map(m => m[1]),
    ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE']);
  assert.deepEqual([...shareFilter[1].matchAll(/android:mimeType="([^"]+)"/g)].map(m => m[1]), [...SHARED_MIME_TYPES],
    'μόνο ήχος και βίντεο (όχι text/plain)');

  const javaDir = `${dir}/app/src/main/java/${PACKAGE.split('.').join('/')}`;
  for (const cls of ['LauncherActivity', 'Application', 'DelegationService']) {
    assert.match(read(`${javaDir}/${cls}.java`), new RegExp(`^package ${PACKAGE.replace(/\./g, '\\.')};$`, 'm'), `${cls} στο package ${PACKAGE}`);
  }
  assert.doesNotMatch(read(`${javaDir}/LauncherActivity.java`), /SCREEN_ORIENTATION_(USER_)?(PORTRAIT|LANDSCAPE)/, 'κανένας κλειδωμένος προσανατολισμός');
  const strings = read(`${dir}/app/src/main/res/values/strings.xml`);
  assert.match(strings, new RegExp(`\\\\"site\\\\": \\\\"${origin.replace(/\./g, '\\.')}\\\\"`), `asset statements για το ${HOST}`);
  assert.equal(read(`${dir}/app/src/main/res/xml/shortcuts.xml`), SHORTCUTS_XML,
    'ίδιο με ό,τι γράφει το Gradle σε κάθε build (αλλιώς το build αφήνει αλλαγές)');
  for (const png of ['store_icon.png', 'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'app/src/main/res/mipmap-xxxhdpi/ic_maskable.png', 'app/src/main/res/drawable-xxxhdpi/splash.png']) {
    assert.deepEqual(fs.readFileSync(path.join(ROOT, dir, png)).subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), `${png} είναι PNG`);
  }
});

test('το αντίγραφο του web manifest μέσα στο APK (res/raw) συμφωνεί με το manifest.json', t => {
  if (skipWhileAppPending(t)) return;
  const raw = JSON.parse(read(`${dir}/app/src/main/res/raw/web_app_manifest.json`));
  /* Το Bubblewrap γράφει το web manifest όπως είναι, με το start_url της εφαρμογής
     Android. Το χρησιμοποιούν το ChromeOS και το Meta Quest. */
  assert.deepEqual(raw, { ...webManifest(), start_url: '/' },
    'το res/raw/web_app_manifest.json πρέπει να ενημερωθεί μαζί με το manifest.json');
});

test('το Gradle wrapper είναι το επίσημο της 8.11.1 και ελέγχει το checksum της διανομής', () => {
  const props = read(`${dir}/gradle/wrapper/gradle-wrapper.properties`);
  assert.match(props, new RegExp(`^distributionUrl=${GRADLE.distributionUrl.replace(/[\\.]/g, m => `\\${m}`)}$`, 'm'), 'Gradle 8.11.1');
  assert.match(props, new RegExp(`^distributionSha256Sum=${GRADLE.distributionSha256Sum}$`, 'm'), 'το Gradle κατεβαίνει μόνο με σωστό checksum');
  assert.match(props, /^validateDistributionUrl=true$/m);
  assert.equal(sha256(`${dir}/gradle/wrapper/gradle-wrapper.jar`), GRADLE.wrapperJarSha256, 'επίσημο gradle-wrapper.jar');
  assert.ok(fs.statSync(path.join(ROOT, dir, 'gradlew')).mode & 0o100, 'το gradlew είναι εκτελέσιμο');
});

test('το assetlinks.json δηλώνει μόνο έγκυρα αποτυπώματα, ανάμεσά τους το κοινό upload key', t => {
  const statements = assetLinks();
  assert.deepEqual(JSON.parse(assetLinksJson()), statements);
  assert.ok(assetLinksJson().endsWith('\n'));
  assert.equal(statements.length, 1, 'μία δήλωση, για το package της εφαρμογής');
  const [statement] = statements;
  assert.deepEqual(statement.relation, [...ASSET_LINK_RELATIONS]);
  assert.equal(statement.target.namespace, 'android_app');
  assert.equal(statement.target.package_name, PACKAGE);
  /* Το upload key υπογράφει το APK δοκιμής του android.yml. Τα τρία κλειδιά
     «Υπογραφή εφαρμογής» του Play προστίθενται όταν δημιουργηθεί η εφαρμογή στο
     Play Console (docs/ANDROID.md §4). */
  assert.ok(statement.target.sha256_cert_fingerprints.includes(UPLOAD_KEY), 'το upload key των εφαρμογών του λογαριασμού');

  // Σε αντίγραφο του twa-manifest.json: άκυρο ή διπλό αποτύπωμα, εφαρμογή χωρίς αποτύπωμα.
  const root = tempDir(t, 'apomagnitofonisi-android-');
  const write = twa => {
    fs.mkdirSync(path.join(root, ANDROID_DIR, APP), { recursive: true });
    fs.writeFileSync(path.join(root, ANDROID_DIR, APP, 'twa-manifest.json'), JSON.stringify(twa));
  };
  const base = readTwaManifest(APP);
  const fp = value => ({ name: 'test', value });
  const other = '7D:9C:FC:38:28:D2:9F:FF:9B:90:CB:7A:B8:EE:EC:EB:10:58:8E:FB:97:73:50:FF:42:71:E8:22:AC:57:43:1F';
  write({ ...base, fingerprints: [] });
  assert.deepEqual(assetLinks(root), [], 'εφαρμογή χωρίς αποτύπωμα δεν δηλώνεται');
  write({ ...base, fingerprints: [fp(other), fp(UPLOAD_KEY)] });
  assert.deepEqual(assetLinks(root)[0].target.sha256_cert_fingerprints, [other, UPLOAD_KEY], 'με τη σειρά του twa-manifest.json');
  write({ ...base, fingerprints: [fp(other.toLowerCase())] });
  assert.throws(() => assetLinks(root), /μη έγκυρο αποτύπωμα/, 'πεζά γράμματα');
  write({ ...base, fingerprints: [fp(other.slice(0, -3))] });
  assert.throws(() => assetLinks(root), /μη έγκυρο αποτύπωμα/, 'λείπει byte (όπως το λάθος του ΡΟΔΙΟΣ στις 11/05/2026)');
  write({ ...base, fingerprints: [fp(other), fp(other)] });
  assert.throws(() => assetLinks(root), /δύο φορές/);
  write({ ...base, packageId: 'Gr.Bad', fingerprints: [fp(other)] });
  assert.throws(() => assetLinks(root), /μη έγκυρο packageId/);

  assert.equal(formatFingerprint('7d9cfc3828d29fff9b90cb7ab8eeeceb10588efb977350ff4271e822ac57431f'), other);
  assert.throws(() => formatFingerprint('7d9c'), /μη έγκυρο SHA-256/);
});

test('η έκδοση για το Play είναι ΕΕΕΕΜΜΗΗΩΩ σε UTC, αυξάνει με τον χρόνο και μένει μέσα στο όριο του Play', () => {
  assert.deepEqual(versionFor(new Date(Date.UTC(2026, 10, 4, 14, 59))), { versionCode: 2026110414, versionName: '2026.11.04.14' });
  assert.deepEqual(versionFor(new Date(Date.UTC(2026, 0, 2, 3)), ''), { versionCode: 2026010203, versionName: '2026.01.02.03' });
  assert.ok(versionFor(new Date(Date.UTC(2026, 10, 4, 15))).versionCode > versionFor(new Date(Date.UTC(2026, 10, 4, 14))).versionCode);
  assert.ok(versionFor(new Date(Date.UTC(2027, 0, 1, 0))).versionCode > versionFor(new Date(Date.UTC(2026, 11, 31, 23))).versionCode);
  assert.ok(versionFor(new Date(Date.UTC(2099, 11, 31, 23))).versionCode <= MAX_VERSION_CODE);
  assert.equal(versionFor(new Date(Date.UTC(2026, 10, 4, 14)), '42').versionCode, 42, 'ρητό versionCode από το input του workflow');
  for (const bad of ['0', '-1', 'abc', '1.5', '2100000001', '1e3']) {
    assert.throws(() => versionFor(new Date(), bad), /μη έγκυρο versionCode/, `απορρίπτεται το ${bad}`);
  }
});

test('το tools/android.mjs δέχεται σε κάθε εντολή μόνο τις δικές της παραμέτρους, με την ίδια --version-code παντού', () => {
  assert.deepEqual(parseArgs(['version']), { command: 'version' });
  assert.deepEqual(parseArgs(['version', '--version-code', '']), { command: 'version', versionCode: '' }, 'κενό input του workflow = από την ώρα');
  assert.deepEqual(parseArgs(['inspect', '--version-code', '7']), { command: 'inspect', versionCode: '7' });
  assert.deepEqual(parseArgs(['release', '--keystore', 'k', '--out', 'o', '--version-code', '9']),
    { command: 'release', keystore: 'k', out: 'o', versionCode: '9' });
  for (const command of Object.keys(COMMAND_FLAGS)) {
    assert.ok(Object.hasOwn(COMMAND_FLAGS[command], '--version-code'), `${command}: --version-code`);
  }
  assert.throws(() => parseArgs(['version', '--code', '1']), /η παράμετρος --code δεν ισχύει για την εντολή version/, 'η παλιά --code απορρίπτεται, δεν αγνοείται');
  assert.throws(() => parseArgs(['inspect', '--keystore', 'k']), /δεν ισχύει για την εντολή inspect/, 'παράμετρος άλλης εντολής');
  assert.throws(() => parseArgs(['inspect', '--password', 'x']), /δεν ισχύει/, 'κανένας κωδικός από τη γραμμή εντολών');
  assert.throws(() => parseArgs(['inspect', '--version-code']), /λείπει η τιμή της --version-code/);
  assert.throws(() => parseArgs(['inspect', '--version-code', '1', '--version-code', '2']), /δόθηκε δύο φορές/);
  assert.throws(() => parseArgs(['build']), /άγνωστη εντολή «build»/);
  assert.throws(() => parseArgs([]), /άγνωστη εντολή/);
  assert.throws(() => parseArgs(['__proto__']), /άγνωστη εντολή/);
});

/* Έξοδος των εργαλείων στη μορφή του aapt2 36.0.0, του apksigner 36 και 37 και του
   keytool του JDK 21, για την εφαρμογή αυτή. */
const BADGING = `package: name='${PACKAGE}' versionCode='2026010100' versionName='ci' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='${PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
application-label:'Απομαγνητοφώνηση'
launchable-activity: name='${PACKAGE}.LauncherActivity'  label='Απομαγνητοφώνηση' icon=''
`;
const SHARE_TARGET_JSON = `{"action":"${origin}/share-target","method":"POST","enctype":"multipart/form-data","params":{"files":[{"name":"media","accept":["audio/*","video/*"]}]}}`;
const RESOURCES = `    resource 0x7f040002 bool/enableNotification
      () false
    resource 0x7f0e001e string/assetStatements
      () "[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "web", "site": "${origin}" } }]"
    resource 0x7f0e0027 string/fallbackType
      () "customtabs"
    resource 0x7f0e002b string/fullScopeUrl
      () "${origin}/"
    resource 0x7f0e002d string/hostName
      () "${HOST}"
    resource 0x7f0e002e string/launchUrl
      () "${origin}/"
    resource 0x7f0e0031 string/shareTarget
      () "${SHARE_TARGET_JSON}"
`;
const MANIFEST_TREE = `        E: meta-data (line=128)
          A: http://schemas.android.com/apk/res/android:name(0x01010003)="${SHARE_TARGET_METADATA}" (Raw: "${SHARE_TARGET_METADATA}")
          A: http://schemas.android.com/apk/res/android:resource(0x01010025)=@0x7f0e0031
        E: intent-filter (line=143)
          E: action (line=145)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.SEND" (Raw: "android.intent.action.SEND")
          E: action (line=147)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.SEND_MULTIPLE" (Raw: "android.intent.action.SEND_MULTIPLE")
          E: data (line=151)
            A: http://schemas.android.com/apk/res/android:mimeType(0x01010026)="audio/*" (Raw: "audio/*")
          E: data (line=153)
            A: http://schemas.android.com/apk/res/android:mimeType(0x01010026)="video/*" (Raw: "video/*")
        E: intent-filter (line=163)
          A: http://schemas.android.com/apk/res/android:autoVerify(0x010104ee)=true
            E: data (line=167)
              A: http://schemas.android.com/apk/res/android:scheme(0x01010027)="https" (Raw: "https")
              A: http://schemas.android.com/apk/res/android:host(0x01010028)=@0x7f0e002d
`;
const APKSIGNER = `Signer #1 certificate DN: CN=test
Signer #1 certificate SHA-256 digest: 7d9cfc3828d29fff9b90cb7ab8eeeceb10588efb977350ff4271e822ac57431f
Signer #1 certificate SHA-1 digest: ae16da88a354a86443535fa2e0c28f0057458974
`;
const APKSIGNER_37 = `Verified using v1 scheme (JAR signing): true
Number of signers: 1
V3.0 Signer: certificate DN: CN=test
V3.0 Signer: certificate SHA-256 digest: 7d9cfc3828d29fff9b90cb7ab8eeeceb10588efb977350ff4271e822ac57431f
V3.0 Signer: public key SHA-256 digest: 40e5ee70ac3cdb63d52c0b881c1463031b25a7592e02dab5c353adc9b98b9383
`;
const KEYTOOL = `Signer #1:

Certificate #1:
Owner: CN=test
Certificate fingerprints:
\t SHA1: AE:16:DA:88:A3:54:A8:64:43:53:5F:A2:E0:C2:8F:00:57:45:89:74
\t SHA256: 7D:9C:FC:38:28:D2:9F:FF:9B:90:CB:7A:B8:EE:EC:EB:10:58:8E:FB:97:73:50:FF:42:71:E8:22:AC:57:43:1F
`;

test('ανάγνωση της εξόδου aapt2, apksigner και keytool, και έλεγχος του APK μαζί με το share target', () => {
  const badging = parseBadging(BADGING);
  assert.deepEqual(badging, {
    package: PACKAGE, versionCode: 2026010100, versionName: 'ci', minSdk: 24, targetSdk: 36,
    permissions: [`${PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`],
  });
  const resources = parseResources(RESOURCES);
  assert.equal(resources['string/hostName'], HOST);
  assert.equal(JSON.parse(resources['string/shareTarget']).action, `${origin}/share-target`);
  const fingerprint = '7D:9C:FC:38:28:D2:9F:FF:9B:90:CB:7A:B8:EE:EC:EB:10:58:8E:FB:97:73:50:FF:42:71:E8:22:AC:57:43:1F';
  assert.deepEqual(parseApksignerCerts(APKSIGNER), [fingerprint]);
  assert.deepEqual(parseApksignerCerts(APKSIGNER_37), [fingerprint], 'μορφή των build-tools 37, χωρίς το public key');
  assert.deepEqual(parseApksignerCerts(`${APKSIGNER}Source Stamp Signer: certificate SHA-256 digest: ${'ab'.repeat(32)}\n`), [fingerprint],
    'το Source Stamp του Play δεν είναι κλειδί υπογραφής της εφαρμογής');
  assert.deepEqual(parseKeytoolCerts(KEYTOOL), [fingerprint]);
  assert.throws(() => parseBadging('ERROR'), /package/);

  const twa = readTwaManifest(APP);
  const ok = { app: APP, twa, badging, resources, manifestTree: MANIFEST_TREE, versionCode: 2026010100 };
  assert.deepEqual(checkApk(ok), []);
  const problems = changes => checkApk({ ...ok, ...changes }).join('\n');
  assert.match(problems({ versionCode: 1 }), /versionCode 2026010100 αντί για 1/);
  assert.match(problems({ badging: { ...badging, targetSdk: 35 } }), /targetSdk 35/);
  assert.match(problems({ badging: { ...badging, minSdk: 21 } }), /minSdk 21 αντί για 24/);
  assert.match(problems({ badging: { ...badging, permissions: [...badging.permissions, 'android.permission.RECORD_AUDIO'] } }), /απρόσμενα δικαιώματα: android\.permission\.RECORD_AUDIO/);
  assert.match(problems({ resources: { ...resources, 'string/hostName': 'apomagnitofonisi.pages.dev' } }), /hostName/);
  assert.match(problems({ resources: { ...resources, 'bool/enableNotification': 'true' } }), /ειδοποιήσεις/);
  assert.match(problems({ manifestTree: MANIFEST_TREE.replace('autoVerify(0x010104ee)=true', 'autoVerify(0x010104ee)=false') }), /autoVerify/);
  assert.match(problems({ manifestTree: MANIFEST_TREE.replace('="https" (Raw: "https")', '="https" (Raw: "https")\n              A: http://schemas.android.com/apk/res/android:pathPrefix(0x0101002b)="/other/" (Raw: "/other/")') }),
    /pathPrefix \/other\//, 'εφαρμογή στη ρίζα: καμία διαδρομή εκτός από /');

  // Share target: λείπει, άλλη διαδρομή, χωρίς βίντεο, χωρίς meta-data.
  assert.match(problems({ resources: { ...resources, 'string/shareTarget': undefined } }), /λείπει ο πόρος string\/shareTarget/);
  assert.match(problems({ resources: { ...resources, 'string/shareTarget': SHARE_TARGET_JSON.replace('/share-target', '/upload') } }), /share target action/);
  assert.match(problems({ manifestTree: MANIFEST_TREE.replace('"video/*" (Raw: "video/*")', '"text/plain" (Raw: "text/plain")') }), /δεν δέχεται video\/\*/);
  assert.match(problems({ manifestTree: MANIFEST_TREE.replace(`="${SHARE_TARGET_METADATA}"`, '="other"').replace(`"${SHARE_TARGET_METADATA}")`, '"other")') }), /METADATA_SHARE_TARGET/);
  assert.deepEqual(checkShareTarget({ app: APP, twa: { ...twa, shareTarget: undefined }, resources, manifestTree: MANIFEST_TREE }), [`${APP}: το twa-manifest.json δεν έχει shareTarget`]);
});

test('κανένα κλειδί υπογραφής, APK ή AAB στο repository', () => {
  const forbidden = /\.(keystore|jks|p12|pfx|apk|aab|idsig)$|^signing-key-info\.txt$/i;
  const skip = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle', 'android-release']);
  const found = [];
  const walk = d => {
    for (const entry of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!skip.has(entry.name)) walk(rel); }
      else if (forbidden.test(entry.name)) found.push(rel);
    }
  };
  walk('');
  assert.deepEqual(found, [], 'το keystore και οι κωδικοί ζουν μόνο στα GitHub secrets (docs/ANDROID.md §3)');
  const ignore = read('.gitignore').split('\n');
  for (const pattern of ['*.keystore', '*.jks', '*.p12', '*.pfx', 'signing-key-info.txt', '*.apk', '*.aab', 'android-release/', 'android/*/app/build/', 'android/*/.gradle/']) {
    assert.ok(ignore.includes(pattern), `.gitignore: ${pattern}`);
  }
  assert.ok(exists(`${dir}/twa-manifest.json`));
  assert.equal(readTwaManifest(APP).signingKey.path, './android.keystore', 'μόνο placeholder, το keystore δεν είναι στο repository');
});

test('η σύνοψη του release γράφει τα αρχεία, το αποτύπωμα και αν το γνωρίζουν repo, domain και Google', () => {
  const twa = readTwaManifest(APP);
  const row = {
    app: APP, twa, apk: `/x/${APP}-2026110414.apk`, aab: `/x/${APP}-2026110414.aab`, fingerprint: UPLOAD_KEY, inRepo: true,
    live: { site: 'ναι', google: 'linked' }, badging: { versionName: '2026.11.04.14' },
  };
  const summary = releaseSummary({ rows: [row], versionCode: 2026110414, buildToolsDir: '/sdk/build-tools/36.0.0', warnings: ['προσοχή'], problems: [] });
  assert.match(summary, /^## Android: έκδοση 2026110414 \(2026\.11\.04\.14\)/);
  assert.ok(summary.includes(`| ${APP} | \`${PACKAGE}\` | \`${APP}-2026110414.aab\` | \`${APP}-2026110414.apk\` | \`${UPLOAD_KEY}\` | ναι | ναι | linked |`));
  assert.ok(summary.includes(`https://${HOST}/.well-known/assetlinks.json`));
  assert.match(summary, /Android build-tools: 36\.0\.0\./);
  assert.match(summary, /> ⚠️ προσοχή/);
  assert.doesNotMatch(releaseSummary({ rows: [{ ...row, inRepo: false }], versionCode: 1, buildToolsDir: '', warnings: [], problems: ['λάθος'] }), /\| ναι \| ναι \| linked \|$/m);
});
