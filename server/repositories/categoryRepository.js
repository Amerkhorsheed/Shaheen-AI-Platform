'use strict';

const { queryOne, queryMany, execute } = require('../db/pool');

function listWithUserCounts() {
  return queryMany(`
    SELECT c.*, (SELECT COUNT(*)::int FROM users u WHERE u.category_id = c.id) AS user_count
    FROM categories c
    ORDER BY c.created_at ASC
  `);
}

function findById(id) {
  return queryOne('SELECT * FROM categories WHERE id = $1', [id]);
}

function findByNameOrCode(name, code) {
  return queryOne('SELECT id FROM categories WHERE name = $1 OR code = $2', [name, code]);
}

function insert(category) {
  return queryOne(
    `INSERT INTO categories (id, name, code, description, clearance_level, color, prompt_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      category.id,
      category.name,
      category.code,
      category.description,
      category.clearanceLevel,
      category.color,
      category.promptContext
    ]
  );
}

/** Update only the specialist directive (layer 3 of the system prompt). */
function updateDirective(id, promptContext) {
  return execute('UPDATE categories SET prompt_context = $1 WHERE id = $2', [promptContext, id]);
}

function remove(id) {
  return execute('DELETE FROM categories WHERE id = $1', [id]);
}

/** Idempotent seed: never overwrites an operator's edits to an existing row. */
function upsertSeed(category) {
  return execute(
    `INSERT INTO categories (id, name, code, clearance_level, icon, color, description, prompt_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      category.id,
      category.name,
      category.code,
      category.clearance_level,
      category.icon,
      category.color,
      category.description,
      category.prompt_context
    ]
  );
}

function count() {
  return queryOne('SELECT COUNT(*)::int AS count FROM categories').then((r) => r.count);
}

module.exports = {
  listWithUserCounts,
  findById,
  findByNameOrCode,
  insert,
  updateDirective,
  remove,
  upsertSeed,
  count
};
