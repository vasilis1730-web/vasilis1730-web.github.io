#!/usr/bin/env node
/**
 * Οι εντολές για την εφαρμογή Android της Απομαγνητοφώνησης (Trusted Web Activity).
 *
 * Το android/apomagnitofonisi είναι project του Bubblewrap: η εφαρμογή ανοίγει
 * το https://apomagnitofonisi.texnikes.app/ σε πλήρη οθόνη μέσα στο Chrome. Ο
 * κώδικας της εφαρμογής ΔΕΝ βρίσκεται στο APK, οπότε κάθε deploy στο main
 * φτάνει αμέσως και στα κινητά. Η λογική είναι στα tools/android/:
 *   project.mjs         διαδρομές και twa-manifest.json
 *   asset-links.mjs     το /.well-known/assetlinks.json (και για το build)
 *   play-version.mjs    versionCode/versionName για το Play
 *   apk-inspection.mjs  ανάγνωση της εξόδου του SDK και έλεγχος του APK
 * Εδώ μόνο η εκτέλεση των εργαλείων του Android SDK και του JDK:
 *
 *   node tools/android.mjs version [--code N]
 *        → versionCode=… και versionName=… (για το $GITHUB_OUTPUT)
 *   node tools/android.mjs inspect --version-code N
 *        → έλεγχος του ανυπόγραφου APK μετά το Gradle (test.yml)
 *   node tools/android.mjs release --keystore <αρχείο> --out <φάκελος> --version-code N
 *        → υπογραφή APK/AAB με το upload key, επαλήθευση, σύνοψη (android.yml)
 *
 * Οι κωδικοί του keystore διαβάζονται ΜΟΝΟ από το περιβάλλον
 * (ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD, ANDROID_KEY_ALIAS) και
 * περνούν στα apksigner/jarsigner ως env:, ποτέ στη γραμμή εντολών.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, ANDROID_DIR, ANDROID_APPS, readTwaManifest, gradleOutputsOf } from './android/project.mjs';
import { ASSET_LINK_RELATIONS } from './android/asset-links.mjs';
import { versionFor } from './android/play-version.mjs';
import { parseBadging, parseResources, parseApksignerCerts, parseKeytoolCerts, checkApk } from './android/apk-inspection.mjs';

/* ---------- Εργαλεία του Android SDK και του JDK ---------- */

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${path.basename(cmd)}: ${result.error.message}`);
  const output = `${result.stdout || ''}${result.stderr || ''}`.replace(/^Picked up JAVA_TOOL_OPTIONS:.*\n/gm, '');
  if (result.status !== 0) throw new Error(`${path.basename(cmd)} ${args[0] || ''}: έξοδος ${result.status}\n${output.slice(-4000)}`);
  return output;
}

/** Ο πιο πρόσφατος φάκελος build-tools του SDK που έχει aapt2, apksigner και zipalign. */
export function buildToolsDir(env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('λείπει το ANDROID_HOME (Android SDK)');
  const dir = path.join(sdk, 'build-tools');
  const numeric = v => v.split(/[.-]/).map(p => (/^\d+$/.test(p) ? Number(p) : -1));
  const versions = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter(v => /^\d+(\.\d+)*$/.test(v))
    .filter(v => ['aapt2', 'apksigner', 'zipalign'].every(t => fs.existsSync(path.join(dir, v, t))))
    .sort((a, b) => {
      const [x, y] = [numeric(a), numeric(b)];
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    });
  if (!versions.length) throw new Error(`δεν βρέθηκαν build-tools με aapt2/apksigner/zipalign στο ${dir}`);
  return path.join(dir, versions.at(-1));
}

function jdkTool(name, env = process.env) {
  return env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', name) : name;
}

/** Διαβάζει ένα APK με το aapt2 και το ελέγχει (tools/android/apk-inspection.mjs). */
export function inspectApk({ apk, app, root = ROOT, tools = buildToolsDir(), versionCode }) {
  const twa = readTwaManifest(app, root);
  const aapt2 = path.join(tools, 'aapt2');
  const badging = parseBadging(run(aapt2, ['dump', 'badging', apk]));
  const resources = parseResources(run(aapt2, ['dump', 'resources', apk]));
  const manifestTree = run(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk]);
  return { twa, badging, problems: checkApk({ app, twa, badging, resources, manifestTree, versionCode }) };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* ---------- Εντολές ---------- */

/** Οι παράμετροι της γραμμής εντολών. Κωδικοί δεν δέχεται ποτέ από εδώ. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i++) {
    const match = rest[i].match(/^--(keystore|out|version-code|code)$/);
    if (!match) throw new Error(`άγνωστη παράμετρος: ${rest[i]}`);
    args[match[1]] = rest[++i] ?? '';
  }
  return args;
}

function commandVersion(args) {
  const { versionCode, versionName } = versionFor(new Date(), args.code);
  console.log(`versionCode=${versionCode}`);
  console.log(`versionName=${versionName}`);
}

function commandInspect(args, root = ROOT) {
  const tools = buildToolsDir();
  const problems = [];
  for (const app of ANDROID_APPS) {
    const { apk } = gradleOutputsOf(app, root);
    if (!fs.existsSync(apk)) { problems.push(`${app}: λείπει το ${path.relative(root, apk)} (τρέξε πρώτα ./gradlew assembleRelease)`); continue; }
    const result = inspectApk({ apk, app, root, tools, versionCode: args['version-code'] || undefined });
    problems.push(...result.problems);
    const b = result.badging;
    console.log(`${result.problems.length ? '✖' : '✓'} ${app}: ${b.package} ${b.versionCode} (${b.versionName}), minSdk ${b.minSdk}, targetSdk ${b.targetSdk}`);
  }
  if (problems.length) throw new Error(`τα APK δεν είναι όπως πρέπει:\n${problems.map(p => `  - ${p}`).join('\n')}`);
}

/** Τι βλέπει σήμερα το domain και η Google για ένα package και αποτύπωμα (ενημερωτικά). */
async function liveStatus(twa, fingerprint) {
  const status = { site: '-', google: '-' };
  try {
    const res = await fetch(`https://${twa.host}/.well-known/assetlinks.json`, { redirect: 'manual' });
    if (res.status !== 200) status.site = `HTTP ${res.status}`;
    else {
      const list = await res.json();
      status.site = list.some(s => s && s.target && s.target.package_name === twa.packageId
        && (s.target.sha256_cert_fingerprints || []).includes(fingerprint)
        && (s.relation || []).includes(ASSET_LINK_RELATIONS[0])) ? 'ναι' : 'όχι';
    }
  } catch (error) { status.site = `σφάλμα: ${error.message}`; }
  try {
    const query = new URLSearchParams({
      'source.web.site': `https://${twa.host}`,
      relation: ASSET_LINK_RELATIONS[0],
      'target.android_app.package_name': twa.packageId,
      'target.android_app.certificate.sha256_fingerprint': fingerprint,
    });
    const res = await fetch(`https://digitalassetlinks.googleapis.com/v1/assetlinks:check?${query}`);
    const body = await res.json().catch(() => ({}));
    status.google = res.ok ? (body.linked ? 'linked' : 'όχι') : `HTTP ${res.status}`;
  } catch (error) { status.google = `σφάλμα: ${error.message}`; }
  return status;
}

/** Υπογράφει APK (για δοκιμή) και AAB (για το Play) μίας εφαρμογής και τα επαληθεύει. */
async function signApp({ app, root, tools, keystore, alias, env, out, work, versionCode }) {
  const twa = readTwaManifest(app, root);
  const built = gradleOutputsOf(app, root);
  for (const file of Object.values(built)) {
    if (!fs.existsSync(file)) throw new Error(`${app}: λείπει το ${path.relative(root, file)} (τρέξε πρώτα ./gradlew assembleRelease bundleRelease)`);
  }
  const apk = path.join(out, `${app}-${versionCode}.apk`);
  const aab = path.join(out, `${app}-${versionCode}.aab`);
  const problems = [];

  // APK για απευθείας δοκιμή: zipalign και υπογραφή v1/v2/v3 (χωρίς .idsig).
  const aligned = path.join(work, `${app}-aligned.apk`);
  run(path.join(tools, 'zipalign'), ['-f', '-p', '4', built.apk, aligned]);
  run(path.join(tools, 'apksigner'), ['sign', '--ks', keystore, '--ks-key-alias', alias,
    '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD',
    '--v4-signing-enabled', 'false', '--out', apk, aligned], { env });
  const apkCerts = parseApksignerCerts(run(path.join(tools, 'apksigner'), ['verify', '--print-certs', apk]));

  // AAB για το Play Console: υπογραφή JAR με το upload key.
  run(jdkTool('jarsigner', env), ['-keystore', keystore, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD',
    '-keypass:env', 'ANDROID_KEY_PASSWORD', '-signedjar', aab, built.aab, alias], { env });
  const verified = run(jdkTool('jarsigner', env), ['-verify', aab]);
  if (!/jar verified\./.test(verified) || /unsigned entries/.test(verified)) problems.push(`${app}: η υπογραφή του AAB δεν επαληθεύεται`);
  const aabCerts = parseKeytoolCerts(run(jdkTool('keytool', env), ['-printcert', '-jarfile', aab]));

  if (apkCerts.length !== 1 || aabCerts.length !== 1 || apkCerts[0] !== aabCerts[0]) {
    problems.push(`${app}: APK (${apkCerts.join(', ')}) και AAB (${aabCerts.join(', ')}) δεν έχουν το ίδιο μοναδικό πιστοποιητικό`);
  }
  // Χωρίς ένα μοναδικό πιστοποιητικό δεν υπάρχει τι να συγκριθεί (το πρόβλημα καταγράφηκε ήδη).
  const fingerprint = apkCerts.length === 1 ? apkCerts[0] : undefined;
  const inspected = inspectApk({ apk, app, root, tools, versionCode });
  problems.push(...inspected.problems);

  const inRepo = !!fingerprint && (twa.fingerprints || []).some(f => f.value === fingerprint);
  const live = fingerprint ? await liveStatus(twa, fingerprint) : { site: '-', google: '-' };
  const warnings = fingerprint && !inRepo
    ? [`${app}: το αποτύπωμα του upload key ${fingerprint} δεν είναι στο ${ANDROID_DIR}/${app}/twa-manifest.json. `
      + 'Το APK αυτού του build θα ανοίγει με γραμμή διευθύνσεων μέχρι να προστεθεί και να γίνει deploy (docs/ANDROID.md §4).']
    : [];
  return { row: { app, twa, apk, aab, fingerprint, inRepo, live, badging: inspected.badging }, problems, warnings };
}

/** Η σύνοψη Markdown του release (για το log και το $GITHUB_STEP_SUMMARY). */
export function releaseSummary({ rows, versionCode, tools, warnings, problems }) {
  const versionName = rows[0] ? rows[0].badging.versionName : '';
  const host = rows[0] ? rows[0].twa.host : '';
  return [
    `## Android: έκδοση ${versionCode} (${versionName})`,
    '',
    '| Εφαρμογή | Package | Για το Play | Για δοκιμή | SHA-256 κλειδιού υπογραφής | Στο repo | Στο domain | Google |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.app} | \`${r.twa.packageId}\` | \`${path.basename(r.aab)}\` | \`${path.basename(r.apk)}\` | ${r.fingerprint ? `\`${r.fingerprint}\`` : '-'} | ${r.inRepo ? 'ναι' : '**όχι**'} | ${r.live.site} | ${r.live.google} |`),
    '',
    'Το `.aab` ανεβαίνει στο Play Console, το `.apk` εγκαθίσταται απευθείας σε κινητό για δοκιμή.',
    `«Στο domain»: αν το https://${host}/.well-known/assetlinks.json έχει ήδη αυτό το αποτύπωμα. «Google»: τι απαντά το Digital Asset Links API.`,
    'Οι εγκαταστάσεις από το Play υπογράφονται με τα κλειδιά «Υπογραφή εφαρμογής» του Play, που χρειάζονται δικά τους αποτυπώματα στο twa-manifest.json (docs/ANDROID.md §4).',
    `Android build-tools: ${tools ? path.basename(tools) : '-'}.`,
    ...(warnings.length ? ['', ...warnings.map(w => `> ⚠️ ${w}`)] : []),
    ...(problems.length ? ['', ...problems.map(p => `> ✖ ${p}`)] : []),
    '',
  ].join('\n');
}

async function commandRelease(args, root = ROOT) {
  const keystore = args.keystore;
  const out = path.resolve(args.out || 'android-release');
  const versionCode = args['version-code'];
  if (!keystore || !fs.existsSync(keystore) || !fs.statSync(keystore).size) throw new Error('λείπει ή είναι άδειο το keystore (--keystore)');
  if (!versionCode) throw new Error('λείπει το --version-code');
  const alias = process.env.ANDROID_KEY_ALIAS;
  if (!alias || !process.env.ANDROID_KEYSTORE_PASSWORD) throw new Error('λείπουν τα ANDROID_KEY_ALIAS ή ANDROID_KEYSTORE_PASSWORD');
  // Κενός κωδικός κλειδιού = ίδιος με του keystore (όπως στα keystores PKCS12).
  const env = { ...process.env, ANDROID_KEY_PASSWORD: process.env.ANDROID_KEY_PASSWORD || process.env.ANDROID_KEYSTORE_PASSWORD };

  const tools = buildToolsDir();
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const work = fs.mkdtempSync(path.join(out, '.work-'));
  const rows = [];
  const warnings = [];
  const problems = [];
  try {
    for (const app of ANDROID_APPS) {
      const result = await signApp({ app, root, tools, keystore, alias, env, out, work, versionCode });
      rows.push(result.row);
      warnings.push(...result.warnings);
      problems.push(...result.problems);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const files = fs.readdirSync(out).filter(f => /\.(apk|aab)$/.test(f)).sort();
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), files.map(f => `${sha256(path.join(out, f))}  ${f}\n`).join(''));

  const summary = releaseSummary({ rows, versionCode, tools, warnings, problems });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (process.env.GITHUB_ACTIONS) for (const w of warnings) console.log(`::warning::${w}`);
  if (problems.length) throw new Error(`η υπογραφή ή ο έλεγχος απέτυχε:\n${problems.map(p => `  - ${p}`).join('\n')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === 'version') commandVersion(args);
    else if (args.command === 'inspect') commandInspect(args);
    else if (args.command === 'release') await commandRelease(args);
    else throw new Error('χρήση: node tools/android.mjs version|inspect|release …');
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  }
}
