import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../tools/paths.mjs';
import { APP_VERSION, CONTACT_EMAIL } from '../../src/config/app-info.js';
import { SHARE_INBOX_CACHE, SHARED_FILE_NAME_HEADER } from '../../src/infrastructure/platform/shared-file-inbox.js';
import { SKIP_WAITING_MESSAGE } from '../../src/infrastructure/platform/service-worker-client.js';
import { STRINGS } from '../../src/ui/strings.js';
import { ERROR_CODES } from '../../src/application/errors.js';

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(rel) : [rel];
  });
}

const sw = read('sw.js');
const swConstant = name => {
  const match = sw.match(new RegExp(`const ${name} = '([^']*)'`));
  return match && match[1];
};

test('ο service worker προαποθηκεύει ακριβώς τα αρχεία του src/ και τις σελίδες', () => {
  const listed = [...sw.matchAll(/^\s+'\.\/([^']*)',$/gm)].map(m => m[1]);
  const sources = walk('src').sort();
  assert.deepEqual(listed.filter(f => f.startsWith('src/')).sort(), sources, 'το SHELL_FILES του sw.js ακολουθεί τα αρχεία του src/');
  for (const file of listed.filter(f => f && !f.includes('/') === false && !f.startsWith('src/'))) {
    if (file === 'privacy') continue;
    assert.ok(fs.existsSync(path.join(ROOT, file)), `υπάρχει το ${file}`);
  }
  assert.ok(listed.includes('') && listed.includes('privacy') && listed.includes('manifest.json'));
});

test('κοινά συμβόλαια sw.js ↔ εφαρμογής: έκδοση, cache κοινής χρήσης, μήνυμα ενημέρωσης', () => {
  assert.equal(swConstant('APP_VERSION'), APP_VERSION);
  assert.equal(swConstant('SHARE_INBOX_CACHE'), SHARE_INBOX_CACHE);
  assert.equal(swConstant('SHARED_FILE_NAME_HEADER'), SHARED_FILE_NAME_HEADER);
  assert.equal(swConstant('SKIP_WAITING_MESSAGE'), SKIP_WAITING_MESSAGE);
});

test('web manifest κατά το συμβόλαιο με την εφαρμογή Android', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'Απομαγνητοφώνηση');
  assert.equal(manifest.short_name, 'Απομαγνητοφώνηση');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0E3B43');
  assert.equal(manifest.background_color, '#0E3B43');
  assert.equal('id' in manifest, false);
  assert.deepEqual(manifest.icons.map(i => [i.src, i.sizes, i.purpose]), [
    ['assets/icons/icon-192.png', '192x192', 'any'],
    ['assets/icons/icon-512.png', '512x512', 'any'],
    ['assets/icons/icon-maskable-512.png', '512x512', 'maskable'],
  ]);
  assert.deepEqual(manifest.share_target, {
    action: './share-target', method: 'POST', enctype: 'multipart/form-data',
    params: { files: [{ name: 'media', accept: ['audio/*', 'video/*'] }] },
  });
  assert.match(sw, /url\.pathname\.endsWith\('\/share-target'\)/);
  assert.match(sw, /form\.getAll\('media'\)/, 'το όνομα πεδίου του share target');
});

test('σελίδες: χωρίς inline script/style, με την πολιτική απορρήτου και τη διαγραφή', () => {
  for (const file of ['index.html', 'privacy.html', '404.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file}: inline script`);
    assert.doesNotMatch(html, /<style/i, `${file}: <style>`);
    assert.doesNotMatch(html, /\sstyle=/i, `${file}: style=`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${file}: on…=`);
    assert.match(html, /<html lang="el"/);
  }
  const privacy = read('privacy.html');
  assert.match(privacy, /id="delete"/);
  for (const provider of ['ElevenLabs', 'Anthropic', 'Hugging Face', 'jsDelivr', 'Cloudflare']) assert.match(privacy, new RegExp(provider));
  assert.match(privacy, /δεν συνδέεται με κανέναν φορέα/);
  assert.ok(privacy.includes(CONTACT_EMAIL), 'ίδιο email επικοινωνίας με το app-info.js');
  assert.match(read('index.html'), /<script type="module" src="\.\/src\/main\.js"><\/script>/);
});

test('κάθε κωδικός σφάλματος έχει μήνυμα για τον χρήστη', () => {
  for (const code of Object.values(ERROR_CODES)) assert.ok(STRINGS.errors[code], code);
});

test('χωρίς άνω τελεία και χωρίς import maps στα αρχεία της εφαρμογής', () => {
  const files = [...walk('src'), 'index.html', 'privacy.html', '404.html', 'manifest.json', 'sw.js'];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, new RegExp(`[${String.fromCharCode(0x387, 0xb7)}]`), file);
    assert.doesNotMatch(text, /importmap/i, file);
  }
});

test('οι βιβλιοθήκες τρίτων εμφανίζονται μόνο στο config/vendor.js', () => {
  for (const file of walk('src').filter(f => f.endsWith('.js') && f !== 'src/config/vendor.js')) {
    assert.doesNotMatch(read(file), /cdn\.jsdelivr\.net\/npm/, file);
  }
});
