/**
 * Το αρχείο με το οποίο άνοιξε η εφαρμογή από «Κοινή χρήση» άλλης εφαρμογής
 * (Web Share Target): ο service worker το έβαλε στη θυρίδα και άνοιξε τη
 * σελίδα με ?shared=1. Εδώ παραλαμβάνεται και το ?shared=1 φεύγει από τη
 * διεύθυνση, ώστε μια ανανέωση να μην το ξαναζητά (OO-002, έξω από το main.js).
 */
import { ROUTES, hrefFor } from './routes.js';

/**
 * @param {Object} deps
 * @param {Location} deps.location
 * @param {History} deps.history
 * @param {import('../application/ports.js').SharedFileInbox} deps.inbox
 * @returns {Promise<File|null>}
 */
export async function takeSharedFile({ location, history, inbox }) {
  const url = new URL(location.href);
  if (!url.searchParams.has('shared')) return null;
  const files = await inbox.takeFiles().catch(() => []);
  url.searchParams.delete('shared');
  // Χωρίς hash, η αρχική από το ROUTES (API-029), όχι γραμμένη με το χέρι.
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash || hrefFor(ROUTES.home())}`);
  return files[0] || null;
}
