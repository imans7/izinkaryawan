# Personnel Desk V3.0 — Sistem Manajemen & Persetujuan Izin Karyawan

Personnel Desk V3 memperluas Personnel Desk V2.3 menjadi aplikasi multi-peran dengan alur persetujuan dua tahap. Stack: HTML/CSS/JavaScript, Vercel Serverless Functions, Neon PostgreSQL, dan QR Code.

## Fitur V3.0

### Empat peran
- **Karyawan:** scan QR, login, mengisi formulir izin keluar, melihat status dan riwayat, memperbaiki pengajuan yang ditolak, serta mencetak/menyimpan surat PDF setelah disetujui.
- **Admin:** ringkasan, seluruh surat izin, laporan dan ekspor Excel, manajemen akun, master karyawan, pengaturan QR, profil, dan ubah password.
- **HRD:** antrean verifikasi tahap 1, setujui untuk meneruskan ke Manajer atau tolak dengan alasan.
- **Manajer:** antrean verifikasi tahap 2, setujui sebagai keputusan akhir atau tolak dengan alasan.

### Alur dan status
`menunggu_hrd` → `menunggu_manager` → `disetujui` / `ditolak`.

Jika HRD atau Manajer menolak, karyawan menerima notifikasi dan dapat memperbaiki lalu mengirim ulang. Pengiriman ulang mengembalikan status ke `menunggu_hrd`; catatan dan riwayat keputusan sebelumnya tetap tercatat di workflow history.

### Master karyawan
Admin dapat menambah/mengedit master karyawan, mengimpor Excel/CSV dengan NIK sebagai kunci update, mengunduh template Excel, dan mengekspor master ke Excel. Baris yang tidak ada dalam file impor tidak dihapus.

### Formulir QR
- Nama, jabatan, dan divisi ditarik dari master karyawan yang terhubung dengan akun.
- Tanggal izin dapat dipilih; jam keluar dicatat otomatis oleh server saat pengajuan disimpan (Asia/Jakarta).
- Jam kembali, keperluan, dan nomor WhatsApp diisi karyawan.
- QR umum membuka halaman login; setelah karyawan login, formulir pengajuan langsung dibuka.

### Notifikasi
Notifikasi tersimpan di Neon dan muncul di dalam aplikasi untuk karyawan, HRD, dan Manajer. Nomor WhatsApp dicatat dalam pengajuan, tetapi **pengiriman pesan WhatsApp otomatis belum diaktifkan** karena memerlukan integrasi WhatsApp Business/API provider dan kredensial tersendiri.

### Surat PDF
Surat hanya tersedia setelah Manajer menyetujui. Tombol PDF membuka dialog cetak browser; pilih **Save as PDF / Simpan sebagai PDF** untuk mengunduh.

### Penugasan HRD/Manajer berdasarkan divisi
- Akun HRD/Manajer yang dihubungkan ke salah satu karyawan master hanya menerima/memproses pengajuan dari divisi karyawan tersebut.
- Akun HRD/Manajer tanpa tautan NIK menjadi akun global yang dapat menangani semua divisi.
- Bisa ada beberapa akun HRD atau Manajer pada satu divisi.
- Pengajuan baru tidak dapat dikirim jika belum ada HRD dan Manajer aktif yang sesuai dengan divisi pemohon.

## Penting sebelum upgrade dari V2.3

1. Buat backup dari aplikasi V2.3 sebagai tindakan pencegahan.
2. Gunakan **Neon branch dan database yang sama** dengan Personnel Desk V2.3. Jangan membuat project database baru.
3. V3 mempertahankan tabel lama `employees`, `leaves`, dan `state`. Riwayat formulir lama ditampilkan pada menu **Arsip Izin Lama** Admin.
4. Jangan jalankan `schema-legacy-v2.sql` lagi. File itu hanya disertakan sebagai referensi skema lama.
5. Jalankan `schema-v3.sql` satu kali di Neon SQL Editor. Skrip ini bersifat additive: membuat tabel akun, pengajuan QR, notifikasi, riwayat alur, pengaturan, dan fungsi upsert master karyawan. Tidak ada DROP/TRUNCATE dan tidak menghapus data V2.3.

## 1. Migrasi Neon

1. Buka https://console.neon.tech/ .
2. Pilih project, branch, dan database yang saat ini dipakai V2.3.
3. Buka **SQL Editor**.
4. Salin seluruh isi `schema-v3.sql`, lalu klik **Run**.
5. Pastikan query selesai tanpa error. Jangan menjalankan migrasi pada branch/database yang berbeda dari `DATABASE_URL` Vercel.

## 2. Deploy ke GitHub dan Vercel

1. Ekstrak ZIP.
2. Upload **isi folder** `personnel-desk-final` ke root repository GitHub yang sudah terhubung ke project Vercel. Pastikan folder `api`, `lib`, dan `public` ikut terunggah.
3. Commit dan push ke production branch (biasanya `main`).
4. Vercel akan memasang dependency `@neondatabase/serverless` dan `qrcode` dari `package.json`, lalu melakukan deployment.
5. Tunggu deployment Production berstatus **Ready**. Buka domain produksi dan lakukan hard refresh (`Ctrl + F5`).

Pengaturan Vercel:
- Framework Preset: Other
- Root Directory: folder yang berisi `package.json`
- Build Command: `npm run build`
- Output Directory: `public`
- Node.js: 22.x

## 3. Environment Variables Vercel

Pertahankan `DATABASE_URL` Neon pooled yang sudah dipakai V2.3. Jangan mengubahnya jika sudah benar.

| Variable | Nilai |
|---|---|
| `DATABASE_URL` | Connection string pooled Neon yang sudah digunakan V2.3 |
| `APP_PASSWORD` | Password lama V2.3; dipakai untuk membuat akun Admin pertama jika `ADMIN_PASSWORD` tidak diisi |
| `ADMIN_USERNAME` | Opsional; default `admin` |
| `ADMIN_PASSWORD` | Opsional; password awal Admin. Jika diisi, gunakan minimal 16 karakter; ini yang dipakai sebagai password awal |
| `SESSION_SECRET` | Sangat disarankan: string acak minimal 32 karakter untuk menandatangani sesi login |
| `ADMIN_NAME` | Opsional; nama tampilan Admin awal, default `Administrator` |

`APP_PASSWORD` lama minimal 16 karakter sesuai pemeriksaan V2.3. Jika ingin mengganti APP_PASSWORD atau menghapusnya setelah upgrade, atur `SESSION_SECRET` terlebih dahulu. Jika `SESSION_SECRET` tidak diisi, aplikasi memakai `APP_PASSWORD` atau `ADMIN_PASSWORD` sebagai fallback.

Setelah mengubah Environment Variables, lakukan Redeploy.

## 4. Login pertama dan pembuatan akun

Jika belum ada akun Admin V3, API membuat akun pertama secara otomatis saat percobaan login pertama:
- Username: `ADMIN_USERNAME` atau `admin`.
- Password: `ADMIN_PASSWORD` jika tersedia; jika tidak, gunakan nilai `APP_PASSWORD` lama V2.3.

Setelah login Admin:

1. Buka **Data Pengguna**.
2. Buat minimal satu akun HRD dan satu akun Manajer.
3. Untuk HRD/Manajer yang hanya bertanggung jawab pada satu divisi, tautkan akun ke data karyawan master dari divisi tersebut. Biarkan tautan NIK kosong untuk akun global.
4. Buat akun Karyawan dan hubungkan ke NIK yang tepat pada master karyawan. Setiap karyawan hanya boleh memiliki satu akun Karyawan.
5. Berikan username dan password awal kepada pemilik akun melalui jalur internal yang aman. Pengguna dapat mengubah password sendiri melalui Profil.

Pastikan data master karyawan dan divisi sudah benar sebelum membuat akun HRD/Manajer berbasis divisi.

## 5. Menggunakan QR

1. Login sebagai Admin.
2. Buka **Pengaturan & QR**.
3. Pastikan formulir QR berstatus Aktif.
4. Cetak atau bagikan QR yang tampil. Link QR mengarah ke `/?scan=1` pada domain produksi.
5. Karyawan scan QR, login dengan akun Karyawan, kemudian formulir terbuka otomatis.
6. Setelah submit, sistem mencatat jam keluar dari waktu server. Karyawan dan HRD yang sesuai divisi menerima notifikasi dalam aplikasi.

Jika formulir ditutup dari Pengaturan, pengajuan baru akan ditolak oleh API meskipun QR lama masih beredar.

## 6. Pengelolaan pengajuan

- HRD memeriksa antrean `menunggu_hrd`. Setujui untuk meneruskan ke Manajer, atau tolak dengan alasan yang wajib diisi.
- Manajer memeriksa antrean `menunggu_manager`. Setujui untuk menyelesaikan proses, atau tolak dengan alasan.
- Karyawan melihat semua perubahan status dan catatan penolakan di Riwayat Pengajuan.
- Pengajuan ditolak dapat diperbaiki dan dikirim ulang. Riwayat penolakan sebelumnya tidak dihapus.
- Surat PDF tersedia setelah status `disetujui`.
- Admin dapat memfilter laporan berdasarkan tanggal/status dan mengunduh Excel.

## 7. Keamanan dan catatan operasional

- Password disimpan sebagai hash scrypt dengan salt acak; password plaintext tidak disimpan.
- Login menggunakan cookie sesi HttpOnly, Secure di Vercel, SameSite=Strict, masa berlaku 12 jam.
- Percobaan login dibatasi secara persisten di Neon; setelah beberapa percobaan gagal akun/IP terkait ditahan sementara.
- Semua aksi baca/tulis dibatasi berdasarkan peran di backend, bukan hanya disembunyikan di tampilan.
- Keputusan HRD/Manajer dicatat di `workflow_events`; status, waktu, dan catatan penolakan tersimpan di Neon.
- Penghapusan akun dilakukan dengan menonaktifkan akun, bukan menghapus histori persetujuan.
- Endpoint snapshot V2 `/api/database` dinonaktifkan pada V3 agar login bersama V2 tidak menjadi jalur bypass RBAC. Frontend V3 menggunakan `/api/portal`.
- Simpan `DATABASE_URL`, `APP_PASSWORD`, `ADMIN_PASSWORD`, dan `SESSION_SECRET` hanya di Environment Variables Vercel. Jangan commit `.env` ke GitHub.
- Pengujian pada Neon produksi harus dilakukan setelah migrasi dan deployment di project Anda; lingkungan ini tidak memiliki akses ke kredensial Neon Anda.

## Struktur folder

```text
personnel-desk-final/
  api/
    portal.js             # API auth, role access, requests, approvals, notifications
    database.js          # menonaktifkan endpoint snapshot V2
  lib/
    validation.js        # validator lama sebagai referensi kompatibilitas
  public/
    index.html            # aplikasi V3
    logo.jpeg
    template-form.json    # aset template lama
  schema-v3.sql           # migrasi additive V3
  schema-legacy-v2.sql    # arsip skema V2.3; jangan dijalankan ulang
  package.json
  vercel.json
  .env.example
```
