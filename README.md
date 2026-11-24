# Personnel Desk 2.2 — Neon Database

Aplikasi manajemen karyawan dan pengajuan izin, frontend HTML/CSS/JavaScript, API Node.js, PostgreSQL Neon. Dibuat untuk deployment Vercel. Jangan membuka `public/index.html` langsung sebagai file karena API tidak akan tersedia.

## Update dari versi 2.1 (deployment yang sudah berjalan)

- Backup JSON terlebih dahulu. Ganti `public/index.html` dan `lib/validation.js` di repository yang sama (opsional: `package.json` dan README untuk versi). Commit keduanya bersama lalu deploy ulang. **Tidak perlu menjalankan schema.sql, restore, membuat database baru atau mengganti environment variables**. Field baru disimpan dalam JSONB yang sudah ada. Jangan menggunakan frontend baru dengan validator server lama karena jabatan akan hilang saat penyimpanan.
- Edit profil karyawan untuk memilih jabatan HRD/Manager/Supervisor (opsional). Banyak orang boleh memiliki jabatan sama. Dalam surat baru, pilihan satu divisi diutamakan; satu kandidat dalam kelompok prioritas terpilih otomatis. Jika ada beberapa, pilih manual. HRD dapat lintas divisi; tanpa divisi dianggap umum. Manager/Supervisor divisi lain tetap dapat dipilih secara manual. Pejabat nonaktif dan pemohon tidak ditawarkan. Surat lama tetap menyimpan nama historis.
- Kolom Jabatan opsional di impor master (template lama tetap diterima; jika kolom tidak ada, jabatan lama dipertahankan). Backup Excel/JSON menyertakan jabatan serta NIK internal pejabat. Backup lama tetap dapat dipulihkan, tetapi restore mengganti database; tidak diperlukan untuk upgrade.
- Dropdown pengganti menampilkan nama/divisi/NIK untuk membedakan nama sama; surat PDF/Excel hanya mencetak nama pengganti. NIK pemohon tetap di No. Absen sesuai template. Template asli dan ukuran F revisi tidak diubah.

## 1. Neon

1. Buat/buka project di https://console.neon.tech/ . Pilih branch dan database tujuan. Untuk pemakaian produksi disarankan branch/database khusus agar terpisah dari proyek lain.
2. Buka SQL Editor, pastikan branch/database benar. Salin isi `schema.sql`, lalu Run. Skrip membuat schema `personnel_desk` dengan tabel `employees`, `leaves`, `state`, dan fungsi transaksi `save_database`. Tidak ada DROP/TRUNCATE pada skrip ini. Menjalankan ulang skrip tidak menghapus data yang sudah tersimpan.
3. Di halaman Connect, pilih connection string pooled (PostgreSQL), lalu salin. Jangan mengirim connection string atau password ke publik.

## 2. GitHub dan Vercel

1. Ekstrak ZIP. Buat repository private di https://github.com/new dan upload **isi** folder `personnel-desk-final`, termasuk `api`, `lib`, `public`, `package.json`, `schema.sql`, `vercel.json`, `.gitignore`. Jangan upload `.env` dengan kredensial asli. `.env.example` hanya contoh.
2. Di https://vercel.com/new , import repository tersebut. Framework Preset: Other; Root Directory: folder yang memuat `package.json`; Node.js: 22.x. `vercel.json` telah mengatur output `public` dan build command.
3. Pada Environment Variables, tambahkan:

| Nama | Isi |
|---|---|
| `DATABASE_URL` | Connection string pooled dari Neon, lengkap dengan SSL |
| `APP_PASSWORD` | Password akses HRD yang kuat, acak, minimal 16 karakter ASCII; buat sendiri |

Pilih Production (dan Development/Preview hanya jika memakai database yang tepat). Jangan menambahkan `NEXT_PUBLIC_` atau `VITE_` ke variabel ini. URL database tidak pernah masuk ke frontend.

4. Klik Deploy. Buka URL deployment dan masukkan APP_PASSWORD. Jika menambahkan variabel setelah deploy, lakukan Redeploy.
5. Uji satu karyawan dan satu pengajuan contoh. Buka ulang di browser lain dan masukkan password yang sama untuk melihat data. Hapus pengajuan contoh setelah uji bila diperlukan.

## 3. Menjalankan lokal (opsional)

Install Node.js 22, jalankan `npm install` di root proyek. Salin `.env.example` ke `.env.local` dan isi dengan nilai sebenarnya. Gunakan `npx vercel dev` (login Vercel dan link project bila diminta). Database tetap Neon, bukan LocalStorage. Hindari menjalankan uji pada database produksi.

## 4. Alur penggunaan

- Download Template Excel untuk master karyawan; isi NIK dan nomor HP sebagai teks agar angka nol awal tidak hilang. Gunakan tanggal YYYY-MM-DD atau DD/MM/YYYY.
- Impor Excel/CSV. NIK yang telah ada diperbarui; riwayat izin tetap tersimpan. Status karyawan dapat diubah melalui Edit Profil.
- Klik karyawan, Buat Surat Izin, isi tanggal, kategori, keperluan dan pengganti. Bagian persetujuan dapat diedit sesudahnya.
- Klik Simpan. Setelah Neon mengonfirmasi penyimpanan, pratinjau muncul. Pilih Cetak/Simpan PDF (A4) atau Download Excel.
- Surat Excel memakai blok formulir kosong pada baris 27–48 dari template perusahaan yang diunggah, dipindah menjadi baris 1–22 untuk satu surat per file. Logo, style, garis, ukuran kolom, tinggi baris, merged cells asli dan tabel tanda tangan dipertahankan. Untuk isian panjang, area nilai bisa digabung dan tinggi baris ditambah agar teks terlihat. No. Absen diisi NIK. PDF/HTML adalah reproduksi tampilan; file Excel memakai template asli. Keterangan kategori dimasukkan bersama keperluan.
- Backup & Restore mendukung JSON dan workbook Excel backup (bukan file surat). Restore mengganti database aplikasi setelah konfirmasi. Backup dulu sebelum restore.
- Untuk memindahkan data dari aplikasi HTML lama: buka aplikasi lama pada browser asal, gunakan Backup JSON, kemudian Restore JSON di versi Neon. Impor master Excel saja tidak memindahkan riwayat. Jangan hapus data browser lama sampai migrasi diverifikasi.
- Tombol Muat ulang mengambil versi terbaru dari Neon. Jika data berubah pada perangkat lain sebelum disimpan, aplikasi menolak penyimpanan konflik; tutup formulir, klik Muat ulang dan ulangi perubahan.

## 5. Struktur

```
personnel-desk-final/
  api/database.js          # API GET/PUT berpassword, komunikasi Neon
  lib/validation.js        # validasi server untuk karyawan dan izin
  public/index.html        # dashboard, formulir, impor, cetak, backup
  public/template-form.json # paket OOXML template, tanpa data contoh lama
  public/logo.jpeg         # logo dari template
  schema.sql               # inisialisasi Neon, transaksi dan revision lock
  package.json
  vercel.json
  .env.example
  .gitignore
```

NIK adalah primary key pada `personnel_desk.employees`. Riwayat izin memakai ID pengajuan unik dan foreign key NIK; snapshot identitas mempertahankan data surat lama. Penyimpanan diproses atomik di PostgreSQL; tidak ada fallback LocalStorage. API memvalidasi payload dan versi data. Aplikasi mengirim snapshot database per penyimpanan, dengan batas permintaan sekitar 4 MB; untuk volume besar gunakan API per record dan pagination.

## 6. Catatan keamanan dan batasan

- Versi ini memakai satu kata sandi akses internal (HRD/admin bersama), bukan akun individual, bukan RBAC, dan belum mempunyai audit log per pengguna. Nama HRD/Manager/Supervisor adalah field dokumen, bukan tanda tangan digital atau autentikasi masing-masing pejabat.
- Jangan gunakan akses publik tanpa kontrol organisasi. Gunakan HTTPS Vercel, password acak yang kuat, batasi siapa yang mengetahui password, dan pertimbangkan SSO/role, rate limiting serta audit log sebelum pemakaian produksi berskala besar. Backup berisi data pribadi; simpan di tempat yang terlindungi.
- Koneksi Neon nyata belum diuji karena tidak ada kredensial/project Neon yang diberikan. Pengujian deployment Neon produksi perlu dilakukan pada project Anda setelah update.
