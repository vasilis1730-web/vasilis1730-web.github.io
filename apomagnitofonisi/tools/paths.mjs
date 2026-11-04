/**
 * Η ρίζα του repository, κοινή για όλα τα εργαλεία και τα tests, και ο κοινός
 * φύλακας των φακέλων εξόδου (build-dist.mjs, android.mjs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Αληθές αν το `inner` είναι ο ίδιος ο φάκελος `outer` ή βρίσκεται μέσα του. */
export function isSameOrInside(inner, outer) {
  const rel = path.relative(path.resolve(outer), path.resolve(inner));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Ένας φάκελος εξόδου που καθαρίζεται πριν γραφτεί δεν επιτρέπεται να είναι η
 * ρίζα του repository ή γονέας της: θα διαγραφόταν το repository (API-024).
 * @param {string} root
 * @param {string} out
 */
export function assertSafeOutput(root, out) {
  if (isSameOrInside(root, out)) {
    throw new Error(`μη ασφαλής φάκελος εξόδου: ${out} περιέχει τη ρίζα του repository`);
  }
}
