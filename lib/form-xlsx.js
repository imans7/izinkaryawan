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

const FIRST = 27, LAST = 48; // satu formulir pada template = baris 27 s/d 48
const PITCH = 24;               // jarak antar formulir (22 baris formulir + 2 baris kosong)
const MAX_FORMS = 500;
const rowOfRef = ref => Number((ref.match(/\d+/) || [0])[0]);
const shiftRef = (ref, off) => ref.replace(/([A-Z]+)(\d+)/g, (m, c, n) => `${c}${Number(n) + off}`);

// Template berisi banyak formulir bertumpuk. Satu formulir (baris 27-48) dijadikan cetakan,
// lalu digandakan ke bawah sebanyak jumlah surat izin, masing-masing satu halaman cetak.
export async function fillFormsTemplate(valuesList) {
  if (!valuesList.length) throw new Error('Tidak ada surat izin untuk diunduh.');
  if (valuesList.length > MAX_FORMS) throw new Error(`Maksimal ${MAX_FORMS} surat per unduhan. Persempit rentang tanggal.`);
  const buf = await readFile(path.join(process.cwd(), 'public', 'template-form.xlsx'));
  const zip = await JSZip.loadAsync(buf);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath).async('string');

  const rowsXml = (xml.match(/<row r="\d+"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).filter(r => { const n = Number(r.match(/r="(\d+)"/)[1]); return n >= FIRST && n <= LAST; });
  if (!rowsXml.length) throw new Error('Template tidak valid.');
  const block = rowsXml.join('');
  const merges = (xml.match(/<mergeCell ref="[^"]+"\/>/g) || []).map(m => m.match(/ref="([^"]+)"/)[1]).filter(r => { const [a, b] = r.split(':'); return rowOfRef(a) >= FIRST && rowOfRef(b || a) <= LAST; });

  // Gambar: ambil logo milik formulir pertama sebagai cetakan.
  const dPath = 'xl/drawings/drawing1.xml', rPath = 'xl/drawings/_rels/drawing1.xml.rels';
  let d = await zip.file(dPath).async('string');
  const anchor = (d.match(/<twoCellAnchor[\s\S]*?<\/twoCellAnchor>/g) || []).find(a => Number(a.match(/<from>[\s\S]*?<row>(\d+)<\/row>/)[1]) + 1 === FIRST);
  if (!anchor) throw new Error('Logo template tidak ditemukan.');

  const hidden = Array.from({ length: FIRST - 1 }, (_, i) => `<row r="${i + 1}" hidden="1"/>`).join('');
  let rows = hidden, mergeOut = [], anchors = [], breaks = [];
  valuesList.forEach((values, i) => {
    const off = i * PITCH;
    let b = block;
    for (const [ref, v] of Object.entries(values)) b = setCell(b, ref, v);
    rows += b.replace(/<row r="(\d+)"/g, (m, n) => `<row r="${Number(n) + off}"`).replace(/<c r="([A-Z]+)(\d+)"/g, (m, c, n) => `<c r="${c}${Number(n) + off}"`);
    merges.forEach(r => mergeOut.push(`<mergeCell ref="${shiftRef(r, off)}"/>`));
    anchors.push(anchor.replace(/<row>(\d+)<\/row>/g, (m, n) => `<row>${Number(n) + off}</row>`).replace(/<cNvPr id="\d+"/, `<cNvPr id="${i + 2}"`));
    if (i < valuesList.length - 1) breaks.push(`<brk id="${LAST + off}" max="16383" man="1"/>`);
  });
  const lastRow = LAST + (valuesList.length - 1) * PITCH;

  xml = xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${rows}</sheetData>`)
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/, `<mergeCells count="${mergeOut.length}">${mergeOut.join('')}</mergeCells>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="B${FIRST}:K${lastRow}"/>`)
    .replace(/activeCell="[^"]*" sqref="[^"]*"/, 'activeCell="B27" sqref="B27"')
    .replace('<pageSetUpPr fitToPage="1"/>', '<pageSetUpPr/>')
    .replace(/<pageSetup [^>]*\/>/, '<pageSetup orientation="portrait" paperSize="9" scale="85"/>');
  if (breaks.length) xml = xml.replace(/(<pageSetup [^>]*\/>)/, `$1<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.join('')}</rowBreaks>`);
  zip.file(sheetPath, xml);

  d = d.replace(/<twoCellAnchor[\s\S]*<\/twoCellAnchor>/, anchors.join(''));
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

  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(/<sheet [^>]*name="Sheet1"[^>]*\/>/, '').replace(/\$B\$26:\$K\$48/, `$B$${FIRST}:$K$${lastRow}`);
  zip.file('xl/workbook.xml', wb);
  const wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/_rels/workbook.xml.rels', wr.replace(/<Relationship [^>]*sheet2\.xml[^>]*\/>/, ''));
  const ct = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', ct.replace(/<Override PartName="\/xl\/worksheets\/sheet2\.xml"[^>]*\/>/, ''));
  zip.remove('xl/worksheets/sheet2.xml');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const fillFormTemplate = values => fillFormsTemplate([values]);
