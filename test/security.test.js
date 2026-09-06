// End-to-end security regression suite.
//
// Every case here corresponds to a finding from the 2026-09-06 audit. These
// are real HTTP requests against a running server, not unit stubs: the point
// is to prove the attack paths are closed, not that the code compiles.
//
//   npm test                 (server must be running on TEST_BASE_URL)
//   TEST_BASE_URL=http://127.0.0.1:3001 npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

require('dotenv').config();

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SUFFIX = crypto.randomBytes(3).toString('hex');
const ADMIN = { username: `t_admin_${SUFFIX}`, password: 'Audit-Admin-2026' };
const USER = { username: `t_user_${SUFFIX}`, password: 'Audit-User-2026' };

let adminToken = '';
let userToken = '';
let victimChatId = '';

async function api(path, { method = 'GET', token, body, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };

  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-JSON response */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

async function seedAccount({ username, password }, role) {
  const category = await pool.query("SELECT id, name FROM categories LIMIT 1");
  await pool.query('DELETE FROM users WHERE username = $1', [username]);
  await pool.query(
    `INSERT INTO users (username, password_hash, display_name, role, department, category_id, job_title, status, must_change_password, token_version)
     VALUES ($1, $2, $3, $4, $5, $6, 'اختبار', 'active', 0, 1)`,
    [username, bcrypt.hashSync(password, 10), `Test ${role}`, role, category.rows[0].name, category.rows[0].id]
  );
}

async function login({ username, password }) {
  const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(res.status, 200, `login failed for ${username}: ${res.text}`);
  return res.body.token;
}

test.before(async () => {
  const health = await api('/api/health');
  assert.equal(health.status, 200, `server not reachable at ${BASE}`);

  await seedAccount(ADMIN, 'admin');
  await seedAccount(USER, 'user');
  adminToken = await login(ADMIN);
  userToken = await login(USER);
});

test.after(async () => {
  await pool.query('DELETE FROM users WHERE username LIKE $1', [`t_%_${SUFFIX}`]);
  await pool.end();
});

// ---------------------------------------------------------------
// A. Fabricated data
// ---------------------------------------------------------------
test('A1 no fabricated response is produced when the model is unreachable', async () => {
  const res = await api('/api/llm/chat', {
    method: 'POST',
    token: adminToken,
    body: { model: 'x', messages: [{ role: 'user', content: 'اعطني جدول بالبيانات والإحصاءات الرسمية' }] }
  });

  // Either a genuine model stream, or an explicit failure. Never invented content.
  if (res.status === 200) {
    assert.ok(!res.text.includes('1,420'), 'response contains the old hardcoded statistics');
    assert.ok(!res.text.includes('مصفوفة البيانات والمؤشرات الرسمية'), 'response contains the canned table');
  } else {
    assert.ok([502, 503].includes(res.status), `expected 502/503 on model failure, got ${res.status}`);
    assert.match(res.body.code, /MODEL_(UNAVAILABLE|ERROR)/);
  }
});

test('A1b the standby generator is gone from the source', () => {
  const src = require('node:fs').readFileSync(require.resolve('../server/lmstudio.js'), 'utf8');
  assert.ok(!src.includes('generateStandbyResponse'), 'generateStandbyResponse still exists');
  assert.ok(!src.includes('streamSimulatedResponse'), 'streamSimulatedResponse still exists');
  assert.ok(!src.includes('SOVEREIGN_STANDBY'), 'standby mode still advertised');
});

test('A2 document references are registered and verifiable, not random', async () => {
  const ticket = (await api('/api/export/ticket', { method: 'POST', token: adminToken })).body.ticket;

  const form = new URLSearchParams({
    ticket,
    title: 'وثيقة اختبار',
    content: '## عنوان\n\nنص المسودة.',
    metadata: JSON.stringify({ classification: 'official' })
  });
  const res = await fetch(`${BASE}/api/export/pdf-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  const html = await res.text();
  assert.equal(res.status, 200);

  const ref = html.match(/SY-GOV-\d{4}-\d{6}/)?.[0];
  assert.ok(ref, 'no registry reference printed on the document');

  const verify = await api(`/api/export/verify/${ref}`, { token: adminToken });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.verified, true);
  assert.match(verify.body.record.content_sha256, /^[0-9a-f]{64}$/);

  // The short hash printed on the page must match the registered digest.
  const printed = html.match(/SHA256: ([0-9A-F]{16})/)?.[1];
  assert.equal(printed, verify.body.record.content_sha256.slice(0, 16).toUpperCase());
});

test('A3 exported documents carry an explicit machine-generated notice', async () => {
  const ticket = (await api('/api/export/ticket', { method: 'POST', token: adminToken })).body.ticket;
  const res = await fetch(`${BASE}/api/export/pdf-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ticket, title: 'ت', content: 'نص' })
  });
  const html = await res.text();
  assert.ok(html.includes('مسودة'), 'document does not state that it is a draft');
  assert.ok(!html.includes('معتمد وموثق رقمياً'), 'document still claims digital certification');
});

// ---------------------------------------------------------------
// B. Access control
// ---------------------------------------------------------------
test('B1 self-registration is closed and cannot self-assign a role', async () => {
  const res = await api('/api/users', {
    method: 'POST',
    body: { username: `intruder_${SUFFIX}`, password: 'Intruder-2026', categoryId: 'cat_exec', role: 'admin' }
  });
  assert.equal(res.status, 403, 'unauthenticated account creation is still possible');
});

test('B1b the /api/auth/register alias no longer exists', async () => {
  const res = await api('/api/auth/register', { method: 'POST', body: {} });
  assert.equal(res.status, 404);
});

test('B2 export endpoints reject unauthenticated callers', async () => {
  for (const path of ['/api/export/pdf-page', '/api/export/xlsx', '/api/export/csv-page']) {
    const res = await api(path, { method: 'POST', body: { csvData: 'a,b', content: 'x' } });
    assert.equal(res.status, 401, `${path} is reachable without authentication`);
  }
});

test('B2b injected markup is sanitised, not reflected', async () => {
  const ticket = (await api('/api/export/ticket', { method: 'POST', token: adminToken })).body.ticket;
  const payload = '<script>alert(document.domain)</script>\n\n<img src=x onerror=alert(1)>\n\n**نص سليم**';

  const res = await fetch(`${BASE}/api/export/pdf-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ticket, title: 'ت', content: payload })
  });
  const html = await res.text();
  const body = html.split('<main class="doc-body">')[1].split('</main>')[0];

  assert.ok(!body.includes('<script'), 'script tag survived sanitisation');
  assert.ok(!body.includes('onerror'), 'event handler survived sanitisation');
  assert.ok(!body.includes('<img'), 'img tag survived sanitisation');
  assert.ok(body.includes('<strong>نص سليم</strong>'), 'legitimate Markdown was not rendered');

  assert.match(res.headers.get('content-security-policy') || '', /script-src 'nonce-/);
});

test('C1 Markdown is rendered to HTML, not dumped raw', async () => {
  const ticket = (await api('/api/export/ticket', { method: 'POST', token: adminToken })).body.ticket;
  const md = '## قرار\n\n| البند | القيمة |\n| --- | --- |\n| المخصص | 500 |\n';

  const res = await fetch(`${BASE}/api/export/pdf-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ticket, title: 'ت', content: md })
  });
  const body = (await res.text()).split('<main class="doc-body">')[1].split('</main>')[0];

  assert.ok(body.includes('<h2>'), 'heading was not rendered');
  assert.ok(body.includes('<table>'), 'table was not rendered');
  assert.ok(!body.includes('## قرار'), 'raw Markdown leaked into the document');
  assert.ok(!body.includes('| --- |'), 'raw table syntax leaked into the document');
});

test('B3 a user cannot read, clear or delete another user\'s chat', async () => {
  victimChatId = `chat_victim_${SUFFIX}`;
  const created = await api('/api/chats', {
    method: 'POST',
    token: adminToken,
    body: { id: victimChatId, title: 'ملف سري', classification: 'top_secret' }
  });
  assert.equal(created.status, 201);

  await api(`/api/chats/${victimChatId}/messages`, {
    method: 'POST',
    token: adminToken,
    body: { role: 'user', content: 'محتوى سري' }
  });

  assert.equal((await api(`/api/chats/${victimChatId}`, { token: userToken })).status, 404);
  assert.equal((await api(`/api/chats/${victimChatId}/messages`, { method: 'DELETE', token: userToken })).status, 404);
  assert.equal((await api(`/api/chats/${victimChatId}`, { method: 'DELETE', token: userToken })).status, 404);

  const after = await api(`/api/chats/${victimChatId}`, { token: adminToken });
  assert.equal(after.body.messages.length, 1, 'the victim\'s messages were destroyed');

  await api(`/api/chats/${victimChatId}`, { method: 'DELETE', token: adminToken });
});

test('B4 no default credential or signing key is present in the source or docs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

  const db = read('server/db.js');
  // The string may appear only as a comparison that forces a change on an
  // account still carrying the old default — never as a password being set.
  assert.ok(!/hashSync\(\s*['"]admin123['"]/.test(db), 'db.js still seeds the admin123 password');
  assert.ok(!/['"]admin123['"]/.test(db) || db.includes('compareSync'),
    'admin123 appears in db.js outside the remediation check');

  assert.ok(!read('server/auth.js').includes('shaheen-local-secret-key'), 'hardcoded JWT signing key still present');
  assert.ok(!db.includes('SecurePassword'), 'hardcoded database password still present');

  // A credential published in the documentation is a published credential.
  for (const doc of ['README.md', 'AGENT.md']) {
    if (!fs.existsSync(path.join(root, doc))) continue;
    assert.ok(!read(doc).includes('admin123'), `${doc} still publishes the default administrator password`);
  }
});

test('B5 suspending a user invalidates their existing session immediately', async () => {
  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [USER.username]);
  const id = rows[0].id;

  assert.equal((await api('/api/chats', { token: userToken })).status, 200);

  const upd = await api(`/api/users/${id}`, { method: 'PUT', token: adminToken, body: { status: 'suspended' } });
  assert.equal(upd.status, 200);

  assert.equal((await api('/api/chats', { token: userToken })).status, 403, 'suspended user still has access');
  assert.equal(
    (await api('/api/llm/chat', { method: 'POST', token: userToken, body: { messages: [{ role: 'user', content: 'hi' }] } })).status,
    403,
    'suspended user can still query the model'
  );

  await api(`/api/users/${id}`, { method: 'PUT', token: adminToken, body: { status: 'active' } });
  userToken = await login(USER); // the reactivation bumped token_version
});

test('B5b deleting a user invalidates their existing session immediately', async () => {
  await seedAccount({ username: `t_temp_${SUFFIX}`, password: 'Temp-Pass-2026' }, 'user');
  const token = await login({ username: `t_temp_${SUFFIX}`, password: 'Temp-Pass-2026' });
  assert.equal((await api('/api/chats', { token })).status, 200);

  const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [`t_temp_${SUFFIX}`]);
  assert.equal((await api(`/api/users/${rows[0].id}`, { method: 'DELETE', token: adminToken })).status, 200);
  assert.equal((await api('/api/chats', { token })).status, 401, 'deleted user still has access');
});

test('B5c a non-admin cannot reach administrative endpoints', async () => {
  assert.equal((await api('/api/users', { token: userToken })).status, 403);
  assert.equal((await api('/api/users/stats', { token: userToken })).status, 403);
  assert.equal((await api('/api/audit-logs', { token: userToken })).status, 403);
  assert.equal((await api('/api/settings', { method: 'PUT', token: userToken, body: { system_name: 'x' } })).status, 403);
});

test('B7 settings require authentication and never expose the signing key', async () => {
  assert.equal((await api('/api/settings')).status, 401);

  const res = await api('/api/settings', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.jwt_secret, undefined, 'the JWT signing key is exposed through the settings API');
});

// ---------------------------------------------------------------
// C. Correctness
// ---------------------------------------------------------------
test('C4 a rejected user update writes nothing', async () => {
  const { rows } = await pool.query('SELECT id, display_name FROM users WHERE username = $1', [USER.username]);
  const before = rows[0].display_name;

  const res = await api(`/api/users/${rows[0].id}`, {
    method: 'PUT',
    token: adminToken,
    body: { displayName: 'MUTATED_BY_TEST', newPassword: '123' }
  });
  assert.equal(res.status, 400);

  const after = (await pool.query('SELECT display_name FROM users WHERE id = $1', [rows[0].id])).rows[0].display_name;
  assert.equal(after, before, 'the rejected request still mutated the record');
});

test('D SSRF: the model endpoint cannot be pointed at an external host', async () => {
  const res = await api('/api/settings', {
    method: 'PUT',
    token: adminToken,
    body: { lm_studio_url: 'http://169.254.169.254/latest/meta-data' }
  });
  assert.equal(res.status, 400, 'an external model URL was accepted');
});

test('D unknown settings keys are rejected', async () => {
  const res = await api('/api/settings', { method: 'PUT', token: adminToken, body: { jwt_secret: 'pwned' } });
  assert.equal(res.status, 400, 'the settings API accepted an unknown key');
});

test('D uploads reject unsupported file types', async () => {
  const form = new FormData();
  form.append('files', new Blob([Buffer.from([0x4d, 0x5a, 0x90, 0x00])]), 'payload.exe');

  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form
  });
  assert.equal(res.status, 400, 'an executable was accepted for parsing');
});

test('D unknown API routes return JSON, not the SPA shell', async () => {
  const res = await api('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.ok(res.body?.error, 'the SPA shell was served for an unknown API route');
});

test('D security headers are present on the application', async () => {
  const res = await api('/api/health', { raw: true });
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});
