/**
 * Το /.well-known/assetlinks.json της εφαρμογής Android.
 *
 * Για να ανοίγει το Chrome την εφαρμογή χωρίς γραμμή διευθύνσεων, το domain
 * σερβίρει το package και το αποτύπωμα SHA-256 κάθε κλειδιού που υπογράφει
 * την εφαρμογή (upload key και τα κλειδιά «Υπογραφή εφαρμογής» του Play), όπως
 * τα γράφει το fingerprints του twa-manifest.json. Το χρησιμοποιεί το build
 * (tools/build-dist.mjs) και το release (tools/android.mjs).
 */
import { ROOT } from '../paths.mjs';
import { ANDROID_DIR, ANDROID_APPS, readTwaManifest } from './project.mjs';

/** Οι σχέσεις του assetlinks.json, όπως στις εφαρμογές ΡΟΔΙΟΣ. */
export const ASSET_LINK_RELATIONS = Object.freeze([
  'delegate_permission/common.handle_all_urls',
  'delegate_permission/common.get_login_creds',
]);

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const PACKAGE_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** 64 δεκαεξαδικά ψηφία (όπως τα δίνει το apksigner) → AB:CD:… (όπως τα θέλει το assetlinks.json). */
export function formatFingerprint(hex) {
  const clean = String(hex).trim().toUpperCase().replace(/:/g, '');
  if (!/^[0-9A-F]{64}$/.test(clean)) throw new Error(`μη έγκυρο SHA-256: ${hex}`);
  return clean.match(/../g).join(':');
}

/**
 * Οι δηλώσεις του /.well-known/assetlinks.json: μία ανά εφαρμογή με τουλάχιστον
 * ένα αποτύπωμα στο twa-manifest.json της. Εφαρμογή χωρίς αποτύπωμα απλώς δεν
 * εμφανίζεται (ανοίγει με γραμμή διευθύνσεων μέχρι να προστεθεί).
 */
export function assetLinks(root = ROOT, apps = ANDROID_APPS) {
  const statements = [];
  const packages = new Set();
  for (const app of apps) {
    const where = `${ANDROID_DIR}/${app}/twa-manifest.json`;
    const twa = readTwaManifest(app, root);
    if (!PACKAGE_ID.test(twa.packageId || '')) throw new Error(`${where}: μη έγκυρο packageId ${twa.packageId}`);
    if (packages.has(twa.packageId)) throw new Error(`${where}: το packageId ${twa.packageId} υπάρχει ήδη σε άλλη εφαρμογή`);
    packages.add(twa.packageId);
    const fingerprints = (twa.fingerprints || []).map(f => f && f.value);
    for (const value of fingerprints) {
      if (!FINGERPRINT.test(value || '')) throw new Error(`${where}: μη έγκυρο αποτύπωμα SHA-256 ${value} (μορφή AB:CD:…, 32 byte, κεφαλαία)`);
    }
    if (new Set(fingerprints).size !== fingerprints.length) throw new Error(`${where}: το ίδιο αποτύπωμα δηλώνεται δύο φορές`);
    if (!fingerprints.length) continue;
    statements.push({
      relation: [...ASSET_LINK_RELATIONS],
      target: { namespace: 'android_app', package_name: twa.packageId, sha256_cert_fingerprints: fingerprints },
    });
  }
  return statements;
}

export function assetLinksJson(root = ROOT, apps = ANDROID_APPS) {
  return `${JSON.stringify(assetLinks(root, apps), null, 2)}\n`;
}
