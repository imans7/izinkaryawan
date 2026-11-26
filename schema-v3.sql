-- Izin Masuk IPK V3.0 - additive migration for Neon PostgreSQL
-- Run once in the SAME Neon branch/database used by Izin Masuk IPK V2.3.
-- This script preserves existing employees, leaves, state, and all legacy records.
BEGIN;
CREATE SCHEMA IF NOT EXISTS personnel_desk;

-- Individual accounts and role-based access control.
CREATE TABLE IF NOT EXISTS personnel_desk.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (length(username) BETWEEN 3 AND 80),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 180),
  role text NOT NULL CHECK (role IN ('admin','hrd','manager','employee')),
  employee_nik text REFERENCES personnel_desk.employees(nik) ON DELETE RESTRICT,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS personnel_desk_one_employee_login_idx
  ON personnel_desk.users(employee_nik) WHERE role='employee' AND employee_nik IS NOT NULL;
CREATE INDEX IF NOT EXISTS personnel_desk_users_role_active_idx
  ON personnel_desk.users(role,is_active);

-- New QR-based short-exit/permission requests. Legacy leave letters stay in personnel_desk.leaves.
CREATE TABLE IF NOT EXISTS personnel_desk.exit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_nik text NOT NULL REFERENCES personnel_desk.employees(nik) ON DELETE RESTRICT,
  employee_name text NOT NULL,
  position text NOT NULL DEFAULT '',
  division text NOT NULL DEFAULT '',
  request_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  exit_at timestamptz NOT NULL DEFAULT now(),
  return_time time NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  whatsapp text NOT NULL CHECK (length(whatsapp) BETWEEN 6 AND 40),
  status text NOT NULL DEFAULT 'menunggu_hrd'
    CHECK (status IN ('menunggu_hrd','menunggu_manager','disetujui','ditolak')),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  rejection_stage text CHECK (rejection_stage IN ('hrd','manager')),
  hrd_user_id uuid REFERENCES personnel_desk.users(id) ON DELETE SET NULL,
  hrd_name text NOT NULL DEFAULT '',
  hrd_reviewed_at timestamptz,
  hrd_note text NOT NULL DEFAULT '',
  manager_user_id uuid REFERENCES personnel_desk.users(id) ON DELETE SET NULL,
  manager_name text NOT NULL DEFAULT '',
  manager_reviewed_at timestamptz,
  manager_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE personnel_desk.exit_requests ADD COLUMN IF NOT EXISTS hrd_name text NOT NULL DEFAULT '';
ALTER TABLE personnel_desk.exit_requests ADD COLUMN IF NOT EXISTS manager_name text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS personnel_desk_exit_requests_employee_idx
  ON personnel_desk.exit_requests(employee_nik,created_at DESC);
CREATE INDEX IF NOT EXISTS personnel_desk_exit_requests_queue_idx
  ON personnel_desk.exit_requests(status,created_at ASC);
CREATE INDEX IF NOT EXISTS personnel_desk_exit_requests_date_idx
  ON personnel_desk.exit_requests(request_date DESC);

-- In-app notifications delivered to each role/user.
CREATE TABLE IF NOT EXISTS personnel_desk.notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES personnel_desk.users(id) ON DELETE CASCADE,
  request_id uuid REFERENCES personnel_desk.exit_requests(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  notification_type text NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personnel_desk_notifications_user_idx
  ON personnel_desk.notifications(user_id,created_at DESC);

-- Immutable workflow history/audit trail.
CREATE TABLE IF NOT EXISTS personnel_desk.workflow_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES personnel_desk.exit_requests(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES personnel_desk.users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personnel_desk_workflow_events_request_idx
  ON personnel_desk.workflow_events(request_id,created_at ASC);


-- Basic persistent login throttling by username + source IP hash.
CREATE TABLE IF NOT EXISTS personnel_desk.auth_attempts (
  attempt_key text PRIMARY KEY,
  fail_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

-- Admin-controlled public QR form setting.
CREATE TABLE IF NOT EXISTS personnel_desk.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO personnel_desk.settings(key,value)
VALUES ('public_form_enabled','true'::jsonb),('company_name','"Izin Masuk IPK"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Update a master employee without deleting legacy leave history; increments V2 snapshot revision.
CREATE OR REPLACE FUNCTION personnel_desk.upsert_employee(payload jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, personnel_desk AS $$
DECLARE new_revision integer;
BEGIN
  IF COALESCE(payload->>'nik','')='' OR COALESCE(payload->>'name','')='' THEN
    RAISE EXCEPTION 'NIK dan nama karyawan wajib diisi';
  END IF;
  INSERT INTO personnel_desk.employees(nik,data)
  VALUES (payload->>'nik',payload)
  ON CONFLICT(nik) DO UPDATE SET data=EXCLUDED.data,updated_at=now();
  UPDATE personnel_desk.state SET revision=revision+1 WHERE singleton RETURNING revision INTO new_revision;
  RETURN COALESCE(new_revision,0);
END;
$$;


CREATE OR REPLACE FUNCTION personnel_desk.upsert_employees(payload jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, personnel_desk AS $$
DECLARE item jsonb; new_revision integer;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'array' OR jsonb_array_length(payload)>2000 THEN
    RAISE EXCEPTION 'Impor harus berupa array maksimal 2.000 karyawan';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
    IF COALESCE(item->>'nik','')='' OR COALESCE(item->>'name','')='' THEN
      RAISE EXCEPTION 'NIK dan nama karyawan wajib diisi pada seluruh baris impor';
    END IF;
    INSERT INTO personnel_desk.employees(nik,data)
    VALUES(item->>'nik',item)
    ON CONFLICT(nik) DO UPDATE SET data=EXCLUDED.data,updated_at=now();
  END LOOP;
  UPDATE personnel_desk.state SET revision=revision+1 WHERE singleton RETURNING revision INTO new_revision;
  RETURN COALESCE(new_revision,0);
END;
$$;

COMMIT;
