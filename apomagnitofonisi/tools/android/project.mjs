/**
 * Το project Android της Απομαγνητοφώνησης (Trusted Web Activity του Bubblewrap).
 *
 * Μοναδική πηγή για package, host, scope, share target και αποτυπώματα είναι
 * το android/<app>/twa-manifest.json. Εδώ ζουν οι διαδρομές του project και η
 * ανάγνωσή του, για τα υπόλοιπα εργαλεία (asset-links, apk-inspection, android.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.mjs';

export const ANDROID_DIR = 'android';

/** Οι εφαρμογές, με το όνομα του φακέλου τους στο android/. Σήμερα μία. */
export const ANDROID_APPS = Object.freeze(['apomagnitofonisi']);

/** Η meta-data με την οποία το android-browser-helper προωθεί ό,τι μοιράζεται ο χρήστης στο web share target. */
export const SHARE_TARGET_METADATA = 'android.support.customtabs.trusted.METADATA_SHARE_TARGET';

/** Οι τύποι αρχείων που δέχεται η εφαρμογή από την «Κοινοποίηση» του Android. */
export const SHARED_MIME_TYPES = Object.freeze(['audio/*', 'video/*']);

export function twaManifestPath(app, root = ROOT) {
  return path.join(root, ANDROID_DIR, app, 'twa-manifest.json');
}

export function readTwaManifest(app, root = ROOT) {
  return JSON.parse(fs.readFileSync(twaManifestPath(app, root), 'utf8'));
}

/** Η διαδρομή του scope της εφαρμογής ('/' για εφαρμογή στη ρίζα του domain). */
export function scopePathOf(twa) {
  return new URL(twa.fullScopeUrl).pathname;
}

/** Τα αρχεία που αφήνει το Gradle για μία εφαρμογή (assembleRelease, bundleRelease). */
export function gradleOutputsOf(app, root = ROOT) {
  const base = path.join(root, ANDROID_DIR, app, 'app', 'build', 'outputs');
  return {
    apk: path.join(base, 'apk', 'release', 'app-release-unsigned.apk'),
    aab: path.join(base, 'bundle', 'release', 'app-release.aab'),
  };
}
