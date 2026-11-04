/**
 * Κοινά βοηθήματα των ελέγχων υποδομής (tests/infra).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../../tools/paths.mjs';

/** Τα αρχεία-είσοδοι της εφαρμογής (Υλοποιητής Α). Όσο δεν υπάρχει κανένα, η εφαρμογή γράφεται ακόμη. */
export const APP_ENTRY_FILES = Object.freeze(['index.html', 'privacy.html', '404.html', 'manifest.json', 'sw.js']);

export const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
export const exists = p => fs.existsSync(path.join(ROOT, p));

/**
 * Παραλείπει έναν έλεγχο ΜΟΝΟ όσο δεν έχει γραφτεί ακόμη κανένα αρχείο της
 * εφαρμογής. Μόλις υπάρξει έστω ένα, ο έλεγχος τρέχει κανονικά, και αν λείπουν
 * τα υπόλοιπα αποτυγχάνει (μισή εφαρμογή είναι πραγματικό πρόβλημα). Το
 * npm run build του CI αποτυγχάνει ούτως ή άλλως αν λείπουν αρχεία.
 */
export function skipWhileAppPending(t) {
  if (APP_ENTRY_FILES.some(exists)) return false;
  t.skip(`η εφαρμογή δεν έχει γραφτεί ακόμη (λείπουν όλα τα ${APP_ENTRY_FILES.join(', ')})`);
  return true;
}

/** Προσωρινός φάκελος που σβήνεται στο τέλος του test. */
export function tempDir(t, prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** Φάκελοι που δεν ανήκουν στον κώδικα του repository (εξαρτήσεις, έξοδοι build). */
export const GENERATED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.gradle', 'android-release', 'store-assets', '.wrangler', 'generated']);

/** Όλα τα αρχεία του repository, σχετικά με τη ρίζα, χωρίς τους παραγόμενους φακέλους. */
export function repositoryFiles(dir = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!GENERATED_DIRS.has(entry.name)) files.push(...repositoryFiles(rel)); }
    else files.push(rel);
  }
  return files;
}

/** Επεκτάσεις αρχείων κειμένου που ελέγχονται για άνω τελεία και μυστικά. */
export const TEXT_FILE = /\.(?:md|txt|html|css|js|mjs|cjs|json|jsonc|yml|yaml|xml|svg|sh|py|gradle|properties|java|toml|webmanifest)$|^(?:_headers|\.gitignore|gradlew)$/i;
