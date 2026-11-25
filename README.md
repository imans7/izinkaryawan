# Personnel Desk V4.0 — Form Surat Izin Tidak Masuk

Versi ini merombak V3 menjadi sistem internal dengan **dua peran saja: Admin dan Eksekutif**. Tidak ada login karyawan, HRD, atau Manajer.

## Perubahan utama
- Admin membuat akun Eksekutif; hanya Admin yang dapat membuat, mengedit, menonaktifkan akun Eksekutif.
- Karyawan tidak mengakses aplikasi. Karyawan menyampaikan izin kepada Admin secara offline/lisan/WA, lalu Admin membuat Form Surat Izin Tidak Masuk.
- Admin dan Eksekutif dapat melihat data karyawan dan seluruh Form Surat Izin.
- Admin dapat menandai status tanda tangan offline: belum/sudah ditandatangani. Perubahan disimpan di Neon beserta waktu dan akun yang menandai.
- Admin dapat membuat surat, mencetak/menyimpan PDF melalui dialog print browser, dan mengunduh Excel berdasarkan template perusahaan yang dilampirkan.
- Eksekutif bersifat read-only: melihat data karyawan, form, laporan, dan mengunduh dokumen. Tidak dapat membuat atau mengubah data.
- Master karyawan tetap menggunakan NIK sebagai primary key internal. NIK tampil pada baris No. Absen pada surat sesuai template.

## Struktur
- `api/portal.js`: API login, role access, CRUD karyawan, akun eksekutif, form surat, tanda tangan, Excel.
- `public/index.html`: UI V3-style, dashboard, tabel, form, preview, print.
- `public/template-form.xlsx`: template Excel asli (logo, layout, border, signature slots); export uses the blank form region.
- `schema-v4.sql`: migrasi additive untuk dua peran dan tabel form.

## Upgrade dari V3
1. Backup database Neon (disarankan).
2. Jalankan `schema-v4.sql` di SQL Editor pada database/branch Neon yang sama.
   - Role HRD dan Manajer yang sudah ada dipetakan menjadi Eksekutif.
   - Akun Karyawan lama dinonaktifkan dan role diset ke Eksekutif nonaktif agar tidak dapat login.
   - Tabel lama karyawan, surat/riwayat V2, dan tabel workflow V3 tidak dihapus.
3. Timpa isi repository GitHub dengan isi folder project ini.
4. Pastikan Environment Variables Vercel tetap ada:
   - `DATABASE_URL` (Neon pooled connection string)
   - `SESSION_SECRET` (minimal 32 karakter)
   - `ADMIN_USERNAME` (opsional, default `admin`)
   - `ADMIN_PASSWORD` atau `APP_PASSWORD` (wajib jika belum ada akun Admin aktif; minimal 12 karakter)
5. Deploy ulang Vercel dan buka domain Production.

## Akun
- Jika akun Admin V3 sudah ada, akun tersebut tetap dapat digunakan dengan password yang sama.
- Jika belum ada Admin aktif, bootstrap membuatnya dari `ADMIN_USERNAME` dan `ADMIN_PASSWORD` (fallback `APP_PASSWORD`).
- Admin membuat akun Eksekutif dari menu Data Eksekutif.

## Catatan penting
- Status tanda tangan adalah pencatatan administrasi; tanda tangan fisik tetap dilakukan di kertas.
- PDF dibuat melalui print browser (pilih Save as PDF).
- Nomor telepon, NIK, dan data karyawan tersimpan di Neon. Batasi akses dan gunakan password kuat.
- Template Excel disimpan sebagai asset aplikasi; export mengisi formulir kosong pada template dan menetapkan print area A4.
