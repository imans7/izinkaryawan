import { readXlsxRows } from './xlsx-read.js';
import { CATEGORIES } from './categories.js';

const MONTHS = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12 };
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };

export function parseDate(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') { // nomor seri Excel
    if (v < 20000 || v > 80000) return null;
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2]]) return ymd(+m[3], MONTHS[m[2]], +m[1]);
  return null;
}
export function parseTime(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && v >= 0 && v < 1) { const mins = Math.round(v * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  return m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : null;
}
export function parseCategory(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return 'Cuti'; // data lama yang diimpor umumnya cuti
  if (s.includes('pulang')) return 'Izin Pulang Cepat';
  if (s.startsWith('cuti')) return 'Cuti';
  if (s.startsWith('sakit')) return 'Sakit';
  if (s === 'izin' || s === 'ijin') return 'Izin';
  return CATEGORIES.find(c => c.toLowerCase() === s) || null;
}
const norm = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fieldOf(h) {
  const n = norm(h);
  if (!n) return null;
  if (n.includes('nik') || n.includes('absen')) return 'nik';
  if (n === 'nama' || n === 'namakaryawan') return 'name';
  if (n.includes('kategori') || n === 'jenis' || n === 'jenisizin') return 'category';
  if (n.includes('mulai')) return 'start';
  if (n.includes('selesai') || n.includes('sampai')) return 'end';
  if (n.includes('jampulang') || n === 'jam') return 'time';
  if (n.includes('keperluan') || n.includes('alasan') || n.includes('keterangan')) return 'purpose';
  if (n.includes('pengajuan')) return 'applied';
  if (n.includes('statustandatangan') || n === 'ttd' || n === 'status') return 'signed';
  if (n.includes('pengganti')) return 'replacement';
  return null;
}
const cell = v => (typeof v === 'number' ? String(v).replace(/\.0+$/, '') : String(v ?? '').trim());

// Mengubah baris Excel menjadi data terstruktur + daftar error per baris.
export async function parseImport(buf, employees, existingForms) {
  const grid = await readXlsxRows(buf);
  let hi = -1, map = {};
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const m = {}; (grid[i] || []).forEach((h, c) => { const f = fieldOf(h); if (f && !(f in m)) m[f] = c; });
    if ((m.nik != null || m.name != null) && m.start != null) { hi = i; map = m; break; }
  }
  if (hi < 0) throw new Error('Header tidak ditemukan. Pastikan ada kolom "NIK / No. Absen" (atau "Nama Karyawan") dan "Tanggal Mulai". Gunakan template impor.');
  const byNik = new Map(employees.map(e => [String(e.nik), e]));
  const byName = new Map(); for (const e of employees) { const k = String(e.name).trim().toLowerCase(); byName.set(k, byName.has(k) ? null : e); }
  const seen = new Set(existingForms.map(f => `${f.employee_nik}|${f.data?.category || 'Izin'}|${f.data?.leave_start}|${f.data?.leave_end}`));
  const rows = [], errors = []; let skipped = 0, blank = 0;
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    if (!r.some(x => x !== '' && x != null)) { blank++; continue; }
    const get = k => (map[k] != null ? r[map[k]] : '');
    const rowNo = i + 1, fail = msg => errors.push({ row: rowNo, error: msg });
    const nikRaw = cell(get('nik')), nameRaw = cell(get('name'));
    let emp = nikRaw ? byNik.get(nikRaw) : (nameRaw ? byName.get(nameRaw.toLowerCase()) : null);
    if (!emp && nikRaw && nameRaw) emp = byName.get(nameRaw.toLowerCase()) || null; // NIK salah ketik tetapi nama unik
    if (!emp) { fail(nikRaw || nameRaw ? `Karyawan "${nikRaw || nameRaw}" tidak ditemukan di Data Karyawan (atau namanya ganda; gunakan NIK).` : 'NIK/Nama kosong.'); continue; }
    const category = parseCategory(get('category'));
    if (!category) { fail(`Kategori "${cell(get('category'))}" tidak dikenal (Cuti, Sakit, Izin, Izin Pulang Cepat).`); continue; }
    const start = parseDate(get('start'));
    if (!start) { fail(`Tanggal mulai tidak valid: "${cell(get('start'))}".`); continue; }
    let end = parseDate(get('end'));
    if (end === null) { fail(`Tanggal selesai tidak valid: "${cell(get('end'))}".`); continue; }
    end = category === 'Izin Pulang Cepat' || !end ? start : end;
    if (end < start) { fail('Tanggal selesai lebih awal dari tanggal mulai.'); continue; }
    const time = parseTime(get('time'));
    if (time === null) { fail(`Jam pulang tidak valid: "${cell(get('time'))}".`); continue; }
    const applied = parseDate(get('applied'));
    if (applied === null) { fail(`Tanggal pengajuan tidak valid: "${cell(get('applied'))}".`); continue; }
    const key = `${emp.nik}|${category}|${start}|${end}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const sg = cell(get('signed')).toLowerCase();
    rows.push({ row: rowNo, employee_nik: String(emp.nik), employee_name: emp.name, category, leave_start: start, leave_end: end, leave_time: category === 'Izin Pulang Cepat' ? time : '', purpose: cell(get('purpose')), application_date: applied || start, replacement: cell(get('replacement')), is_signed: /^(sudah|ya|yes|true|1|ttd)/.test(sg) });
  }
  return { rows, errors, skipped, blank, total: rows.length + errors.length + skipped };
}
