-- Izin Masuk IPK V4.0: dua peran (admin & executive), form izin offline-signature.
BEGIN;
CREATE SCHEMA IF NOT EXISTS personnel_desk;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='personnel_desk.users'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP EXECUTE format('ALTER TABLE personnel_desk.users DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
UPDATE personnel_desk.users SET role='executive', is_active=CASE WHEN role='employee' THEN false ELSE is_active END
WHERE role IN ('hrd','manager','employee');
ALTER TABLE personnel_desk.users ADD CONSTRAINT users_role_v4_check CHECK (role IN ('admin','executive'));
CREATE TABLE IF NOT EXISTS personnel_desk.absence_forms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_nik text NOT NULL REFERENCES personnel_desk.employees(nik) ON DELETE RESTRICT,
 data jsonb NOT NULL,
 created_by uuid REFERENCES personnel_desk.users(id) ON DELETE SET NULL,
 is_signed boolean NOT NULL DEFAULT false,
 signed_at timestamptz,
 signed_by uuid REFERENCES personnel_desk.users(id) ON DELETE SET NULL,
 signed_by_name text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS absence_forms_created_idx ON personnel_desk.absence_forms(created_at DESC);
CREATE INDEX IF NOT EXISTS absence_forms_employee_idx ON personnel_desk.absence_forms(employee_nik,created_at DESC);
COMMIT;
