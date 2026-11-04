/**
 * Η έκδοση κάθε AAB για το Google Play.
 *
 * versionCode = ώρα UTC του build σε μορφή ΕΕΕΕΜΜΗΗΩΩ (π.χ. 2026110414) και
 * versionName = 2026.11.04.14: κάθε νέο build έχει μεγαλύτερο versionCode από
 * όλα τα προηγούμενα χωρίς να χρειάζεται commit. Δύο builds μέσα στην ίδια ώρα
 * παίρνουν τον ίδιο αριθμό, τότε δίνεται ρητά code (input version_code του workflow).
 */

/** Το μεγαλύτερο versionCode που δέχεται το Google Play. Η μορφή ΕΕΕΕΜΜΗΗΩΩ το φτάνει το 2100. */
export const MAX_VERSION_CODE = 2_100_000_000;

export function versionFor(date = new Date(), code = '') {
  const pad = n => String(n).padStart(2, '0');
  const y = date.getUTCFullYear(), m = pad(date.getUTCMonth() + 1), d = pad(date.getUTCDate()), h = pad(date.getUTCHours());
  const name = `${y}.${m}.${d}.${h}`;
  const raw = String(code ?? '').trim();
  const versionCode = raw ? Number(raw) : Number(`${y}${m}${d}${h}`);
  if ((raw && !/^\d+$/.test(raw)) || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) {
    throw new Error(`μη έγκυρο versionCode ${raw || versionCode}: ακέραιος από 1 έως ${MAX_VERSION_CODE}`);
  }
  return { versionCode, versionName: name };
}
