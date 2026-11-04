/**
 * Επιλογή μοντέλου Whisper για τη συσκευή: ποιο repo, σε ποια συσκευή
 * (WebGPU ή WASM) και με ποια κβάντιση, από το επίπεδο ποιότητας και τις
 * δυνατότητες της συσκευής.
 *
 * @typedef {Object} LocalModelChoice
 * @property {string} presetId
 * @property {string} repo
 * @property {'webgpu'|'wasm'} device
 * @property {Record<string, string>} dtype
 * @property {number} approxDownloadMb
 */
import { LOCAL_MODEL_PRESETS, LOCAL_QUALITY_PRESET_IDS, findLocalModelPreset } from '../../config/models.js';

/** «Αυτόματα»: ισορροπημένο με WebGPU, γρήγορο χωρίς (σε CPU το small είναι αργό). */
export function resolvePresetId(presetId, capabilities) {
  if (presetId && presetId !== LOCAL_QUALITY_PRESET_IDS.AUTO) return presetId;
  return capabilities.webgpu ? LOCAL_QUALITY_PRESET_IDS.BALANCED : LOCAL_QUALITY_PRESET_IDS.FAST;
}

/**
 * @param {string} presetId
 * @param {import('../platform/capabilities.js').DeviceCapabilities} capabilities
 * @returns {LocalModelChoice|null} null όταν το επίπεδο δεν τρέχει σε αυτή τη συσκευή
 */
export function selectLocalModel(presetId, capabilities) {
  const preset = findLocalModelPreset(resolvePresetId(presetId, capabilities));
  if (!preset) return null;
  const { variants } = preset;
  let variant = null;
  let device = 'wasm';
  if (capabilities.webgpu && capabilities.shaderF16 && variants.webgpuShaderF16) { variant = variants.webgpuShaderF16; device = 'webgpu'; }
  else if (capabilities.webgpu && variants.webgpu) { variant = variants.webgpu; device = 'webgpu'; }
  else if (variants.wasm) variant = variants.wasm;
  if (!variant) return null;
  return { presetId: preset.id, repo: preset.repo, device, dtype: { ...variant.dtype }, approxDownloadMb: variant.approxDownloadMb };
}

/** Όλα τα επίπεδα με το μέγεθος λήψης σε αυτή τη συσκευή (null = δεν τρέχει). */
export function describeLocalPresets(capabilities) {
  return LOCAL_MODEL_PRESETS.map(preset => ({ presetId: preset.id, choice: selectLocalModel(preset.id, capabilities) }));
}
