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

export async function fillFormTemplate(values) {
  const buf = await readFile(path.join(process.cwd(), 'public', 'template-form.xlsx'));
  const zip = await JSZip.loadAsync(buf);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath).async('string');
  for (const [ref, v] of Object.entries(values)) xml = setCell(xml, ref, v);
  zip.file(sheetPath, xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
