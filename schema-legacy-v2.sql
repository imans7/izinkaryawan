-- Run once in Neon SQL Editor, on the intended branch/database.
-- Dedicated schema avoids interfering with other applications. Safe to rerun.
BEGIN;
CREATE SCHEMA IF NOT EXISTS personnel_desk;
CREATE TABLE IF NOT EXISTS personnel_desk.employees (
  nik text PRIMARY KEY CHECK (length(nik) BETWEEN 1 AND 120),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'nik' = nik),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS personnel_desk.leaves (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  nik text NOT NULL REFERENCES personnel_desk.employees(nik) ON DELETE RESTRICT,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data->>'id' = id AND data->>'nik' = nik),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personnel_desk_leaves_nik_idx ON personnel_desk.leaves(nik);
CREATE TABLE IF NOT EXISTS personnel_desk.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  revision integer NOT NULL DEFAULT 0
);
INSERT INTO personnel_desk.state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
-- Serialized optimistic write. An out-of-date browser cannot overwrite new data.
CREATE OR REPLACE FUNCTION personnel_desk.save_database(expected_revision integer, payload jsonb, is_restore boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, personnel_desk AS $$
DECLARE current_revision integer;
BEGIN
  SELECT revision INTO current_revision FROM personnel_desk.state WHERE singleton FOR UPDATE;
  IF current_revision IS DISTINCT FROM expected_revision THEN RETURN -1; END IF;
  IF NOT is_restore AND EXISTS (SELECT 1 FROM personnel_desk.employees e WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'employees') x WHERE x->>'nik'=e.nik)) THEN
    RAISE EXCEPTION 'Employee removal requires explicit restore';
  END IF;
  INSERT INTO personnel_desk.employees(nik,data)
    SELECT x->>'nik',x FROM jsonb_array_elements(payload->'employees') x
    ON CONFLICT(nik) DO UPDATE SET data=EXCLUDED.data,updated_at=now() WHERE employees.data IS DISTINCT FROM EXCLUDED.data;
  INSERT INTO personnel_desk.leaves(id,nik,data)
    SELECT x->>'id',x->>'nik',x FROM jsonb_array_elements(payload->'leaves') x
    ON CONFLICT(id) DO UPDATE SET nik=EXCLUDED.nik,data=EXCLUDED.data,updated_at=now() WHERE leaves.data IS DISTINCT FROM EXCLUDED.data OR leaves.nik IS DISTINCT FROM EXCLUDED.nik;
  DELETE FROM personnel_desk.leaves l WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'leaves') x WHERE x->>'id'=l.id);
  IF is_restore THEN
    DELETE FROM personnel_desk.employees e WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'employees') x WHERE x->>'nik'=e.nik);
  END IF;
  UPDATE personnel_desk.state SET revision=revision+1 WHERE singleton RETURNING revision INTO current_revision;
  RETURN current_revision;
END;
$$;
COMMIT;
