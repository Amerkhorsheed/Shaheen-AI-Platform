-- 003 — Composable system prompts.
--
-- Previously a category carried a single free-text `prompt_context`, so any
-- guidance shared by several departments — how to read an attachment, how to
-- lay out an official letter — had to be copied into each of them and drifted
-- apart on every edit.
--
-- A prompt is now assembled from named modules that categories reference. One
-- module can be attached to many categories; editing it corrects every
-- department at once. `categories.prompt_context` is kept for the guidance that
-- genuinely belongs to one department alone.

CREATE TABLE IF NOT EXISTS prompt_modules (
  id          VARCHAR(64)  PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  content     TEXT         NOT NULL,
  -- Seeded modules are protected from deletion; they are referenced by the
  -- default category mapping.
  is_system   INTEGER      NOT NULL DEFAULT 0,
  created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many. `sort_order` fixes the assembly order, so the same category
-- always produces byte-identical instructions — a prompt that varies between
-- requests is not auditable.
CREATE TABLE IF NOT EXISTS category_prompt_modules (
  category_id VARCHAR(64) NOT NULL REFERENCES categories(id)      ON DELETE CASCADE,
  module_id   VARCHAR(64) NOT NULL REFERENCES prompt_modules(id)  ON DELETE CASCADE,
  sort_order  INTEGER     NOT NULL DEFAULT 100,
  PRIMARY KEY (category_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_category_prompt_modules_category
  ON category_prompt_modules (category_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_category_prompt_modules_module
  ON category_prompt_modules (module_id);
