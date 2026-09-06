'use strict';

/**
 * Structured logging.
 *
 * One JSON line per event in production so records can be shipped and queried;
 * a readable single line in development. Credentials, tokens and document
 * bodies are redacted at the logger level so a careless call site cannot leak
 * them into a log file that outlives the request.
 */

const pino = require('pino');
const config = require('../config');

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'newPassword',
  'currentPassword',
  'password_hash',
  'passwordHash',
  'token',
  'ticket',
  'jwtSecret',
  'JWT_SECRET',
  'DATABASE_URL',
  'connectionString',
  '*.password',
  '*.token',
  '*.password_hash'
];

const logger = pino({
  level: config.logging.level,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'oss-ai-platform' },
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    config.isProduction || config.isTest
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' }
        }
});

module.exports = logger;
