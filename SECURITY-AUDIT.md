# Security & Correctness Audit — منظومة OSS للذكاء الاصطناعي

**Date:** 2026-09-06 · **Commit:** a3b1aba (+ uncommitted changes) · **Scope:** full stack (server, client, deployment, tests)
**Method:** static review of all 6,938 LOC + live exploitation against a running instance on ports 3999/3998.

> **Verdict: NOT SAFE TO DEPLOY.** 22 issues, 10 critical. The most serious is not a security hole — it is
> that the system **fabricates official government data** and presents it as real.

---

## A. FABRICATED DATA

### A1 — CRITICAL — The server invents statistics and presents them as official measurements

**File:** `server/lmstudio.js:13-127` (`generateStandbyResponse`), reached from `:283`

Whenever LM Studio is unreachable **or returns any non-2xx status**, the server silently substitutes a
hardcoded canned document and streams it through the same SSE channel a real model uses, with an
artificial 22 ms/word delay (`streamSimulatedResponse`, `:131`) that **imitates a model typing**. There is
no flag, banner, or field distinguishing it from a genuine answer.

Verified live (LM Studio pointed at a dead port, asked for "جدول بالبيانات والإحصاءات الرسمية"):

```
## 📊 مصفوفة البيانات والمؤشرات الرسمية
**الرمز المرجعي:** `SY-GOV-2026-4797`
| المعرف | المؤشر المؤسسي              | القيمة الفعلية | نسبة الإنجاز | التقييم الرسمي |
| 101    | استكمال الربط الرقمي للأنظمة | 94%           | 94%          | ممتازة          |
| 102    | تدقيق المعاملات إلكترونياً    | 1,420 معاملة  | 94.6%        | مطابق للمعايير  |
| 103    | نسبة الأمان والعزل الرقمي     | 100%          | 100%         | حماية معزولة تامة |
```

Those numbers exist nowhere but in the source file. They are labelled **القيمة الفعلية** ("actual value")
and **التقييم الرسمي** ("official assessment"), carry a state reference number, and the response then
invites the user to export them to Excel or to PDF on Syrian state letterhead. A civil servant has no way
to know this is fiction.

Two further fabrications in the same function:

- **`:32`** — for any message containing an attachment marker, it emits *"تمت قراءة وتحليل المستند المرفق
  بالكامل والتحقق من بنيته"* — claiming a document was fully read and audited. **No document is read.** The
  branch is selected by `String.includes`; file content is never examined.
- **`:73`** — emits a draft official letter closing with *"خاتم الاعتماد والتوثيق الإلكتروني"* /
  *"معتمد رقمياً"* — a claimed digital certification that does not exist.

**Fix:** delete `generateStandbyResponse` and `streamSimulatedResponse`. On failure return `503` with a
plain error. Never synthesise content. Any standby message must contain no numbers, no tables, no
reference codes, and no certification language.

### A2 — CRITICAL — Fake "security hash" and reference numbers on official documents

**File:** `server/exportService.js:90-91`, rendered at `:325`, `:334`, `:346`, `:384`, `:436`

```js
const docRef = `SY-GOV-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
const securityHash = 'SHN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
```

Both are `Math.random()`. They print on the document as **"الرقم الإشاري"**, **"الرمز الأمني"**, and inside
the seal box as **`HASH:`** beside *"خاتم الاعتماد والتوثيق الإلكتروني"* and *"وثيقة معتمدة ومحفوظة بالسجل
المحلي الموحد"* ("certified and stored in the unified local registry"). Nothing is hashed, nothing is
registered, nothing is verifiable — and two documents can collide. This is forged provenance metadata on a
document bearing the state emblem.

**Fix:** either implement real provenance (sequential registry number persisted in the DB + SHA-256 of the
document body, verifiable through a lookup endpoint) or remove the seal, the hash and the reference line.
Do not print unverifiable authenticity markers.

### A3 — CRITICAL — The UI hides the fact that no AI is running

**Files:** `server/lmstudio.js:181-192`, `client/src/components/WelcomeScreen.jsx:61`

With LM Studio down, `/api/llm/models` returns `connected: false` but advertises a model named
*"المحرك الداخلي الاحتياطي (جاهز للعمل المباشر)"* ("internal standby engine, ready for direct operation"),
and the welcome screen renders *"المحرك الداخلي نشط وجاهز للعمل محلياً"*. Both describe the canned-text
generator as a working engine. The user is told the system is operational when it is not.

**Fix:** when `connected` is false, show a plain unavailable state and disable the composer.

---

## B. CRITICAL SECURITY DEFECTS (all verified by live exploit)

### B1 — Anyone on the network can create an account, at the highest clearance

**File:** `server/auth.js:255-268`; `server/db.js:200` defaults `allow_user_registration` to `'true'`

```
$ curl -X POST http://host:3001/api/auth/register -d \
  '{"username":"intruder_test","password":"123456","categoryId":"cat_exec"}'
{"message":"تم إنشاء الحساب واعتماد التصنيف بنجاح",
 "user":{"categoryName":"القيادة والإدارة العليا","categoryCode":"EXEC","status":"active"},
 "token":"eyJhbGciOiJIUzI1..."}
```

No authentication. `categoryId` is caller-supplied, so the attacker self-assigns to the `top_secret` EXEC
department and receives a valid 30-day JWT immediately — then reads the org chart, all categories, all
templates, uploads files, and queries the model.

**Fix:** default `allow_user_registration` to `'false'`; remove the `/api/auth/register` alias; require
`adminMiddleware` on `POST /api/users`.

### B2 — Export endpoints are unauthenticated and inject raw HTML → XSS on the app origin

**Files:** `server/index.js:28` (`registerExportRoutes(app)` — no middleware passed);
`server/exportService.js:61, 255, 374, 423`

`title` is escaped; **`content` is not** (`:255` → `<main class="doc-body">${content}</main>`). Verified:

```
$ curl -X POST http://host:3001/api/export/pdf-page -d \
  '{"title":"T","content":"<script>alert(document.domain)</script><h1>INJECTED</h1>",
    "metadata":{"classification":"top_secret"}}'
→ HTTP 200
  line 248: درجة السرية والتصنيف: [ سري للغاية ومكتوم ]
  line 255: <main class="doc-body"><script>alert(document.domain)</script><h1>INJECTED</h1></main>
```

Two impacts:

1. **Forgery** — an unauthenticated stranger produced a **TOP SECRET**-marked Syrian government document
   with the state emblem, a fake security code, and a certification seal.
2. **XSS on the application's own origin.** The JWT lives in `localStorage`
   (`client/src/services/api.js:5,22`), so injected script reads it directly. Message content is passed to
   this endpoint verbatim (`MessageItem.jsx:51`, `ChatView.jsx:58`), so any `<script>` in a chat message —
   user-typed or model-emitted — executes when the document is exported.

**Fix:** add `authMiddleware` to all three export routes; render Markdown server-side through a sanitising
pipeline (`marked` + `sanitize-html`) instead of interpolating raw input; set a strict CSP on these
responses; move the token to an `HttpOnly`, `SameSite=Strict` cookie.

### B3 — IDOR: any user can wipe any other user's conversation

**File:** `server/index.js:159-163`

```js
app.delete('/api/chats/:id/messages', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);   // no ownership check
```

Every sibling route checks `AND user_id = ?`. This one does not, and writes no audit entry. Verified: a
plain `role: 'user'` account deleted the messages of an admin-owned `top_secret` chat it did not own
(`messages before: 1 → messages after: 0`), receiving `تم إفراغ سجل الرسائل بنجاح`.

**Fix:** load the chat with `WHERE id = ? AND user_id = ?`, 404 otherwise, and `logAudit` the action.

### B4 — Hardcoded JWT secret; default admin password published in the repo

**Files:** `server/auth.js:5`, `server/db.js:226-231`, `README.md:78`, `AGENT.md:185`

```js
const JWT_SECRET = process.env.JWT_SECRET || 'shaheen-local-secret-key-2026-secure';
```

Neither `Dockerfile` nor `docker-compose.yml` sets `JWT_SECRET`, so every container ships with this public
secret — anyone with the source can forge an `admin` token. Separately the admin account is seeded as
`admin` / `admin123`, the password is `console.log`-ed at boot, and **the README documents it** under
"حساب المشرف الافتراضي". `AGENT.md:77` claims the credential hint was "removed" — it was removed from the
login modal only; the README still broadcasts it.

**Fix:** fail to boot when `JWT_SECRET` is unset (no fallback); generate a random admin password on first
run, print it once, force a change at first login; delete the credentials from README and AGENT.md.

### B5 — Sessions cannot be revoked: suspending, demoting, or deleting a user does nothing

**File:** `server/auth.js:9-22, 25-31` — `authMiddleware` verifies the JWT signature and never touches the DB.

Verified:

| Admin action | Victim's existing token afterwards |
| :-- | :-- |
| `status → suspended` | still works — `GET /api/chats` → **200**, `POST /api/llm/chat` → **200** |
| account **deleted** | still works — `GET /api/chats` → **200** |

`role` is likewise read from the token, so a demoted admin keeps admin rights. Tokens last **30 days**
(`:46`). Dismissing an employee leaves them up to a month of live access to a system handling material
classified `سري للغاية`.

**Fix:** re-load the user in `authMiddleware` and reject missing/non-`active` accounts; take `role` from
the DB row, not the token; shorten expiry to ~8h with refresh; add a `token_version` column bumped on
suspend / delete / role-change / password-reset.

### B6 — No rate limiting anywhere

20 consecutive failed logins → `401 401 401 … 401`, never a `429`. Combined with a published default
password (B4), compromise is trivial. `/api/upload` and `/api/llm/chat` are likewise unthrottled.

**Fix:** `express-rate-limit` globally, a stricter per-IP + per-username limiter on `/api/auth/login`, and
progressive lockout recorded in `audit_logs`.

### B7 — `GET /api/settings` is unauthenticated

**File:** `server/index.js:171-176` (the client matches — `api.js` sends no auth header)

Returns `lm_studio_url`, `organization_name`, `default_system_prompt`, and `allow_user_registration` to
anyone. That last field tells an attacker whether B1 is open. **Fix:** add `authMiddleware`.

---

## C. FUNCTIONAL / CORRECTNESS BUGS

### C1 — HIGH — The official PDF export prints raw Markdown

**Files:** `client/src/components/MessageItem.jsx:51`, `ChatView.jsx:58` → `server/exportService.js:255`

The client sends the message's **raw Markdown**; the server interpolates it into HTML without converting
it. The stylesheet at `:206-216` defines `.doc-body table`, `.doc-body th`, `.doc-body h1/h2/h3` — the
author clearly intended rendered HTML — but nothing renders it. Verified output on state letterhead:

```html
<main class="doc-body">## قرار إداري رقم 12

**أولاً:** يعتمد ما يلي:

| البند | القيمة |
| :--- | :---: |
```

Every exported document shows `##`, `**`, and pipe-table syntax under the state emblem. The flagship
export feature does not work.

**Fix:** render Markdown → sanitised HTML server-side (this also fixes B2).

### C2 — HIGH — `docker compose up --build` fails; the documented deploy path is broken

**Files:** `.dockerignore:22` excludes `client/src`; `Dockerfile:22` copies `client/src/assets/`

Confirmed with a real `docker build` (Docker 29.7.2):

```
ERROR: failed to solve: failed to compute cache key: "/client/src/assets": not found
```

README §"الخيار 2" and AGENT.md both advertise this path.

**Fix:** un-ignore the assets (`client/src` plus `!client/src/assets`), or serve the eagle asset from
`client/public`.

### C3 — HIGH — `docker-compose.yml` bind-mounts a single SQLite file → data loss

**File:** `docker-compose.yml` — `- ./server/shaheen.db:/app/server/shaheen.db`

`db.js:9` enables `journal_mode = WAL`, which requires `shaheen.db-wal` and `-shm` **in the same
directory**. Only the `.db` file is mounted, so the WAL — holding the most recent committed transactions —
lives inside the container layer and is **destroyed on `docker compose down`**. Recent chats, users and
audit records vanish; single-file bind mounts also break on inode replacement.

**Fix:** mount the directory (`./server/data:/app/server/data`) and point `dbPath` at it.

### C4 — MEDIUM — Partial write on a rejected user update

**File:** `server/auth.js:399-407`

The `UPDATE` runs at `:390` **before** the `newPassword.length < 6` check at `:400`. Verified:

```
PUT /api/users/1 {"displayName":"MUTATED_NAME","newPassword":"123"}
→ HTTP 400 {"error":"كلمة المرور الجديدة يجب ألا تقل عن 6 خانات"}
→ DB: { display_name: 'MUTATED_NAME' }     ← written anyway
```

The admin sees an error and reasonably assumes nothing changed.

**Fix:** validate everything first, then apply all writes inside one `db.transaction`.

### C5 — MEDIUM — Crash path when LM Studio drops mid-stream

**File:** `server/lmstudio.js:262-277`

If `reader.read()` throws after headers are sent, control reaches the `catch` at `:274` and
`streamSimulatedResponse` then calls `res.setHeader` — `ERR_HTTP_HEADERS_SENT`. The answer is truncated
with no error surfaced. Separately, when LM Studio returns a non-2xx status, `if (lmResponse.ok)` is simply
false and execution falls through to the fabricated response (A1) — a model error becomes a fake document.

**Fix:** guard with `if (res.headersSent) return res.end();`, handle `!lmResponse.ok` explicitly with a
`502`, and abort the upstream fetch on `req.on('close')`.

### C6 — MEDIUM — The client never validates its session

**File:** `client/src/App.jsx:11` — `useState(api.getStoredUser())`; `api.getMe()` is defined but never called.

The session is restored purely from `localStorage`, and load failures are swallowed by `console.error`
(`:60`, `:70`). An expired or revoked token yields a logged-in-looking but empty UI instead of a login
prompt. `role` is also read from `localStorage` (`App.jsx:418`, `Sidebar.jsx:336`), so admin menus unlock
by editing browser storage — the server still blocks the operations (`adminMiddleware`), so this is UI
integrity rather than privilege escalation, but it misleads.

**Fix:** call `getMe()` on mount, drive `currentUser` from the response, and log out on any 401.

---

## D. HARDENING & HYGIENE

| # | Issue | Location | Fix |
| :-- | :-- | :-- | :-- |
| D1 | `xlsx@0.18.5` — prototype pollution (CVSS 7.8) + ReDoS (7.5); **no npm fix exists** | `package.json` | install SheetJS ≥ 0.20.2 from `cdn.sheetjs.com`, or move to `exceljs` |
| D2 | `cors({ origin: '*' })` on a classified system | `server/index.js:16` | restrict to the deployment origin |
| D3 | No `helmet`, no CSP, no HSTS; served over plain HTTP | `server/index.js` | add `helmet`, terminate TLS |
| D4 | Uploads: no MIME/extension whitelist — binaries are decoded as UTF-8 and fed to the model; 10 × 50 MB buffered in RAM = 500 MB spike | `server/upload.js:8-11, 66` | whitelist extensions, lower the limit, cap concurrency |
| D5 | Container runs as **root**; build toolchain (`python3 make g++`) left in the final image | `Dockerfile` | multi-stage build + `USER node` |
| D6 | PDF/CSV templates load fonts from `fonts.googleapis.com` / `gstatic.com` — **directly contradicts the "معزول 100% عن الإنترنت" claim shown in the UI** | `exportService.js:99-101, 444-446` | self-host; the fonts already exist in `client/public/fonts` |
| D7 | `logAudit` receives an object at most call sites but a string at two | `index.js:127`, `templates.js:60, 101, 131` | standardise on objects |
| D8 | `clearChat` writes no audit record | `index.js:159` | add one alongside B3 |
| D9 | `desc` used as a column name — a SQL keyword; tolerated by SQLite, breaks on any port | `db.js:76` | rename to `description` |
| D10 | SSRF: `lm_studio_url` is admin-writable and passed verbatim to `fetch` | `lmstudio.js:3-11` | validate against a loopback allow-list |

### D11 — `test/verification.js` is not a test suite, and it enforces the vulnerability

65 lines, 4 assertions, **zero HTTP requests** — no route, no authentication and no authorization is
exercised. Line 29 asserts `bcrypt.compareSync('admin123', user.password_hash)`: **fixing the default
password makes the suite fail.** It nonetheless prints
`جميع الاختبارات الميكانيكية والتحقق نجحت 100%!`, which is how a system carrying the ten critical defects
above reports itself as fully verified.

**Fix:** delete the `admin123` assertion; add supertest coverage for auth, ownership (B3), admin gating,
revocation (B5), and export escaping (B2).

---

## Recommended order of work

1. **A1, A2, A3** — remove all fabricated content and forged provenance. Nothing else matters while the
   system can invent official statistics.
2. **B1, B2, B3, B4, B5** — close the unauthenticated paths, the IDOR, and the revocation gap.
3. **C1, C2, C3** — make the export and deployment paths actually work.
4. **B6, B7, C4, C5, C6**, then section D.
5. Rewrite the test suite (D11) before re-claiming any verification status.

Do not put this in front of a government user until at least items 1–3 are done.
