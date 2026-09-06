'use strict';

const { queryOne, queryMany, execute } = require('../db/pool');

/**
 * Append an entry. Details are always stored as a JSON object so the trail can
 * be queried consistently; the previous code mixed objects and bare strings.
 */
function append({ userId, action, details, ipAddress }) {
  return execute(
    'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
    [userId ?? null, action, JSON.stringify(details ?? {}), ipAddress ?? null]
  );
}

function list({ limit, offset }) {
  return queryMany(
    `SELECT a.id, a.user_id, a.action, a.details, a.ip_address, a.created_at,
            u.username, u.display_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}

function count() {
  return queryOne('SELECT COUNT(*)::int AS count FROM audit_logs').then((r) => r.count);
}

module.exports = { append, list, count };
