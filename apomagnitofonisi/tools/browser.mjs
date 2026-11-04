/**
 * Εντοπισμός του Chromium, τοπικά και στον runner.
 *
 * Στο περιβάλλον ανάπτυξης υπάρχει έτοιμος Chromium σε γνωστή διαδρομή, αλλά
 * η έκδοσή του μπορεί να διαφέρει από αυτήν που περιμένει το playwright του
 * package-lock: το σκέτο launch() τότε αποτυγχάνει. Στον runner ισχύει το
 * αντίστροφο, η διαδρομή δεν υπάρχει και το playwright ξέρει μόνο του πού
 * κατέβασε τον browser. Γι' αυτό: ρητό executablePath όταν η διαδρομή
 * υπάρχει, αλλιώς η προεπιλογή.
 *
 * Μεταβλητές περιβάλλοντος (προαιρετικές, όχι μυστικά):
 *   APOMAGN_CHROMIUM            ρητή διαδρομή του εκτελέσιμου
 *   APOMAGN_BROWSER_IGNORE_TLS  "1" = αποδοχή πιστοποιητικών του τοπικού proxy (μόνο τοπικά)
 */
import fs from 'node:fs';
import path from 'node:path';

/** Γνωστές διαδρομές του Chromium στο περιβάλλον ανάπτυξης. */
export const KNOWN_CHROMIUM_PATHS = Object.freeze([
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux64/chrome',
]);

/** Οι υποψήφιες διαδρομές κάτω από το PLAYWRIGHT_BROWSERS_PATH, αν έχει οριστεί. */
export function candidatesFromBrowsersPath(root) {
  if (!root || !fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root)) {
    if (!/^chromium/.test(entry)) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-linux64/chrome']) {
      found.push(path.join(root, entry, rel));
    }
  }
  return found;
}

/** Επιλογές για το chromium.launch(). Κενό αντικείμενο = προεπιλογή playwright. */
export function launchOptions(env = process.env) {
  const candidates = [
    env.APOMAGN_CHROMIUM,
    ...KNOWN_CHROMIUM_PATHS,
    ...candidatesFromBrowsersPath(env.PLAYWRIGHT_BROWSERS_PATH),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { executablePath: candidate };
  }
  return {};
}

/**
 * Αν ο browser πρέπει να δέχεται τα πιστοποιητικά του τοπικού proxy. Στο
 * περιβάλλον ανάπτυξης το HTTPS περνά από proxy με δικό του CA που ο Chromium
 * δεν εμπιστεύεται, οπότε καμία εξωτερική βιβλιοθήκη δεν φορτώνει. Ρητή
 * επιλογή, μόνο τοπικά. Στον runner του CI δεν χρειάζεται ποτέ.
 */
export function ignoreHttpsErrors(env = process.env) {
  return env.APOMAGN_BROWSER_IGNORE_TLS === '1';
}
