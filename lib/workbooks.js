import ExcelJS from 'exceljs';

export const CATEGORIES = ['Cuti', 'Sakit', 'Izin', 'Izin Pulang Cepat'];
export const catOf = d => (CATEGORIES.includes(d?.category) ? d.category : 'Izin'); // data lama tanpa kategori dianggap "Izin"

const HEAD = 'FF146B61';
const toDate = s => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? new Date(String(s).slice(0, 10) + 'T00:00:00Z') : null);
const days = (a, b) => { const x = toDate(a), y = toDate(b); return x && y ? Math.round((y - x) / 86400000) + 1 : ''; };
const stamp = v => { if (!v) return ''; const d = new Date(v); return Number.isNaN(+d) ? '' : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(d); };

function style(ws, cols, headerRow = 1) {
  const h = ws.getRow(headerRow);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
  h.alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols } };
  ws.eachRow((row, n) => { if (n >= headerRow) row.eachCell(c => { c.border = { bottom: { style: 'hair', color: { argb: 'FFDCE4ED' } } }; if (n > headerRow) c.alignment = { vertical: 'top', wrapText: true }; }); });
}
const DATE_FMT = 'dd/mm/yyyy';

function sheetName(base, used) {
  let n = String(base || 'Karyawan').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Karyawan';
  let k = 2, out = n;
  while (used.has(out.toLowerCase())) { const suf = ` (${k++})`; out = n.slice(0, 31 - suf.length) + suf; }
  used.add(out.toLowerCase());
  return out;
}

export function reportWorkbook(rows) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Personnel Desk';
  const ws = wb.addWorksheet('Laporan Izin');
  ws.columns = [
    { header: 'Tanggal Pengajuan', key: 'app', width: 18 }, { header: 'Nama Karyawan', key: 'name', width: 28 }, { header: 'NIK / No. Absen', key: 'nik', width: 18 },
    { header: 'Jabatan', key: 'pos', width: 20 }, { header: 'Divisi', key: 'div', width: 20 }, { header: 'Kategori', key: 'cat', width: 18 },
    { header: 'Tanggal Mulai', key: 'st', width: 16 }, { header: 'Tanggal Selesai', key: 'en', width: 16 }, { header: 'Jam Pulang', key: 'time', width: 12 },
    { header: 'Lama (hari)', key: 'len', width: 12 }, { header: 'Keperluan', key: 'purpose', width: 36 }, { header: 'Pengganti', key: 'rep', width: 24 },
    { header: 'Status Tanda Tangan', key: 'sig', width: 22 }, { header: 'Ditandai Oleh', key: 'by', width: 24 }, { header: 'Tanggal Dibuat', key: 'created', width: 22 }
  ];
  for (const r of rows) {
    const d = r.data || {};
    ws.addRow({ app: toDate(d.application_date), name: d.employee_name || '', nik: d.employee_nik || '', pos: d.position || '', div: d.division || '', cat: catOf(d), st: toDate(d.leave_start), en: toDate(d.leave_end), time: d.leave_time || '', len: days(d.leave_start, d.leave_end), purpose: d.purpose || '', rep: d.replacement_name || '', sig: r.is_signed ? 'Sudah ditandatangani' : 'Belum ditandatangani', by: r.signed_by_name || '', created: stamp(r.created_at) });
  }
  ['app', 'st', 'en'].forEach(k => { ws.getColumn(k).numFmt = DATE_FMT; });
  style(ws, 15);
  return wb;
}

// Sheet 1: Data Karyawan, Sheet 2: Data User, Sheet 3..n: satu sheet per karyawan yang punya surat izin, terakhir: Semua Izin.
export function dataWorkbook({ employees, users, forms, includeUsers }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Personnel Desk';
  const used = new Set(['data karyawan', 'data user', 'semua izin']);
  const byNik = new Map();
  for (const f of forms) { const k = f.employee_nik; if (!byNik.has(k)) byNik.set(k, []); byNik.get(k).push(f); }

  const s1 = wb.addWorksheet('Data Karyawan');
  s1.columns = [{ header: 'NIK / No. Absen', key: 'nik', width: 18 }, { header: 'Nama', key: 'name', width: 30 }, { header: 'Jabatan', key: 'pos', width: 22 }, { header: 'Divisi', key: 'div', width: 22 }, { header: 'Tanggal Masuk', key: 'join', width: 16 }, { header: 'No. HP', key: 'phone', width: 18 }, { header: 'No. HP Darurat', key: 'emg', width: 18 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Jumlah Surat Izin', key: 'n', width: 16 }];
  for (const e of employees) s1.addRow({ nik: e.nik, name: e.name, pos: e.position || '', div: e.division || '', join: toDate(e.join), phone: e.phone || '', emg: e.emergency || '', status: e.active === false ? 'Nonaktif' : 'Aktif', n: (byNik.get(e.nik) || []).length });
  s1.getColumn('join').numFmt = DATE_FMT;
  style(s1, 9);

  const s2 = wb.addWorksheet('Data User');
  if (includeUsers) {
    s2.columns = [{ header: 'Username', key: 'u', width: 24 }, { header: 'Nama Lengkap', key: 'n', width: 30 }, { header: 'Peran', key: 'r', width: 14 }, { header: 'Status Akun', key: 's', width: 14 }, { header: 'Dibuat', key: 'c', width: 22 }];
    for (const u of users) s2.addRow({ u: u.username, n: u.full_name, r: u.role === 'admin' ? 'Admin' : 'Eksekutif', s: u.is_active ? 'Aktif' : 'Nonaktif', c: stamp(u.created_at) });
    style(s2, 5);
  } else { s2.addRow(['Data user hanya dapat diunduh oleh Admin.']); }

  const sorted = [...employees].filter(e => byNik.has(e.nik)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
  for (const e of sorted) {
    const list = byNik.get(e.nik).slice().sort((a, b) => String(a.data?.leave_start || '').localeCompare(String(b.data?.leave_start || '')) || new Date(a.created_at) - new Date(b.created_at));
    const ws = wb.addWorksheet(sheetName(e.name, used));
    ws.getCell('A1').value = e.name; ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = `NIK ${e.nik} · ${e.position || '-'} · ${e.division || '-'} · ${e.active === false ? 'Nonaktif' : 'Aktif'}`;
    const sum = CATEGORIES.map(c => { const rows = list.filter(f => catOf(f.data) === c); return `${c}: ${rows.length} surat / ${rows.reduce((t, f) => t + (Number(days(f.data.leave_start, f.data.leave_end)) || 0), 0)} hari`; });
    ws.getCell('A3').value = `Total ${list.length} surat — ` + sum.join(' | ');
    const H = 5;
    ws.getRow(H).values = ['No', 'Tgl Pengajuan', 'Kategori', 'Tgl Mulai', 'Tgl Selesai', 'Jam Pulang', 'Lama (hari)', 'Keperluan', 'Pengganti', 'Status Tanda Tangan', 'Ditandai Oleh', 'Dibuat'];
    [6, 16, 18, 14, 14, 12, 12, 40, 24, 22, 22, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    list.forEach((f, i) => { const d = f.data || {}; ws.addRow([i + 1, toDate(d.application_date), catOf(d), toDate(d.leave_start), toDate(d.leave_end), d.leave_time || '', days(d.leave_start, d.leave_end), d.purpose || '', d.replacement_name || '', f.is_signed ? 'Sudah ditandatangani' : 'Belum ditandatangani', f.signed_by_name || '', stamp(f.created_at)]); });
    [2, 4, 5].forEach(c => { ws.getColumn(c).numFmt = DATE_FMT; });
    style(ws, 12, H);
    ws.views = [{ state: 'frozen', ySplit: H }];
  }

  const all = wb.addWorksheet('Semua Izin');
  all.columns = [{ header: 'Tgl Pengajuan', width: 16 }, { header: 'Nama', width: 28 }, { header: 'NIK', width: 16 }, { header: 'Divisi', width: 20 }, { header: 'Kategori', width: 18 }, { header: 'Tgl Mulai', width: 14 }, { header: 'Tgl Selesai', width: 14 }, { header: 'Jam Pulang', width: 12 }, { header: 'Lama (hari)', width: 12 }, { header: 'Keperluan', width: 40 }, { header: 'Status Tanda Tangan', width: 22 }].map((c, i) => ({ ...c, key: 'c' + i }));
  for (const f of forms) { const d = f.data || {}; all.addRow([toDate(d.application_date), d.employee_name || '', d.employee_nik || '', d.division || '', catOf(d), toDate(d.leave_start), toDate(d.leave_end), d.leave_time || '', days(d.leave_start, d.leave_end), d.purpose || '', f.is_signed ? 'Sudah ditandatangani' : 'Belum ditandatangani']); }
  [1, 6, 7].forEach(c => { all.getColumn(c).numFmt = DATE_FMT; });
  style(all, 11);
  return wb;
}
