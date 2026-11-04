import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PUBLIC_DIR } from '../../tools/build-dist.mjs';
import { cspOf } from '../../tools/headers.mjs';
import { findForbiddenCharacters, findSecrets, checkHtml, checkVendorModule, VENDOR_MODULE } from '../../tools/source-checks.mjs';
import { ROOT } from '../../tools/paths.mjs';
import { read, exists, skipWhileAppPending, repositoryFiles, TEXT_FILE } from './helpers.mjs';

/* Υγιεινή όλου του repository: κανόνες που ισχύουν σε κάθε αρχείο, όχι μόνο
   σε όσα δημοσιεύονται. */

const textFiles = () => repositoryFiles().filter(file => TEXT_FILE.test(path.basename(file)));

test('κανένα αρχείο δεν έχει άνω τελεία (U+0387) ή μέση τελεία (U+00B7): κόμμα ή τελεία ανάλογα με το νόημα', () => {
  const found = [];
  for (const file of textFiles()) {
    for (const hit of findForbiddenCharacters(read(file))) found.push(`${file}:${hit.line}: ${hit.name} «${hit.excerpt}»`);
  }
  assert.deepEqual(found, [], 'τα tests γράφουν τους χαρακτήρες μόνο ως escape (\\u0387, String.fromCharCode)');
});

test('κανένα αρχείο δεν έχει κάτι που μοιάζει με πραγματικό κλειδί API ή ιδιωτικό κλειδί', () => {
  const found = [];
  for (const file of textFiles()) {
    for (const hit of findSecrets(read(file))) found.push(`${file}:${hit.line}: ${hit.name}`);
  }
  assert.deepEqual(found, [], 'τα κλειδιά των χρηστών μένουν στις συσκευές τους, τα δικά μας στα GitHub secrets');
});

test('οι σελίδες HTML δεν έχουν inline script, on…=, style= ή εξωτερικούς πόρους εκτός CSP', t => {
  if (skipWhileAppPending(t)) return;
  const csp = cspOf(read(`${PUBLIC_DIR}/_headers`));
  const pages = repositoryFiles().filter(f => /^[^/]+\.html$/.test(f));
  assert.deepEqual(pages.sort(), ['404.html', 'index.html', 'privacy.html']);
  for (const file of pages) assert.deepEqual(checkHtml({ file, text: read(file), csp }), [], file);
  assert.match(read('privacy.html'), /id="delete"/, 'η ενότητα διαγραφής που ζητά το Google Play (…/privacy#delete)');
});

test('οι βιβλιοθήκες τρίτων ζουν μόνο στο src/config/vendor.js, σε ακριβείς εκδόσεις του jsDelivr', t => {
  if (skipWhileAppPending(t)) return;
  assert.ok(exists(VENDOR_MODULE), `${VENDOR_MODULE}: η μοναδική πηγή εκδόσεων των βιβλιοθηκών`);
  const csp = cspOf(read(`${PUBLIC_DIR}/_headers`));
  assert.deepEqual(checkVendorModule({ text: read(VENDOR_MODULE), csp }), []);
});

test('το web manifest είναι έγκυρο, με σχετικές διαδρομές, εικονίδια που υπάρχουν και share target για ήχο και βίντεο', t => {
  if (skipWhileAppPending(t)) return;
  const web = JSON.parse(read('manifest.json'));
  assert.equal(web.start_url, './');
  assert.equal(web.scope, './');
  assert.equal(web.display, 'standalone');
  assert.equal(web.lang, 'el');
  assert.equal(web.id, undefined, 'χωρίς id: το id προκύπτει από το start_url');
  assert.match(web.theme_color, /^#[0-9a-f]{6}$/i);
  for (const icon of web.icons) {
    assert.ok(!/^(\/|https?:)/.test(icon.src), `${icon.src}: σχετική διαδρομή`);
    assert.ok(exists(icon.src), `${icon.src}: υπάρχει`);
  }
  assert.ok(web.icons.some(i => i.sizes === '512x512' && (i.purpose || 'any').includes('maskable')), 'maskable εικονίδιο 512');
  assert.ok(web.icons.some(i => i.sizes === '192x192'), 'εικονίδιο 192');
  assert.equal(web.share_target.method.toUpperCase(), 'POST');
  assert.equal(web.share_target.enctype, 'multipart/form-data');
  assert.ok(!/^(\/|https?:)/.test(web.share_target.action), 'σχετική διαδρομή του share target');
});

test('κάθε αρχείο JavaScript της εφαρμογής και των εργαλείων περνά συντακτικό έλεγχο', t => {
  const files = repositoryFiles().filter(f => /\.(m?js|cjs)$/.test(f) && !f.startsWith('android/'));
  if (!files.some(f => f.startsWith('src/')) && skipWhileAppPending(t)) return;
  const failed = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { encoding: 'utf8' });
    if (result.status !== 0) failed.push(`${file}: ${(result.stderr || '').split('\n').find(l => /Error/.test(l)) || result.stderr}`);
  }
  assert.deepEqual(failed, []);
});

test('τα παραδοτέα έγγραφα του repository ονομάζονται με κενά, όχι με κάτω παύλες', () => {
  const documents = repositoryFiles().filter(f => /\.(docx|xlsx|pptx|pdf|zip|csv)$/i.test(f));
  assert.deepEqual(documents.filter(f => path.basename(f).includes('_')), []);
});

test('το .gitignore κρατά έξω εξαρτήσεις, εξόδους build, γραφικά καταστήματος και δοκιμαστικά αρχεία ήχου', () => {
  const ignore = read('.gitignore').split('\n');
  for (const pattern of ['node_modules/', 'dist/', '.wrangler/', 'store-assets/', 'tests/fixtures/generated/']) {
    assert.ok(ignore.includes(pattern), `.gitignore: ${pattern}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'make-icons.mjs')), 'τα γραφικά ξαναφτιάχνονται με npm run icons');
});

test('τα κείμενα του Google Play στο docs/PLAY.md χωρούν στα όρια του Play Console', () => {
  const text = read('docs/PLAY.md');
  const block = label => {
    const match = text.match(new RegExp(`\\*\\*${label}\\*\\*[^\\n]*\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
    assert.ok(match, `docs/PLAY.md: λείπει το κείμενο «${label}»`);
    return match[1];
  };
  const limits = { 'Όνομα': 30, 'Σύντομη περιγραφή': 80, 'Πλήρης περιγραφή': 4000 };
  for (const [label, limit] of Object.entries(limits)) {
    const value = block(label);
    assert.ok([...value].length <= limit, `${label}: ${[...value].length} χαρακτήρες, όριο ${limit}`);
  }
  assert.equal(block('Όνομα'), JSON.parse(read('package.json')).description.split(':')[0], 'το όνομα του καταστήματος είναι το όνομα της εφαρμογής');
  assert.match(block('Πλήρης περιγραφή'), /Δεν συνδέεται με κανέναν δημόσιο φορέα/, 'δήλωση μη σύνδεσης με φορέα');
  assert.match(block('Πλήρης περιγραφή'), /https:\/\/apomagnitofonisi\.texnikes\.app\/privacy/);
});
