/**
 * Οι εξωτερικές βιβλιοθήκες (ES modules από το jsDelivr), καρφιτσωμένες σε
 * ακριβή έκδοση. Μοναδική πηγή εκδόσεων: καμία άλλη μονάδα δεν γράφει URL
 * βιβλιοθήκης. Φορτώνονται μόνο όταν χρειαστούν (dynamic import), μέσω του
 * loader του infrastructure/vendor-loader.js.
 *
 * Transformers.js: το dist/transformers.web.min.js κάνει import τα
 * «onnxruntime-web/webgpu» και «onnxruntime-common» ως bare specifiers και
 * δεν φορτώνει σε browser χωρίς bundler (ούτε σε worker, όπου δεν ισχύουν
 * import maps). Το dist/transformers.min.js περιέχει το ONNX Runtime και
 * φέρνει μόνο τα .wasm από το cdn.jsdelivr.net/npm/onnxruntime-web@….
 */
export const VENDOR_MODULE_URLS = Object.freeze({
  mediabunny: 'https://cdn.jsdelivr.net/npm/mediabunny@1.65.1/dist/bundles/mediabunny.min.mjs',
  transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js',
  anthropicSdk: 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm',
});
