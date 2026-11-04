/**
 * Ο γράφος εξαρτήσεων του src/ και οι κανόνες των στρωμάτων (Clean Architecture).
 *
 * Η εφαρμογή χωρίζεται σε στρώματα με φορά εξαρτήσεων προς τα μέσα:
 *
 *   domain          → μόνο domain (καθαρή λογική, χωρίς DOM, δίκτυο ή βιβλιοθήκες)
 *   application     → application, domain, config (υπηρεσίες και θύρες σε JSDoc)
 *   infrastructure  → infrastructure, application, domain, config (adapters)
 *   ui              → ui, application, domain, config (προβολές)
 *   config          → τίποτα (σταθερές δεδομένων)
 *   src/main.js     → όλα (το μοναδικό σημείο σύνδεσης, composition root)
 *
 * Μετρούν και τα στατικά import και οι τύποι JSDoc `import('…')`: ένας τύπος
 * που δείχνει σε adapter δένει την προβολή με την υλοποίηση όσο και ένα import.
 * Δυναμικό import() επιτρέπεται μόνο στον φορτωτή βιβλιοθηκών και `new Worker(`
 * μόνο όπου δηλώνεται ρητά.
 *
 * Όλες οι συναρτήσεις είναι καθαρές (κείμενο μέσα, ευρήματα έξω), ώστε να
 * δοκιμάζονται χωρίς αρχεία. Τις εφαρμόζει στο repository το
 * tests/infra/architecture.test.mjs.
 */
import path from 'node:path';

/** Τα στρώματα κάτω από το src/, με το όνομα του φακέλου τους. */
export const LAYERS = Object.freeze(['domain', 'application', 'infrastructure', 'ui', 'config']);

/** Το composition root: το μόνο αρχείο που συνδέει adapters με υπηρεσίες και προβολές. */
export const COMPOSITION_ROOT = 'src/main.js';

/** Από ποια στρώματα επιτρέπεται να εξαρτάται κάθε στρώμα (και το composition root, «main»). */
export const ALLOWED_DEPENDENCIES = Object.freeze({
  domain: Object.freeze(['domain']),
  application: Object.freeze(['application', 'domain', 'config']),
  infrastructure: Object.freeze(['infrastructure', 'application', 'domain', 'config']),
  ui: Object.freeze(['ui', 'application', 'domain', 'config']),
  config: Object.freeze([]),
  main: Object.freeze(['infrastructure', 'application', 'domain', 'config', 'ui']),
});

/** Λέξεις μετά από τις οποίες το «/» αρχίζει regular expression και όχι διαίρεση. */
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const PUNCTUATION_BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '~', '^', '%', '*', '+', '-', '<', '>']);

/**
 * Χωρίζει ένα ES module σε κώδικα και σχόλια, κρατώντας τις θέσεις των χαρακτήρων:
 *   code      ο κώδικας με τα σχόλια και τα regular expressions σε κενά (οι συμβολοσειρές μένουν),
 *   bare      ο κώδικας και με τα περιεχόμενα των συμβολοσειρών σε κενά,
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
  /** Στοίβα: 'code' ή ένα template literal. Μέσα σε ${…} μετράμε άγκιστρα για να ξέρουμε πότε κλείνει. */
  const braceDepths = [];
  let lastToken = '';
  let i = 0;
  const n = source.length;

  /** Ένα template literal από το i (που δείχνει μετά το `), μέχρι το κλείσιμό του ή ένα ${. */
  const scanTemplate = () => {
    while (i < n) {
      const c = source[i];
      if (c === '\\') { emit(source.slice(i, i + 2), '  '.slice(0, Math.min(2, n - i))); i += 2; continue; }
      if (c === '`') { emit('`'); i++; lastToken = '`'; return 'closed'; }
      if (c === '$' && source[i + 1] === '{') { emit('${'); i += 2; braceDepths.push(0); lastToken = '{'; return 'expression'; }
      emit(c, c === '\n' ? '\n' : ' ');
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
      if (scanTemplate() === 'expression') continue;
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
const DYNAMIC_IMPORT = /\bimport\s*\(/g;
const WORKER_CONSTRUCTION = /\bnew\s+Worker\s*\(/g;

/**
 * Οι εξαρτήσεις ενός module: στατικά import/export…from, τύποι JSDoc
 * import('…') μέσα σε σχόλια, και οι θέσεις όπου καλείται import() ή new Worker(.
 * @param {string} source
 * @returns {{ imports: { specifier: string, line: number, kind: 'static'|'type' }[], dynamicImportLines: number[], workerLines: number[] }}
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
  const linesOf = pattern => [...bare.matchAll(pattern)].map(match => lineAt(source, match.index));
  return { imports, dynamicImportLines: linesOf(DYNAMIC_IMPORT), workerLines: linesOf(WORKER_CONSTRUCTION) };
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

/** Το στρώμα ενός αρχείου του src/ ('main' για το composition root, null αν δεν ανήκει πουθενά). */
export function layerOf(file) {
  if (file === COMPOSITION_ROOT) return 'main';
  const match = file.match(/^src\/([^/]+)\//);
  return match && LAYERS.includes(match[1]) ? match[1] : null;
}

/**
 * Παραβιάσεις του κανόνα εξαρτήσεων.
 * @param {{ file: string, imports: { specifier: string, line: number, kind: 'static'|'type' }[] }[]} modules
 * @param {{ exists?: (file: string) => boolean }} [options] exists: αν υπάρχει το αρχείο-στόχος
 * @returns {string[]}
 */
export function findLayerViolations(modules, { exists = () => true } = {}) {
  const problems = [];
  for (const { file, imports } of modules) {
    const from = layerOf(file);
    if (!from) { problems.push(`${file}: δεν ανήκει σε κανένα στρώμα (${LAYERS.map(l => `src/${l}/`).join(', ')}) ούτε είναι το ${COMPOSITION_ROOT}`); continue; }
    for (const { specifier, line, kind } of imports) {
      const where = `${file}:${line}: ${kind === 'type' ? 'τύπος JSDoc' : 'import'} «${specifier}»`;
      const { kind: resolution, target } = resolveSpecifier(file, specifier);
      if (resolution === 'url' || resolution === 'bare') {
        problems.push(`${where}: βιβλιοθήκη τρίτου με ${kind === 'type' ? 'τύπο' : 'στατικό import'}, φορτώνεται μόνο μέσω του src/config/vendor.js και του φορτωτή`);
        continue;
      }
      if (!target.startsWith('src/')) { problems.push(`${where}: δείχνει έξω από το src/ (${target})`); continue; }
      if (!exists(target)) { problems.push(`${where}: δεν υπάρχει το ${target}`); continue; }
      if (target === COMPOSITION_ROOT) { problems.push(`${where}: κανείς δεν εξαρτάται από το composition root`); continue; }
      const to = layerOf(target);
      if (!to) { problems.push(`${where}: το ${target} δεν ανήκει σε κανένα στρώμα`); continue; }
      if (!ALLOWED_DEPENDENCIES[from].includes(to)) {
        problems.push(`${where}: το στρώμα ${from} δεν επιτρέπεται να εξαρτάται από το ${to} (επιτρέπονται: ${ALLOWED_DEPENDENCIES[from].join(', ') || 'κανένα'})`);
      }
    }
  }
  return problems;
}

/**
 * Κύκλοι ανάμεσα στους φακέλους του src/ (στρώματα και composition root), από
 * στατικά import και τύπους JSDoc. Επιστρέφει κάθε κύκλο ως «a → b → a».
 * @param {{ file: string, imports: { specifier: string }[] }[]} modules
 * @returns {string[]}
 */
export function findLayerCycles(modules) {
  const edges = new Map();
  for (const { file, imports } of modules) {
    const from = layerOf(file);
    if (!from) continue;
    for (const { specifier } of imports) {
      const { kind, target } = resolveSpecifier(file, specifier);
      const to = kind === 'relative' || kind === 'absolute' ? layerOf(target) : null;
      if (!to || to === from) continue;
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from).add(to);
    }
  }
  const cycles = new Set();
  const visit = (node, trail) => {
    for (const next of [...(edges.get(node) || [])].sort()) {
      const at = trail.indexOf(next);
      if (at !== -1) {
        const cycle = trail.slice(at);
        const start = cycle.indexOf([...cycle].sort()[0]);
        const rotated = [...cycle.slice(start), ...cycle.slice(0, start)];
        cycles.add([...rotated, rotated[0]].join(' → '));
      } else visit(next, [...trail, next]);
    }
  };
  for (const node of [...edges.keys()].sort()) visit(node, [node]);
  return [...cycles].sort();
}

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
