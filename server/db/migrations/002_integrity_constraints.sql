-- 002 — Enforce the domain rules in the database itself.
--
-- These values were previously validated only in JavaScript. A constraint here
-- means a bug, a migration script or a direct psql session cannot leave a row
-- in a state the application considers impossible — for example a chat marked
-- with a classification the UI cannot render, or a user with no valid role.

-- Normalise any pre-existing rows before the constraints are applied, so the
-- migration cannot fail on legacy data.
UPDATE users  SET role   = 'user'     WHERE role   IS NULL OR role   NOT IN ('admin', 'analyst', 'auditor', 'user');
UPDATE users  SET status = 'active'   WHERE status IS NULL OR status NOT IN ('active', 'suspended');
UPDATE chats  SET classification = 'official'
  WHERE classification IS NULL OR classification NOT IN ('top_secret', 'secret', 'official', 'unclassified');
UPDATE categories SET clearance_level = 'official'
  WHERE clearance_level IS NULL OR clearance_level NOT IN ('top_secret', 'secret', 'official', 'unclassified');
UPDATE messages SET role = 'user' WHERE role NOT IN ('user', 'assistant', 'system');
UPDATE document_registry SET kind = 'document' WHERE kind NOT IN ('document', 'dataset');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('admin', 'analyst', 'auditor', 'user'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'suspended'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_classification_check') THEN
    ALTER TABLE chats ADD CONSTRAINT chats_classification_check
      CHECK (classification IN ('top_secret', 'secret', 'official', 'unclassified'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_clearance_check') THEN
    ALTER TABLE categories ADD CONSTRAINT categories_clearance_check
      CHECK (clearance_level IN ('top_secret', 'secret', 'official', 'unclassified'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_role_check') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_role_check
      CHECK (role IN ('user', 'assistant', 'system'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_registry_kind_check') THEN
    ALTER TABLE document_registry ADD CONSTRAINT document_registry_kind_check
      CHECK (kind IN ('document', 'dataset'));
  END IF;

  -- One serial per reference per year; makes a duplicate reference number
  -- impossible even under concurrent exports.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_registry_year_serial_key') THEN
    ALTER TABLE document_registry ADD CONSTRAINT document_registry_year_serial_key
      UNIQUE (year, serial);
  END IF;
END
$$;

-- The audit trail must survive the deletion of the account it refers to,
-- which is exactly when it matters most. Keep the id, drop the FK if one was
-- ever added.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_fkey') THEN
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_user_id_fkey;
  END IF;
END
$$;
