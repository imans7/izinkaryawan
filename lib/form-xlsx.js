// Mengisi template-hrd.xlsx (3 formulir resmi HRD) langsung di level XML tanpa ExcelJS, sehingga logo, border,
// dan layout asli tetap utuh (ExcelJS gagal membaca drawing template ini: "reading 'anchors'").
//   leave   = Sheet 1 "1. Pengajuan Cuti"            (IPK-HRD-FM-020)
//   exit    = Sheet 2 "2. Ijin Keluar Area Kerja"    (IPK-HRD-FM-017)
//   absence = Sheet 3 " 3. Ijin Tidak Masuk Kerja "  (IPK-HRD-FM-030)
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const EMU = 9525, MAX_FORMS = 500;
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_IMG = `${NS_REL}/image`;

export const SPECS = {
  absence: { sheet: 'xl/worksheets/sheet3.xml', drawing: 'xl/drawings/drawing3.xml', title: 'Ijin Tidak Masuk', first: 27, last: 48, hideAbove: true, print: ['B', 'K'], keepEmpty: false, sigRow: 45, sigRows: 3, slots: { hrd: [1, 3], manager: [3, 5], supervisor: [5, 7], replacement: [7, 9], employee: [9, 11] } },
  leave:   { left: ['E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'E14', 'E15', 'E17'], sheet: 'xl/worksheets/sheet1.xml', drawing: 'xl/drawings/drawing1.xml', title: 'Cuti', first: 1, last: 25, hideAbove: false, print: ['A', 'I'], keepEmpty: true, sigRow: 23, sigRows: 1, slots: { hrd: [1, 3], manager: [3, 5], supervisor: [5, 6], replacement: [6, 7], employee: [7, 8] } },
  exit:    { sheet: 'xl/worksheets/sheet2.xml', drawing: 'xl/drawings/drawing2.xml', title: 'Ijin Keluar', first: 1, last: 17, hideAbove: false, print: ['A', 'F'], keepEmpty: true, sigRow: 15, sigRows: 1, slots: { security: [1, 2], hrd: [2, 3], leader: [3, 4], employee: [4, 5] } }
};
export const TPL_ORDER = ['leave', 'exit', 'absence'];

export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('Bukan file PNG yang valid.');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (!w || !h) throw new Error('Ukuran PNG tidak valid.');
  return { w, h };
}

// value: string | number | { v } (pertahankan rumus, ubah nilai cache)
function setCell(xml, ref, value, keepEmpty) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`Sel ${ref} tidak ditemukan pada template.`);
  const attrs = m[1].replace(/\s+t="[^"]*"/, '');
  if (value && typeof value === 'object') {
    const f = (m[2] || '').match(/<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>/);
    return xml.replace(re, `<c r="${ref}"${attrs}>${f ? f[0] : ''}<v>${value.v}</v></c>`);
  }
  if (typeof value === 'number') return xml.replace(re, `<c r="${ref}"${attrs}><v>${value}</v></c>`);
  const text = String(value ?? '');
  if (text === '') return keepEmpty ? xml : xml.replace(re, `<c r="${ref}"${attrs}/>`);
  return xml.replace(re, `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`);
}

const colLetter = i => { let s = '', n = i + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const rowOfRef = ref => Number((ref.match(/\d+/) || [0])[0]);
const shiftRef = (ref, off) => ref.replace(/([A-Z]+)(\d+)/g, (m, c, n) => `${c}${Number(n) + off}`);
const shiftFormula = (xml, off) => xml.replace(/<f>([^<]*)<\/f>/g, (m, f) => `<f>${shiftRef(f, off)}</f>`);

async function loadBase() {
  const buf = await readFile(path.join(process.cwd(), 'public', 'template-hrd.xlsx'));
  return JSZip.loadAsync(buf);
}

async function loadSpec(zip, key) {
  const sp = SPECS[key];
  const xml = await zip.file(sp.sheet).async('string');
  const rows = xml.match(/<row r="\d+"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];
  const block = rows.filter(r => { const n = Number(r.match(/r="(\d+)"/)[1]); return n >= sp.first && n <= sp.last; });
  if (!block.length) throw new Error(`Template ${key} tidak valid.`);
  const defH = Number((xml.match(/<sheetFormatPr[^>]*defaultRowHeight="([\d.]+)"/) || [0, 15])[1]);
  const rowPx = {};
  for (let r = sp.first; r <= sp.last; r++) rowPx[r] = defH * 96 / 72;
  block.forEach(r => { const n = Number(r.match(/r="(\d+)"/)[1]), h = r.match(/\sht="([\d.]+)"/); if (h) rowPx[n] = Number(h[1]) * 96 / 72; });
  const defW = Number((xml.match(/<sheetFormatPr[^>]*defaultColWidth="([\d.]+)"/) || [0, 8.43])[1]);
  const colPx = Array(26).fill(Math.round(defW * 7 + 5));
  for (const c of (xml.match(/<col [^>]*\/>/g) || [])) {
    const mn = Number(c.match(/min="(\d+)"/)[1]), mx = Math.min(Number(c.match(/max="(\d+)"/)[1]), 26), w = Number(c.match(/width="([\d.]+)"/)[1]);
    for (let i = mn; i <= mx; i++) colPx[i - 1] = Math.round(w * 7 + 5);
  }
  const merges = (xml.match(/<mergeCell ref="[^"]+"\/>/g) || []).map(m => m.match(/ref="([^"]+)"/)[1]).filter(r => { const [a, b] = r.split(':'); return rowOfRef(a) >= sp.first && rowOfRef(b || a) <= sp.last; });
  const dxml = await zip.file(sp.drawing).async('string');
  const anchors = (dxml.match(/<(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/g) || [])
    .filter(a => { const r = Number(a.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)</)[1]) + 1; return r >= sp.first && r <= sp.last; });
  if (!anchors.length) throw new Error(`Logo template ${key} tidak ditemukan.`);
  const rkey = sp.drawing.replace('drawings/', 'drawings/_rels/') + '.rels';
  const rels = (await zip.file(rkey).async('string')).match(/<Relationship [^>]*?\/>/g) || [];
  const logos = {};
  for (const r of rels) { const id = r.match(/Id="([^"]+)"/)[1]; const t = r.match(/Target="([^"]+)"/)[1]; logos[id] = 'xl/media/' + t.split('/').pop(); }
  const widthPx = colPx.slice(0, sp.print[1].charCodeAt(0) - 64).reduce((a, b) => a + b, 0) - colPx.slice(0, sp.print[0].charCodeAt(0) - 65).reduce((a, b) => a + b, 0);
  return { key, sp, xml, block: block.join(''), rowPx, colPx, merges, anchors, logos, widthPx };
}

function sigAnchor(tpl, slot, png, off, id, rid) {
  const { sp, colPx, rowPx } = tpl;
  const { w, h } = pngSize(png);
  const [c0, c1] = sp.slots[slot];
  const x0 = colPx.slice(0, c0).reduce((a, b) => a + b, 0), boxW = colPx.slice(c0, c1).reduce((a, b) => a + b, 0);
  let boxH = 0; for (let r = sp.sigRow; r < sp.sigRow + sp.sigRows; r++) boxH += rowPx[r];
  const pad = 4, availW = boxW - 2 * pad, availH = boxH - 4;
  const k = Math.min(availW / w, availH / h);
  const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
  const x = x0 + pad + (availW - dw) / 2, y = 2 + (availH - dh) / 2;
  let col = 0, acc = 0; while (col < colPx.length - 1 && acc + colPx[col] <= x) { acc += colPx[col]; col++; }
  let row = sp.sigRow, ra = 0; while (ra + rowPx[row] <= y && row < sp.sigRow + sp.sigRows - 1) { ra += rowPx[row]; row++; }
  const cx = dw * EMU, cy = dh * EMU;
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${Math.round((x - acc) * EMU)}</xdr:colOff><xdr:row>${row - 1 + off}</xdr:row><xdr:rowOff>${Math.round((y - ra) * EMU)}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="TTD ${slot}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${NS_REL}" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

// Satu sheet berisi N formulir sejenis bertumpuk ke bawah (satu formulir per halaman cetak).
function buildSheet(tpl, items, tag, selected, leftOf) {
  const { sp } = tpl;
  const height = sp.last - sp.first + 1, pitch = height + 2;
  let rows = sp.hideAbove ? Array.from({ length: sp.first - 1 }, (_, i) => `<row r="${i + 1}" hidden="1"/>`).join('') : '';
  const mergeOut = [], anchors = [], breaks = [], media = [], rels = [];
  items.forEach((item, i) => {
    const off = i * pitch;
    let b = tpl.block;
    for (const [ref, v] of Object.entries(item.values)) b = setCell(b, ref, v, sp.keepEmpty);
    for (const ref of sp.left || []) if (String(item.values[ref] ?? '') !== '') b = b.replace(new RegExp(`<c r="${ref}" s="(\\d+)"`), (m, st) => `<c r="${ref}" s="${leftOf(Number(st))}"`);
    b = shiftFormula(b, off);
    rows += b.replace(/<row r="(\d+)"/g, (m, n) => `<row r="${Number(n) + off}"`).replace(/<c r="([A-Z]+)(\d+)"/g, (m, c, n) => `<c r="${c}${Number(n) + off}"`);
    tpl.merges.forEach(r => mergeOut.push(`<mergeCell ref="${shiftRef(r, off)}"/>`));
    tpl.anchors.forEach((a, j) => anchors.push(a.replace(/(<(?:xdr:)?row>)(\d+)(<\/(?:xdr:)?row>)/g, (m, o, n, c) => `${o}${Number(n) + off}${c}`).replace(/<((?:xdr:)?cNvPr) id="\d+"/, `<$1 id="${i * 4 + j + 2}"`)));
    Object.keys(sp.slots).forEach((slot, k) => {
      const png = item.sigs?.[slot];
      if (!png) return;
      const rid = `rIdSig${i}x${k}`, file = `xl/media/sig_${tag}_${i}_${slot}.png`;
      anchors.push(sigAnchor(tpl, slot, png, off, 1000 + i * 10 + k, rid));
      media.push({ file, buf: png });
      rels.push(`<Relationship Id="${rid}" Type="${REL_IMG}" Target="/${file}"/>`);
    });
    if (i < items.length - 1) breaks.push(`<brk id="${sp.last + off}" max="16383" man="1"/>`);
  });
  const lastRow = sp.last + (items.length - 1) * pitch;
  const scale = Math.min(100, Math.floor(650 / tpl.widthPx * 100));
  let xml = tpl.xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${rows}</sheetData>`)
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeOut.length ? `<mergeCells count="${mergeOut.length}">${mergeOut.join('')}</mergeCells>` : '')
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${sp.print[0]}${sp.first}:${sp.print[1]}${lastRow}"/>`)
    .replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, `<sheetViews><sheetView ${selected ? 'tabSelected="1" ' : ''}workbookViewId="0"/></sheetViews>`)
    .replace(/<pageSetUpPr[^>]*\/>/, '').replace(/<drawing r:id="[^"]*"\/>/, '<drawing r:id="rId1"/>')
    .replace(/<pageSetup [^>]*\/>/, `<pageSetup paperSize="9" scale="${scale}" orientation="portrait"/>`)
    .replace(/<rowBreaks[\s\S]*?<\/rowBreaks>/, '').replace(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g, '');
  if (breaks.length) xml = xml.replace(/(<pageSetup [^>]*\/>)/, `$1<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.join('')}</rowBreaks>`);
  return { xml, anchors, media, rels, lastRow };
}

function cleanSheetName(base, used) {
  const n = String(base || 'Formulir').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31) || 'Formulir';
  let k = 2, out = n;
  while (used.has(out.toLowerCase())) { const suf = ` (${k++})`; out = n.slice(0, 31 - suf.length) + suf; }
  used.add(out.toLowerCase());
  return out;
}

// sheets: [{ name, tpl, items }]
async function assemble(sheets) {
  const zip = await loadBase();
  const tpls = {};
  for (const key of new Set(sheets.map(s => s.tpl))) tpls[key] = await loadSpec(zip, key);
  const logoBufs = {};
  for (const t of Object.values(tpls)) for (const f of Object.values(t.logos)) if (zip.file(f)) logoBufs[f] = await zip.file(f).async('nodebuffer');

  Object.keys(zip.files).forEach(f => { if (/^xl\/(worksheets|drawings|printerSettings)\//.test(f) || f === 'xl/calcChain.xml') zip.remove(f); });
  Object.entries(logoBufs).forEach(([f, b]) => zip.file(f, b));

  let styles = await zip.file('xl/styles.xml').async('string');
  const xfBlock = styles.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/);
  const xfs = xfBlock[1].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
  const added = [], leftCache = {};
  const leftOf = idx => {
    if (leftCache[idx] != null) return leftCache[idx];
    let x = xfs[idx].replace(/<alignment[^>]*\/>/, '').replace(/\sapplyAlignment="\d"/, '');
    x = x.endsWith('/>') ? x.replace(/\/>$/, ' applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>') : x.replace(/>/, ' applyAlignment="1">').replace('</xf>', '<alignment horizontal="left" vertical="center"/></xf>');
    added.push(x); return (leftCache[idx] = xfs.length + added.length - 1);
  };
  const used = new Set(), wbSheets = [], names = [], wrels = [], ctOver = [];
  sheets.forEach((sh, n) => {
    const idx = n + 1, name = cleanSheetName(sh.name, used), tpl = tpls[sh.tpl];
    const built = buildSheet(tpl, sh.items, `s${idx}`, n === 0, leftOf);
    zip.file(`xl/worksheets/sheet${idx}.xml`, built.xml);
    zip.file(`xl/worksheets/_rels/sheet${idx}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/drawing" Target="/xl/drawings/drawing${idx}.xml"/></Relationships>`);
    zip.file(`xl/drawings/drawing${idx}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${built.anchors.join('')}</xdr:wsDr>`);
    const logoRels = Object.entries(tpl.logos).map(([id, f]) => `<Relationship Id="${id}" Type="${REL_IMG}" Target="/${f}"/>`).join('');
    zip.file(`xl/drawings/_rels/drawing${idx}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logoRels}${built.rels.join('')}</Relationships>`);
    built.media.forEach(m => zip.file(m.file, m.buf));
    const p = tpl.sp.print;
    wbSheets.push(`<sheet name="${xmlEsc(name)}" sheetId="${idx}" r:id="rIdWs${idx}"/>`);
    names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${n}">'${xmlEsc(name.replace(/'/g, "''"))}'!$${p[0]}$${tpl.sp.first}:$${p[1]}$${built.lastRow}</definedName>`);
    wrels.push(`<Relationship Id="rIdWs${idx}" Type="${NS_REL}/worksheet" Target="/xl/worksheets/sheet${idx}.xml"/>`);
    ctOver.push(`<Override PartName="/xl/worksheets/sheet${idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  });

  if (added.length) zip.file('xl/styles.xml', styles.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length + added.length}">${xfBlock[1]}${added.join('')}</cellXfs>`));
  let wb = await zip.file('xl/workbook.xml').async('string');
  wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${wbSheets.join('')}</sheets>`)
    .replace(/<definedNames>[\s\S]*?<\/definedNames>/, `<definedNames>${names.join('')}</definedNames>`)
    .replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g, '')
    .replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
  zip.file('xl/workbook.xml', wb);
  let wr = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  wr = wr.replace(/<Relationship [^>]*?(?:worksheets\/|calcChain)[^>]*?\/>/g, '').replace('</Relationships>', `${wrels.join('')}</Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels', wr);
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace(/<Override PartName="\/xl\/(?:worksheets\/sheet|drawings\/drawing)\d+\.xml"[^>]*\/>/g, '').replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
  const defaults = ['png', 'jpeg'].filter(e => !ct.includes(`Extension="${e}"`)).map(e => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('');
  ct = ct.replace(/(<Default Extension="xml"[^>]*\/>)/, `$1${defaults}`).replace('</Types>', `${ctOver.join('')}</Types>`);
  zip.file('[Content_Types].xml', ct);
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function guard(items) {
  if (!items.length) throw new Error('Tidak ada surat izin untuk diunduh.');
  if (items.length > MAX_FORMS) throw new Error(`Maksimal ${MAX_FORMS} surat per unduhan. Persempit rentang tanggal.`);
  items.forEach(i => { if (!SPECS[i.tpl]) throw new Error('Jenis template tidak dikenal.'); });
}

// item: { tpl: 'leave'|'exit'|'absence', values, sigs: { slot: PNG Buffer }, sheetName }
// Surat dikelompokkan per jenis template; tiap jenis satu sheet, formulir ditumpuk dari atas ke bawah.
export async function fillFormsTemplate(items) {
  guard(items);
  const sheets = TPL_ORDER.filter(k => items.some(i => i.tpl === k)).map(k => ({ name: SPECS[k].title, tpl: k, items: items.filter(i => i.tpl === k) }));
  return assemble(sheets);
}
// Satu sheet per surat (Sheet 1 = surat 1, dst), memakai template sesuai jenisnya. Nama sheet = nama karyawan.
export async function fillFormsPerSheet(items) {
  guard(items);
  return assemble(items.map(it => ({ name: it.sheetName, tpl: it.tpl, items: [it] })));
}
