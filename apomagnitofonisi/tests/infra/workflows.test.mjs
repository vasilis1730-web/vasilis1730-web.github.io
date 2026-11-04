import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ANDROID_APPS } from '../../tools/android/project.mjs';
import { PAGES_PROJECT, PRODUCTION_URL, CONTACT_PLACEHOLDER } from '../../tools/build-dist.mjs';
import { ROOT, read } from './helpers.mjs';

/* Τα workflows του GitHub Actions: μόνο τα τρία που χρειάζονται, με actions
   καρφιτσωμένα σε πλήρες SHA, ελάχιστα δικαιώματα και secrets μόνο μέσω env:
   (ποτέ ${{ }} μέσα σε run:, για να μη γίνεται script injection). */

const SECRETS = Object.freeze({
  'android.yml': ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'],
  'deploy.yml': ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
  'test.yml': [],
});

/** Το σώμα κάθε run: (μονή γραμμή ή μπλοκ |) ενός workflow. */
export function runScripts(text) {
  const lines = text.split('\n');
  const scripts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!match) continue;
    if (!/^[|>]/.test(match[2])) { scripts.push(match[2]); continue; }
    const body = [];
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > match[1].length); j++) body.push(lines[j]);
    scripts.push(body.join('\n'));
  }
  return scripts;
}

test('τα workflows είναι μόνο android.yml, deploy.yml και test.yml, με actions σε πλήρες SHA και ελάχιστα δικαιώματα', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(SECRETS).sort());
  for (const name of Object.keys(SECRETS)) {
    const text = read(`.github/workflows/${name}`);
    assert.match(text, /^permissions:\n  contents: read\n/m, `${name}: permissions contents: read`);
    assert.match(text, /node-version: 22/, `${name}: Node 22`);
    assert.match(text, /npm ci --ignore-scripts/, `${name}: καθαρή εγκατάσταση από το lockfile`);
    for (const [, action] of text.matchAll(/uses:\s*(\S+)/g)) {
      assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${name}: το ${action} δεν είναι καρφιτσωμένο σε πλήρες SHA`);
    }
    assert.doesNotMatch(text, /wrangler-action/, 'το wrangler τρέχει με npx από το package.json, όχι μέσω action');
    for (const [, secret] of text.matchAll(/secrets\.(\w+)/g)) {
      assert.ok(SECRETS[name].includes(secret), `${name}: άγνωστο secret ${secret}`);
    }
    // Secrets και inputs φτάνουν στα scripts μόνο ως μεταβλητές env:, ποτέ ως ${{ }} μέσα στο run.
    for (const line of text.split('\n').filter(l => /\$\{\{\s*secrets\./.test(l))) {
      assert.match(line, /^\s+[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/, `${name}: secret εκτός env: ${line.trim()}`);
    }
    const scripts = runScripts(text);
    assert.ok(scripts.length > 0, `${name}: βρέθηκαν τα run:`);
    for (const script of scripts) assert.doesNotMatch(script, /\$\{\{/, `${name}: έκφραση \${{ }} μέσα σε run: ${script.slice(0, 80)}`);
  }
});

test('το test.yml ελέγχει κάθε αλλαγή: tests, build, Chromium με την πραγματική CSP και build του Android', () => {
  const text = read('.github/workflows/test.yml');
  assert.match(text, /pull_request:\n\s+branches: \[main\]/, 'κάθε PR προς το main ελέγχεται');
  assert.match(text, /- 'claude\/\*\*'/, 'και κάθε push σε branch claude/**');
  assert.match(text, /- 'ccr-\*\*'/, 'και κάθε push σε branch ccr-**');
  assert.match(text, /npm ci --ignore-scripts/);
  assert.match(text, /run: npm test\n[\s\S]*run: npm run build\n[\s\S]*npx playwright install --with-deps chromium[\s\S]*run: npm run test:browser/,
    'tests → build → Chromium → έλεγχοι στον browser');
  assert.doesNotMatch(text, /secrets\./, 'τα tests δεν χρειάζονται κανένα secret');
  assert.match(text, /^  android:\n/m, 'η εφαρμογή Android χτίζεται σε κάθε αλλαγή');
  assert.match(text, new RegExp(`for app in ${ANDROID_APPS.join(' ')};[\\s\\S]*assembleRelease bundleRelease[\\s\\S]*run: node tools\\/android\\.mjs inspect --version-code 2026010100`),
    'χωρίς υπογραφή, με έλεγχο του APK (package, targetSdk, δικαιώματα, host, share target)');
  assert.match(text, /-PapomagnitofonisiVersionCode=2026010100 -PapomagnitofonisiVersionName=ci/);
  assert.match(text, /test -z "\$\(git status --porcelain\)"/, 'το build δεν αφήνει αλλαγές στο repository');
});

test('το deploy.yml ανεβάζει μόνο από το main, μόνο με email επικοινωνίας, και ελέγχει την παραγωγή', () => {
  const text = read('.github/workflows/deploy.yml');
  assert.match(text, /^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:/m);
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/, 'παραγωγή μόνο από το main');
  assert.match(text, new RegExp(`PAGES_PROJECT: ${PAGES_PROJECT}\\n`), 'το Pages project της εφαρμογής');
  assert.match(text, new RegExp(`PUBLIC_URL: '${PRODUCTION_URL.replace(/[.]/g, '\\.')}'`), 'το custom domain της εφαρμογής');
  assert.match(text, /run: npm test\n[\s\S]*run: npm run build\n[\s\S]*Check privacy contact[\s\S]*wrangler pages deploy dist/, 'tests → build → έλεγχος email → deploy');
  assert.ok(text.includes(`grep -rIl '${CONTACT_PLACEHOLDER}' dist`), 'το deploy αρνείται όσο λείπει το email επικοινωνίας της πολιτικής απορρήτου');
  assert.match(text, /group: cloudflare-pages-production\n\s+cancel-in-progress: false/);
  for (const pattern of ["'^content-security-policy:'", "'^x-frame-options: *deny'", "'^x-content-type-options: *nosniff'",
    "'^cross-origin-opener-policy: *same-origin'", "'^cross-origin-embedder-policy: *credentialless'"]) {
    assert.ok(text.includes(`grep -qi ${pattern}`), `ο έλεγχος της παραγωγής κοιτά το ${pattern}`);
  }
  for (const file of ['sw.js', 'manifest.json', '.well-known/assetlinks.json']) {
    assert.ok(text.includes(`same "\${base}/${file}" dist/${file}`), `το ${file} της παραγωγής ταυτίζεται με το dist`);
  }
  assert.match(text, /"200 application\/json"\*\)/, 'assetlinks: 200 application/json χωρίς ανακατεύθυνση');
});

test('το android.yml υπογράφει μόνο χειροκίνητα, μόνο από το main, και δεν αφήνει το keystore στον runner', () => {
  const android = read('.github/workflows/android.yml');
  assert.match(android, /^on:\n  workflow_dispatch:\n/m, 'μόνο χειροκίνητα');
  assert.doesNotMatch(android, /^\s+(push|pull_request|schedule|workflow_run):/m, 'κανένα αυτόματο trigger');
  assert.match(android, /if: github\.ref == 'refs\/heads\/main'/, 'και μόνο από το main');
  assert.match(android, /run: npm test\n[\s\S]*gradlew[\s\S]*node tools\/android\.mjs release/, 'tests → Gradle → υπογραφή');
  assert.match(android, new RegExp(`for app in ${ANDROID_APPS.join(' ')}; do`), 'χτίζει και υπογράφει όλες τις εφαρμογές του tools/android.mjs');
  assert.match(android, /VERSION_CODE: \$\{\{ github\.event\.inputs\.version_code \}\}\n[\s\S]*node tools\/android\.mjs version --code "\$\{VERSION_CODE\}"/,
    'το versionCode περνά από το tools/android.mjs, που το ελέγχει');
  assert.match(android, /-PapomagnitofonisiVersionCode="\$\{VERSION_CODE\}" -PapomagnitofonisiVersionName="\$\{VERSION_NAME\}"/);
  assert.match(android, /umask 077\n\s+printf '%s' "\$\{ANDROID_KEYSTORE_BASE64\}" \| base64 --decode --ignore-garbage > "\$\{RUNNER_TEMP\}\/upload\.keystore"/,
    'το keystore γράφεται μόνο στον προσωρινό φάκελο, αναγνώσιμο μόνο από τον χρήστη του runner');
  assert.match(android, /- name: Remove keystore\n\s+if: always\(\)\n[\s\S]*?rm -f "\$\{RUNNER_TEMP\}\/upload\.keystore"/, 'και σβήνεται ό,τι κι αν γίνει');
  assert.doesNotMatch(android, /--ks-pass pass:|-storepass [^:]|set -x/, 'κανένας κωδικός στη γραμμή εντολών ή στο log');
  assert.match(android, /path: android-release\/\n\s+if-no-files-found: error\n\s+retention-days: 30/, 'artifact με τα AAB/APK για 30 ημέρες');
  assert.match(android, /group: android-release\n\s+cancel-in-progress: false/);
});

test('το runScripts βρίσκει μονές γραμμές και μπλοκ run:', () => {
  const text = 'steps:\n  - run: npm test\n  - name: x\n    run: |\n      echo a\n      echo b\n  - run: echo c\n';
  assert.deepEqual(runScripts(text), ['npm test', '      echo a\n      echo b', 'echo c']);
});
