/**
 * Η έκδοση κάθε AAB για το Google Play.
 *
 * versionCode = ώρα UTC του build σε μορφή ΕΕΕΕΜΜΗΗΩΩ (π.χ. 2026110414) και
 * versionName = 2026.11.04.14: κάθε νέο build έχει μεγαλύτερο versionCode από
 * όλα τα προηγούμενα χωρίς να χρειάζεται commit. Δύο builds μέσα στην ίδια ώρα
 * παίρνουν τον ίδιο αριθμό, τότε δίνεται ρητά versionCodeOverride (input
 * version_code του workflow, μέσω του --version-code του tools/android.mjs).
 */

/** Το μεγαλύτερο versionCode που δέχεται το Google Play. Η μορφή ΕΕΕΕΜΜΗΗΩΩ το φτάνει το 2100. */
export const MAX_VERSION_CODE = 2_100_000_000;

/**
 * Ένα versionCode όπως έρχεται από τη γραμμή εντολών ή το input του workflow.
 * Κενό = δεν δόθηκε (undefined). Αλλιώς ακέραιος από 1 έως MAX_VERSION_CODE,
 * μόνο με ψηφία: «12abc», «1e3», «-5» και «0» απορρίπτονται.
 * @param {string|number|null|undefined} raw
 * @returns {number|undefined}
 */
export function parseVersionCode(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const versionCode = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) {
    throw new Error(`μη έγκυρο versionCode «${text}»: ακέραιος από 1 έως ${MAX_VERSION_CODE}`);
  }
  return versionCode;
}

/**
 * Η έκδοση ενός build. Χωρίς versionCodeOverride, το versionCode βγαίνει από την ώρα.
 * @param {Date} [date]
 * @param {string|number} [versionCodeOverride] ρητό versionCode (κενό = από την ώρα), περνά από το parseVersionCode
 * @returns {{ versionCode: number, versionName: string }}
 */
export function versionFor(date = new Date(), versionCodeOverride = '') {
  const pad = n => String(n).padStart(2, '0');
  const y = date.getUTCFullYear(), m = pad(date.getUTCMonth() + 1), d = pad(date.getUTCDate()), h = pad(date.getUTCHours());
  const versionCode = parseVersionCode(versionCodeOverride) ?? parseVersionCode(`${y}${m}${d}${h}`);
  return { versionCode, versionName: `${y}.${m}.${d}.${h}` };
}
