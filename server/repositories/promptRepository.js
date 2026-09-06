'use strict';

const { queryOne, queryMany, execute } = require('../db/pool');

// Each module reports how many categories reference it, so an administrator
// can see at a glance that editing one block affects several departments.
const MODULE_VIEW = `
  SELECT m.id, m.name, m.description, m.content, m.is_system, m.created_at, m.updated_at,
         (SELECT COUNT(*)::int FROM category_prompt_modules cm WHERE cm.module_id = m.id) AS category_count
  FROM prompt_modules m
`;

function listModules() {
  return queryMany(`${MODULE_VIEW} ORDER BY m.is_system DESC, m.name ASC`);
}

function findModule(id) {
  return queryOne(`${MODULE_VIEW} WHERE m.id = $1`, [id]);
}

function insertModule(module) {
  return queryOne(
    `INSERT INTO prompt_modules (id, name, description, content, is_system, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [module.id, module.name, module.description, module.content, module.isSystem ? 1 : 0, module.createdBy ?? null]
  );
}

function updateModule(id, fields) {
  return execute(
    `UPDATE prompt_modules
     SET name = $1, description = $2, content = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [fields.name, fields.description, fields.content, id]
  );
}

function removeModule(id) {
  return execute('DELETE FROM prompt_modules WHERE id = $1', [id]);
}

/** Idempotent seed — never overwrites an edited module. */
function insertModuleSeed(module) {
  return execute(
    `INSERT INTO prompt_modules (id, name, description, content, is_system)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (id) DO NOTHING`,
    [module.id, module.name, module.description, module.content]
  );
}

/** Modules attached to a category, in assembly order. */
function listModulesForCategory(categoryId) {
  return queryMany(
    `SELECT m.id, m.name, m.content, cm.sort_order
     FROM category_prompt_modules cm
     JOIN prompt_modules m ON m.id = cm.module_id
     WHERE cm.category_id = $1
     ORDER BY cm.sort_order ASC, m.id ASC`,
    [categoryId]
  );
}

/** The full mapping, for the administration screen. */
function listAllAssignments() {
  return queryMany(
    `SELECT cm.category_id, cm.module_id, cm.sort_order, m.name AS module_name
     FROM category_prompt_modules cm
     JOIN prompt_modules m ON m.id = cm.module_id
     ORDER BY cm.category_id, cm.sort_order`
  );
}

function attachModule(categoryId, moduleId, sortOrder) {
  return execute(
    `INSERT INTO category_prompt_modules (category_id, module_id, sort_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (category_id, module_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
    [categoryId, moduleId, sortOrder]
  );
}

function clearCategoryModules(categoryId) {
  return execute('DELETE FROM category_prompt_modules WHERE category_id = $1', [categoryId]);
}

function countAssignmentsForCategory(categoryId) {
  return queryOne('SELECT COUNT(*)::int AS count FROM category_prompt_modules WHERE category_id = $1', [
    categoryId
  ]).then((r) => r.count);
}

module.exports = {
  listModules,
  findModule,
  insertModule,
  updateModule,
  removeModule,
  insertModuleSeed,
  listModulesForCategory,
  listAllAssignments,
  attachModule,
  clearCategoryModules,
  countAssignmentsForCategory
};
