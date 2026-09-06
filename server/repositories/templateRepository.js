'use strict';

const { queryOne, queryMany, execute } = require('../db/pool');

// `description` is the column name — `desc` is a reserved SQL keyword. The
// alias keeps clients that still read `desc` working during the transition.
const TEMPLATE_VIEW = `
  SELECT t.id, t.title, t.category, t.description, t.description AS "desc",
         t.prompt, t.icon, t.is_system, t.created_by, t.created_at, t.updated_at,
         u.display_name AS creator_name
  FROM templates t
  LEFT JOIN users u ON u.id = t.created_by
`;

function listAll() {
  return queryMany(`${TEMPLATE_VIEW} ORDER BY t.is_system DESC, t.created_at DESC`);
}

function findById(id) {
  return queryOne(`${TEMPLATE_VIEW} WHERE t.id = $1`, [id]);
}

function findRawById(id) {
  return queryOne('SELECT * FROM templates WHERE id = $1', [id]);
}

function insert(template) {
  return queryOne(
    `INSERT INTO templates (id, title, category, description, prompt, icon, is_system, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
     RETURNING id`,
    [
      template.id,
      template.title,
      template.category,
      template.description,
      template.prompt,
      template.icon,
      template.createdBy
    ]
  );
}

function update(id, fields) {
  return execute(
    `UPDATE templates
     SET title = $1, category = $2, description = $3, prompt = $4, icon = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $6`,
    [fields.title, fields.category, fields.description, fields.prompt, fields.icon, id]
  );
}

function remove(id) {
  return execute('DELETE FROM templates WHERE id = $1', [id]);
}

function insertSeed(template) {
  return execute(
    `INSERT INTO templates (id, title, category, description, prompt, icon, is_system)
     VALUES ($1, $2, $3, $4, $5, $6, 1)
     ON CONFLICT (id) DO NOTHING`,
    [
      template.id,
      template.title,
      template.category,
      template.description,
      template.prompt,
      template.icon
    ]
  );
}

function count() {
  return queryOne('SELECT COUNT(*)::int AS count FROM templates').then((r) => r.count);
}

module.exports = {
  listAll,
  findById,
  findRawById,
  insert,
  update,
  remove,
  insertSeed,
  count
};
