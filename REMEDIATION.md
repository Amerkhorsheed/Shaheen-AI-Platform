# Remediation Report — منظومة OSS للذكاء الاصطناعي

**Date:** 2026-09-06 · **Baseline:** [SECURITY-AUDIT.md](SECURITY-AUDIT.md) (22 findings, 10 critical)
**Backend at time of remediation:** PostgreSQL 16 + pgvector (Docker) — migrated from SQLite mid-session
**Verification:** `npm test` (infrastructure) + `npm run test:security` (21 HTTP-level regression tests) — **21/21 passing**

---

## Status by finding

| # | Finding | Status | Proven by |
| :-- | :-- | :-- | :-- |
| **A1** | Server fabricated official statistics when the model was unreachable | **Fixed** — `generateStandbyResponse` and `streamSimulatedResponse` deleted. Unreachable model → `503 MODEL_UNAVAILABLE`; upstream error → `502 MODEL_ERROR`; mid-stream failure → an SSE error frame, never silent truncation. | A1, A1b |
| **A2** | `Math.random()` reference numbers and a fake `HASH:` on the state seal | **Fixed** — `document_registry` table; sequential `SY-GOV-YYYY-NNNNNN` per year; SHA-256 of the exact rendered body; verifiable via `GET /api/export/verify/:ref`. Seal text now claims only what it can prove; the signature block is left blank for a human. | A2 |
| **A3** | UI advertised a "standby engine" when no AI was running | **Fixed** — `/api/llm/models` reports `connected:false` with the real reason and an empty model list. The welcome screen shows an explicit unavailable state. | A1b + live UI check |
| — | *(new)* Exported documents carried no provenance warning | **Added** — every document and dataset export states it is a machine-generated draft with no administrative or legal effect until reviewed and signed. | A3 |
| — | *(new)* Model was free to invent figures | **Added** — the default system prompt now forbids inventing numbers, dates and legal references, and requires «غير متوفر» instead of an estimate. | — |
| **B1** | Unauthenticated registration, self-assigned to `top_secret` | **Fixed** — `/api/auth/register` removed; `allow_user_registration` defaults to `false` and is force-closed once on upgrade; role is never caller-controlled; self-registered accounts are created **suspended**. | B1, B1b |
| **B2** | Export endpoints unauthenticated + raw HTML injection (XSS) | **Fixed** — single-use, 120 s export tickets; Markdown rendered through `marked` + `sanitize-html` allowlist; per-response CSP with a script nonce; no inline handlers. | B2, B2b |
| **B3** | IDOR — any user could wipe any chat | **Fixed** — every chat/message route goes through `ownedChat()`; clearing is audit-logged with the row count. | B3 |
| **B4** | Hardcoded JWT secret; `admin123` published in the README | **Fixed** — no credential or key literal in source or docs; server refuses to start without `JWT_SECRET`; first boot generates a random admin password, printed once, with a forced change. Accounts still holding the old default are flagged automatically at startup. | B4 |
| **B5** | Suspend / delete / demote did not revoke live sessions | **Fixed** — `authMiddleware` re-reads the account on every request; `token_version` is bumped on any privilege, status or credential change; role comes from the database, never the token; TTL 30 d → 8 h. | B5, B5b, B5c |
| **B6** | No rate limiting | **Fixed** — per-IP **and** per-username login limiter (IPv6 normalised to /64), plus a write limiter on mutating routes. | manual: 10×401 → 429 |
| **B7** | `GET /api/settings` unauthenticated | **Fixed** — authenticated, allowlisted keys only; the signing key is stored in the same table and can neither be read nor written through the API. | B7 |
| **C1** | Official PDF export printed raw Markdown | **Fixed** — server-side Markdown → sanitised HTML; headings, tables, lists and code render correctly on the letterhead. | C1 |
| **C2** | `docker compose up --build` failed | **Fixed** — `.dockerignore` no longer excludes `client/src/assets`. Build verified end to end. | `docker build` OK |
| **C3** | SQLite WAL data loss via single-file bind mount | **Resolved by the PostgreSQL migration** — data now lives in the `shaheen_postgres_data` named volume. | — |
| **C4** | Rejected user update still wrote changes | **Fixed** — full validation before any write; all writes in one transaction. | C4 |
| **C5** | Crash path when the model dropped mid-stream | **Fixed** — `headersSent` guard, explicit non-2xx handling, upstream aborted on client disconnect. | code review |
| **C6** | Client never validated its session | **Fixed** — `getMe()` on mount drives the user object; 401 clears storage and returns to login with a reason; `PASSWORD_CHANGE_REQUIRED` opens a blocking modal. Generation errors render as a distinct error banner, **never as an assistant message**. | live UI check |
| **D1** | `xlsx@0.18.5` — prototype pollution + ReDoS, no npm fix | **Fixed** — replaced with `exceljs` for both reading uploads and writing exports; `uuid` pinned via `overrides`. `npm audit`: **0 vulnerabilities**. | `npm audit` |
| **D2** | `cors({origin:'*'})` | **Fixed** — same-origin always allowed (any port), extra origins via `ALLOWED_ORIGINS`; a disallowed origin gets no CORS headers rather than a 500. | manual |
| **D3** | No security headers | **Fixed** — `helmet` with an explicit CSP, `nosniff`, `no-referrer`, `frame-ancestors 'none'`, no `X-Powered-By`. | D headers |
| **D4** | Uploads: no type checks, 500 MB memory spike | **Fixed** — extension allowlist + magic-byte checks, 15 MB × 10 files, sequential parsing, 400 k character cap, filenames only in the audit log. | D uploads |
| **D5** | Container ran as root with the build toolchain | **Fixed** — multi-stage build, `USER node`, `dumb-init`, healthcheck, `read_only`, `cap_drop: ALL`, `no-new-privileges`. Postgres no longer publishes 5432 to the host. | image inspected |
| **D6** | Google Fonts loaded — contradicted the air-gap claim | **Fixed** — IBM Plex Sans Arabic and Amiri (both OFL) vendored to `client/public/fonts/vendor/`. **Zero external references** in the built client and in both export templates. | grep on `dist/` |
| **D7–D9** | Audit-log inconsistency, missing entries, `desc` keyword column | **Fixed** — audit details always JSON objects; clear/export/upload/settings all logged; column renamed to `description` (with a `desc` alias for client compatibility). | — |
| **D10** | SSRF via the operator-set model URL | **Fixed** — loopback / RFC1918 / `host.docker.internal` only, validated on read **and** on write. | D SSRF |
| **D11** | Test suite asserted the default password | **Fixed** — that assertion is gone; the suite now *fails* if any account still uses the old default without a forced change. Added 21 HTTP-level security regression tests. | — |

### Also changed
- **Credentials rotated:** the PostgreSQL role password and the JWT signing key both matched values that were sitting in committed source. Both were rotated; all sessions were invalidated.
- **`npm run reset-admin-password`** — break-glass recovery that issues a one-time password and forces a change.
- **`.env.example`** documents every variable; `docker compose` now refuses to start rather than fall back to a shared default credential.

---

## Open items — read before deploying

1. **Another process in this workspace is editing the repository concurrently.** Commit `4794b0c`
   ("enterprise hardening…") **reintroduced every credential removed earlier in this session**: the
   hardcoded JWT secret in `server/auth.js`, `admin123` in `server/db.js`, the PostgreSQL password in
   `server/migrateToPg.js`, and the credential blocks in `README.md` / `AGENT.md`. They were removed
   again. **Run `npm run test:security` before every release** — test **B4** is what caught it, and
   it will catch a recurrence. Until you know what is making those edits, treat every commit as
   requiring this check.

2. **Account passwords not set by this remediation.** `legal_counsel` and the `analyst_mtpt*` accounts
   were created by that other process; their password strength is unknown here. Review them, and
   delete the `analyst_mtpt*` accounts if they were test artefacts.

3. **The PostgreSQL migration was not part of this work.** The adapter and schema were hardened and
   the whole API re-verified against them, but `server/migrateToPg.js` has not had a line-by-line
   review. The old SQLite file remains at `server/shaheen.db` (gitignored) — keep it until you have
   confirmed the migrated data, then remove it.

4. **Rotate the PostgreSQL password again if the repository was ever pushed**, since
   `SecurePassword2026!` was committed. Changing the role password is enough; the volume is unaffected.

5. **Not yet done:** TLS (the platform still speaks plain HTTP — set `ENABLE_HSTS=true` once a
   reverse proxy terminates TLS), backup/restore procedure for the Postgres volume, and log rotation
   for `audit_logs`, which grows without bound.

---

## Running the checks

```bash
npm start                     # server (requires .env — see .env.example)
npm test                      # infrastructure: DB, categories, credential hygiene, client build
npm run test:security         # 21 HTTP-level security regression tests (server must be running)
npm run reset-admin-password  # break-glass administrator recovery
docker compose up -d --build  # full stack; refuses to start without secrets in .env
```
