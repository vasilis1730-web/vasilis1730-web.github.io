/**
 * Σύνδεσμοι προς σελίδες τρίτων που ανοίγει ο χρήστης (πλοήγηση, όχι
 * αιτήματα της εφαρμογής). Δεν χρειάζονται θέση στο connect-src της CSP.
 */
export const EXTERNAL_LINKS = Object.freeze({
  elevenLabsKeys: 'https://elevenlabs.io/app/settings/api-keys',
  elevenLabsPricing: 'https://elevenlabs.io/pricing/api',
  elevenLabsPrivacy: 'https://elevenlabs.io/privacy-policy',
  anthropicKeys: 'https://console.anthropic.com/settings/keys',
  anthropicPricing: 'https://www.anthropic.com/pricing',
  anthropicPrivacy: 'https://www.anthropic.com/legal/privacy',
});
