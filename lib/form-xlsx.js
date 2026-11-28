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
const PITCH = 24;            // jarak antar formulir bila ditumpuk (22 baris + 2 baris kosong)
const MAX_FORMS = 500;
const rowOfRef = ref => Number((ref.match(/\d+/) || [0])[0]);
const shiftRef = (ref, off) => ref.replace(/([A-Z]+)(\d+)/g, (m, c, n) => `${c}${Number(n) + off}`);

// Kotak tanda tangan: baris 45-47, kolom B:C (HRD), D:E (Manager), F:G (Supervisor), H:I (Pengganti), J:K (Karyawan)
export const SIG_SLOTS = ['hrd', 'manager', 'supervisor', 'replacement', 'employee'];
const SLOT_COLS = { hrd: [1, 3], manager: [3, 5], supervisor: [5, 7], replacement: [7, 9], employee: [9, 11] };
const COLW = [19, 69, 69, 69, 97, 19, 125, 69, 69, 69, 88]; // lebar kolom A..K dalam piksel
const ROW_PX = 17, SIG_ROW = 45, SIG_ROWS = 3, EMU = 9525;
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('Bukan file PNG yang valid.');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (!w || !h) throw new Error('Ukuran PNG tidak valid.');
  return { w, h };
}

function sigAnchor(slot, png, off, id, rid) {
  const { w, h } = pngSize(png);
  const [c0, c1] = SLOT_COLS[slot];
  const x0 = COLW.slice(0, c0).reduce((a, b) => a + b, 0), boxW = COLW.slice(c0, c1).reduce((a, b) => a + b, 0);
  const availW = boxW - 8, availH = ROW_PX * SIG_ROWS - 4;
  const k = Math.min(availW / w, availH / h);
  const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
  const x = x0 + 4 + (availW - dw) / 2, y = 2 + (availH - dh) / 2;
  let col = 0, acc = 0;
  while (col < COLW.length - 1 && acc + COLW[col] <= x) { acc += COLW[col]; col++; }
  const row = SIG_ROW - 1 + off + Math.floor(y / ROW_PX);
  const cx = dw * EMU, cy = dh * EMU;
  return `<oneCellAnchor><from><col>${col}</col><colOff>${Math.round((x - acc) * EMU)}</colOff><row>${row}</row><rowOff>${Math.round((y % ROW_PX) * EMU)}</rowOff></from><ext cx="${cx}" cy="${cy}"/><pic><nvPicPr><cNvPr id="${id}" name="TTD ${slot}"/><cNvPicPr><a:picLocks ${NS_A} noChangeAspect="1"/></cNvPicPr></nvPicPr><blipFill><a:blip ${NS_A} ${NS_R} r:embed="${rid}"/><a:stretch ${NS_A}><a:fillRect/></a:stretch></blipFill><spPr><a:xfrm ${NS_A}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom ${NS_A} prst="rect"><a:avLst/></a:prstGeom></spPr></pic><clientData/></oneCellAnchor>`;
}

async function loadTemplate() {
  const buf = await readFile(path.join(process.cwd(), 'public', 'template-form.xlsx'));
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const rowsXml = (xml.match(/<row r="\d+"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).filter(r => { const n = Number(r.match(/r="(\d+)"/)[1]); return n >= FIRST && n <= LAST; });
  if (!rowsXml.length) throw new Error('Template tidak valid.');
  const merges = (xml.match(/<mergeCell ref="[^"]+"\/>/g) || []).map(m => m.match(/ref="([^"]+)"/)[1]).filter(r => { const [a, b] = r.split(':'); return rowOfRef(a) >= FIRST && rowOfRef(b || a) <= LAST; });
  const d = await zip.file('xl/drawings/drawing1.xml').async('string');
  const logo = (d.match(/<twoCellAnchor[\s\S]*?<\/twoCellAnchor>/g) || []).find(a => Number(a.match(/<from>[\s\S]*?<row>(\d+)<\/row>/)[1]) + 1 === FIRST);
  if (!logo) throw new Error('Logo template tidak ditemukan.');
  const logoRid = logo.match(/r:embed="([^"]+)"/)[1];
  const rels = await zip.file('xl/drawings/_rels/drawing1.xml.rels').async('string');
  const rel = (rels.match(/<Relationship [^>]*?\/>/g) || []).find(r => r.includes(`Id="${logoRid}"`));
  const logoTarget = rel.match(/Target="([^"]+)"/)[1].replace(/^\//, '');
  return { zip, xml, block: rowsXml.join(''), merges, logo, logoRid, logoTarget, hasHeadStyle: true };
}

// Satu sheet berisi N formulir bertumpuk ke bawah. Tiap item: { values, sigs: { slot: PNG Buffer } }.
function buildSheet(tpl, items, tag) {
  const hidden = Array.from({ length: FIRST - 1 }, (_, i) => `<row r="${i + 1}" hidden="1"/>`).join('');
  let rows = hidden; const mergeOut = [], anchors = [], breaks = [], media = [], rels = [];
  items.forEach((item, i) => {
    const off = i * PITCH;
    let b = tpl.block;
    for (const [ref, v] of Object.entries(item.values)) b = setCell(b, ref, v);
    rows += b.replace(/<row r="(\d+)"/g, (m, n) => `<row r="${Number(n) + off}"`).replace(/<c r="([A-Z]+)(\d+)"/g, (m, c, n) => `<c r="${c}${Number(n) + off}"`);
    tpl.merges.forEach(r => mergeOut.push(`<mergeCell ref="${shiftRef(r, off)}"/>`));
    anchors.push(tpl.logo.replace(/<row>(\d+)<\/row>/g, (m, n) => `<row>${Number(n) + off}</row>`).replace(/<cNvPr id="\d+"/, `<cNvPr id="${i + 2}"`));
    SIG_SLOTS.forEach((slot, k) => {
      const png = item.sigs?.[slot];
      if (!png) return;
      const rid = `rIdSig${i}x${k}`, file = `xl/media/sig_${tag}_${i}_${slot}.png`;
      anchors.push(sigAnchor(slot, png, off, 1000 + i * 10 + k, rid));
      media.push({ file, buf: png });
      rels.push(`<Relationship Id="${rid}" Type="${REL_IMG}" Target="/${file}"/>`);
    });
    if (i < items.length - 1) breaks.push(`<brk id="${LAST + off}" max="16383" man="1"/>`);
  });
  const lastRow = LAST + (items.length - 1) * PITCH;
  let xml = tpl.xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${rows}</sheetData>`)
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/, `<mergeCells count="${mergeOut.length}">${mergeOut.join('')}</mergeCells>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="B${FIRST}:K${lastRow}"/>`)
    .replace(/activeCell="[^"]*" sqref="[^"]*"/, 'activeCell="B27" sqref="B27"')
    .replace('<pageSetUpPr fitToPage="1"/>', '<pageSetUpPr/>')
    .replace(/<pageSetup [^>]*\/>/, '<pageSetup orientation="portrait" paperSize="9" scale="85"/>');
  if (breaks.length) xml = xml.replace(/(<pageSetup [^>]*\/>)/, `$1<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.join('')}</rowBreaks>`);
  return { xml, anchors, media, rels, lastRow };
}

function cleanSheetName(base, used) {
  const n = String(base || 'Karyawan').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31) || 'Karyawan';
  let k = 2, out = n;
  while (used.has(out.toLowerCase())) { const suf = ` (${k++})`; out = n.slice(0, 31 - suf.length) + suf; }
  used.add(out.toLowerCase());
  return out;
}

// sheets: [{ name, items: [item, ...] }]
async function assemble(sheets) {
  const tpl = await loadTemplate();
  const zip = tpl.zip;
  const logoBuf = await zip.file(tpl.logoTarget).async('nodebuffer');
  const logoExt = path.extname(tpl.logoTarget).slice(1) || 'jpeg';

  // Bersihkan bagian lama (sheet, drawing, media).
  Object.keys(zip.files).forEach(f => { if (/^xl\/(worksheets|drawings)\//.test(f) || /^xl\/media\//.test(f)) zip.remove(f); });
  zip.remove('xl/worksheets'); zip.remove('xl/drawings'); zip.remove('xl/media');
  const logoFile = `xl/media/logo.${logoExt}`;
  zip.file(logoFile, logoBuf);

  const used = new Set();
  const wbSheets = [], names = [], rels = [], ctOver = [];
  sheets.forEach((sh, n) => {
    const idx = n + 1, name = cleanSheetName(sh.name, used);
    const built = buildSheet(tpl, sh.items, `s${idx}`);
    zip.file(`xl/worksheets/sheet${idx}.xml`, built.xml);
    zip.file(`xl/worksheets/_rels/sheet${idx}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing${idx}.xml"/></Relationships>`);
    zip.file(`xl/drawings/drawing${idx}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">${built.anchors.join('')}</wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${idx}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${tpl.logoRid}" Type="${REL_IMG}" Target="/${logoFile}"/>${built.rels.join('')}</Relationships>`);
    built.media.forEach(m => zip.file(m.file, m.buf));
    wbSheets.push(`<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="${xmlEsc(name)}" sheetId="${idx}" state="visible" r:id="rIdWs${idx}"/>`);
    names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${n}">'${xmlEsc(name.replace(/'/g, "''"))}'!$B$${FIRST}:$K$${built.lastRow}</definedName>`);
    rels.push(`<Relationship Id="rIdWs${idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${idx}.xml"/>`);
    ctOver.push(`<Override PartName="/xl/worksheets/sheet${idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  });

  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${wbSheets.join('')}</sheets>`).replace(/<definedNames>[\s\S]*?<\/definedNames>/, `<definedNames>${names.join('')}</definedNames>`);
  zip.file('xl/workbook.xml', wb);
  const wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/_rels/workbook.xml.rels', wr.replace(/<Relationship [^>]*?(?:worksheets\/)[^>]*?\/>/g, '').replace('</Relationships>', `${rels.join('')}</Relationships>`));
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace(/<Override PartName="\/xl\/(?:worksheets\/sheet|drawings\/drawing)\d+\.xml"[^>]*\/>/g, '');
  const defaults = ['png', logoExt].filter((e, i, a) => a.indexOf(e) === i && !ct.includes(`Extension="${e}"`)).map(e => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('');
  ct = ct.replace(/(<Default Extension="xml"[^>]*\/>)/, `$1${defaults}`).replace('</Types>', `${ctOver.join('')}</Types>`);
  zip.file('[Content_Types].xml', ct);
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const norm = x => (x && x.values ? x : { values: x, sigs: {} });
function guard(list) {
  if (!list.length) throw new Error('Tidak ada surat izin untuk diunduh.');
  if (list.length > MAX_FORMS) throw new Error(`Maksimal ${MAX_FORMS} surat per unduhan. Persempit rentang tanggal.`);
}

// Semua surat ditumpuk dari atas ke bawah dalam satu sheet ("Karyawan"), satu surat per halaman cetak.
export async function fillFormsTemplate(list) {
  const items = list.map(norm); guard(items);
  return assemble([{ name: 'Karyawan', items }]);
}
// Satu sheet per surat (Sheet 1 = surat 1, dst). Nama sheet = nama karyawan.
export async function fillFormsPerSheet(list) {
  const items = list.map(norm); guard(items);
  return assemble(items.map(it => ({ name: it.sheetName || it.values.G30, items: [it] })));
}
export const fillFormTemplate = v => fillFormsTemplate([v]);
