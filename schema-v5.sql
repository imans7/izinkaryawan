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
