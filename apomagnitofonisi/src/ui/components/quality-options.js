/**
 * Οι επιλογές ποιότητας μιας μηχανής ως <option>, από την περιγραφή που δίνει
 * η υπηρεσία μεταγραφής (OO-003): «Αυτόματα» (με το επίπεδο που θα διαλέξει)
 * και κάθε επίπεδο, με όσα δεν τρέχουν σε αυτή τη συσκευή απενεργοποιημένα.
 * Κοινές για τη «Νέα μεταγραφή» και τις Ρυθμίσεις, ώστε να λένε το ίδιο.
 *
 * @typedef {import('../../application/ports.js').QualityPresetsDescription} QualityPresetsDescription
 */
import { h } from '../dom.js';
import { STRINGS, downloadSizeHint, qualityLabel } from '../strings.js';
import { AUTO_LOCAL_QUALITY } from '../../config/models.js';

/**
 * @param {QualityPresetsDescription|null} description  null: δεν έχει έρθει ακόμη
 * @param {{ withDownloadSize?: boolean }} [options]  και το μέγεθος λήψης κάθε επιπέδου
 * @returns {HTMLOptionElement[]}
 */
export function qualityOptions(description, { withDownloadSize = false } = {}) {
  const autoLabel = description ? STRINGS.quality.autoResolves(qualityLabel(description.autoPresetId)) : qualityLabel(AUTO_LOCAL_QUALITY);
  const presets = description ? description.presets : [];
  return [
    h('option', { value: AUTO_LOCAL_QUALITY }, autoLabel),
    ...presets.map(preset => h('option', { value: preset.id, disabled: !preset.available }, presetLabel(preset, withDownloadSize))),
  ];
}

function presetLabel(preset, withDownloadSize) {
  const label = qualityLabel(preset.id);
  if (!preset.available) return `${label} (${STRINGS.quality.unavailable})`;
  return withDownloadSize ? `${label}, ${downloadSizeHint(preset.approxDownloadMb)}` : label;
}
