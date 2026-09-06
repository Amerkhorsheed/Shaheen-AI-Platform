'use strict';

/**
 * Entry point.
 *
 * Startup order matters and is explicit: validate configuration, prove the
 * database is reachable, bring the schema up to date, seed what is missing,
 * and only then accept traffic. A failure at any step stops the process rather
 * than leaving a half-initialised server answering requests.
 */

const os = require('node:os');
const config = require('./config');
const logger = require('./lib/logger');
const pool = require('./db/pool');
const migrate = require('./db/migrate');
const { seed } = require('./db/seed');
const exportTicketService = require('./services/exportTicketService');
const { createApp } = require('./app');

const SHUTDOWN_GRACE_MS = 10_000;

let server = null;
let shuttingDown = false;

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const physical = [];
  const other = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    const isVirtual = /vEthernet|WSL|docker|vbox|vmnet|pseudo/i.test(name);
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        if (!isVirtual) {
          physical.push(net.address);
        } else {
          other.push(net.address);
        }
      }
    }
  }

  // Prioritize 192.168.x.x / 10.x.x.x LAN IPs, place 192.168 first
  const addresses = physical.length > 0 ? physical : other;
  addresses.sort((a, b) => {
    if (a.startsWith('192.168.') && !b.startsWith('192.168.')) return -1;
    if (!a.startsWith('192.168.') && b.startsWith('192.168.')) return 1;
    return 0;
  });

  return [...new Set(addresses)];
}

async function start() {
  logger.info({ env: config.env, node: process.version }, 'Starting OSS AI Platform');

  await pool.verifyConnection();

  if (config.db.runMigrations) {
    await migrate.migrate();
  } else {
    logger.warn('RUN_MIGRATIONS is false — the schema is assumed to be current');
  }

  await seed();

  const app = createApp();

  server = app.listen(config.http.port, config.http.host, () => {
    const lanIps = getLanAddresses();
    const lanLines = lanIps.length > 0
      ? lanIps.map((ip) => `  الوصول عبر الشبكة (LAN):  http://${ip}:${config.http.port}\n`).join('')
      : '';

    // Kept on stdout rather than the structured log: this is the banner an
    // operator looks for when starting the platform by hand.
    process.stdout.write(
      '=======================================================\n' +
        '  منظومة OSS للذكاء الاصطناعي (OSS AI Platform)\n' +
        `  الخادم المحلي (Local):    http://localhost:${config.http.port}\n` +
        lanLines +
        '  النظام معزول ولا يجري أي اتصال بخدمات خارجية\n' +
        '=======================================================\n'
    );
  });

  // Slow-loris protection: a client cannot hold a connection open forever.
  server.headersTimeout = 65_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 61_000;

  return server;
}

/**
 * Stop accepting connections, let in-flight requests finish, then release the
 * database. Bounded, so a stuck SSE stream cannot block shutdown forever.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down');

  const forced = setTimeout(() => {
    logger.warn('Graceful shutdown timed out — exiting now');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forced.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    exportTicketService.stop();
    await pool.close();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// A rejection or an uncaught throw leaves the process in an unknown state.
// Log it and exit so the supervisor restarts cleanly, rather than continuing
// to serve requests from a corrupted one.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});

if (require.main === module) {
  start().catch((err) => {
    logger.fatal({ err }, 'Failed to start');
    process.exit(1);
  });
}

module.exports = { start, shutdown };
