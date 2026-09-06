# Backend Architecture

**Stack:** Node.js 20+ · Express 5 · PostgreSQL 16 (pgvector) · Zod · Pino
**Entry point:** `server/index.js` → `server/app.js`

---

## Layers

Each layer may only call the one below it. That single rule is what keeps the
code navigable, and it is enforced by a test (`npm test`, check 6) that fails
the build if SQL appears in a route handler.

```
  HTTP          server/http/          routing, validation, auth, error mapping
    ↓
  Services      server/services/      business rules, transactions, audit
    ↓
  Repositories  server/repositories/  SQL, and nothing else
    ↓
  Database      server/db/            pool, migrations, seed
```

`server/lib/` (errors, logger, html, csv) and `server/templates/` (printable
documents) are leaves: pure, dependency-light, callable from anywhere.

| Layer | Files | Lines | Responsibility |
| :-- | --: | --: | :-- |
| `config/` | 1 | 164 | Validated, frozen configuration; refuses to boot on a bad value |
| `lib/` | 4 | 333 | Typed errors, structured logging, HTML sanitising, CSV |
| `db/` | 6 | 807 | Connection pool, versioned migrations, idempotent seed |
| `repositories/` | 7 | 579 | Parameterised SQL, one module per aggregate |
| `services/` | 11 | 1650 | Business rules, transaction boundaries, audit trail |
| `templates/` | 5 | 522 | Printable document markup, as pure functions |
| `http/` | 12 | 1154 | Routers, Zod schemas, middleware |
| root | 2 | 260 | App assembly and lifecycle |

---

## What changed and why

### The data layer was a SQLite emulator

`server/db.js` wrapped PostgreSQL in a shim that rewrote SQL with regular
expressions — `?` → `$1`, `INSERT OR IGNORE` → `ON CONFLICT` — and synthesised
a `lastInsertRowid` by appending `RETURNING *` to inserts. It corrupted any
query containing a `?` inside a string literal or a JSON operator, and it hid
the real database behind a false interface.

It is replaced by `server/db/pool.js`: native `$1` placeholders, explicit
`queryOne` / `queryMany` / `execute`, and a `transaction()` that binds a client
to the async context so nested calls join the open transaction instead of
opening a second one.

### Schema changes had no history

The old `initDb()` re-issued `CREATE TABLE IF NOT EXISTS` and
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` on every boot. Nothing recorded what
had been applied, and two deployments could silently diverge.

`server/db/migrations/` now holds numbered SQL files applied once each, in
order, inside a transaction, under an advisory lock, recorded with a checksum
in `schema_migrations`. Editing an applied migration is reported rather than
ignored. Migration `002` moves the role, status and classification rules into
database `CHECK` constraints, so a direct `psql` session cannot produce a row
the application considers impossible.

### Four files held everything

`auth.js` (608 lines) mixed middleware, users, categories and the audit trail.
`exportService.js` (772) mixed authorisation, Markdown rendering, provenance,
spreadsheet generation and two full HTML documents. Route handlers issued SQL
directly.

Those are now 45 focused modules. A route handler reads validated input, calls
one service, and sends the result — nothing else.

### Validation was hand-rolled

`String(x).trim().slice(0, n)` repeated at each call site, with no shared
notion of what a request should look like. Every mutating endpoint now declares
a Zod schema in `http/validators/`; unknown keys are stripped, strings trimmed
and capped, enums checked once.

### Errors leaked or vanished

Each handler had its own `try/catch` and its own status code, and some returned
driver messages to the client. `lib/errors.js` defines a typed hierarchy;
services throw, and one handler in `http/middleware/` maps them. Anything not
declared is an internal fault: logged in full, reported generically.

### Logging was `console.log`

`lib/logger.js` is Pino: one JSON line per event in production, readable in
development, with tokens, passwords and connection strings redacted at the
logger so a careless call site cannot leak them.

---

## Cross-cutting rules

**Authority comes from the database, never the token.** A JWT proves *which*
account is calling. Role, status and `token_version` are re-read on every
request, so suspending, demoting or deleting a user takes effect immediately
(`services/authService.resolveSession`).

**Ownership is a WHERE clause.** Chat and message queries are scoped by
`user_id` in SQL rather than checked afterwards, so no code path can reach
another user's conversation by supplying its id.

**The platform never fabricates model output.** `services/modelService` proxies
the local engine and nothing else. If it is unreachable the request fails with
`503 MODEL_UNAVAILABLE`. A test scans the whole server tree for the removed
fabrication machinery and fails if it reappears under any name.

**Every exported document is registered.** `services/documentService` records a
sequential reference and the SHA-256 of the exact rendered body, verifiable at
`GET /api/export/verify/:ref`. Nothing decorative is printed as provenance.

**No secret has a fallback.** `config/index.js` refuses to start without
`JWT_SECRET` and `DATABASE_URL`. A test fails the build if a credential appears
in source or documentation.

---

## Request lifecycle

```
request
  → pino-http            request logging
  → helmet               CSP and security headers
  → cors                 same-origin always allowed; others get no CORS headers
  → express.json         body limit
  → /api router
      → authenticate     verify token, re-read account, enforce password change
      → requireAdmin     where applicable
      → validate(schema) parse and replace req.body / params / query
      → handler          calls exactly one service
  → errorHandler         typed error → status; anything else → 500 + log
```

## Startup sequence

`server/index.js` fails fast, in order: validate config → verify the database →
migrate → seed → listen. `SIGTERM` drains connections, stops the ticket
sweeper, and closes the pool, bounded at 10 seconds.

---

## Testing

```bash
npm test              # infrastructure: config, schema, seed, credentials, bundle, layering
npm run test:unit     # 16 unit tests — no database, no server
npm run test:security # 21 HTTP-level tests, one per audit finding
npm run test:all      # all three
```

The unit suite exists *because* of the refactor: CSV parsing, Markdown
sanitising, SSRF validation and the password policy were previously embedded in
route handlers and could only be reached over HTTP.

## Adding a feature

1. Migration in `db/migrations/` if the schema changes.
2. SQL in a repository.
3. Rules, transactions and audit calls in a service.
4. A Zod schema in `http/validators/`.
5. A thin route in `http/routes/`.
6. Unit tests for anything pure; a security test for anything that grants access.
