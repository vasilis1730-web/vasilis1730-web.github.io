import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUTS, SVG_OUTPUTS, PALETTE, iconSvg, glyphSvg, featureGraphicHtml } from '../../tools/make-icons.mjs';
import { ROOT } from '../../tools/paths.mjs';
import { exists } from './helpers.mjs';

/* Τα εικονίδια (tools/make-icons.mjs): μία πηγή, σωστές διαστάσεις, και το
   maskable με το σχέδιο μέσα στη ζώνη ασφαλείας του Android (κύκλος με ακτίνα
   το 40% της πλευράς), ώστε να μην κόβεται σε κανένα σχήμα εικονιδίου. */

/** Πλάτος και ύψος ενός PNG από το IHDR του. */
function pngSize(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), `${file}: PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('τα εικονίδια της εφαρμογής υπάρχουν με τις διαστάσεις που ζητούν το manifest, το iOS και το Play', () => {
  for (const output of OUTPUTS.filter(o => o.file.startsWith('assets/'))) {
    assert.deepEqual(pngSize(output.file), { width: output.width, height: output.height }, output.file);
  }
  for (const { file, variant } of SVG_OUTPUTS) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), 'utf8'), iconSvg(variant), `${file}: ίδιο με την πηγή (npm run icons)`);
  }
  assert.ok(!exists('store-assets') || fs.statSync(path.join(ROOT, 'store-assets')).isDirectory());
});

test('το σήμα έχει τα χρώματα της εφαρμογής, χωρίς κείμενο, και το maskable χωρά στη ζώνη ασφαλείας', () => {
  const rounded = iconSvg('rounded');
  const maskable = iconSvg('maskable');
  assert.match(rounded, new RegExp(`fill="${PALETTE.background}"`));
  assert.match(rounded, /rx="112"/, 'στρογγυλεμένες γωνίες για το purpose any');
  assert.doesNotMatch(maskable, /rx=/, 'το maskable γεμίζει όλο το τετράγωνο');
  assert.doesNotMatch(rounded, /<text/, 'χωρίς κείμενο στο εικονίδιο');
  for (const color of [PALETTE.wave, PALETTE.text]) assert.ok(rounded.includes(`stroke="${color}"`));

  // Τα άκρα του σχεδίου (μαζί με το μισό πάχος της γραμμής) μετά την κλίμακα του maskable.
  const scale = Number(maskable.match(/scale\(([\d.]+)\)/)[1]);
  const points = [...glyphSvg(1).matchAll(/x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)]
    .flatMap(m => [[+m[1], +m[2]], [+m[3], +m[4]]]);
  const stroke = Number(glyphSvg(1).match(/stroke-width="(\d+)"/)[1]);
  const farthest = Math.max(...points.map(([x, y]) => Math.hypot(x - 256, y - 256) + stroke / 2)) * scale;
  assert.ok(farthest <= 0.4 * 512, `το σχέδιο φτάνει ${farthest.toFixed(0)} px από το κέντρο, όριο ${0.4 * 512}`);
  assert.match(featureGraphicHtml(), /Απομαγνητοφώνηση/);
});
