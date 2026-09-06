'use strict';

/**
 * Versioned migration runner.
 *
 * Replaces the previous approach of one large `initDb()` that re-issued
 * `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE … ADD COLUMN IF NOT EXISTS` on
 * every boot: with that scheme there was no record of what had been applied,
 * no way to review a change before it ran, and no way to tell two deployments
 * apart.
 *
 * Each `NNN_name.sql` file runs exactly once, in filename order, inside its
 * own transaction, and is recorded with a checksum. A file that changes after
 * being applied is reported rather than silently ignored.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { pool, query, queryMany } = require('./pool');
const logger = require('../lib/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// A session-level advisory lock, so two instances starting at once cannot
// apply the same migration twice.
const LOCK_ID = 4_820_113;

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT        PRIMARY KEY,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER
    )
  `);
}

async function readMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (filename) => {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return {
        version: filename.replace(/\.sql$/, ''),
        filename,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex')
      };
    })
  );
}

/**
 * Apply every migration that has not run yet.
 * @returns {Promise<{applied: string[], skipped: number}>}
 */
async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

    await ensureMigrationsTable();
    const [files, appliedRows] = await Promise.all([
      readMigrationFiles(),
      queryMany('SELECT version, checksum FROM schema_migrations')
    ]);

    const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]));
    const newlyApplied = [];

    for (const migration of files) {
      const existingChecksum = applied.get(migration.version);

      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          // Editing an applied migration means two databases silently diverge.
          logger.warn(
            { version: migration.version },
            'Migration file changed after it was applied — add a new migration instead of editing this one'
          );
        }
        continue;
      }

      const startedAt = Date.now();
      logger.info({ version: migration.version }, 'Applying migration');

      // Each migration is atomic: it either applies completely or not at all.
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum, duration_ms) VALUES ($1, $2, $3)',
          [migration.version, migration.checksum, Date.now() - startedAt]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, version: migration.version }, 'Migration failed — database left unchanged');
        throw err;
      }

      newlyApplied.push(migration.version);
    }

    if (newlyApplied.length > 0) {
      logger.info({ applied: newlyApplied }, `Applied ${newlyApplied.length} migration(s)`);
    } else {
      logger.info({ total: files.length }, 'Database schema is up to date');
    }

    return { applied: newlyApplied, skipped: files.length - newlyApplied.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

/** Versions applied, newest first — used by the health endpoint. */
async function status() {
  await ensureMigrationsTable();
  return queryMany(
    'SELECT version, applied_at, duration_ms FROM schema_migrations ORDER BY version DESC'
  );
}

module.exports = { migrate, status };
