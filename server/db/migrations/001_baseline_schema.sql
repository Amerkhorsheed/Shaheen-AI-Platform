-- 001 — Baseline schema.
--
-- Written to match the schema already deployed, using IF NOT EXISTS
-- throughout, so it is a no-op against an existing database and produces the
-- correct structure on a fresh one. Every later change gets its own numbered
-- migration; this file is never edited again.

CREATE TABLE IF NOT EXISTS categories (
  id              VARCHAR(64)  PRIMARY KEY,
  name            VARCHAR(255) NOT NULL UNIQUE,
  description     TEXT,
  code            VARCHAR(32)  NOT NULL UNIQUE,
  clearance_level VARCHAR(32)  DEFAULT 'official',
  icon            VARCHAR(64)  DEFAULT 'Briefcase',
  color           VARCHAR(32)  DEFAULT '#02443A',
  prompt_context  TEXT,
  created_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL       PRIMARY KEY,
  username             VARCHAR(128) NOT NULL UNIQUE,
  password_hash        VARCHAR(255) NOT NULL,
  display_name         VARCHAR(255),
  role                 VARCHAR(64)  DEFAULT 'user',
  department           VARCHAR(255) DEFAULT 'الإدارة العامة',
  category_id          VARCHAR(64)  REFERENCES categories(id) ON DELETE SET NULL,
  job_title            VARCHAR(255) DEFAULT 'مستشار إداري',
  status               VARCHAR(32)  DEFAULT 'active',
  notes                TEXT,
  -- Incremented whenever privileges, account state or credentials change, so
  -- tokens issued before the change stop validating immediately.
  token_version        INTEGER      NOT NULL DEFAULT 1,
  must_change_password INTEGER      NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
  id             VARCHAR(96)  PRIMARY KEY,
  user_id        INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          VARCHAR(300) NOT NULL,
  model          VARCHAR(255),
  system_prompt  TEXT,
  classification VARCHAR(32)  DEFAULT 'official',
  pinned         INTEGER      DEFAULT 0,
  created_at     TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id          VARCHAR(96) PRIMARY KEY,
  chat_id     VARCHAR(96) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role        VARCHAR(32) NOT NULL,
  content     TEXT        NOT NULL,
  attachments TEXT,
  model_used  VARCHAR(255),
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS templates (
  id          VARCHAR(96)  PRIMARY KEY,
  title       VARCHAR(300) NOT NULL,
  category    VARCHAR(150) NOT NULL,
  description TEXT,
  prompt      TEXT         NOT NULL,
  icon        VARCHAR(64)  DEFAULT 'FileText',
  is_system   INTEGER      DEFAULT 0,
  created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key   VARCHAR(128) PRIMARY KEY,
  value TEXT         NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL       PRIMARY KEY,
  user_id    INTEGER,
  action     VARCHAR(128) NOT NULL,
  details    TEXT,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- Provenance for every exported document: a sequential reference number and
-- the SHA-256 of the exact rendered body, so the reference printed on a page
-- can actually be verified rather than being decorative.
CREATE TABLE IF NOT EXISTS document_registry (
  ref            TEXT      PRIMARY KEY,
  year           INTEGER   NOT NULL,
  serial         INTEGER   NOT NULL,
  content_sha256 TEXT      NOT NULL,
  title          TEXT,
  classification TEXT,
  kind           TEXT      NOT NULL,
  issued_by      INTEGER,
  issued_by_name TEXT,
  model          TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chats_user      ON chats (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_pinned    ON chats (user_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_chat   ON messages (chat_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_category  ON users (category_id);
CREATE INDEX IF NOT EXISTS idx_registry_serial ON document_registry (year, serial DESC);
CREATE INDEX IF NOT EXISTS idx_templates_order ON templates (is_system DESC, created_at DESC);
