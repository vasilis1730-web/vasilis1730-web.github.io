/**
 * Τι μπορεί η συσκευή: WebGPU (και fp16 στους shaders), WebCodecs, WebAssembly,
 * workers, απομόνωση cross-origin (πολυνηματικό WASM) και πυρήνες.
 *
 * @typedef {Object} DeviceCapabilities
 * @property {boolean} webgpu
 * @property {boolean} shaderF16
 * @property {boolean} webCodecs
 * @property {boolean} webAssembly
 * @property {boolean} workers
 * @property {boolean} crossOriginIsolated
 * @property {number} hardwareConcurrency
 * @property {number|null} deviceMemoryGb
 */

/**
 * @param {typeof globalThis} [env]
 * @returns {Promise<DeviceCapabilities>}
 */
export async function detectCapabilities(env = globalThis) {
  let webgpu = false;
  let shaderF16 = false;
  const gpu = env.navigator && env.navigator.gpu;
  if (gpu && typeof gpu.requestAdapter === 'function') {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        shaderF16 = Boolean(adapter.features && adapter.features.has('shader-f16'));
      }
    } catch {
      webgpu = false;
    }
  }
  return {
    webgpu,
    shaderF16,
    webCodecs: typeof env.AudioDecoder === 'function',
    webAssembly: typeof env.WebAssembly === 'object',
    workers: typeof env.Worker === 'function',
    crossOriginIsolated: env.crossOriginIsolated === true,
    hardwareConcurrency: (env.navigator && env.navigator.hardwareConcurrency) || 1,
    deviceMemoryGb: (env.navigator && env.navigator.deviceMemory) ?? null,
  };
}

/**
 * Ανιχνευτής με μία ανίχνευση ανά σελίδα (το requestAdapter δεν είναι δωρεάν).
 * @returns {() => Promise<DeviceCapabilities>}
 */
export function createCachedCapabilityDetector(detect = detectCapabilities) {
  let pending = null;
  return () => (pending ??= detect());
}
