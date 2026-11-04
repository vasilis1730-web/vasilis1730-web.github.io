import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../tools/paths.mjs';
import {
  ALLOWED_DEPENDENCIES, COMPOSITION_ROOT, LAYERS,
  splitModuleSource, scanModuleDependencies, resolveSpecifier, layerOf,
  findLayerViolations, findLayerCycles, findOccurrencesOutside,
} from '../../tools/import-graph.mjs';
import { repositoryFiles, skipWhileAppPending } from './helpers.mjs';

/* Ο κανόνας εξαρτήσεων της εφαρμογής (Clean Architecture), ως έλεγχος και όχι
   μόνο ως σχόλιο: domain → μόνο domain, application → application/domain/config,
   infrastructure → infrastructure/application/domain/config, ui →
   ui/application/domain/config, config → τίποτα, και μόνο το src/main.js
   συνδέει adapters. Μετρούν και οι τύποι JSDoc import('…'). Ο κανόνας
   περιγράφεται στο tools/import-graph.mjs και στο CLAUDE.md. */

/** Το μόνο αρχείο με δυναμικό import(): ο φορτωτής βιβλιοθηκών τρίτων (src/config/vendor.js). */
const DYNAMIC_IMPORT_FILES = Object.freeze(['src/infrastructure/vendor-loader.js']);

/**
 * Πού επιτρέπεται `new Worker(`: μόνο στο composition root, που δίνει στη μηχανή
 * Whisper μια συνάρτηση δημιουργίας του worker (η μηχανή δεν ξέρει το URL του).
 */
const WORKER_CONSTRUCTION_FILES = Object.freeze([COMPOSITION_ROOT]);

/** Τα modules του src/ με τις εξαρτήσεις τους, όπως είναι σήμερα στον δίσκο. */
function repositoryModules() {
  return repositoryFiles('src')
    .filter(file => /\.m?js$/.test(file))
    .sort()
    .map(file => ({ file, ...scanModuleDependencies(fs.readFileSync(path.join(ROOT, file), 'utf8')) }));
}

const exists = file => fs.existsSync(path.join(ROOT, file));

test('το src/ τηρεί τον κανόνα εξαρτήσεων των στρωμάτων (και στους τύπους JSDoc)', t => {
  if (skipWhileAppPending(t)) return;
  const problems = findLayerViolations(repositoryModules(), { exists });
  assert.deepEqual(problems, [], `παραβιάσεις του κανόνα εξαρτήσεων:\n${problems.join('\n')}`);
});

test('κανένας κύκλος εξαρτήσεων ανάμεσα στους φακέλους του src/', t => {
  if (skipWhileAppPending(t)) return;
  const cycles = findLayerCycles(repositoryModules());
  assert.deepEqual(cycles, [], `κύκλοι: ${cycles.join(', ')}`);
});

test('δυναμικό import() μόνο στον φορτωτή βιβλιοθηκών, new Worker( μόνο στο composition root', t => {
  if (skipWhileAppPending(t)) return;
  const modules = repositoryModules();
  const dynamic = findOccurrencesOutside(modules.map(m => ({ file: m.file, lines: m.dynamicImportLines })), DYNAMIC_IMPORT_FILES, 'το δυναμικό import()');
  assert.deepEqual(dynamic, [], dynamic.join('\n'));
  const workers = findOccurrencesOutside(modules.map(m => ({ file: m.file, lines: m.workerLines })), WORKER_CONSTRUCTION_FILES, 'το new Worker(');
  assert.deepEqual(workers, [], workers.join('\n'));
  for (const file of [...DYNAMIC_IMPORT_FILES, ...WORKER_CONSTRUCTION_FILES]) {
    assert.ok(exists(file), `η λίστα του test δείχνει σε αρχείο που υπάρχει: ${file}`);
  }
  assert.ok(modules.some(m => DYNAMIC_IMPORT_FILES.includes(m.file) && m.dynamicImportLines.length), 'ο φορτωτής πράγματι κάνει import()');
});

test('ο πίνακας των στρωμάτων: φορά προς τα μέσα, config χωρίς εξαρτήσεις, μόνο το main βλέπει το infrastructure', () => {
  assert.deepEqual([...LAYERS].sort(), ['application', 'config', 'domain', 'infrastructure', 'ui']);
  assert.deepEqual(ALLOWED_DEPENDENCIES.domain, ['domain']);
  assert.deepEqual(ALLOWED_DEPENDENCIES.config, []);
  for (const layer of LAYERS.filter(l => l !== 'infrastructure')) {
    assert.ok(!ALLOWED_DEPENDENCIES[layer].includes('infrastructure'), `το ${layer} δεν βλέπει το infrastructure`);
  }
  assert.ok(ALLOWED_DEPENDENCIES.main.includes('infrastructure'));
  assert.equal(layerOf('src/main.js'), 'main');
  assert.equal(layerOf('src/domain/audio/pcm.js'), 'domain');
  assert.equal(layerOf('src/styles/app.css'), null);
});

test('το σάρωμα ξεχωρίζει import, τύπους JSDoc, δυναμικό import() και new Worker( από κείμενα και regular expressions', () => {
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
  ].join('\n');
  const { imports, dynamicImportLines, workerLines } = scanModuleDependencies(source);
  assert.deepEqual(imports.filter(i => i.kind === 'static').map(i => i.specifier), ['./a.js', '../domain/c.js', './side-effect.js', './d.js', './e.js']);
  assert.deepEqual(imports.filter(i => i.kind === 'type').map(i => [i.specifier, i.line]), [['../infrastructure/x.js', 8]]);
  assert.equal(imports.find(i => i.specifier === '../domain/c.js').line, 4, 'η γραμμή του specifier');
  assert.deepEqual(dynamicImportLines, [15], 'μόνο το πραγματικό import(), όχι σε συμβολοσειρά, template ή regular expression');
  assert.deepEqual(workerLines, [16]);

  const { code, bare } = splitModuleSource(source);
  assert.equal(code.length, source.length, 'οι θέσεις των χαρακτήρων μένουν ίδιες');
  assert.equal(bare.split('\n').length, source.split('\n').length, 'και οι γραμμές');
  assert.ok(!code.includes('comment.js') && code.includes('string.js'), 'τα σχόλια σβήνονται, οι συμβολοσειρές μένουν στο code');
  assert.ok(!bare.includes('string.js'), 'αλλά όχι στο bare');
});

test('η επίλυση specifier και τα μηνύματα παραβίασης', () => {
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
    { file: 'src/lib/x.js', imports: [] },
    { file: COMPOSITION_ROOT, imports: [{ specifier: './infrastructure/i.js', line: 1, kind: 'static' }, { specifier: './ui/views/v.js', line: 2, kind: 'static' }] },
  ];
  const problems = findLayerViolations(modules, { exists: file => !file.endsWith('missing.js') }).join('\n');
  assert.match(problems, /src\/domain\/a\.js:3: import «\.\.\/config\/models\.js»: το στρώμα domain δεν επιτρέπεται να εξαρτάται από το config/);
  assert.match(problems, /src\/ui\/views\/v\.js:7: τύπος JSDoc «[^»]+file-saver\.js»: το στρώμα ui δεν επιτρέπεται να εξαρτάται από το infrastructure/);
  assert.match(problems, /src\/application\/s\.js:1: import «mediabunny»: βιβλιοθήκη τρίτου/);
  assert.match(problems, /src\/application\/s\.js:2: import «\.\.\/main\.js»: κανείς δεν εξαρτάται από το composition root/);
  assert.match(problems, /src\/config\/c\.js:1: import «\.\/other\.js»: το στρώμα config δεν επιτρέπεται να εξαρτάται από το config \(επιτρέπονται: κανένα\)/);
  assert.match(problems, /src\/infrastructure\/i\.js:1: import «[^»]+»: δείχνει έξω από το src\//);
  assert.match(problems, /src\/infrastructure\/i\.js:2: import «\.\/missing\.js»: δεν υπάρχει το src\/infrastructure\/missing\.js/);
  assert.match(problems, /src\/lib\/x\.js: δεν ανήκει σε κανένα στρώμα/);
  assert.doesNotMatch(problems, /^src\/main\.js:/m, 'το composition root εξαρτάται από όλα');
});

test('οι κύκλοι ανάμεσα σε στρώματα βρίσκονται και γράφονται με σταθερή σειρά', () => {
  const modules = [
    { file: 'src/ui/a.js', imports: [{ specifier: '../application/b.js' }] },
    { file: 'src/application/b.js', imports: [{ specifier: '../ui/a.js' }, { specifier: '../domain/c.js' }] },
    { file: 'src/domain/c.js', imports: [{ specifier: './d.js' }] },
  ];
  assert.deepEqual(findLayerCycles(modules), ['application → ui → application']);
  assert.deepEqual(findLayerCycles(modules.slice(1, 3)), [], 'χωρίς την επιστροφή, κανένας κύκλος');
});
