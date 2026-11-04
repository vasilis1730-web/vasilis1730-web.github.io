/**
 * Επιλογή μοντέλου Whisper για τη συσκευή: ποιο repo, σε ποια συσκευή
 * (WebGPU ή WASM) και με ποια κβάντιση, από το επίπεδο ποιότητας και τις
 * δυνατότητες της συσκευής. Μόνο η μηχανή στη συσκευή τη χρησιμοποιεί, και
 * εκθέτει το αποτέλεσμα προς τα έξω με τη θύρα describeQualityPresets (OO-003).
 *
 * @typedef {import('../../config/models.js').LocalQualityPresetId} LocalQualityPresetId
 * @typedef {import('../../config/models.js').LocalQualityChoice} LocalQualityChoice
 *
 * @typedef {Object} LocalModelChoice
 * @property {LocalQualityPresetId} presetId
 * @property {string} repo
 * @property {import('./worker-protocol.js').InferenceDevice} device
 * @property {Record<string, string>} dtype
 * @property {number} approxDownloadMb
 */
import { LOCAL_MODEL_PRESETS, LOCAL_QUALITY_PRESET_IDS, AUTO_LOCAL_QUALITY, findLocalModelPreset } from '../../config/models.js';
import { INFERENCE_DEVICES } from './worker-protocol.js';

/** «Αυτόματα»: ισορροπημένο με WebGPU, γρήγορο χωρίς (σε CPU το small είναι αργό). */
export function resolvePresetId(choice, capabilities) {
  if (choice && choice !== AUTO_LOCAL_QUALITY) return choice;
  return capabilities.webgpu ? LOCAL_QUALITY_PRESET_IDS.BALANCED : LOCAL_QUALITY_PRESET_IDS.FAST;
}

/**
 * @param {LocalQualityChoice} choice
 * @param {import('../platform/capabilities.js').DeviceCapabilities} capabilities
 * @returns {LocalModelChoice|null} null όταν το επίπεδο δεν τρέχει σε αυτή τη συσκευή
 */
export function selectLocalModel(choice, capabilities) {
  const preset = findLocalModelPreset(resolvePresetId(choice, capabilities));
  if (!preset) return null;
  const { variants } = preset;
  let variant = null;
  let device = INFERENCE_DEVICES.WASM;
  if (capabilities.webgpu && capabilities.shaderF16 && variants.webgpuShaderF16) { variant = variants.webgpuShaderF16; device = INFERENCE_DEVICES.WEBGPU; }
  else if (capabilities.webgpu && variants.webgpu) { variant = variants.webgpu; device = INFERENCE_DEVICES.WEBGPU; }
  else if (variants.wasm) variant = variants.wasm;
  if (!variant) return null;
  return { presetId: preset.id, repo: preset.repo, device, dtype: { ...variant.dtype }, approxDownloadMb: variant.approxDownloadMb };
}

/**
 * Τα επίπεδα ποιότητας σε αυτή τη συσκευή, για τη θύρα
 * TranscriptionEngine.describeQualityPresets.
 * @returns {import('../../application/ports.js').QualityPresetsDescription}
 */
export function describeQualityPresets(capabilities) {
  return {
    accelerated: Boolean(capabilities.webgpu),
    autoPresetId: resolvePresetId(AUTO_LOCAL_QUALITY, capabilities),
    presets: LOCAL_MODEL_PRESETS.map(preset => {
      const choice = selectLocalModel(preset.id, capabilities);
      return { id: preset.id, available: Boolean(choice), approxDownloadMb: choice ? choice.approxDownloadMb : null };
    }),
  };
}
