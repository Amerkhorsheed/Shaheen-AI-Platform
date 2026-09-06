'use strict';

/**
 * Unit tests for the pure modules.
 *
 * These need no database and no server. Before the refactor this logic was
 * embedded in route handlers and could only be exercised by making an HTTP
 * request; extracting it into libraries and services is what makes these
 * possible at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { parseCsv, contentDisposition } = require('../server/lib/csv');
const { decodeFilename } = require('../server/services/fileService');
const { escapeHtml, renderMarkdown, documentCsp } = require('../server/lib/html');
const { assertSafeModelUrl, clampTemperature, clampMaxTokens } = require('../server/services/modelService');
const { validatePassword } = require('../server/services/authService');
const { AppError, NotFoundError } = require('../server/lib/errors');
const { resolveClassification } = require('../server/templates/classifications');
const {
  createPromptModuleSchema,
  updatePromptModuleSchema,
  setCategoryModulesSchema,
  promptPreviewSchema
} = require('../server/http/validators');
const {
  SYSTEM_CHARTER,
  PROMPT_MODULES,
  CATEGORY_MODULE_MAP,
  CATEGORY_DIRECTIVES,
  SUPERSEDED_CHARTERS
} = require('../server/db/promptLibrary');

// ---------------------------------------------------------------
// CSV
// ---------------------------------------------------------------
test('parseCsv handles quoted commas, escaped quotes and embedded newlines', () => {
  const csv = 'البند,القيمة\n"بند, بفاصلة",500\n"يقول ""نعم""",12\n"سطر\nثانٍ",7\n';
  assert.deepEqual(parseCsv(csv), [
    ['البند', 'القيمة'],
    ['بند, بفاصلة', '500'],
    ['يقول "نعم"', '12'],
    ['سطر\nثانٍ', '7']
  ]);
});

test('parseCsv drops blank rows and tolerates empty input', () => {
  assert.deepEqual(parseCsv('a,b\n\n\nc,d\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('   '), []);
});

test('parseCsv normalises CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('contentDisposition survives an Arabic filename', () => {
  const header = contentDisposition('تقرير المالية.xlsx');
  assert.match(header, /filename="[^"]*\.xlsx"/);       // ASCII fallback
  assert.match(header, /filename\*=UTF-8''/);            // RFC 5987 form
  assert.ok(!/[؀-ۿ]/.test(header.split('filename*')[0]), 'raw Arabic leaked into the ASCII part');
});

test('decodeFilename repairs Latin-1 / UTF-8 mojibake into clean Arabic', () => {
  const corrupted = Buffer.from('تدفقات ومدفوعات شهر8.xlsx', 'utf8').toString('latin1');
  assert.equal(decodeFilename(corrupted), 'تدفقات ومدفوعات شهر8.xlsx');
});

test('decodeFilename preserves already valid Arabic, ASCII, and accented filenames', () => {
  assert.equal(decodeFilename('تدفقات ومدفوعات شهر8.xlsx'), 'تدفقات ومدفوعات شهر8.xlsx');
  assert.equal(decodeFilename('document_2026.pdf'), 'document_2026.pdf');
  assert.equal(decodeFilename('café.pdf'), 'café.pdf');
  assert.equal(decodeFilename(''), '');
  assert.equal(decodeFilename(null), '');
});

// ---------------------------------------------------------------
// HTML rendering and sanitisation
// ---------------------------------------------------------------
test('escapeHtml neutralises every markup character', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#039;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('renderMarkdown produces real HTML for headings, tables and emphasis', () => {
  const html = renderMarkdown('## عنوان\n\n**عريض**\n\n| أ | ب |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<h2>/);
  assert.match(html, /<strong>عريض<\/strong>/);
  assert.match(html, /<table>/);
  assert.ok(!html.includes('## عنوان'), 'raw Markdown survived rendering');
});

test('renderMarkdown strips scripts, event handlers, images and iframes', () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="//evil"></iframe>\n\n<div onclick="x()">نص</div>'
  );
  assert.ok(!html.includes('<script'), 'script survived');
  assert.ok(!html.includes('onerror'), 'event handler survived');
  assert.ok(!html.includes('<img'), 'img survived');
  assert.ok(!html.includes('<iframe'), 'iframe survived');
  assert.ok(!html.includes('onclick'), 'inline handler survived');
  assert.match(html, /نص/, 'legitimate text was discarded');
});

test('renderMarkdown rewrites links to be safe and keeps javascript: out', () => {
  const safe = renderMarkdown('[موقع](https://example.gov.sy)');
  assert.match(safe, /rel="noopener noreferrer nofollow"/);

  const unsafe = renderMarkdown('[اضغط](javascript:alert(1))');
  assert.ok(!unsafe.includes('javascript:'), 'javascript: URL survived');
});

test('documentCsp forbids external sources and requires a script nonce', () => {
  const csp = documentCsp('abc123');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-abc123'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!csp.includes("script-src 'unsafe-inline'"), 'inline script is permitted');
});

// ---------------------------------------------------------------
// Model endpoint validation (SSRF)
// ---------------------------------------------------------------
test('assertSafeModelUrl accepts loopback and private addresses', () => {
  for (const url of [
    'http://127.0.0.1:1234/v1',
    'http://localhost:1234/v1',
    'http://192.168.1.50:1234/v1',
    'http://10.0.0.4:1234/v1',
    'http://172.16.3.9:1234/v1',
    'http://host.docker.internal:1234/v1'
  ]) {
    assert.doesNotThrow(() => assertSafeModelUrl(url), url);
  }
});

test('assertSafeModelUrl rejects public hosts, metadata endpoints and odd schemes', () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data',   // cloud metadata
    'https://api.openai.com/v1',                 // external provider
    'http://8.8.8.8:1234/v1',
    'http://172.32.0.1:1234/v1',                 // just outside the private range
    'file:///etc/passwd',
    'not-a-url'
  ]) {
    assert.throws(() => assertSafeModelUrl(url), url);
  }
});

test('generation parameters are clamped to a usable range', () => {
  assert.equal(clampTemperature(-5), 0);
  assert.equal(clampTemperature(99), 2);
  assert.equal(clampTemperature('abc'), 0.7);
  assert.equal(clampMaxTokens(0), 1);
  assert.equal(clampMaxTokens(999999), 32768);
  assert.equal(clampMaxTokens('abc'), 4096);
});

// ---------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------
test('validatePassword enforces length and a letter-plus-digit mix', () => {
  assert.ok(validatePassword('short1'), 'a short password was accepted');
  assert.ok(validatePassword('allletterspassword'), 'a digitless password was accepted');
  assert.ok(validatePassword('1234567890'), 'a letterless password was accepted');
  assert.equal(validatePassword('GoodPassword2026'), null);
  // Arabic letters count as letters.
  assert.equal(validatePassword('كلمةمروري2026'), null);
});

// ---------------------------------------------------------------
// Errors
// ---------------------------------------------------------------
test('application errors carry a status and serialise without internals', () => {
  const err = new NotFoundError('غير موجود');
  assert.equal(err.status, 404);
  assert.equal(err.expected, true);
  assert.deepEqual(err.toJSON(), { error: 'غير موجود', code: 'NOT_FOUND' });
  assert.ok(!JSON.stringify(err.toJSON()).includes('stack'));
});

test('a cause is retained for logging but never serialised to the client', () => {
  const err = new AppError('فشل', { status: 500, cause: new Error('connection refused at 10.0.0.1') });
  assert.ok(!JSON.stringify(err.toJSON()).includes('connection refused'));
});

// ---------------------------------------------------------------
// Classifications
// ---------------------------------------------------------------
test('an unknown classification falls back to official rather than throwing', () => {
  assert.equal(resolveClassification('top_secret').label, 'سري للغاية ومكتوم');
  assert.equal(resolveClassification('nonsense').label, 'رسمي');
  assert.equal(resolveClassification(undefined).label, 'رسمي');
});

// ---------------------------------------------------------------
// Prompt Library & Institutional Charters
// ---------------------------------------------------------------
test('SYSTEM_CHARTER contains mandatory integrity rules and disclaimers', () => {
  assert.ok(typeof SYSTEM_CHARTER === 'string' && SYSTEM_CHARTER.length > 500, 'charter must be substantial');
  assert.ok(SYSTEM_CHARTER.includes('نزاهة المعلومة'), 'must mandate information integrity');
  assert.ok(SYSTEM_CHARTER.includes('حدود صلاحيتك'), 'must define agent boundaries');
  assert.ok(SYSTEM_CHARTER.includes('غير متوفر'), 'must require "غير متوفر" for unknown values');
  assert.ok(SYSTEM_CHARTER.includes('مسودات'), 'must state drafts only');
});

test('PROMPT_MODULES satisfies institutional composition contract', () => {
  assert.equal(PROMPT_MODULES.length, 10, 'must define exactly 10 prompt modules');
  const ids = new Set();
  for (const mod of PROMPT_MODULES) {
    assert.ok(mod.id && mod.id.startsWith('mod_'), `invalid module id format: ${mod.id}`);
    assert.ok(!ids.has(mod.id), `duplicate module id: ${mod.id}`);
    ids.add(mod.id);
    assert.ok(mod.name && mod.name.trim().length > 0, `module ${mod.id} missing name`);
    assert.ok(mod.description && mod.description.trim().length > 0, `module ${mod.id} missing description`);
    assert.ok(mod.content && mod.content.trim().length > 0, `module ${mod.id} missing content`);
  }
});

test('CATEGORY_MODULE_MAP references only valid declared modules', () => {
  const declaredModuleIds = new Set(PROMPT_MODULES.map((m) => m.id));
  const expectedCategories = ['cat_exec', 'cat_strategy', 'cat_legal', 'cat_finance', 'cat_tech', 'cat_audit', 'cat_hr'];

  for (const catId of expectedCategories) {
    assert.ok(CATEGORY_MODULE_MAP[catId], `missing mapping for category ${catId}`);
    const assigned = CATEGORY_MODULE_MAP[catId];
    assert.ok(Array.isArray(assigned) && assigned.length > 0, `empty mapping for ${catId}`);
    const uniqueAssignments = new Set(assigned);
    assert.equal(uniqueAssignments.size, assigned.length, `duplicate modules assigned to ${catId}`);
    for (const modId of assigned) {
      assert.ok(declaredModuleIds.has(modId), `category ${catId} references unknown module ${modId}`);
    }
  }
});

test('SUPERSEDED_CHARTERS and CATEGORY_DIRECTIVES support safe institutional upgrades', () => {
  assert.ok(Array.isArray(SUPERSEDED_CHARTERS) && SUPERSEDED_CHARTERS.length >= 2);
  for (const legacy of SUPERSEDED_CHARTERS) {
    assert.ok(typeof legacy === 'string' && legacy.trim().length > 0);
    assert.notEqual(legacy.trim(), SYSTEM_CHARTER.trim(), 'legacy charter must not match current charter');
  }

  assert.ok(CATEGORY_DIRECTIVES && Object.keys(CATEGORY_DIRECTIVES).length >= 7);
  for (const [catId, directive] of Object.entries(CATEGORY_DIRECTIVES)) {
    assert.ok(typeof directive === 'string' && directive.trim().length > 0, `invalid directive for ${catId}`);
  }
});

// ---------------------------------------------------------------
// Prompt Validators
// ---------------------------------------------------------------
test('createPromptModuleSchema validates name, description, and content strictly', () => {
  const valid = {
    name: 'وحدة تحليل البيانات',
    description: 'وحدة مخصصة لتحليل البيانات الإحصائية',
    content: 'قواعد تحليل البيانات...'
  };
  assert.deepEqual(createPromptModuleSchema.parse(valid), valid);

  // Missing name
  assert.throws(() => createPromptModuleSchema.parse({ content: 'محتوى' }));
  // Missing content
  assert.throws(() => createPromptModuleSchema.parse({ name: 'اسم' }));
  // Strict mode: unknown properties rejected
  assert.throws(() => createPromptModuleSchema.parse({ ...valid, extraField: 'test' }));
});

test('updatePromptModuleSchema permits partial updates and rejects unknown fields', () => {
  assert.deepEqual(updatePromptModuleSchema.parse({ name: 'اسم جديد' }), { name: 'اسم جديد' });
  assert.deepEqual(updatePromptModuleSchema.parse({ content: 'محتوى جديد' }), { content: 'محتوى جديد' });
  assert.throws(() => updatePromptModuleSchema.parse({ unknownProperty: 123 }));
});

test('setCategoryModulesSchema enforces max modules cap and array structure', () => {
  const valid = { moduleIds: ['mod_source_discipline', 'mod_documents'] };
  assert.deepEqual(setCategoryModulesSchema.parse(valid), valid);

  // Exceeds max cap of 20
  const tooMany = { moduleIds: Array.from({ length: 21 }, (_, i) => `mod_${i}`) };
  assert.throws(() => setCategoryModulesSchema.parse(tooMany));
});

test('promptPreviewSchema handles classification enum with default', () => {
  assert.deepEqual(promptPreviewSchema.parse({}), { classification: 'official' });
  assert.deepEqual(promptPreviewSchema.parse({ classification: 'top_secret' }), { classification: 'top_secret' });
  assert.throws(() => promptPreviewSchema.parse({ classification: 'invalid_level' }));
});

