/**
 * Οι διαδρομές της εφαρμογής σε ένα σημείο (API-013): ο router χτίζεται από
 * τα ROUTE_PATTERNS και οι προβολές φτιάχνουν συνδέσμους μόνο με τα ROUTES.
 */
export const ROUTE_PATTERNS = Object.freeze({
  HOME: '/',
  PROGRESS: '/progress',
  TRANSCRIPT: '/t/:id',
  SUMMARY: '/t/:id/summary',
  HISTORY: '/history',
  SETTINGS: '/settings',
});

const encoded = id => encodeURIComponent(id);

/** Διαδρομές για το router.navigate(). */
export const ROUTES = Object.freeze({
  home: () => '/',
  progress: () => '/progress',
  transcript: id => `/t/${encoded(id)}`,
  summary: id => `/t/${encoded(id)}/summary`,
  history: () => '/history',
  settings: () => '/settings',
});

/** Η διαδρομή ως href συνδέσμου (με #). */
export function hrefFor(path) {
  return `#${path}`;
}
