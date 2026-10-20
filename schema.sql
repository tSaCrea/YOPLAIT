CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  role TEXT NOT NULL,
  zone TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT 'Sans équipe',
  status TEXT NOT NULL DEFAULT 'dispo' CHECK (status IN ('dispo','tournee','pause','absent')),
  since TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT NOT NULL DEFAULT '',
  back_at TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'TTTTTTR' CHECK (plan ~ '^[TRC]{7}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS status_log (
  id BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_log_emp_at ON status_log (employee_id, at DESC);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT 'Sans équipe';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reset_hash TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reset_tries INT NOT NULL DEFAULT 0;
