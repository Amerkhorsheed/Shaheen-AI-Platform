'use strict';

/**
 * User persistence.
 *
 * Repositories own SQL and nothing else: no HTTP concepts, no validation, no
 * business rules. They return plain rows; mapping to API shapes happens in the
 * service layer.
 */

const { query, queryOne, queryMany, execute } = require('../db/pool');

// Joined projection used everywhere a user is presented with its category.
const USER_VIEW = `
  SELECT u.id, u.username, u.display_name, u.role, u.department, u.job_title,
         u.status, u.category_id, u.notes, u.must_change_password, u.created_at,
         c.name            AS category_name,
         c.code            AS category_code,
         c.color           AS category_color,
         c.clearance_level AS category_clearance
  FROM users u
  LEFT JOIN categories c ON c.id = u.category_id
`;

/** Full row including the password hash — for authentication only. */
function findByUsernameWithSecret(username) {
  return queryOne('SELECT * FROM users WHERE username = $1', [username]);
}

function findByIdWithSecret(id) {
  return queryOne('SELECT * FROM users WHERE id = $1', [id]);
}

/**
 * The projection the auth middleware needs on every request: identity,
 * authority and the values that decide whether a token is still valid.
 */
function findForAuthentication(id) {
  return queryOne(
    `SELECT u.id, u.username, u.display_name, u.role, u.department, u.job_title,
            u.status, u.category_id, u.token_version, u.must_change_password,
            c.name           AS category_name,
            c.prompt_context AS category_prompt_context
     FROM users u
     LEFT JOIN categories c ON c.id = u.category_id
     WHERE u.id = $1`,
    [id]
  );
}

function findById(id) {
  return queryOne(`${USER_VIEW} WHERE u.id = $1`, [id]);
}

function listAll() {
  return queryMany(
    `${USER_VIEW.replace(
      'FROM users u',
      ', (SELECT COUNT(*) FROM chats ch WHERE ch.user_id = u.id) AS chat_count FROM users u'
    )}
     ORDER BY u.created_at DESC`
  );
}

function existsByUsername(username) {
  return queryOne('SELECT id FROM users WHERE username = $1', [username]);
}

async function insert(user) {
  const row = await queryOne(
    `INSERT INTO users (username, password_hash, display_name, role, department,
                        category_id, job_title, status, notes, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      user.username,
      user.passwordHash,
      user.displayName,
      user.role,
      user.department,
      user.categoryId,
      user.jobTitle,
      user.status,
      user.notes,
      user.mustChangePassword ? 1 : 0
    ]
  );
  return row.id;
}

function updateProfile(id, fields) {
  return execute(
    `UPDATE users
     SET display_name = $1, role = $2, department = $3, category_id = $4,
         job_title = $5, status = $6, notes = $7
     WHERE id = $8`,
    [
      fields.displayName,
      fields.role,
      fields.department,
      fields.categoryId,
      fields.jobTitle,
      fields.status,
      fields.notes,
      id
    ]
  );
}

/**
 * Replace the password. `mustChangePassword` distinguishes an administrative
 * reset (the holder must choose their own next) from a self-service change.
 */
function updatePassword(id, passwordHash, { mustChangePassword }) {
  return execute(
    `UPDATE users
     SET password_hash = $1, must_change_password = $2, token_version = token_version + 1
     WHERE id = $3`,
    [passwordHash, mustChangePassword ? 1 : 0, id]
  );
}

/** Invalidate every session belonging to this account, immediately. */
function revokeSessions(id) {
  return execute('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
}

function remove(id) {
  return execute('DELETE FROM users WHERE id = $1', [id]);
}

function countActiveAdmins() {
  return queryOne(
    "SELECT COUNT(*)::int AS count FROM users WHERE role IN ('admin', 'superadmin') AND status = 'active'"
  ).then((r) => r.count);
}

function countByCategory(categoryId) {
  return queryOne('SELECT COUNT(*)::int AS count FROM users WHERE category_id = $1', [
    categoryId
  ]).then((r) => r.count);
}

async function statistics() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM users)                                AS total_users,
      (SELECT COUNT(*)::int FROM users WHERE status = 'active')        AS active_users,
      (SELECT COUNT(*)::int FROM users WHERE role IN ('admin', 'superadmin')) AS admin_count,
      (SELECT COUNT(*)::int FROM users WHERE role = 'superadmin')      AS superadmin_count,
      (SELECT COUNT(*)::int FROM categories)                           AS total_categories,
      (SELECT COUNT(*)::int FROM chats)                                AS total_chats
  `);
  return rows[0];
}

function categoryBreakdown() {
  return queryMany(`
    SELECT c.name, c.code, c.color, COUNT(u.id)::int AS user_count
    FROM categories c
    LEFT JOIN users u ON u.category_id = c.id
    GROUP BY c.id, c.name, c.code, c.color
    ORDER BY user_count DESC
  `);
}

/** Every account with its hash — used only by the startup security sweep. */
function listCredentialAudit() {
  return queryMany('SELECT id, username, password_hash, must_change_password FROM users');
}

function flagPasswordChangeRequired(id) {
  return execute(
    'UPDATE users SET must_change_password = 1, token_version = token_version + 1 WHERE id = $1',
    [id]
  );
}

module.exports = {
  findByUsernameWithSecret,
  findByIdWithSecret,
  findForAuthentication,
  findById,
  listAll,
  existsByUsername,
  insert,
  updateProfile,
  updatePassword,
  revokeSessions,
  remove,
  countActiveAdmins,
  countByCategory,
  statistics,
  categoryBreakdown,
  listCredentialAudit,
  flagPasswordChangeRequired
};
