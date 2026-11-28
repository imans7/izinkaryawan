// Perhitungan hari kerja & kuota cuti (fungsi murni, dipakai server untuk Excel, pratinjau, dan rekap).
const D = 86400000;
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const toUtc = s => new Date(`${s}T00:00:00Z`);
const fmtYmd = d => d.toISOString().slice(0, 10);

export const defaultSettings = () => ({ annual_quota: 12, collective_days: 0, saturday_work: true });

// Jumlah hari kerja pada rentang [start,end] yang jatuh di tahun `year`.
// Hari Minggu, tanggal merah (holidaySet), dan (opsional) Sabtu tidak dihitung.
export function workdays(start, end, year, holidaySet = new Set(), saturdayWork = true) {
  if (!isYmd(start)) return 0;
  const e = isYmd(end) ? end : start;
  let a = toUtc(start < `${year}-01-01` ? `${year}-01-01` : start);
  const b = toUtc(e > `${year}-12-31` ? `${year}-12-31` : e);
  let n = 0;
  for (let t = +a; t <= +b; t += D) {
    const d = new Date(t), dow = d.getUTCDay();
    if (dow === 0 || (dow === 6 && !saturdayWork) || holidaySet.has(fmtYmd(d))) continue;
    n++;
  }
  return n;
}

const before = (x, f) => x.data.leave_start < f.data.leave_start || (x.data.leave_start === f.data.leave_start && new Date(x.created_at) < new Date(f.created_at));
const idLong = ymd => new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toUtc(ymd));
export const rangeText = (s, e) => (!s ? '' : e && e !== s ? `${idLong(s)} s/d ${idLong(e)}` : idLong(s));

// Rincian kuota untuk satu pengajuan cuti (tahun kuota = tahun tanggal mulai).
export function quotaFor({ form, cutiForms, settings, adjustDays = 0, holidaySet }) {
  const d = form.data, year = Number(String(d.leave_start).slice(0, 4));
  const st = { ...defaultSettings(), ...settings };
  const wd = (s, e) => workdays(s, e, year, holidaySet, st.saturday_work);
  const prior = cutiForms.filter(x => x.id !== form.id && x.employee_nik === form.employee_nik && before(x, form));
  const tahunan = Number(st.annual_quota) + Number(adjustDays), bersama = Number(st.collective_days);
  const diambil = prior.reduce((t, x) => t + wd(x.data.leave_start, x.data.leave_end), 0);
  const akan = wd(d.leave_start, d.leave_end);
  const sisaBelum = tahunan - bersama;
  const last = [...prior].sort((a, b) => String(b.data.leave_start).localeCompare(String(a.data.leave_start)))[0];
  return { year, tahunan, bersama, sisaBelum, diambil, akan, sisa: sisaBelum - diambil - akan, sebelumnya: last ? rangeText(last.data.leave_start, last.data.leave_end) : '' };
}

// Rekap kuota per karyawan untuk satu tahun (tanpa pengajuan tertentu).
export function summaryFor({ employees, cutiForms, settings, adjByNik, holidaySet, year }) {
  const st = { ...defaultSettings(), ...settings };
  return employees.map(e => {
    const mine = cutiForms.filter(x => x.employee_nik === String(e.nik));
    const taken = mine.reduce((t, x) => t + workdays(x.data.leave_start, x.data.leave_end, year, holidaySet, st.saturday_work), 0);
    const adj = Number(adjByNik.get(String(e.nik)) || 0);
    const tahunan = Number(st.annual_quota) + adj, bersama = Number(st.collective_days);
    return { nik: String(e.nik), name: e.name, division: e.division || '', active: e.active !== false, adjust: adj, tahunan, bersama, diambil: taken, sisa: tahunan - bersama - taken, forms: mine.filter(x => workdays(x.data.leave_start, x.data.leave_end, year, holidaySet, st.saturday_work) > 0).length };
  });
}
