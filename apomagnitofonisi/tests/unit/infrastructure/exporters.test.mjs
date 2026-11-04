import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createZip, crc32 } from '../../../src/infrastructure/export/zip-store-writer.js';
import { buildDocx, escapeXml } from '../../../src/infrastructure/export/docx-document.js';
import { TxtTranscriptExporter, SrtTranscriptExporter, VttTranscriptExporter, JsonTranscriptExporter, TxtSummaryExporter } from '../../../src/infrastructure/export/text-exporters.js';
import { DocxTranscriptExporter, DocxSummaryExporter, markdownToDocxBlocks } from '../../../src/infrastructure/export/docx-exporters.js';
import { createTranscript, addSummary } from '../../../src/domain/transcript.js';
import { deserializeTranscript } from '../../../src/domain/transcript-codec.js';
import { testLabels } from '../helpers/labels.mjs';

const transcript = addSummary(createTranscript({
  id: 't1', title: 'Σύσκεψη «Έργων» & Υποδομών', createdAt: '2026-11-04T09:00:00.000Z',
  source: { fileName: 'a.m4a', mimeType: 'audio/mp4', sizeBytes: 1, durationSec: 65 },
  languageCode: 'el', engine: { kind: 'elevenlabs', model: 'scribe_v2' },
  speakers: [{ id: 'S1', label: 'Πρόεδρος', colorIndex: 0 }, { id: 'S2', label: 'Μηχανικός <Α>', colorIndex: 1 }],
  segments: [
    { id: 'seg-1', start: 0.5, end: 4, speakerId: 'S1', text: 'Καλημέρα σε όλους, ξεκινάμε τη συνεδρίαση.' },
    { id: 'seg-2', start: 61, end: 64.2, speakerId: 'S2', text: 'Η μελέτη --> έτοιμη.', words: [{ text: 'Η', start: 61, end: 61.2 }, { text: 'μελέτη', start: 61.3, end: 62 }, { text: '-->', start: 62.1, end: 62.2 }, { text: 'έτοιμη.', start: 62.3, end: 64.2 }] },
  ],
}), { id: 's1', kind: 'minutes', model: 'claude-opus-5-5', createdAt: '2026-11-04T10:00:00.000Z', text: '## Αποφάσεις\n- Εγκρίνεται **ομόφωνα**.\n1. Πρώτο\n\n| Ποιος | Τι |\n|---|---|\n| Γραμματέας | Πρόσκληση |' }, '2026-11-04T10:00:00.000Z');

/** Διαβάζει τα αρχεία ενός ZIP (μέθοδος STORE) από τον κεντρικό κατάλογο. */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(position, true), 0x02014b50);
    const crc = view.getUint32(position + 16, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const offset = view.getUint32(position + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength));
    const localNameLength = view.getUint16(offset + 26, true);
    const data = bytes.subarray(offset + 30 + localNameLength, offset + 30 + localNameLength + size);
    assert.equal(crc, zlib.crc32(data), `CRC του ${name}`);
    files.set(name, new TextDecoder().decode(data));
    position += 46 + nameLength;
  }
  return files;
}

test('ZIP: CRC-32 ίδιο με του zlib, ονόματα UTF-8, δομή που διαβάζεται', () => {
  const bytes = new TextEncoder().encode('Καλημέρα κόσμε');
  assert.equal(crc32(bytes), zlib.crc32(bytes));
  const zip = createZip([{ path: 'α/β.txt', data: 'γεια' }, { path: 'x.bin', data: new Uint8Array([1, 2, 3]) }], { date: new Date(2026, 10, 4, 10, 30, 12) });
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ['α/β.txt', 'x.bin']);
  assert.equal(files.get('α/β.txt'), 'γεια');
});

test('XML: διαφυγή και αφαίρεση χαρακτήρων ελέγχου', () => {
  assert.equal(escapeXml('a<b>&"\'\u0001c'), 'a&lt;b&gt;&amp;&quot;&apos;c');
});

test('Word μεταγραφής: μέρη πακέτου, τίτλος, ομιλητές έντονα, κείμενο με διαφυγή', () => {
  const docx = new DocxTranscriptExporter({ labels: testLabels }).render(transcript);
  const files = readZip(docx);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'docProps/core.xml', 'docProps/app.xml']) {
    assert.ok(files.has(part), part);
  }
  const document = files.get('word/document.xml');
  assert.match(document, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">Σύσκεψη «Έργων» &amp; Υποδομών<\/w:t>/);
  assert.match(document, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Μηχανικός &lt;Α&gt;: <\/w:t>/);
  assert.match(document, /\[00:01:01\] /);
  assert.match(files.get('word/styles.xml'), /w:lang w:val="el-GR"/);
  assert.match(files.get('docProps/core.xml'), /<dc:title>Σύσκεψη «Έργων» &amp; Υποδομών<\/dc:title>/);
});

test('Word περίληψης: επικεφαλίδες, λίστες με αρίθμηση από την αρχή, πίνακας', () => {
  const files = readZip(new DocxSummaryExporter({ labels: testLabels }).render(transcript, transcript.summaries[0]));
  const document = files.get('word/document.xml');
  assert.match(document, /Πρακτικά: Σύσκεψη/);
  assert.match(document, /<w:pStyle w:val="Heading2"\/>/);
  assert.match(document, /<w:numId w:val="1"\/>/, 'κουκκίδες');
  assert.match(document, /<w:numId w:val="2"\/>/, 'αριθμημένη λίστα');
  assert.match(document, /<w:tbl>/);
  assert.match(files.get('word/numbering.xml'), /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><w:lvlOverride/);
  const blocks = markdownToDocxBlocks('# Α\n#### Β');
  assert.deepEqual(blocks.map(b => b.style), ['Heading1', 'Heading3']);
});

test('Word: έγκυρο XML σε κάθε μέρος (python3, όπου υπάρχει)', { skip: spawnSync('python3', ['--version']).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  const file = path.join(dir, 'Δοκιμή.docx');
  fs.writeFileSync(file, new DocxSummaryExporter({ labels: testLabels }).render(transcript, transcript.summaries[0]));
  const check = spawnSync('python3', ['-I', '-c', [
    'import sys, zipfile, xml.dom.minidom',
    'z = zipfile.ZipFile(sys.argv[1])',
    'assert z.testzip() is None',
    '[xml.dom.minidom.parseString(z.read(n)) for n in z.namelist()]',
    'print(len(z.namelist()))',
  ].join('\n'), file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout.trim(), '8');
});

test('κείμενο: κεφαλίδα, στοιχεία και γραμμές με χρόνο και ομιλητή', () => {
  const txt = new TxtTranscriptExporter({ labels: testLabels }).render(transcript);
  assert.match(txt, /^Σύσκεψη «Έργων» & Υποδομών\r\n\r\nΗμερομηνία: 2026-11-04\r\nΔιάρκεια: 00:01:05\r\n/);
  assert.match(txt, /\[00:00:00\] Πρόεδρος: Καλημέρα σε όλους/);
  assert.match(txt, /Ομιλητές: Πρόεδρος, Μηχανικός <Α>/);
});

test('SRT και VTT', () => {
  const srt = new SrtTranscriptExporter().render(transcript);
  assert.match(srt, /^1\r\n00:00:00,500 --> 00:00:04,000\r\nΚαλημέρα σε όλους, ξεκινάμε τη συνεδρίαση\.\r\n\r\n2\r\n00:01:01,000 --> /);
  const vtt = new VttTranscriptExporter().render(transcript);
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.500 --> 00:00:04\.000\n<v Πρόεδρος>/);
  assert.match(vtt, /<v Μηχανικός &lt;Α&gt;>Η μελέτη --&gt; έτοιμη\./);
  assert.equal(vtt.split('\n').filter(line => line.includes('-->')).length, 2, 'το «-->» μόνο στις γραμμές χρόνου');
});

test('JSON: ξαναδιαβάζεται χωρίς απώλειες, και Markdown περίληψης', () => {
  const json = new JsonTranscriptExporter({ clock: { nowIso: () => '2026-11-04T12:00:00.000Z' }, appVersion: '1.0.0' }).render(transcript);
  assert.deepEqual(deserializeTranscript(json), transcript);
  const md = new TxtSummaryExporter({ labels: testLabels }).render(transcript, transcript.summaries[0]);
  assert.match(md, /^# Πρακτικά: Σύσκεψη/);
  assert.match(md, /Συντάχθηκε αυτόματα/);
});

test('χωρίς τίτλο: τα έγγραφα γράφουν την ετικέτα της διεπαφής', () => {
  const untitled = addSummary(createTranscript({
    id: 't2', title: '', createdAt: '2026-11-04T09:00:00.000Z',
    source: { fileName: '', mimeType: 'audio/mp4', sizeBytes: 1, durationSec: 5 },
    languageCode: 'el', engine: { kind: 'local', model: 'whisper' }, speakers: [],
    segments: [{ id: 'seg-1', start: 0, end: 2, speakerId: null, text: 'Δοκιμή.' }],
  }), { id: 's1', kind: 'brief', model: 'm', createdAt: '2026-11-04T10:00:00.000Z', text: 'Κείμενο.' }, '2026-11-04T10:00:00.000Z');
  assert.equal(untitled.title, '');
  assert.match(new TxtTranscriptExporter({ labels: testLabels }).render(untitled), /^Μεταγραφή χωρίς τίτλο\r\n/);
  assert.match(new TxtSummaryExporter({ labels: testLabels }).render(untitled, untitled.summaries[0]), /^# Περίληψη: Μεταγραφή χωρίς τίτλο/);
  const document = readZip(new DocxTranscriptExporter({ labels: testLabels }).render(untitled)).get('word/document.xml');
  assert.match(document, /<w:t xml:space="preserve">Μεταγραφή χωρίς τίτλο<\/w:t>/);
});
