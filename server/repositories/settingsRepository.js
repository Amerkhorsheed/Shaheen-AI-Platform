'use strict';

const { queryOne, queryMany, execute } = require('../db/pool');

async function getValue(key) {
  const row = await queryOne('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : null;
}

/** Only the keys asked for, as a plain object. */
async function getMany(keys) {
  if (keys.length === 0) return {};
  const rows = await queryMany('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [keys]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function set(key, value) {
  return execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

/** Seed a default without ever overwriting an operator's choice. */
function setIfAbsent(key, value) {
  return execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    [key, String(value)]
  );
}

async function exists(key) {
  return (await queryOne('SELECT 1 FROM settings WHERE key = $1', [key])) !== null;
}

module.exports = { getValue, getMany, set, setIfAbsent, exists };
