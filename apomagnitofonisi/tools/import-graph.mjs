/**
 * Ο γράφος εξαρτήσεων του src/ και οι κανόνες της αρχιτεκτονικής (Clean Architecture).
 *
 * Η εφαρμογή χωρίζεται σε στρώματα με φορά εξαρτήσεων προς τα μέσα:
 *
 *   domain          → μόνο domain (καθαρή λογική, χωρίς DOM, δίκτυο ή βιβλιοθήκες)
 *   application     → application, domain, config (υπηρεσίες και θύρες σε JSDoc)
 *   infrastructure  → infrastructure, application, domain, config (adapters)
 *   ui              → ui, application, domain, config (προβολές)
 *   config          → τίποτα (σταθερές δεδομένων)
 *   src/main.js     → όλα (το σημείο σύνδεσης της σελίδας, composition root)
 *
 * Δύο composition roots: το src/main.js για τη σελίδα και το
 * src/infrastructure/whisper/whisper-worker.js για τον worker του Whisper (ο
 * worker δεν δέχεται συναρτήσεις απ' έξω, οπότε συνδέει μόνος του τα δικά
 * του). Κανένα module δεν εισάγει composition root. Το src/main.js ξεκινά τον
 * worker με `new URL('…', import.meta.url)`, που μετρά ως εξάρτηση «αρχείου».
 *
 * Μετρούν τα στατικά import και οι τύποι JSDoc `import('…')`: ένας τύπος που
 * δείχνει σε adapter δένει την προβολή με την υλοποίηση όσο και ένα import.
 * Επιπλέον:
 *   - κανένας κύκλος ανάμεσα σε modules (και μέσω τύπων JSDoc),
 *   - domain και application χωρίς globals του browser (window, fetch κ.λπ.),
 *   - τα components του ui δεν εξαρτώνται από προβολές,
 *   - κάθε πάροχος του infrastructure (whisper, elevenlabs, anthropic, media,
 *     export) βλέπει μόνο τον εαυτό του και τους κοινούς φακέλους (platform,
 *     http, storage, vendor-loader.js), και οι κοινοί φάκελοι κανέναν πάροχο,
 *   - το infrastructure παίρνει από την application μόνο συμβόλαια και
 *     σταθερές (APPLICATION_CONTRACTS), ποτέ υπηρεσίες,
 *   - τα tools/ διαβάζουν από το src/ μόνο το src/config/.
 *
 * Όλες οι συναρτήσεις είναι καθαρές (κείμενο μέσα, ευρήματα έξω), ώστε να
 * δοκιμάζονται χωρίς αρχεία. Τις εφαρμόζει στο repository το
 * tests/infra/architecture.test.mjs.
 */
import path from 'node:path';

/** Τα στρώματα κάτω από το src/, με το όνομα του φακέλου τους. */
export const LAYERS = Object.freeze(['domain', 'application', 'infrastructure', 'ui', 'config']);

/** Το composition root της σελίδας: το μόνο αρχείο που συνδέει adapters με υπηρεσίες και προβολές. */
export const MAIN_COMPOSITION_ROOT = 'src/main.js';

/** Το composition root του worker του Whisper (μέσα στο infrastructure, συνδέει μόνο τα δικά του). */
export const WORKER_COMPOSITION_ROOT = 'src/infrastructure/whisper/whisper-worker.js';

/** Τα composition roots: κανένα module δεν τα εισάγει. */
export const COMPOSITION_ROOTS = Object.freeze([MAIN_COMPOSITION_ROOT, WORKER_COMPOSITION_ROOT]);

/** Από ποια στρώματα επιτρέπεται να εξαρτάται κάθε στρώμα (και το composition root της σελίδας, «main»). */
export const ALLOWED_DEPENDENCIES = Object.freeze({
  domain: Object.freeze(['domain']),
  application: Object.freeze(['application', 'domain', 'config']),
  infrastructure: Object.freeze(['infrastructure', 'application', 'domain', 'config']),
  ui: Object.freeze(['ui', 'application', 'domain', 'config']),
  config: Object.freeze([]),
  main: Object.freeze(['infrastructure', 'application', 'domain', 'config', 'ui']),
});

/**
 * Τα modules της application που επιτρέπεται να βλέπει το infrastructure:
 * συμβόλαια (θύρες σε JSDoc) και κοινές σταθερές. Οι υπηρεσίες (…-service.js)
 * δεν είναι εδώ: ένας adapter που εισάγει υπηρεσία γυρίζει τη φορά ανάποδα.
 */
export const APPLICATION_CONTRACTS = Object.freeze([
  'src/application/erase-targets.js',
  'src/application/errors.js',
  'src/application/export-formats.js',
  'src/application/key-providers.js',
  'src/application/limits.js',
  'src/application/ports.js',
  'src/application/progress.js',
]);

/** Οι πάροχοι του infrastructure: ο καθένας βλέπει μόνο τον εαυτό του και τα κοινά. */
export const INFRASTRUCTURE_PROVIDERS = Object.freeze(['anthropic', 'elevenlabs', 'export', 'media', 'whisper']);

/** Οι κοινοί φάκελοι του infrastructure, που χρησιμοποιούν όλοι οι πάροχοι και δεν βλέπουν κανέναν. */
export const INFRASTRUCTURE_SHARED_FOLDERS = Object.freeze(['http', 'platform', 'storage']);

/** Κοινά αρχεία στη ρίζα του src/infrastructure/. */
export const INFRASTRUCTURE_SHARED_FILES = Object.freeze(['src/infrastructure/vendor-loader.js']);

/** Τα «καθαρά» στρώματα: χωρίς globals του browser, ό,τι χρειάζονται τους δίνεται απ' έξω. */
export const PURE_LAYERS = Object.freeze(['domain', 'application']);

/** Globals του browser που δεν εμφανίζονται στα καθαρά στρώματα. */
export const BROWSER_GLOBALS = Object.freeze([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'fetch', 'XMLHttpRequest', 'Worker', 'self', 'location', 'crypto', 'globalThis',
]);

/**
 * Τα ονόματα των ίδιων των global αντικειμένων: μια τοπική δήλωση με αυτά τα
 * ονόματα ΔΕΝ εξαιρεί το module (CA-014), γιατί θα έκρυβε από τον έλεγχο κάθε
 * πραγματική χρήση του global στο ίδιο αρχείο. Ένα module καθαρού στρώματος
 * διαλέγει άλλο όνομα (π.χ. audioWindow).
 */
export const GLOBAL_OBJECT_NAMES = Object.freeze(['window', 'self', 'globalThis', 'document', 'location']);

/** Το μόνο μέρος του src/ που διαβάζουν τα tools/ (σταθερές δεδομένων, π.χ. SITE_URL). */
export const TOOLS_READABLE_SOURCE = 'src/config/';

/* ---------- Ανάγνωση των modules ---------- */

/** Λέξεις μετά από τις οποίες το «/» αρχίζει regular expression και όχι διαίρεση. */
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const PUNCTUATION_BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '~', '^', '%', '*', '+', '-', '<', '>']);

/**
 * Χωρίζει ένα ES module σε κώδικα και σχόλια, κρατώντας τις θέσεις των χαρακτήρων:
 *   code      ο κώδικας με τα σχόλια, τα regular expressions και το κείμενο των
 *             template literals σε κενά (οι συμβολοσειρές '…' και "…" μένουν, όπως
 *             και ο κώδικας μέσα στα ${…}). Εδώ ψάχνουμε import και new URL(…),
 *             ώστε μια γραμμή μέσα σε template literal να μη μοιάζει με import.
 *   bare      το code και με τα περιεχόμενα των συμβολοσειρών σε κενά,
 *   comments  τα σχόλια με τη θέση τους στο αρχικό κείμενο.
 * Οι αλλαγές γραμμής μένουν παντού στη θέση τους, ώστε οι αριθμοί γραμμής να ισχύουν.
 * @param {string} source
 * @returns {{ code: string, bare: string, comments: { text: string, offset: number }[] }}
 */
export function splitModuleSource(source) {
  const code = [];
  const bare = [];
  const comments = [];
  const blank = text => text.replace(/[^\n]/g, ' ');
  const emit = (codeText, bareText = codeText) => { code.push(codeText); bare.push(bareText); };
  /** Για κάθε ανοιχτό ${…} ενός template literal, πόσα άγκιστρα έχουν ανοίξει μέσα του. */
  const braceDepths = [];
  let lastToken = '';
  let i = 0;
  const n = source.length;

  /** Το κείμενο ενός template literal από το i (μετά το `), μέχρι το κλείσιμό του ή ένα ${. */
  const scanTemplate = () => {
    while (i < n) {
      const c = source[i];
      if (c === '\\') { const text = source.slice(i, i + 2); emit(blank(text)); i += 2; continue; }
      if (c === '`') { emit('`'); i++; lastToken = '`'; return 'closed'; }
      if (c === '$' && source[i + 1] === '{') { emit('${'); i += 2; braceDepths.push(0); lastToken = '{'; return 'expression'; }
      emit(c === '\n' ? '\n' : ' ');
      i++;
    }
    return 'closed';
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      comments.push({ text: source.slice(i, stop), offset: i });
      emit(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      comments.push({ text: source.slice(i, stop), offset: i });
      emit(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, n);
      const text = source.slice(i, stop);
      emit(text, c + blank(text.slice(1, -1)) + (stop > i + 1 ? text.at(-1) : ''));
      i = stop;
      lastToken = c;
      continue;
    }
    if (c === '`') {
      emit('`');
      i++;
      scanTemplate();
      continue;
    }
    if (c === '}' && braceDepths.length && braceDepths.at(-1) === 0) {
      // Κλείνει το ${…} ενός template literal: συνεχίζουμε μέσα στο template.
      braceDepths.pop();
      emit('}');
      i++;
      scanTemplate();
      continue;
    }
    if (c === '{' && braceDepths.length) braceDepths[braceDepths.length - 1]++;
    if (c === '}' && braceDepths.length) braceDepths[braceDepths.length - 1]--;
    if (c === '/' && (PUNCTUATION_BEFORE_REGEX.has(lastToken) || KEYWORDS_BEFORE_REGEX.has(lastToken))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j++;
      }
      while (j + 1 < n && /[a-z]/i.test(source[j + 1])) j++;
      const stop = Math.min(j + 1, n);
      emit(blank(source.slice(i, stop)));
      i = stop;
      lastToken = ')';
      continue;
    }
    emit(c);
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++;
      lastToken = source.slice(i, j);
      emit(source.slice(i + 1, j));
      i = j;
      continue;
    }
    if (!/\s/.test(c)) lastToken = c;
    i++;
  }
  return { code: code.join(''), bare: bare.join(''), comments };
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

const STATIC_IMPORT = /^[ \t]*(?:import|export)\b(?:[^'"`;]*?\bfrom)?\s*(['"])([^'"\n]+)\1/gm;
const TYPE_IMPORT = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;
const ASSET_REFERENCE = /\bnew\s+URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/g;
const WORKER_CONSTRUCTION = /\bnew\s+Worker\s*\(/g;

/**
 * @typedef {{ specifier: string, line: number, kind: 'static'|'type' }} ModuleImport
 * @typedef {{ specifier: string, line: number }} AssetReference
 * @typedef {{ imports: ModuleImport[], assets: AssetReference[], dynamicImportLines: number[], workerLines: number[] }} ModuleDependencies
 * @typedef {{ file: string } & ModuleDependencies} ScannedModule
 */

/**
 * Οι εξαρτήσεις ενός module: στατικά import/export…from, τύποι JSDoc
 * import('…') μέσα σε σχόλια, αρχεία που αναφέρονται με new URL('…', import.meta.url),
 * και οι θέσεις όπου καλείται import() ή new Worker(.
 * @param {string} source
 * @returns {ModuleDependencies}
 */
export function scanModuleDependencies(source) {
  const { code, bare, comments } = splitModuleSource(source);
  const imports = [];
  for (const match of code.matchAll(STATIC_IMPORT)) {
    imports.push({ specifier: match[2], line: lineAt(source, match.index + match[0].length - match[2].length - 1), kind: 'static' });
  }
  for (const comment of comments) {
    for (const match of comment.text.matchAll(TYPE_IMPORT)) {
      imports.push({ specifier: match[2], line: lineAt(source, comment.offset + match.index), kind: 'type' });
    }
  }
  const assets = [...code.matchAll(ASSET_REFERENCE)].map(match => ({ specifier: match[2], line: lineAt(source, match.index) }));
  const linesOf = pattern => [...bare.matchAll(pattern)].map(match => lineAt(source, match.index));
  return { imports, assets, dynamicImportLines: linesOf(DYNAMIC_IMPORT), workerLines: linesOf(WORKER_CONSTRUCTION) };
}

/**
 * Πού δείχνει ένας specifier από ένα αρχείο του repository.
 * @returns {{ kind: 'relative'|'absolute'|'url'|'bare', target: string }} target σχετικό με τη ρίζα του repository
 */
export function resolveSpecifier(fromFile, specifier) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return { kind: 'url', target: specifier };
  if (specifier.startsWith('/')) return { kind: 'absolute', target: path.posix.normalize(specifier.slice(1)) };
  if (specifier.startsWith('.')) return { kind: 'relative', target: path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier)) };
  return { kind: 'bare', target: specifier };
}

/** Αρχείο του repository για έναν specifier, ή null για βιβλιοθήκη τρίτου (όνομα πακέτου ή URL). */
function localTarget(fromFile, specifier) {
  const { kind, target } = resolveSpecifier(fromFile, specifier);
  return kind === 'relative' || kind === 'absolute' ? target : null;
}

/** Το στρώμα ενός αρχείου του src/ ('main' για το composition root της σελίδας, null αν δεν ανήκει πουθενά). */
export function layerOf(file) {
  if (file === MAIN_COMPOSITION_ROOT) return 'main';
  const match = file.match(/^src\/([^/]+)\//);
  return match && LAYERS.includes(match[1]) ? match[1] : null;
}

/* ---------- Κανόνας στρωμάτων ---------- */

/**
 * Παραβιάσεις του κανόνα εξαρτήσεων: στρώματα, composition roots, βιβλιοθήκες
 * τρίτων, αρχεία που λείπουν, και οι εξαρτήσεις «αρχείου» (new URL(…, import.meta.url)).
 * @param {ScannedModule[]} modules
 * @param {{ exists?: (file: string) => boolean }} [options] exists: αν υπάρχει το αρχείο-στόχος
 * @returns {string[]}
 */
export function findLayerViolations(modules, { exists = () => true } = {}) {
  const problems = [];
  for (const { file, imports, assets = [] } of modules) {
    const from = layerOf(file);
    if (!from) { problems.push(`${file}: δεν ανήκει σε κανένα στρώμα (${LAYERS.map(l => `src/${l}/`).join(', ')}) ούτε είναι το ${MAIN_COMPOSITION_ROOT}`); continue; }
    for (const { specifier, line, kind } of imports) {
      const where = `${file}:${line}: ${kind === 'type' ? 'τύπος JSDoc' : 'import'} «${specifier}»`;
      const { kind: resolution, target } = resolveSpecifier(file, specifier);
      if (resolution === 'url' || resolution === 'bare') {
        problems.push(`${where}: βιβλιοθήκη τρίτου με ${kind === 'type' ? 'τύπο' : 'στατικό import'}, φορτώνεται μόνο μέσω του src/config/vendor.js και του φορτωτή`);
        continue;
      }
      if (!target.startsWith('src/')) { problems.push(`${where}: δείχνει έξω από το src/ (${target})`); continue; }
      if (!exists(target)) { problems.push(`${where}: δεν υπάρχει το ${target}`); continue; }
      if (COMPOSITION_ROOTS.includes(target)) { problems.push(`${where}: κανείς δεν εισάγει composition root (${target})`); continue; }
      problems.push(...layerProblem(where, from, target));
    }
    for (const { specifier, line } of assets) {
      const where = `${file}:${line}: αρχείο «${specifier}» (new URL(…, import.meta.url))`;
      const target = localTarget(file, specifier);
      if (!target) { problems.push(`${where}: δείχνει έξω από το repository`); continue; }
      if (!exists(target)) { problems.push(`${where}: δεν υπάρχει το ${target}`); continue; }
      if (!target.startsWith('src/')) continue;
      if (COMPOSITION_ROOTS.includes(target)) {
        if (!(file === MAIN_COMPOSITION_ROOT && target === WORKER_COMPOSITION_ROOT)) {
          problems.push(`${where}: μόνο το ${MAIN_COMPOSITION_ROOT} ξεκινά τον worker (${WORKER_COMPOSITION_ROOT})`);
        }
        continue;
      }
      problems.push(...layerProblem(where, from, target));
    }
  }
  return problems;
}

function layerProblem(where, from, target) {
  const to = layerOf(target);
  if (!to) return [`${where}: το ${target} δεν ανήκει σε κανένα στρώμα`];
  if (ALLOWED_DEPENDENCIES[from].includes(to)) return [];
  return [`${where}: το στρώμα ${from} δεν επιτρέπεται να εξαρτάται από το ${to} (επιτρέπονται: ${ALLOWED_DEPENDENCIES[from].join(', ') || 'κανένα'})`];
}

/* ---------- Όρια μέσα στα στρώματα ---------- */

/**
 * Σε ποια περιοχή του infrastructure ανήκει ένα αρχείο.
 * @param {string} file
 * @returns {{ kind: 'provider'|'shared'|'unknown', name: string }|null} null αν δεν είναι στο src/infrastructure/
 */
export function infrastructureAreaOf(file) {
  if (!file.startsWith('src/infrastructure/')) return null;
  if (INFRASTRUCTURE_SHARED_FILES.includes(file)) return { kind: 'shared', name: path.posix.basename(file) };
  const folder = file.slice('src/infrastructure/'.length).split('/');
  if (folder.length < 2) return { kind: 'unknown', name: folder[0] };
  if (INFRASTRUCTURE_PROVIDERS.includes(folder[0])) return { kind: 'provider', name: folder[0] };
  if (INFRASTRUCTURE_SHARED_FOLDERS.includes(folder[0])) return { kind: 'shared', name: folder[0] };
  return { kind: 'unknown', name: folder[0] };
}

/**
 * Τα όρια μέσα στα στρώματα, που κλειδώνουν αποφάσεις της αρχιτεκτονικής:
 *   - ui/components → όχι ui/views,
 *   - ένας πάροχος του infrastructure → μόνο ο εαυτός του και τα κοινά,
 *     ένα κοινό → μόνο κοινά,
 *   - infrastructure → από την application μόνο τα APPLICATION_CONTRACTS,
 *   - κάθε αρχείο του infrastructure ανήκει σε δηλωμένο πάροχο ή κοινό φάκελο.
 * Μετρούν τα στατικά import και οι τύποι JSDoc.
 * @param {ScannedModule[]} modules
 * @returns {string[]}
 */
export function findBoundaryViolations(modules) {
  const problems = [];
  for (const { file, imports } of modules) {
    const area = infrastructureAreaOf(file);
    if (area && area.kind === 'unknown') {
      problems.push(`${file}: άγνωστος φάκελος του infrastructure «${area.name}»: δήλωσέ τον στο INFRASTRUCTURE_PROVIDERS ή στο INFRASTRUCTURE_SHARED_FOLDERS του tools/import-graph.mjs`);
    }
    for (const { specifier, line, kind } of imports) {
      const target = localTarget(file, specifier);
      if (!target) continue;
      const where = `${file}:${line}: ${kind === 'type' ? 'τύπος JSDoc' : 'import'} «${specifier}»`;
      if (file.startsWith('src/ui/components/') && target.startsWith('src/ui/views/')) {
        problems.push(`${where}: ένα component δεν εξαρτάται από προβολή (${target})`);
      }
      if (area && target.startsWith('src/application/') && !APPLICATION_CONTRACTS.includes(target)) {
        problems.push(`${where}: το infrastructure παίρνει από την application μόνο συμβόλαια και σταθερές (${APPLICATION_CONTRACTS.map(f => path.posix.basename(f)).join(', ')}), όχι το ${target}`);
      }
      const targetArea = infrastructureAreaOf(target);
      if (area && targetArea && area.kind !== 'unknown' && targetArea.kind !== 'unknown') {
        const sameProvider = area.kind === 'provider' && targetArea.kind === 'provider' && area.name === targetArea.name;
        if (targetArea.kind === 'provider' && !sameProvider) {
          problems.push(area.kind === 'provider'
            ? `${where}: ο πάροχος ${area.name} δεν εξαρτάται από τον πάροχο ${targetArea.name} (μόνο από τα κοινά: ${[...INFRASTRUCTURE_SHARED_FOLDERS, ...INFRASTRUCTURE_SHARED_FILES.map(f => path.posix.basename(f))].join(', ')})`
            : `${where}: το κοινό ${area.name} δεν εξαρτάται από τον πάροχο ${targetArea.name}`);
        }
      }
    }
  }
  return problems;
}

/* ---------- Κύκλοι ---------- */

/**
 * Οι ισχυρά συνεκτικές συνιστώσες ενός κατευθυνόμενου γράφου (αλγόριθμος του
 * Tarjan, γραμμικός χρόνος). Επιστρέφει μόνο όσες είναι κύκλοι: με δύο ή
 * περισσότερους κόμβους, ή έναν κόμβο που δείχνει στον εαυτό του.
 * @param {Map<string, Set<string>>} edges
 * @returns {string[][]}
 */
export function stronglyConnectedCycles(edges) {
  let counter = 0;
  const index = new Map();
  const lowLink = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  const nodes = [...new Set([...edges.keys(), ...[...edges.values()].flatMap(set => [...set])])].sort();
  const connect = node => {
    index.set(node, counter);
    lowLink.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of [...(edges.get(node) || [])].sort()) {
      if (!index.has(next)) {
        connect(next);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(next)));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node), index.get(next)));
      }
    }
    if (lowLink.get(node) !== index.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || (edges.get(node) || new Set()).has(node)) cycles.push(component.sort());
  };
  for (const node of nodes) if (!index.has(node)) connect(node);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Ένας συγκεκριμένος κύκλος μέσα σε μια συνιστώσα, από τον πρώτο κόμβο της πίσω σε αυτόν (BFS). */
function cyclePath(component, edges) {
  const members = new Set(component);
  const start = component[0];
  const previous = new Map();
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    for (const next of [...(edges.get(node) || [])].sort()) {
      if (!members.has(next)) continue;
      if (next === start) {
        const pathBack = [node];
        while (pathBack[0] !== start) pathBack.unshift(previous.get(pathBack[0]));
        return [...pathBack, start];
      }
      if (!previous.has(next)) { previous.set(next, node); queue.push(next); }
    }
  }
  return [...component, start];
}

/**
 * Κύκλοι εξαρτήσεων ανάμεσα σε modules του src/, από στατικά import και τύπους
 * JSDoc. Ένας κύκλος στο runtime σπάει τη σειρά αρχικοποίησης των ES modules
 * («Cannot access … before initialization»), ένας κύκλος τύπων δείχνει ότι δύο
 * modules δεν ξέρουν ποιο είναι το συμβόλαιο. Και οι δύο απορρίπτονται.
 * @param {ScannedModule[]} modules
 * @param {{ exists?: (file: string) => boolean }} [options]
 * @returns {string[]}
 */
export function findModuleCycles(modules, { exists = () => true } = {}) {
  const edges = new Map();
  const runtimeEdges = new Set();
  for (const { file, imports } of modules) {
    for (const { specifier, kind } of imports) {
      const target = localTarget(file, specifier);
      if (!target || !target.startsWith('src/') || !exists(target)) continue;
      if (!edges.has(file)) edges.set(file, new Set());
      edges.get(file).add(target);
      if (kind === 'static') runtimeEdges.add(`${file}\n${target}`);
    }
  }
  return stronglyConnectedCycles(edges).map(component => {
    const cycle = cyclePath(component, edges);
    const layers = [...new Set(component.map(file => layerOf(file) || '—'))].join(', ');
    const runtime = cycle.slice(1).some((file, i) => runtimeEdges.has(`${cycle[i]}\n${file}`));
    return `κύκλος εξαρτήσεων ${runtime ? 'στο runtime' : 'μόνο μέσω τύπων JSDoc'} (στρώματα: ${layers}): ${cycle.join(' → ')}`;
  });
}

/**
 * Κύκλοι στον ίδιο τον πίνακα των στρωμάτων (χωρίς τις εξαρτήσεις ενός στρώματος
 * από τον εαυτό του). Ένας πίνακας με κύκλο θα επέτρεπε κύκλους ανάμεσα σε στρώματα.
 * @param {Record<string, readonly string[]>} [matrix]
 * @returns {string[]}
 */
export function findMatrixCycles(matrix = ALLOWED_DEPENDENCIES) {
  const edges = new Map(Object.entries(matrix).map(([layer, targets]) => [layer, new Set(targets.filter(t => t !== layer))]));
  return stronglyConnectedCycles(edges).map(component => cyclePath(component, edges).join(' → '));
}

/* ---------- Καθαρά στρώματα ---------- */

/** Ονόματα που ένα module δηλώνει τοπικά (const, let, var, function, class): σκιάζουν το global. */
function declaredNames(bare) {
  return new Set([...bare.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
}

/** Ο προηγούμενος και ο επόμενος χαρακτήρας που δεν είναι κενό, γύρω από μια θέση. */
function neighbours(text, start, end) {
  let before = start - 1;
  while (before >= 0 && /\s/.test(text[before])) before--;
  let after = end;
  while (after < text.length && /\s/.test(text[after])) after++;
  return { before: text[before] ?? '', beforeBefore: text[before - 1] ?? '', after: text[after] ?? '' };
}

/**
 * Globals του browser σε ένα module καθαρού στρώματος (domain, application):
 * ένα όνομα της BROWSER_GLOBALS σε θέση global. Δεν μετρούν: ιδιότητες
 * (`x.window`), κλειδιά αντικειμένων (`{ window: … }`), ορισμοί μεθόδων
 * (`fetch() {`) και ονόματα που το module δηλώνει το ίδιο (`const crypto = …`),
 * εκτός από τα ονόματα των global αντικειμένων (GLOBAL_OBJECT_NAMES, CA-014).
 * @param {{ file: string, source: string }} module
 * @returns {string[]}
 */
export function findBrowserGlobals({ file, source }) {
  if (!PURE_LAYERS.includes(layerOf(file))) return [];
  const { bare } = splitModuleSource(source);
  const declared = declaredNames(bare);
  const problems = [];
  for (const name of BROWSER_GLOBALS) {
    if (declared.has(name) && !GLOBAL_OBJECT_NAMES.includes(name)) continue;
    for (const match of bare.matchAll(new RegExp(`(?<![\\w$#])${name}(?![\\w$])`, 'g'))) {
      const { before, beforeBefore, after } = neighbours(bare, match.index, match.index + name.length);
      if (before === '.' && beforeBefore !== '.') continue;
      if (after === ':' && (before === '{' || before === ',')) continue;
      const lineStart = bare.lastIndexOf('\n', match.index) + 1;
      const lineEnd = bare.indexOf('\n', match.index);
      const lineText = bare.slice(lineStart, lineEnd === -1 ? bare.length : lineEnd);
      const column = match.index - lineStart;
      if (/^\s*(?:(?:static|async|get|set)\s+)*$/.test(lineText.slice(0, column)) && /^\s*\([^)]*\)\s*\{/.test(lineText.slice(column + name.length))) continue;
      problems.push(`${file}:${lineAt(source, match.index)}: «${name}» είναι global του browser: το στρώμα ${layerOf(file)} μένει καθαρό, ό,τι χρειάζεται του δίνεται από θύρα (src/application/ports.js)`);
    }
  }
  return problems;
}

/* ---------- tools/ ---------- */

/**
 * Τα tools/ διαβάζουν από το src/ μόνο σταθερές δεδομένων (src/config/): η
 * λογική της εφαρμογής δεν τρέχει στο build.
 * @param {ScannedModule[]} modules αρχεία του tools/
 * @returns {string[]}
 */
export function findToolsImportViolations(modules) {
  const problems = [];
  for (const { file, imports } of modules) {
    for (const { specifier, line, kind } of imports) {
      const target = localTarget(file, specifier);
      if (target && target.startsWith('src/') && !target.startsWith(TOOLS_READABLE_SOURCE)) {
        problems.push(`${file}:${line}: ${kind === 'type' ? 'τύπος JSDoc' : 'import'} «${specifier}»: τα tools/ διαβάζουν από το src/ μόνο το ${TOOLS_READABLE_SOURCE}`);
      }
    }
  }
  return problems;
}

/* ---------- Επιτρεπτές θέσεις ---------- */

/**
 * Θέσεις όπου εμφανίζεται κάτι επιτρεπτό μόνο σε δηλωμένα αρχεία (import(), new Worker().
 * @param {{ file: string, lines: number[] }[]} occurrences
 * @param {readonly string[]} allowedFiles
 * @param {string} what περιγραφή για το μήνυμα
 * @returns {string[]}
 */
export function findOccurrencesOutside(occurrences, allowedFiles, what) {
  return occurrences
    .filter(({ file, lines }) => lines.length && !allowedFiles.includes(file))
    .flatMap(({ file, lines }) => lines.map(line => `${file}:${line}: ${what} επιτρέπεται μόνο στα ${allowedFiles.join(', ')}`));
}
