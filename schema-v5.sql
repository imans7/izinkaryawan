-- Personnel Desk V4.2 — tabel tambahan (opsional: API juga membuatnya otomatis saat pertama dipakai)
CREATE TABLE IF NOT EXISTS personnel_desk.holidays (
  day date PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS personnel_desk.signatures (
  name_key text PRIMARY KEY,           -- nama dalam huruf kecil, spasi dirapikan
  name text NOT NULL,
  image_base64 text NOT NULL,          -- PNG (maks. 300 KB)
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- V4.3: jenis tanggal merah, pengaturan kuota per tahun, dan cuti khusus per karyawan
ALTER TABLE personnel_desk.holidays ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'libur'; -- libur | cuti_bersama | perusahaan
CREATE TABLE IF NOT EXISTS personnel_desk.leave_settings (
  year int PRIMARY KEY,
  annual_quota numeric NOT NULL DEFAULT 12,
  collective_days numeric NOT NULL DEFAULT 0,
  saturday_work boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS personnel_desk.leave_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  employee_nik text NOT NULL,
  days numeric NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_adjustments_year_idx ON personnel_desk.leave_adjustments(year, employee_nik);
