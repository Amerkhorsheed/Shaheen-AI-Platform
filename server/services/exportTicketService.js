'use strict';

/**
 * Single-use export tickets.
 *
 * Export targets are reached by a form navigation, so the browser can print
 * the page or save the file. A form navigation cannot carry an Authorization
 * header, so the SPA fetches a short-lived ticket over the authenticated API
 * and posts that instead. A ticket is bound to one user, valid for a couple of
 * minutes, and consumed on first use.
 *
 * The store is in-process and deliberately so: a ticket outliving a restart
 * has no value, and the platform runs as a single instance. If it is ever run
 * behind more than one process, this moves to a shared store.
 */

const crypto = require('node:crypto');

const config = require('../config');
const userRepository = require('../repositories/userRepository');

/** @type {Map<string, {userId: number, expiresAt: number}>} */
const tickets = new Map();

function issue(user) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, { userId: user.id, expiresAt: Date.now() + config.exports.ticketTtlMs });
  return ticket;
}

/**
 * Consume a ticket and return the account it belongs to.
 * The account is re-read so a ticket issued before a suspension is useless.
 * @returns {Promise<object|null>}
 */
async function consume(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;

  const entry = tickets.get(ticket);
  if (!entry) return null;

  tickets.delete(ticket);
  if (Date.now() > entry.expiresAt) return null;

  const user = await userRepository.findById(entry.userId);
  if (!user || user.status !== 'active') return null;

  return user;
}

function purgeExpired() {
  const now = Date.now();
  for (const [key, entry] of tickets) {
    if (now > entry.expiresAt) tickets.delete(key);
  }
}

// Bounded growth even if tickets are issued and never used. `unref` keeps the
// timer from holding the process open during shutdown.
const sweeper = setInterval(purgeExpired, 60_000);
sweeper.unref();

function stop() {
  clearInterval(sweeper);
  tickets.clear();
}

module.exports = { issue, consume, purgeExpired, stop, ttlMs: config.exports.ticketTtlMs };
