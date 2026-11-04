import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../tools/paths.mjs';
import {
  ALLOWED_DEPENDENCIES, APPLICATION_CONTRACTS, BROWSER_GLOBALS, COMPOSITION_ROOTS, INFRASTRUCTURE_PROVIDERS,
  INFRASTRUCTURE_SHARED_FILES, INFRASTRUCTURE_SHARED_FOLDERS, LAYERS, MAIN_COMPOSITION_ROOT, PURE_LAYERS,
  TOOLS_READABLE_SOURCE, WORKER_COMPOSITION_ROOT,
  splitModuleSource, scanModuleDependencies, resolveSpecifier, layerOf, infrastructureAreaOf,
  findLayerViolations, findBoundaryViolations, findModuleCycles, findMatrixCycles, stronglyConnectedCycles,
  findBrowserGlobals, findToolsImportViolations, findOccurrencesOutside,
} from '../../tools/import-graph.mjs';
import { repositoryFiles, skipWhileAppPending } from './helpers.mjs';

/* Η αρχιτεκτονική της εφαρμογής (Clean Architecture) ως έλεγχος και όχι μόνο ως
   σχόλιο: ο πίνακας των στρωμάτων, κανένας κύκλος ανάμεσα σε modules, καθαρά
   domain και application, τα όρια μέσα στα στρώματα, δύο composition roots που
   κανείς δεν εισάγει, και τα tools/ που διαβάζουν από το src/ μόνο το
   src/config/. Μετρούν και οι τύποι JSDoc import('…'). Οι κανόνες
   περιγράφονται στο tools/import-graph.mjs και στο CLAUDE.md. */

/** Το μόνο αρχείο με δυναμικό import(): ο φορτωτής βιβλιοθηκών τρίτων (src/config/vendor.js). */
const DYNAMIC_IMPORT_FILES = Object.freeze(['src/infrastructure/vendor-loader.js']);

/**
 * Πού επιτρέπεται `new Worker(`: μόνο στο composition root της σελίδας, που δίνει
 * στη μηχανή Whisper μια συνάρτηση δημιουργίας του worker (η μηχανή δεν ξέρει το URL του).
 */
const WORKER_CONSTRUCTION_FILES = Object.freeze([MAIN_COMPOSITION_ROOT]);

const exists = file => fs.existsSync(path.join(ROOT, file));
const sourceOf = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Τα modules ενός φακέλου με τις εξαρτήσεις τους, όπως είναι σήμερα στον δίσκο. */
function scannedModules(dir) {
  return repositoryFiles(dir)
    .filter(file => /\.m?js$/.test(file))
    .sort()
    .map(file => ({ file, ...scanModuleDependencies(sourceOf(file)) }));
}

test('ο πίνακας των στρωμάτων είναι ακριβώς αυτός και δεν έχει κύκλο', () => {
  assert.deepEqual([...LAYERS].sort(), ['application', 'config', 'domain', 'infrastructure', 'ui']);
  assert.deepEqual(ALLOWED_DEPENDENCIES, {
    domain: ['domain'],
    application: ['application', 'domain', 'config'],
    infrastructure: ['infrastructure', 'application', 'domain', 'config'],
    ui: ['ui', 'application', 'domain', 'config'],
    config: [],
    main: ['infrastructure', 'application', 'domain', 'config', 'ui'],
  }, 'αλλαγή στον πίνακα = απόφαση αρχιτεκτονικής: ενημερώνεται εδώ, στο tools/import-graph.mjs και στο CLAUDE.md');
  assert.deepEqual(findMatrixCycles(ALLOWED_DEPENDENCIES), []);
  assert.deepEqual(findMatrixCycles({ a: ['a', 'b'], b: ['a'] }), ['a → b → a'], 'ο έλεγχος του πίνακα βρίσκει κύκλο');
  assert.deepEqual([...COMPOSITION_ROOTS], [MAIN_COMPOSITION_ROOT, WORKER_COMPOSITION_ROOT]);
  assert.deepEqual([...PURE_LAYERS], ['domain', 'application']);
  assert.equal(TOOLS_READABLE_SOURCE, 'src/config/');
  assert.equal(layerOf(MAIN_COMPOSITION_ROOT), 'main');
  assert.equal(layerOf(WORKER_COMPOSITION_ROOT), 'infrastructure', 'ο worker είναι composition root μέσα στο infrastructure');
  assert.equal(layerOf('src/domain/audio/pcm.js'), 'domain');
  assert.equal(layerOf('src/styles/app.css'), null);
});

test('το src/ τηρεί τον κανόνα εξαρτήσεων των στρωμάτων (και στους τύπους JSDoc και στα αρχεία new URL)', t => {
  if (skipWhileAppPending(t)) return;
  const problems = findLayerViolations(scannedModules('src'), { exists });
  assert.deepEqual(problems, [], `παραβιάσεις του κανόνα εξαρτήσεων:\n${problems.join('\n')}`);
});

test('κανένας κύκλος εξαρτήσεων ανάμεσα σε modules του src/ (ούτε μέσω τύπων JSDoc)', t => {
  if (skipWhileAppPending(t)) return;
  const cycles = findModuleCycles(scannedModules('src'), { exists });
  assert.deepEqual(cycles, [], `κύκλοι:\n${cycles.join('\n')}`);
});

test('domain και application χωρίς globals του browser', t => {
  if (skipWhileAppPending(t)) return;
  const problems = PURE_LAYERS
    .flatMap(layer => repositoryFiles(`src/${layer}`))
    .filter(file => /\.m?js$/.test(file))
    .sort()
    .flatMap(file => findBrowserGlobals({ file, source: sourceOf(file) }));
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('τα όρια μέσα στα στρώματα: components χωρίς προβολές, πάροχοι απομονωμένοι, το infrastructure βλέπει μόνο συμβόλαια της application', t => {
  if (skipWhileAppPending(t)) return;
  const problems = findBoundaryViolations(scannedModules('src'));
  assert.deepEqual(problems, [], problems.join('\n'));
  for (const file of [...APPLICATION_CONTRACTS, ...INFRASTRUCTURE_SHARED_FILES]) {
    assert.ok(exists(file), `η λίστα δείχνει σε αρχείο που υπάρχει: ${file}`);
  }
  for (const folder of [...INFRASTRUCTURE_PROVIDERS, ...INFRASTRUCTURE_SHARED_FOLDERS]) {
    assert.ok(exists(`src/infrastructure/${folder}`), `η λίστα δείχνει σε φάκελο που υπάρχει: src/infrastructure/${folder}`);
  }
});

test('τα tools/ διαβάζουν από το src/ μόνο το src/config/', () => {
  const problems = findToolsImportViolations(scannedModules('tools'));
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('δυναμικό import() μόνο στον φορτωτή, new Worker( μόνο στο main, που ξεκινά τον worker με new URL', t => {
  if (skipWhileAppPending(t)) return;
  const modules = scannedModules('src');
  const dynamic = findOccurrencesOutside(modules.map(m => ({ file: m.file, lines: m.dynamicImportLines })), DYNAMIC_IMPORT_FILES, 'το δυναμικό import()');
  assert.deepEqual(dynamic, [], dynamic.join('\n'));
  const workers = findOccurrencesOutside(modules.map(m => ({ file: m.file, lines: m.workerLines })), WORKER_CONSTRUCTION_FILES, 'το new Worker(');
  assert.deepEqual(workers, [], workers.join('\n'));
  for (const file of [...DYNAMIC_IMPORT_FILES, ...WORKER_CONSTRUCTION_FILES, ...COMPOSITION_ROOTS]) {
    assert.ok(exists(file), `η λίστα του test δείχνει σε αρχείο που υπάρχει: ${file}`);
  }
  assert.ok(modules.some(m => DYNAMIC_IMPORT_FILES.includes(m.file) && m.dynamicImportLines.length), 'ο φορτωτής πράγματι κάνει import()');
  const main = modules.find(m => m.file === MAIN_COMPOSITION_ROOT);
  assert.ok(main.assets.some(a => resolveSpecifier(main.file, a.specifier).target === WORKER_COMPOSITION_ROOT),
    `το ${MAIN_COMPOSITION_ROOT} ξεκινά τον worker από το ${WORKER_COMPOSITION_ROOT} με new URL(…, import.meta.url)`);
});

/* ---------- Οι κανόνες με ψεύτικα modules ---------- */

test('το σάρωμα ξεχωρίζει import, τύπους JSDoc, αρχεία new URL, δυναμικό import() και new Worker( από κείμενα, templates και regular expressions', () => {
  const source = [
    "import { a, b } from './a.js';",
    "import {",
    "  c,",
    "} from '../domain/c.js';",
    "import './side-effect.js';",
    "export { d } from './d.js';",
    "export * from \"./e.js\";",
    "/** @param {import('../infrastructure/x.js').X} x */",
    "// import { nope } from './comment.js';",
    "const s = \"import { q } from './string.js'\";",
    "const re = /['\"]import\\(/g;",
    "const url = 'https://example.org/a//b';",
    "const tpl = `import(${name}) and ${ { k: 'v' }.k } new Worker(`;",
    "const half = total / 2; const other = (x) / 3;",
    "await import(url);",
    "const w = new Worker(new URL('./w.js', import.meta.url));",
    "export const later = 'from';",
    'const doc = `',
    "import fake from './fake.js';",
    "export * from './also-fake.js';",
    'new URL(`./not-an-asset.js`, import.meta.url);',
    '`;',
    'const here = new URL(location.href);',
  ].join('\n');
  const { imports, assets, dynamicImportLines, workerLines } = scanModuleDependencies(source);
  assert.deepEqual(imports.filter(i => i.kind === 'static').map(i => i.specifier), ['./a.js', '../domain/c.js', './side-effect.js', './d.js', './e.js'],
    'όχι οι γραμμές μέσα σε template literal');
  assert.deepEqual(imports.filter(i => i.kind === 'type').map(i => [i.specifier, i.line]), [['../infrastructure/x.js', 8]]);
  assert.equal(imports.find(i => i.specifier === '../domain/c.js').line, 4, 'η γραμμή του specifier');
  assert.deepEqual(assets, [{ specifier: './w.js', line: 16 }], 'μόνο new URL με import.meta.url, όχι μέσα σε template');
  assert.deepEqual(dynamicImportLines, [15], 'μόνο το πραγματικό import(), όχι σε συμβολοσειρά, template ή regular expression');
  assert.deepEqual(workerLines, [16]);

  const { code, bare } = splitModuleSource(source);
  assert.equal(code.length, source.length, 'οι θέσεις των χαρακτήρων μένουν ίδιες');
  assert.equal(bare.split('\n').length, source.split('\n').length, 'και οι γραμμές');
  assert.ok(!code.includes('comment.js') && code.includes('string.js'), 'τα σχόλια σβήνονται, οι συμβολοσειρές μένουν στο code');
  assert.ok(!code.includes('fake.js'), 'το κείμενο των template literals σβήνεται στο code');
  assert.ok(code.includes("{ k: 'v' }"), 'ο κώδικας μέσα στα ${…} μένει');
  assert.ok(!bare.includes('string.js'), 'οι συμβολοσειρές σβήνονται στο bare');
});

test('η επίλυση specifier και τα μηνύματα παραβίασης των στρωμάτων, των composition roots και των αρχείων new URL', () => {
  assert.deepEqual(resolveSpecifier('src/ui/views/home-view.js', '../../application/ports.js'), { kind: 'relative', target: 'src/application/ports.js' });
  assert.deepEqual(resolveSpecifier('src/main.js', '/src/config/vendor.js'), { kind: 'absolute', target: 'src/config/vendor.js' });
  assert.equal(resolveSpecifier('src/main.js', 'https://cdn.jsdelivr.net/npm/x@1.0.0/x.mjs').kind, 'url');
  assert.equal(resolveSpecifier('src/main.js', 'mediabunny').kind, 'bare');

  const modules = [
    { file: 'src/domain/a.js', imports: [{ specifier: '../config/models.js', line: 3, kind: 'static' }] },
    { file: 'src/ui/views/v.js', imports: [{ specifier: '../../infrastructure/platform/file-saver.js', line: 7, kind: 'type' }] },
    { file: 'src/application/s.js', imports: [{ specifier: 'mediabunny', line: 1, kind: 'static' }, { specifier: '../main.js', line: 2, kind: 'static' }] },
    { file: 'src/config/c.js', imports: [{ specifier: './other.js', line: 1, kind: 'static' }] },
    { file: 'src/infrastructure/i.js', imports: [{ specifier: '../../tools/paths.mjs', line: 1, kind: 'static' }, { specifier: './missing.js', line: 2, kind: 'static' }] },
    { file: 'src/infrastructure/elevenlabs/e.js', imports: [{ specifier: '../whisper/whisper-worker.js', line: 4, kind: 'type' }] },
    { file: 'src/lib/x.js', imports: [] },
    { file: 'src/ui/router.js', imports: [], assets: [{ specifier: '../infrastructure/whisper/whisper-worker.js', line: 9 }, { specifier: './gone.js', line: 10 }] },
    {
      file: MAIN_COMPOSITION_ROOT,
      imports: [{ specifier: './infrastructure/i.js', line: 1, kind: 'static' }, { specifier: './ui/views/v.js', line: 2, kind: 'static' }],
      assets: [{ specifier: './infrastructure/whisper/whisper-worker.js', line: 3 }],
    },
  ];
  const problems = findLayerViolations(modules, { exists: file => !/(missing|gone)\.js$/.test(file) }).join('\n');
  assert.match(problems, /src\/domain\/a\.js:3: import «\.\.\/config\/models\.js»: το στρώμα domain δεν επιτρέπεται να εξαρτάται από το config/);
  assert.match(problems, /src\/ui\/views\/v\.js:7: τύπος JSDoc «[^»]+file-saver\.js»: το στρώμα ui δεν επιτρέπεται να εξαρτάται από το infrastructure/);
  assert.match(problems, /src\/application\/s\.js:1: import «mediabunny»: βιβλιοθήκη τρίτου/);
  assert.match(problems, /src\/application\/s\.js:2: import «\.\.\/main\.js»: κανείς δεν εισάγει composition root/);
  assert.match(problems, /src\/infrastructure\/elevenlabs\/e\.js:4: τύπος JSDoc «[^»]+»: κανείς δεν εισάγει composition root \(src\/infrastructure\/whisper\/whisper-worker\.js\)/);
  assert.match(problems, /src\/config\/c\.js:1: import «\.\/other\.js»: το στρώμα config δεν επιτρέπεται να εξαρτάται από το config \(επιτρέπονται: κανένα\)/);
  assert.match(problems, /src\/infrastructure\/i\.js:1: import «[^»]+»: δείχνει έξω από το src\//);
  assert.match(problems, /src\/infrastructure\/i\.js:2: import «\.\/missing\.js»: δεν υπάρχει το src\/infrastructure\/missing\.js/);
  assert.match(problems, /src\/lib\/x\.js: δεν ανήκει σε κανένα στρώμα/);
  assert.match(problems, /src\/ui\/router\.js:9: αρχείο «[^»]+whisper-worker\.js» \(new URL\(…, import\.meta\.url\)\): μόνο το src\/main\.js ξεκινά τον worker/);
  assert.match(problems, /src\/ui\/router\.js:10: αρχείο «\.\/gone\.js» [^:]+: δεν υπάρχει το src\/ui\/gone\.js/);
  assert.doesNotMatch(problems, /^src\/main\.js:/m, 'το composition root εξαρτάται από όλα και ξεκινά τον worker');
});

test('οι κύκλοι ανάμεσα σε modules βρίσκονται (Tarjan), και με τύπους JSDoc, με σταθερή σειρά', () => {
  const modules = [
    { file: 'src/application/ports.js', imports: [{ specifier: './api-key-service.js', kind: 'type' }] },
    { file: 'src/application/api-key-service.js', imports: [{ specifier: './ports.js', kind: 'type' }, { specifier: '../domain/a.js', kind: 'static' }] },
    { file: 'src/domain/a.js', imports: [{ specifier: './b.js', kind: 'static' }] },
    { file: 'src/domain/b.js', imports: [{ specifier: './c.js', kind: 'static' }] },
    { file: 'src/domain/c.js', imports: [{ specifier: './a.js', kind: 'static' }] },
    { file: 'src/ui/self.js', imports: [{ specifier: './self.js', kind: 'static' }] },
    { file: 'src/ui/ok.js', imports: [{ specifier: '../domain/a.js', kind: 'static' }, { specifier: 'mediabunny', kind: 'static' }] },
  ];
  assert.deepEqual(findModuleCycles(modules), [
    'κύκλος εξαρτήσεων μόνο μέσω τύπων JSDoc (στρώματα: application): src/application/api-key-service.js → src/application/ports.js → src/application/api-key-service.js',
    'κύκλος εξαρτήσεων στο runtime (στρώματα: domain): src/domain/a.js → src/domain/b.js → src/domain/c.js → src/domain/a.js',
    'κύκλος εξαρτήσεων στο runtime (στρώματα: ui): src/ui/self.js → src/ui/self.js',
  ]);
  assert.deepEqual(findModuleCycles(modules.filter(m => !/(ports|c|self)\.js$/.test(m.file))), [], 'χωρίς τις επιστροφές, κανένας κύκλος');
  assert.deepEqual(findModuleCycles(modules, { exists: file => !file.endsWith('c.js') }).length, 2, 'ένα module που λείπει δεν κλείνει κύκλο');

  // Μεγάλος γράφος χωρίς κύκλο: ο Tarjan τελειώνει σε γραμμικό χρόνο (όχι απαρίθμηση μονοπατιών).
  const chain = new Map(Array.from({ length: 2000 }, (_, i) => [`m${i}`, new Set(i ? [`m${i - 1}`] : [])]));
  for (let i = 2; i < 2000; i++) chain.get(`m${i}`).add(`m${i - 2}`);
  assert.deepEqual(stronglyConnectedCycles(chain), []);
});

test('τα καθαρά στρώματα: globals του browser σε θέση global, όχι ιδιότητες, κλειδιά, μέθοδοι ή τοπικά ονόματα', () => {
  assert.ok(BROWSER_GLOBALS.includes('fetch') && BROWSER_GLOBALS.includes('localStorage') && BROWSER_GLOBALS.includes('document'));
  const source = [
    "const r = await fetch('/x');",
    'const k = localStorage.getItem("k");',
    'if (typeof window !== "undefined") {}',
    'const spread = { ...navigator };',
    'const ok1 = options.document;',
    'const ok2 = { window: 1, self: 2 };',
    "// window.location σε σχόλιο",
    "const ok3 = 'document.cookie σε συμβολοσειρά';",
    'class Repo {',
    '  async fetch(id) {',
    '    return id;',
    '  }',
    '}',
    'const ok4 = a ? b : c;',
  ].join('\n');
  const problems = findBrowserGlobals({ file: 'src/application/x.js', source });
  // Με τη σειρά της BROWSER_GLOBALS (window, document, navigator, localStorage, …, fetch).
  assert.deepEqual(problems.map(p => p.match(/:(\d+): «(\w+)»/).slice(1)), [['3', 'window'], ['4', 'navigator'], ['2', 'localStorage'], ['1', 'fetch']]);
  assert.match(problems[0], /src\/application\/x\.js:\d+: «\w+» είναι global του browser: το στρώμα application μένει καθαρό/);
  assert.deepEqual(findBrowserGlobals({ file: 'src/domain/w.js', source: 'const window = { start: 0 };\nreturn window;' }), [], 'τοπικό όνομα που σκιάζει το global');
  assert.deepEqual(findBrowserGlobals({ file: 'src/infrastructure/x.js', source }), [], 'το infrastructure δεν είναι καθαρό στρώμα');
});

test('τα όρια μέσα στα στρώματα με ψεύτικα modules', () => {
  assert.deepEqual(infrastructureAreaOf('src/infrastructure/whisper/a.js'), { kind: 'provider', name: 'whisper' });
  assert.deepEqual(infrastructureAreaOf('src/infrastructure/platform/a.js'), { kind: 'shared', name: 'platform' });
  assert.deepEqual(infrastructureAreaOf('src/infrastructure/vendor-loader.js'), { kind: 'shared', name: 'vendor-loader.js' });
  assert.deepEqual(infrastructureAreaOf('src/infrastructure/new/a.js'), { kind: 'unknown', name: 'new' });
  assert.equal(infrastructureAreaOf('src/ui/a.js'), null);
  const modules = [
    { file: 'src/ui/components/c.js', imports: [{ specifier: '../views/v.js', line: 1, kind: 'type' }, { specifier: '../dom.js', line: 2, kind: 'static' }] },
    { file: 'src/infrastructure/elevenlabs/e.js', imports: [
      { specifier: '../whisper/w.js', line: 3, kind: 'static' },
      { specifier: '../http/h.js', line: 4, kind: 'type' },
      { specifier: '../vendor-loader.js', line: 5, kind: 'static' },
      { specifier: './r.js', line: 6, kind: 'static' },
      { specifier: '../../application/api-key-service.js', line: 7, kind: 'static' },
      { specifier: '../../application/ports.js', line: 8, kind: 'type' },
    ] },
    { file: 'src/infrastructure/platform/p.js', imports: [{ specifier: '../media/m.js', line: 9, kind: 'static' }, { specifier: '../storage/s.js', line: 10, kind: 'static' }] },
    { file: 'src/infrastructure/stray.js', imports: [] },
    { file: 'src/infrastructure/new/n.js', imports: [] },
  ];
  const problems = findBoundaryViolations(modules).join('\n');
  assert.match(problems, /src\/ui\/components\/c\.js:1: τύπος JSDoc «\.\.\/views\/v\.js»: ένα component δεν εξαρτάται από προβολή/);
  assert.match(problems, /src\/infrastructure\/elevenlabs\/e\.js:3: import «\.\.\/whisper\/w\.js»: ο πάροχος elevenlabs δεν εξαρτάται από τον πάροχο whisper/);
  assert.match(problems, /src\/infrastructure\/elevenlabs\/e\.js:7: import «[^»]+»: το infrastructure παίρνει από την application μόνο συμβόλαια και σταθερές/);
  assert.match(problems, /src\/infrastructure\/platform\/p\.js:9: import «\.\.\/media\/m\.js»: το κοινό platform δεν εξαρτάται από τον πάροχο media/);
  assert.match(problems, /src\/infrastructure\/stray\.js: άγνωστος φάκελος του infrastructure «stray\.js»/);
  assert.match(problems, /src\/infrastructure\/new\/n\.js: άγνωστος φάκελος του infrastructure «new»/);
  for (const allowed of [':2:', ':4:', ':5:', ':6:', ':8:', ':10:']) assert.ok(!problems.includes(allowed), `επιτρέπεται: ${allowed}`);
  assert.deepEqual(problems.split('\n').length, 6);
});

test('τα tools/ με ψεύτικα modules', () => {
  const modules = [
    { file: 'tools/build-dist.mjs', imports: [{ specifier: '../src/config/app-info.js', line: 1, kind: 'static' }] },
    { file: 'tools/x.mjs', imports: [{ specifier: '../src/domain/transcript.js', line: 2, kind: 'static' }, { specifier: 'node:fs', line: 3, kind: 'static' }] },
  ];
  assert.deepEqual(findToolsImportViolations(modules), [
    'tools/x.mjs:2: import «../src/domain/transcript.js»: τα tools/ διαβάζουν από το src/ μόνο το src/config/',
  ]);
});
