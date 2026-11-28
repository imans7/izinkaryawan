// Pembaca .xlsx minimal (sheet pertama) berbasis JSZip. Mengembalikan array baris; sel berupa string/angka.
import JSZip from 'jszip';

const unesc = s => String(s).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = xml => [...String(xml).replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('');
const colIdx = ref => ref.replace(/\d+/g, '').split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export async function readXlsxRows(buf, { maxRows = 5000 } = {}) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new Error('File bukan Excel (.xlsx) yang valid.'); }
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) throw new Error('File bukan Excel (.xlsx) yang valid.');
  const wb = await wbFile.async('string');
  const first = wb.match(/<sheet\b[^>]*>/);
  if (!first) throw new Error('Workbook tidak memiliki sheet.');
  const rid = (first[0].match(/r:id="([^"]+)"/) || [])[1];
  const rels = zip.file('xl/_rels/workbook.xml.rels') ? await zip.file('xl/_rels/workbook.xml.rels').async('string') : '';
  const rel = (rels.match(/<Relationship\b[^>]*>/g) || []).find(r => r.includes(`Id="${rid}"`));
  let target = rel ? rel.match(/Target="([^"]+)"/)[1] : 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.?\//, '');
  const sheetFile = zip.file(target) || zip.file('xl/worksheets/sheet1.xml');
  if (!sheetFile) throw new Error('Sheet pertama tidak ditemukan.');
  const sheet = await sheetFile.async('string');

  let shared = [];
  if (zip.file('xl/sharedStrings.xml')) {
    const ss = await zip.file('xl/sharedStrings.xml').async('string');
    shared = (ss.match(/<si\b[\s\S]*?<\/si>/g) || []).map(textOf);
  }
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = Number((rm[1].match(/\br="(\d+)"/) || [])[1] || rows.length + 1);
    if (rn > maxRows + 1) break;
    const arr = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const t = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textOf(inner);
      else if (t === 'str' || t === 'e') val = v == null ? '' : unesc(v);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null && v !== '') val = Number(v);
      if (ref) arr[colIdx(ref)] = val; else arr.push(val);
    }
    rows[rn - 1] = Array.from(arr, x => x ?? '');
  }
  return Array.from(rows, r => r || []);
}
