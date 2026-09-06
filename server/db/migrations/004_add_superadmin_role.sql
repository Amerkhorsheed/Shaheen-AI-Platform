-- 004 — Support the 'superadmin' role in the database and upgrade the root administrator.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'analyst', 'auditor', 'user'));

-- Upgrade the primary system administrator account to superadmin.
UPDATE users SET role = 'superadmin' WHERE username = 'admin';
