import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHeaderRules, ruleMatches, headersFor, cspOf, directiveSources, effectiveSources, sourceAllowsUrl, cspAllows,
} from '../../tools/headers.mjs';
import {
  findForbiddenCharacters, findSecrets, urlLiteralsIn, findScriptUrlProblems, findVendorModuleProblems, describeJsdelivrPin,
  findStrayVendorUrlProblems, findHtmlProblems, findPublishedSourceProblems, VENDOR_MODULE,
} from '../../tools/source-checks.mjs';

/* Οι καθαρές συναρτήσεις των εργαλείων ελέγχου (tools/headers.mjs και
   tools/source-checks.mjs), με τεχνητά δεδομένα. Οι πραγματικοί έλεγχοι
   πάνω στα αρχεία του repository είναι στα sources.test.mjs και build.test.mjs. */

const HEADERS = `# σχόλιο
/*
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.org blob:; connect-src 'self' https://api.example.org https://*.cdn.example.net; style-src 'self'
  ! Access-Control-Allow-Origin
/sw.js
  Cache-Control: no-cache
/docs/*
  X-Robots-Tag: noindex
`;
const CSP = cspOf(HEADERS);

test('ανάγνωση του _headers: κανόνες, ταίριασμα διαδρομών, headers ανά διαδρομή, CSP', () => {
  const rules = parseHeaderRules(HEADERS);
  assert.deepEqual(rules.map(r => r.pattern), ['/*', '/sw.js', '/docs/*']);
  assert.deepEqual(rules[0].unset, ['access-control-allow-origin']);
  assert.ok(ruleMatches('/*', '/anything'));
  assert.ok(ruleMatches('/docs/*', '/docs/a/b'));
  assert.ok(!ruleMatches('/docs/*', '/doc'));
  assert.ok(ruleMatches('/sw.js', '/sw.js') && !ruleMatches('/sw.js', '/sw.json'));
  assert.equal(headersFor(rules, '/sw.js')['Cache-Control'], 'no-cache');
  assert.equal(headersFor(rules, '/sw.js')['X-Frame-Options'], 'DENY', 'ο κανόνας /* ισχύει παντού');
  assert.equal(headersFor(rules, '/index.html')['Cache-Control'], undefined);
  assert.equal(headersFor([{ pattern: '/*', set: [['Access-Control-Allow-Origin', '*']], unset: [] }, rules[0]], '/x')['Access-Control-Allow-Origin'], undefined,
    'το ! αφαιρεί header που έβαλε προηγούμενος κανόνας');
  assert.throws(() => parseHeaderRules('/*\n  χωρίς άνω κάτω\n'), /χωρίς «:»/);
  assert.throws(() => cspOf('/*\n  X-Frame-Options: DENY\n'), /Content-Security-Policy/);
  assert.deepEqual(directiveSources(CSP, 'script-src'), ["'self'", 'https://cdn.example.org', 'blob:']);
  assert.equal(directiveSources(CSP, 'img-src'), null);
  assert.deepEqual(effectiveSources(CSP, 'img-src'), ["'self'"], 'χωρίς οδηγία ισχύει το default-src');
});

test('μια πηγή της CSP επιτρέπει URL ανά host, υποτομέα σε κάθε βάθος, σχήμα και πρόθεμα διαδρομής', () => {
  assert.ok(sourceAllowsUrl('https://api.example.org', 'https://api.example.org/v1/x'));
  assert.ok(!sourceAllowsUrl('https://api.example.org', 'https://evil.example.org/'));
  assert.ok(!sourceAllowsUrl('https://api.example.org', 'http://api.example.org/'), 'άλλο σχήμα');
  assert.ok(sourceAllowsUrl('https://*.hf.co', 'https://us.aws.cdn.hf.co/x'), 'ο μπαλαντέρ καλύπτει υποτομείς σε κάθε βάθος');
  assert.ok(!sourceAllowsUrl('https://*.hf.co', 'https://hf.co/x'), 'ο μπαλαντέρ δεν καλύπτει τον ίδιο τον τομέα');
  assert.ok(!sourceAllowsUrl('https://*.hf.co', 'https://evilhf.co/x'));
  assert.ok(sourceAllowsUrl('blob:', 'blob:https://app.example/1234'));
  assert.ok(sourceAllowsUrl('https:', 'https://anything.example/'));
  assert.ok(sourceAllowsUrl('https://cdn.example.org/npm/', 'https://cdn.example.org/npm/pkg@1.0.0/x.js'));
  assert.ok(!sourceAllowsUrl('https://cdn.example.org/npm/', 'https://cdn.example.org/gh/x.js'));
  assert.ok(!sourceAllowsUrl("'self'", 'https://app.example/'), "το 'self' το χειρίζεται ο καλών");
  assert.ok(cspAllows(CSP, 'connect-src', 'https://a.b.cdn.example.net/x'));
  assert.ok(!cspAllows(CSP, 'connect-src', 'https://cdn.example.org/x'));
  assert.ok(!cspAllows(CSP, 'img-src', 'https://cdn.example.org/x.png'), 'default-src: μόνο self');
});

test('εύρεση άνω τελείας, μέσης τελείας και κλειδιών', () => {
  const ano = String.fromCharCode(0x387);
  const middle = String.fromCharCode(0xb7);
  const hits = findForbiddenCharacters(`πρώτη γραμμή\nδεύτερη${ano} τρίτη${middle} λέξη`);
  assert.deepEqual(hits.map(h => [h.line, h.name]), [[2, 'άνω τελεία (U+0387)'], [2, 'μέση τελεία (U+00B7)']]);
  assert.deepEqual(findForbiddenCharacters('καθαρό κείμενο, με κόμμα. Και τελεία.'), []);

  // Τα «κλειδιά» φτιάχνονται εδώ, ώστε το ίδιο το αρχείο να μην έχει τίποτα που μοιάζει με μυστικό.
  const anthropic = `sk-ant-api03-${'A1b2C3d4'.repeat(12)}`;
  const elevenlabs = `sk_${'0123456789abcdef'.repeat(3)}`;
  const found = findSecrets(`const a = '${anthropic}';\n\nconst b = "${elevenlabs}";`);
  assert.deepEqual(found, [{ line: 1, name: 'κλειδί Anthropic' }, { line: 3, name: 'κλειδί ElevenLabs' }]);
  assert.ok(!JSON.stringify(found).includes(anthropic), 'η τιμή του κλειδιού δεν επιστρέφεται');
  assert.deepEqual(findSecrets("const fake = 'sk-ant-test'; const other = 'sk_test';"), [], 'τα κοντά ψεύτικα κλειδιά των tests δεν μετρούν');
  assert.deepEqual(findSecrets(`-----BEGIN ${'PRIVATE'} KEY-----`).map(f => f.name), ['ιδιωτικό κλειδί']);
});

test('τα URL του κώδικα: μόνο συμβολοσειρές https, όχι σχόλια, μέχρι το πρώτο ${', () => {
  const text = [
    "// δες https://ignored.example/docs",
    "const a = 'https://api.example.org/v1/x';",
    'const b = `https://api.example.org/${path}`;',
    'const ns = "http://www.w3.org/2000/svg";',
    "const c = 'https://' + host;",
  ].join('\n');
  assert.deepEqual(urlLiteralsIn(text).map(u => [u.url.hostname, u.line]), [['api.example.org', 2], ['api.example.org', 3]]);

  const ok = findScriptUrlProblems({ file: 'src/a.js', text: "fetch('https://api.example.org/x'); import('https://cdn.example.org/m.js'); a.href = 'https://elevenlabs.io/app';", csp: CSP });
  assert.deepEqual(ok, [], 'connect-src, script-src και σύνδεσμος πλοήγησης');
  const bad = findScriptUrlProblems({ file: 'src/a.js', text: "fetch('https://tracker.example/collect');", csp: CSP });
  assert.match(bad.join('\n'), /src\/a\.js:1: το tracker\.example δεν επιτρέπεται/);
  const own = "export const SITE = 'https://app.example/';";
  assert.equal(findScriptUrlProblems({ file: 'src/b.js', text: own, csp: CSP }).length, 1);
  assert.deepEqual(findScriptUrlProblems({ file: 'src/b.js', text: own, csp: CSP, selfOrigins: ['https://app.example'] }), [],
    'το URL της ίδιας της εφαρμογής είναι self');
});

test('οι βιβλιοθήκες τρίτων: μόνο στο vendor.js, μόνο jsDelivr με ακριβή έκδοση, επιτρεπτές από την CSP', () => {
  assert.deepEqual(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/mediabunny@1.65.1/dist/bundles/mediabunny.min.mjs'), { ok: true, packageNamed: true, version: '1.65.1' });
  assert.equal(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm').version, '1.4.0', 'scoped πακέτο με +esm');
  assert.equal(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/pkg@4.4.0-next.0/x.js').ok, true, 'προέκδοση με ακριβή αριθμό');
  assert.match(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/mediabunny/dist/x.mjs').reason, /χωρίς έκδοση/);
  assert.match(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/mediabunny@1/dist/x.mjs').reason, /δεν είναι ακριβής/);
  assert.match(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/mediabunny@latest/x.mjs').reason, /δεν είναι ακριβής/);
  assert.match(describeJsdelivrPin('https://unpkg.com/mediabunny@1.65.1/x.mjs').reason, /εκτός jsDelivr/);
  assert.equal(describeJsdelivrPin('https://cdn.jsdelivr.net/npm/').packageNamed, false, 'πρόθεμα χωρίς πακέτο (service worker)');

  const csp = "script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net";
  assert.deepEqual(findVendorModuleProblems({ text: "export const A = 'https://cdn.jsdelivr.net/npm/a@1.2.3/a.mjs';", csp }), []);
  assert.match(findVendorModuleProblems({ text: "export const A = 'https://cdn.jsdelivr.net/npm/a@^1.2.3/a.mjs';", csp }).join('\n'), /δεν είναι ακριβής/);
  assert.match(findVendorModuleProblems({ text: "export const A = 'https://cdn.jsdelivr.net/npm/a@1.2.3/a.mjs';", csp: "script-src 'self'" }).join('\n'), /script-src[\s\S]*connect-src/);
  assert.match(findVendorModuleProblems({ text: 'export const NOTHING = 1;', csp }).join('\n'), /κανένα URL/);
  assert.match(findStrayVendorUrlProblems({ file: 'src/x.js', text: "import('https://cdn.jsdelivr.net/npm/a@1.2.3/a.mjs');" }).join('\n'), /έξω από το src\/config\/vendor\.js/);
  assert.deepEqual(findStrayVendorUrlProblems({ file: 'sw.js', text: "const CDN = 'https://cdn.jsdelivr.net/npm/';" }), []);
  assert.deepEqual(findStrayVendorUrlProblems({ file: VENDOR_MODULE, text: "const A = 'https://cdn.jsdelivr.net/npm/a@1.2.3/a.mjs';" }), []);
});

test('οι σελίδες HTML δεν έχουν ό,τι κόβει η αυστηρή CSP', () => {
  const clean = '<!doctype html><html><head><link rel="stylesheet" href="./src/styles/app.css"><link rel="manifest" href="./manifest.json">'
    + '<script type="module" src="./src/main.js"></script></head><body><a href="https://elevenlabs.io/">ElevenLabs</a></body></html>';
  assert.deepEqual(findHtmlProblems({ file: 'index.html', text: clean, csp: CSP }), []);
  const problems = html => findHtmlProblems({ file: 'x.html', text: html, csp: CSP }).join('\n');
  assert.match(problems('<script>alert(1)</script>'), /inline <script>/);
  assert.match(problems('<script type="importmap">{}</script>'), /inline <script>/, 'ούτε import map');
  assert.match(problems('<button onclick="go()">x</button>'), /on…=/);
  assert.match(problems('<div style="color:red">x</div>'), /style=/);
  assert.match(problems('<style>p{}</style>'), /<style>/);
  assert.match(problems('<a href="javascript:void(0)">x</a>'), /javascript:/);
  assert.match(problems('<link rel="stylesheet" href="https://fonts.example/x.css">'), /style-src/);
  assert.match(problems('<script src="https://evil.example/x.js"></script>'), /script-src/);
  assert.equal(problems('<script src="https://cdn.example.org/x.js"></script>'), '', 'host του script-src');
  assert.equal(problems('<link rel="canonical" href="https://other.example/">'), '', 'το canonical δεν φορτώνει πόρο');
});

test('όλοι οι έλεγχοι μαζί πάνω σε λίστα αρχείων', () => {
  const ano = String.fromCharCode(0x387);
  const problems = findPublishedSourceProblems({
    csp: CSP,
    files: [
      { path: 'index.html', text: '<p>Καλημέρα</p>' },
      { path: 'src/a.js', text: `const t = 'τέλος${ano} αρχή';\nfetch('https://tracker.example/');` },
      { path: VENDOR_MODULE, text: "export const X = 'https://cdn.example.org/x.js';" },
    ],
  });
  assert.equal(problems.length, 4, problems.join('\n'));
  assert.match(problems[0], /src\/a\.js:1: άνω τελεία/);
  assert.match(problems[1], /src\/a\.js:2: το tracker\.example/);
  assert.match(problems[2], /src\/config\/vendor\.js:1: βιβλιοθήκη εκτός jsDelivr/);
  assert.match(problems[3], /src\/config\/vendor\.js:1: το connect-src της CSP δεν επιτρέπει το cdn\.example\.org/);
});
