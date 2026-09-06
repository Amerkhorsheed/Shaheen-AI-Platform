'use strict';

/**
 * Audit trail.
 *
 * Writing an audit record must never fail the operation being audited, so
 * every call is fire-and-forget with its own error handling. What is recorded
 * is deliberately limited to *what happened*, never the content involved: the
 * trail must not become a second, less protected copy of classified
 * conversations or uploaded documents.
 */

const auditRepository = require('../repositories/auditRepository');
const logger = require('../lib/logger');

const ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_BLOCKED: 'LOGIN_BLOCKED',
  LOGIN_RATE_LIMITED: 'LOGIN_RATE_LIMITED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_CHANGE_FAILED: 'PASSWORD_CHANGE_FAILED',
  FORBIDDEN_ADMIN_ATTEMPT: 'FORBIDDEN_ADMIN_ATTEMPT',

  USER_CREATED: 'USER_CREATED',
  USER_SELF_REGISTERED: 'USER_SELF_REGISTERED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',

  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_DELETED: 'CATEGORY_DELETED',

  CHAT_QUERY: 'CHAT_QUERY',
  DELETE_CHAT: 'DELETE_CHAT',
  CLEAR_CHAT_MESSAGES: 'CLEAR_CHAT_MESSAGES',

  TEMPLATE_CREATED: 'TEMPLATE_CREATED',
  TEMPLATE_UPDATED: 'TEMPLATE_UPDATED',
  TEMPLATE_DELETED: 'TEMPLATE_DELETED',

  FILES_UPLOADED: 'FILES_UPLOADED',
  EXPORT_DOCUMENT: 'EXPORT_DOCUMENT',
  EXPORT_DATASET: 'EXPORT_DATASET',

  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  SECURITY_REMEDIATION: 'SECURITY_REMEDIATION'
});

/**
 * @param {object} params
 * @param {number|null} params.userId  Actor, or null for anonymous attempts.
 * @param {string} params.action       One of ACTIONS.
 * @param {object} [params.details]    Structured, non-sensitive context.
 * @param {string} [params.ipAddress]
 */
function record({ userId, action, details, ipAddress }) {
  return auditRepository
    .append({ userId, action, details, ipAddress })
    .catch((err) => logger.error({ err, action }, 'Failed to write audit record'));
}

async function list({ limit, offset }) {
  const [logs, total] = await Promise.all([
    auditRepository.list({ limit, offset }),
    auditRepository.count()
  ]);

  return {
    total,
    limit,
    offset,
    logs: logs.map((entry) => ({
      ...entry,
      details: safeParse(entry.details)
    }))
  };
}

function safeParse(value) {
  if (value === null || value === undefined) return {};
  try {
    return JSON.parse(value);
  } catch (e) {
    // Legacy rows written before details were standardised on JSON.
    return { message: String(value) };
  }
}

module.exports = { record, list, ACTIONS };
