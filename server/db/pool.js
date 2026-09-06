'use strict';

/**
 * PostgreSQL access layer.
 *
 * This talks to PostgreSQL directly with native `$1` placeholders. The
 * previous implementation was a SQLite-emulation shim that rewrote SQL with
 * regular expressions (`?` → `$1`, `INSERT OR IGNORE` → `ON CONFLICT`) and
 * synthesised a `lastInsertRowid`. That silently corrupted any query
 * containing a `?` inside a string literal or a JSON operator, and hid the
 * real database behind a false interface. It is gone.
 *
 * `transaction()` binds a dedicated client to the async context, so every
 * query issued inside the callback — however deep in the call stack — runs on
 * that client and inside that transaction, with no plumbing at the call sites.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool, types } = require('pg');

const config = require('../config');
const logger = require('../lib/logger');

// COUNT(*) and other bigint columns arrive as strings by default; the
// application treats them as numbers everywhere.
types.setTypeParser(types.builtins.INT8, (value) => (value === null ? null : Number(value)));

const pool = new Pool({
  connectionString: config.db.connectionString,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  application_name: 'oss-ai-platform'
});

pool.on('error', (err) => {
  // An idle client failed (server restart, network blip). The pool discards it
  // and creates a new one; this must not take the process down.
  logger.error({ err }, 'Idle PostgreSQL client error');
});

const transactionContext = new AsyncLocalStorage();

const SLOW_QUERY_MS = 500;

/**
 * Execute a parameterised statement.
 * @param {string} text SQL with $1, $2 … placeholders.
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  const client = transactionContext.getStore() || pool;
  const startedAt = process.hrtime.bigint();

  try {
    const result = await client.query(text, params);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    if (durationMs > SLOW_QUERY_MS) {
      logger.warn(
        { durationMs: Math.round(durationMs), sql: text.replace(/\s+/g, ' ').trim().slice(0, 200) },
        'Slow query'
      );
    }
    return result;
  } catch (err) {
    logger.error(
      { err, sql: text.replace(/\s+/g, ' ').trim().slice(0, 300) },
      'Query failed'
    );
    throw err;
  }
}

/** First row, or `null`. */
async function queryOne(text, params = []) {
  const { rows } = await query(text, params);
  return rows.length > 0 ? rows[0] : null;
}

/** All rows. */
async function queryMany(text, params = []) {
  const { rows } = await query(text, params);
  return rows;
}

/** Number of affected rows. */
async function execute(text, params = []) {
  const { rowCount } = await query(text, params);
  return rowCount;
}

/**
 * Run `fn` inside a transaction. Nested calls join the existing transaction
 * rather than opening a second one, so a service can compose other services
 * without either of them needing to know it is already in a transaction.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
  const existing = transactionContext.getStore();
  if (existing) return fn();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionContext.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Transaction rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Verify connectivity at startup so a bad DSN fails loudly and immediately. */
async function verifyConnection() {
  const row = await queryOne('SELECT current_database() AS database, version() AS version');
  logger.info(
    { database: row.database, version: String(row.version).split(' ').slice(0, 2).join(' ') },
    'Connected to PostgreSQL'
  );
  return row;
}

/** Liveness probe. Returns false rather than throwing, for health endpoints. */
async function ping() {
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    logger.warn({ err: err.message }, 'Database ping failed');
    return false;
  }
}

async function close() {
  await pool.end();
}

/** PostgreSQL error codes the services care about. */
const PG_ERRORS = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514'
});

module.exports = {
  pool,
  query,
  queryOne,
  queryMany,
  execute,
  transaction,
  verifyConnection,
  ping,
  close,
  PG_ERRORS
};
