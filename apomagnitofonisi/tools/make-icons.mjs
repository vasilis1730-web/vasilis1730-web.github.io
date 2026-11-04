#!/usr/bin/env node
/**
 * Τα εικονίδια και τα γραφικά της Απομαγνητοφώνησης, από μία πηγή.
 *
 * Το σχέδιο: κυματομορφή ήχου (κάθετες μπάρες, τιρκουάζ) που συνεχίζει ως
 * γραμμές κειμένου (λευκές) πάνω σε σκούρο πετρόλ #0E3B43. Χωρίς κείμενο και
 * χωρίς κανένα επίσημο σύμβολο. Τα PNG αποδίδονται από τον Chromium (Playwright)
 * με τις ίδιες διαστάσεις που ζητούν το web manifest, το iOS και το Google Play.
 *
 *   npm run icons            → assets/icons/* και store-assets/* (το δεύτερο είναι στο .gitignore)
 *
 * Τα εικονίδια του Android (mipmaps, splash) τα παράγει το Bubblewrap από τα
 * icon-512.png και icon-maskable-512.png (docs/ANDROID.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './browser.mjs';
import { ROOT } from './paths.mjs';

/** Τα χρώματα του σήματος. Το φόντο είναι το theme_color του web manifest. */
export const PALETTE = Object.freeze({
  background: '#0E3B43',
  wave: '#5EEAD4',
  text: '#F8FAFC',
});

/** Οι μπάρες της κυματομορφής: θέση x και ύψος, σε σύστημα 512×512 με κέντρο το (256, 256). */
const WAVE_BARS = Object.freeze([
  { x: 112, height: 84 },
  { x: 172, height: 204 },
  { x: 232, height: 128 },
]);

/** Οι γραμμές κειμένου: θέση y, αρχή και τέλος στον άξονα x. */
const TEXT_LINES = Object.freeze([
  { y: 188, from: 296, to: 402 },
  { y: 256, from: 296, to: 402 },
  { y: 324, from: 296, to: 358 },
]);

const STROKE = 40;

/** Το σχέδιο (χωρίς φόντο) ως στοιχεία SVG, σε κλίμακα scale γύρω από το κέντρο. */
export function glyphSvg(scale = 1) {
  const bars = WAVE_BARS.map(b => `<line x1="${b.x}" y1="${256 - b.height / 2}" x2="${b.x}" y2="${256 + b.height / 2}" stroke="${PALETTE.wave}"/>`);
  const lines = TEXT_LINES.map(l => `<line x1="${l.from}" y1="${l.y}" x2="${l.to}" y2="${l.y}" stroke="${PALETTE.text}"/>`);
  return `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)" stroke-width="${STROKE}" stroke-linecap="round" fill="none">${[...bars, ...lines].join('')}</g>`;
}

/**
 * Το εικονίδιο ως SVG.
 *   rounded   φόντο με στρογγυλεμένες γωνίες (purpose "any", favicon)
 *   maskable  φόντο σε όλο το τετράγωνο και σχέδιο μέσα στη ζώνη ασφαλείας (purpose "maskable", iOS)
 */
export function iconSvg(variant = 'rounded') {
  const background = variant === 'maskable'
    ? `<rect width="512" height="512" fill="${PALETTE.background}"/>`
    : `<rect width="512" height="512" rx="112" fill="${PALETTE.background}"/>`;
  const scale = variant === 'maskable' ? 0.78 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${background}${glyphSvg(scale)}</svg>\n`;
}

/** Το γραφικό λειτουργίας του Google Play (1024×500): σήμα, όνομα και μία φράση. */
export function featureGraphicHtml() {
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; }
    body { background: linear-gradient(135deg, ${PALETTE.background} 0%, #145560 100%); display: flex; align-items: center;
      font-family: Inter, 'DejaVu Sans', sans-serif; color: ${PALETTE.text}; }
    .mark { width: 240px; height: 240px; margin: 0 40px 0 72px; flex: none; }
    h1 { font-size: 60px; font-weight: 700; margin: 0 0 16px; letter-spacing: -0.5px; white-space: nowrap; }
    p { font-size: 30px; margin: 0; color: ${PALETTE.wave}; font-weight: 500; }
  </style></head><body>
    <svg class="mark" viewBox="0 0 512 512">${glyphSvg(1.15)}</svg>
    <div><h1>Απομαγνητοφώνηση</h1><p>Ήχος και βίντεο σε κείμενο</p></div>
  </body></html>`;
}

/** Τα αρχεία που παράγονται: διαδρομή σχετική με τη ρίζα, διαστάσεις και πηγή. */
export const OUTPUTS = Object.freeze([
  { file: 'assets/icons/icon-192.png', width: 192, height: 192, variant: 'rounded' },
  { file: 'assets/icons/icon-512.png', width: 512, height: 512, variant: 'rounded' },
  { file: 'assets/icons/icon-maskable-512.png', width: 512, height: 512, variant: 'maskable' },
  { file: 'assets/icons/apple-touch-icon.png', width: 180, height: 180, variant: 'maskable' },
  { file: 'store-assets/store-icon-512.png', width: 512, height: 512, variant: 'maskable' },
  { file: 'store-assets/feature-graphic-1024x500.png', width: 1024, height: 500, html: featureGraphicHtml },
]);

/** Τα SVG που γράφονται όπως είναι. */
export const SVG_OUTPUTS = Object.freeze([
  { file: 'assets/icons/icon.svg', variant: 'rounded' },
  { file: 'assets/icons/favicon.svg', variant: 'rounded' },
]);

function htmlForIcon(variant, size) {
  return `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${iconSvg(variant)}</body></html>`;
}

/** Αποδίδει μία έξοδο σε PNG (διαφανές φόντο έξω από το σχέδιο). */
async function renderPng(browser, output, root) {
  const page = await browser.newPage({ viewport: { width: output.width, height: output.height }, deviceScaleFactor: 1 });
  try {
    const html = output.html ? output.html() : htmlForIcon(output.variant, output.width);
    await page.setContent(html, { waitUntil: 'load' });
    const target = path.join(root, output.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, omitBackground: !output.html, clip: { x: 0, y: 0, width: output.width, height: output.height } });
  } finally {
    await page.close();
  }
}

/** Γράφει όλα τα εικονίδια και τα γραφικά. Επιστρέφει τις διαδρομές τους. */
export async function makeIcons({ root = ROOT } = {}) {
  const written = [];
  for (const { file, variant } of SVG_OUTPUTS) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), iconSvg(variant));
    written.push(file);
  }
  const browser = await chromium.launch(launchOptions());
  try {
    for (const output of OUTPUTS) {
      await renderPng(browser, output, root);
      written.push(output.file);
    }
  } finally {
    await browser.close();
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const file of await makeIcons()) console.log(`✓ ${file}`);
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  }
}
