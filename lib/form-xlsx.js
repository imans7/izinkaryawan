// Mengisi template-form.xlsx langsung di level XML (tanpa ExcelJS) supaya logo, border,
// dan layout template asli tetap utuh. ExcelJS gagal membaca drawing template ini
// ("Cannot read properties of undefined (reading 'anchors')").
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function setCell(xml, ref, value) {
  const text = String(value ?? '');
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`Sel ${ref} tidak ditemukan pada template.`);
  const attrs = m[1].replace(/\s+t="[^"]*"/, '');
  const repl = text === ''
    ? `<c r="${ref}"${attrs}/>`
    : `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
  return xml.replace(re, repl);
}

const FIRST = 27, LAST = 48; // area satu formulir pada template (judul s/d baris tanda tangan)
const inRange = n => n >= FIRST && n <= LAST;
const rowOfRef = ref => Number((ref.match(/\d+/) || [0])[0]);

// Template berisi banyak formulir bertumpuk (baris 1-541). Untuk unduhan, hanya satu formulir yang dipertahankan.
function trimSheet(xml) {
  const hidden = Array.from({ length: FIRST - 1 }, (_, i) => `<row r="${i + 1}" hidden="1"/>`).join('');
  let first = true;
  xml = xml.replace(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (m, n) => {
    n = Number(n);
    if (!inRange(n)) return '';
    if (first) { first = false; return hidden + m; }
    return m;
  });
  const merges = (xml.match(/<mergeCell ref="[^"]+"\/>/g) || []).filter(m => { const [a, b] = m.match(/ref="([^"]+)"/)[1].split(':'); return inRange(rowOfRef(a)) && inRange(rowOfRef(b || a)); });
  xml = xml.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '');
  return xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="B${FIRST}:K${LAST}"/>`).replace(/activeCell="[^"]*" sqref="[^"]*"/, 'activeCell="B27" sqref="B27"');
}

export async function fillFormTemplate(values) {
  const buf = await readFile(path.join(process.cwd(), 'public', 'template-form.xlsx'));
  const zip = await JSZip.loadAsync(buf);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath).async('string');
  for (const [ref, v] of Object.entries(values)) xml = setCell(xml, ref, v);
  zip.file(sheetPath, trimSheet(xml));

  // Gambar: pertahankan hanya logo milik formulir ini.
  const dPath = 'xl/drawings/drawing1.xml', rPath = 'xl/drawings/_rels/drawing1.xml.rels';
  let d = await zip.file(dPath).async('string');
  const anchors = d.match(/<twoCellAnchor[\s\S]*?<\/twoCellAnchor>/g) || [];
  const keep = anchors.filter(a => { const r = Number(a.match(/<from>[\s\S]*?<row>(\d+)<\/row>/)[1]) + 1; return inRange(r); });
  d = d.replace(/<twoCellAnchor[\s\S]*<\/twoCellAnchor>/, keep.join(''));
  zip.file(dPath, d);
  const used = new Set([...d.matchAll(/r:embed="([^"]+)"/g)].map(m => m[1]));
  let rels = await zip.file(rPath).async('string');
  rels = rels.replace(/<Relationship [^>]*?\/>/g, m => {
    const id = m.match(/Id="([^"]+)"/)[1];
    if (used.has(id)) return m;
    const t = m.match(/Target="([^"]+)"/)[1].replace(/^\//, '');
    zip.remove(t.startsWith('xl/') ? t : 'xl/' + t);
    return '';
  });
  zip.file(rPath, rels);

  // Buang "Sheet1" yang kosong; hanya sheet "Karyawan" yang tersisa.
  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(/<sheet [^>]*name="Sheet1"[^>]*\/>/, '').replace(/\$B\$26:\$K\$48/, `$B$${FIRST}:$K$${LAST}`);
  zip.file('xl/workbook.xml', wb);
  let wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/_rels/workbook.xml.rels', wr.replace(/<Relationship [^>]*sheet2\.xml[^>]*\/>/, ''));
  let ct = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', ct.replace(/<Override PartName="\/xl\/worksheets\/sheet2\.xml"[^>]*\/>/, ''));
  zip.remove('xl/worksheets/sheet2.xml');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
