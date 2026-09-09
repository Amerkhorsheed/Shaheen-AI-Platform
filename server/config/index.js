'use strict';

/**
 * Application configuration.
 *
 * Every value the application depends on is declared, validated and frozen
 * here at startup. If something required is missing or malformed the process
 * refuses to boot with a readable message, rather than failing later inside a
 * request handler — and no secret has a fallback baked into the source.
 */

const { z } = require('zod');

require('dotenv').config();

const booleanish = (defaultValue = false) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- HTTP ---
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default('0.0.0.0'),
  // Only enable behind a trusted reverse proxy: it decides whether
  // X-Forwarded-For is believed for rate limiting and audit records.
  TRUST_PROXY: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default(''),
  ENABLE_HSTS: booleanish(false),
  BODY_LIMIT: z.string().default('50mb'),

  // --- Database ---
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required. Copy .env.example to .env and fill it in.' })
    .min(1)
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string'
    }),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5000),
  RUN_MIGRATIONS: booleanish(true),

  // --- Security ---
  JWT_SECRET: z
    .string({
      required_error:
        'JWT_SECRET is required. Generate one with: openssl rand -base64 48\n' +
        'There is deliberately no default — a signing key in source lets anyone forge an admin token.'
    })
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  TOKEN_TTL: z.string().default('8h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  MIN_PASSWORD_LENGTH: z.coerce.number().int().min(8).default(10),

  LOGIN_RATE_WINDOW_MS: z.coerce.number().int().default(15 * 60 * 1000),
  LOGIN_RATE_LIMIT: z.coerce.number().int().default(10),
  WRITE_RATE_WINDOW_MS: z.coerce.number().int().default(60 * 1000),
  WRITE_RATE_LIMIT: z.coerce.number().int().default(60),

  // --- Local inference engine ---
  LM_STUDIO_URL: z.string().optional(),
  MODEL_LIST_TIMEOUT_MS: z.coerce.number().int().default(4000),
  MODEL_CONNECT_TIMEOUT_MS: z.coerce.number().int().default(120000),

  // --- Uploads ---
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(50 * 1024 * 1024),
  MAX_UPLOAD_FILES: z.coerce.number().int().default(20),
  MAX_EXTRACTED_CHARS: z.coerce.number().int().default(80000),

  // --- Exports ---
  EXPORT_TICKET_TTL_MS: z.coerce.number().int().default(120000),
  MAX_DOCUMENT_CHARS: z.coerce.number().int().default(2000000),

  // --- Bootstrap ---
  INITIAL_ADMIN_PASSWORD: z.string().optional(),

  // --- Logging ---
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

  // Written directly to stderr: the logger itself depends on this config.
  process.stderr.write(`\nInvalid configuration — the server cannot start:\n\n${issues}\n\n`);
  process.exit(1);
}

const env = parsed.data;

function resolveTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return 1;
  if (value === 'false') return false;
  const asNumber = Number(value);
  return Number.isInteger(asNumber) ? asNumber : value;
}

const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  http: Object.freeze({
    port: env.PORT,
    host: env.HOST,
    trustProxy: resolveTrustProxy(env.TRUST_PROXY),
    allowedOrigins: Object.freeze(
      env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    ),
    enableHsts: env.ENABLE_HSTS,
    bodyLimit: env.BODY_LIMIT
  }),

  db: Object.freeze({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
    runMigrations: env.RUN_MIGRATIONS
  }),

  security: Object.freeze({
    jwtSecret: env.JWT_SECRET,
    tokenTtl: env.TOKEN_TTL,
    bcryptRounds: env.BCRYPT_ROUNDS,
    minPasswordLength: env.MIN_PASSWORD_LENGTH,
    loginRate: Object.freeze({ windowMs: env.LOGIN_RATE_WINDOW_MS, limit: env.LOGIN_RATE_LIMIT }),
    writeRate: Object.freeze({ windowMs: env.WRITE_RATE_WINDOW_MS, limit: env.WRITE_RATE_LIMIT })
  }),

  model: Object.freeze({
    url: env.LM_STUDIO_URL || null,
    listTimeoutMs: env.MODEL_LIST_TIMEOUT_MS,
    connectTimeoutMs: env.MODEL_CONNECT_TIMEOUT_MS
  }),

  uploads: Object.freeze({
    maxBytes: env.MAX_UPLOAD_BYTES,
    maxFiles: env.MAX_UPLOAD_FILES,
    maxExtractedChars: env.MAX_EXTRACTED_CHARS
  }),

  exports: Object.freeze({
    ticketTtlMs: env.EXPORT_TICKET_TTL_MS,
    maxDocumentChars: env.MAX_DOCUMENT_CHARS
  }),

  bootstrap: Object.freeze({
    initialAdminPassword: env.INITIAL_ADMIN_PASSWORD || null
  }),

  logging: Object.freeze({
    level: env.LOG_LEVEL
  })
});

module.exports = config;
