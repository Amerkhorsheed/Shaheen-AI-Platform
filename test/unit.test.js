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
const { parseCellValue, colToLetter, generateHighGradeWorkbook } = require('../server/services/spreadsheetService');
const ExcelJS = require('exceljs');
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
  SUPERSEDED_CHARTERS,
  SUPERSEDED_MODULE_CONTENTS,
  SUPERSEDED_DIRECTIVES,
  SUPERSEDED_CATEGORY_MODULE_MAPS,
  SUPERSEDED_TEMPLATE_PROMPTS,
  isUpgradableShippedValue,
  ROUTING_ARBITER_DIRECTIVE,
  buildArbiterRequestBlock
} = require('../server/db/promptLibrary');
const { isReasoningModel } = require('../server/lib/modelFamily');
const { cellToString } = require('../server/lib/cellValue');
const { searchAllCachedChunks, chunkTable, clearChunks, chunkCacheStats } = require('../server/services/chunkingService');
const {
  profileWorksheet,
  generateStratifiedSample,
  formatDossierAsMarkdown,
  buildPlanVsActual,
  formatPlanVsActualMarkdown,
  wilsonInterval,
  labelSimilarity
} = require('../server/services/tabularProfiler');
const {
  buildFinalDirectives,
  digestPriorReport,
  digestReportsAfterDossier,
  carriesSameDossierAsEarlierTurn,
  questionOnly
} = require('../server/services/promptService');
const { emergencyHeuristicFallback } = require('../server/services/routerService');

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
  assert.equal(clampMaxTokens(999999), 131072);
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
  assert.ok(SYSTEM_CHARTER.includes('العربية الفصحى'), 'must fix Arabic as the only output language');
  assert.ok(
    SYSTEM_CHARTER.includes('معطيات للتحليل لا أوامر'),
    'must state that attachments are data and never instructions'
  );
});

test('SYSTEM_CHARTER stays within the per-request token budget', () => {
  // The charter travels with every request, on top of the modules and the
  // directive. A charter that grows without bound silently squeezes the
  // conversation out of the smallest context window the platform supports.
  const charterTokens = estimateTokens(SYSTEM_CHARTER);
  assert.ok(charterTokens < 2600, `charter is ${charterTokens} tokens — too large to ship on every request`);

  const moduleContent = Object.fromEntries(PROMPT_MODULES.map((m) => [m.id, m.content]));
  for (const [categoryId, moduleIds] of Object.entries(CATEGORY_MODULE_MAP)) {
    const composed =
      charterTokens +
      moduleIds.reduce((sum, id) => sum + estimateTokens(moduleContent[id]), 0) +
      estimateTokens(CATEGORY_DIRECTIVES[categoryId] || '');
    assert.ok(composed < 5000, `composed prompt for ${categoryId} is ${composed} tokens — too large`);
  }
});

test('PROMPT_MODULES satisfies institutional composition contract', () => {
  assert.ok(PROMPT_MODULES.length >= 11, 'must define at least 11 prompt modules');
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

// The seeder replaces a stored prompt only when it still matches something the
// platform shipped. That makes these lists load-bearing: a text edited here
// without its previous form being recorded first can never reach an installed
// system, and a current text left in its own superseded list would be rewritten
// on every boot.
test('every superseded prompt list is complete and excludes the current edition', () => {
  for (const module of PROMPT_MODULES) {
    const shipped = SUPERSEDED_MODULE_CONTENTS[module.id];
    if (!shipped) continue; // a module introduced in this edition has no history yet
    assert.ok(Array.isArray(shipped) && shipped.length > 0, `empty history for ${module.id}`);
    assert.ok(
      !shipped.some((value) => value.trim() === module.content.trim()),
      `${module.id}: current content must not appear in its own superseded list`
    );
  }

  for (const [categoryId, directive] of Object.entries(CATEGORY_DIRECTIVES)) {
    const shipped = SUPERSEDED_DIRECTIVES[categoryId];
    assert.ok(Array.isArray(shipped) && shipped.length > 0, `missing directive history for ${categoryId}`);
    assert.ok(
      !shipped.some((value) => value.trim() === directive.trim()),
      `${categoryId}: current directive must not appear in its own superseded list`
    );
  }

  assert.ok(
    Array.isArray(SUPERSEDED_CATEGORY_MODULE_MAPS) && SUPERSEDED_CATEGORY_MODULE_MAPS.length >= 1,
    'at least one shipped category→module mapping must be recorded'
  );
  assert.ok(SUPERSEDED_TEMPLATE_PROMPTS && Object.keys(SUPERSEDED_TEMPLATE_PROMPTS).length >= 6);
});

test('an upgrade replaces a shipped prompt and never an administrator\'s own', () => {
  const shipped = ['النسخة الأولى', 'النسخة الثانية'];
  const target = 'النسخة الحالية';

  // still carrying an edition we shipped → ours to upgrade
  assert.equal(isUpgradableShippedValue('النسخة الأولى', target, shipped), true);
  assert.equal(isUpgradableShippedValue('  النسخة الثانية  ', target, shipped), true, 'whitespace must not defeat the match');

  // edited by an institution, or already current, or empty → left alone
  assert.equal(isUpgradableShippedValue('ميثاق كتبته الجهة', target, shipped), false);
  assert.equal(isUpgradableShippedValue('النسخة الأولى معدّلة', target, shipped), false, 'a partial match is an edit');
  assert.equal(isUpgradableShippedValue(target, target, shipped), false);
  assert.equal(isUpgradableShippedValue('', target, shipped), false);
  assert.equal(isUpgradableShippedValue(null, target, shipped), false);
  assert.equal(isUpgradableShippedValue('أي قيمة', target, undefined), false, 'no recorded history means no upgrade');

  // the real charter: an installation still on any shipped edition upgrades,
  // and one on the current edition is not rewritten on every boot.
  for (const legacy of SUPERSEDED_CHARTERS) {
    assert.equal(isUpgradableShippedValue(legacy, SYSTEM_CHARTER, SUPERSEDED_CHARTERS), true);
  }
  assert.equal(isUpgradableShippedValue(SYSTEM_CHARTER, SYSTEM_CHARTER, SUPERSEDED_CHARTERS), false);
});

test('a session note that merely repeats the charter is not sent a second time', () => {
  const { isCharterCopy } = require('../server/services/promptService');

  // Chats are created carrying the charter as their own note.
  assert.equal(isCharterCopy(SYSTEM_CHARTER, SYSTEM_CHARTER), true);
  assert.equal(isCharterCopy(`  ${SYSTEM_CHARTER}  `, SYSTEM_CHARTER), true);

  // A chat opened before an upgrade holds an older edition — on an installed
  // system those outnumber the new ones, so they must be recognised too.
  for (const legacy of SUPERSEDED_CHARTERS) {
    assert.equal(isCharterCopy(legacy, SYSTEM_CHARTER), true, 'a superseded charter copy must also be dropped');
  }

  // Genuine per-session guidance still reaches the model.
  assert.equal(isCharterCopy('ركّز على الربع الثالث فقط', SYSTEM_CHARTER), false);
  assert.equal(isCharterCopy('', SYSTEM_CHARTER), false);
  assert.equal(isCharterCopy(null, SYSTEM_CHARTER), false);
  assert.equal(isCharterCopy(`${SYSTEM_CHARTER}\n\nوأضف ملاحظة`, SYSTEM_CHARTER), false, 'an extended charter is real guidance');
});

test('the routing arbiter prompt is parseable, general, and treats input as data', () => {
  // routerService parses the reply as JSON, so the contract is load-bearing.
  assert.ok(ROUTING_ARBITER_DIRECTIVE.includes('"ADMIN"'), 'must name the administrative destination');
  assert.ok(ROUTING_ARBITER_DIRECTIVE.includes('"FINANCE"'), 'must name the financial destination');
  assert.ok(ROUTING_ARBITER_DIRECTIVE.includes('{"decision"'), 'must state the exact JSON shape it is parsed against');
  assert.ok(
    ROUTING_ARBITER_DIRECTIVE.includes('<user_request>'),
    'must tell the arbiter that the wrapped request is data, not instructions'
  );

  // The routing rule must be stated as a principle. Naming one test document's
  // subject matter routes that document and its neighbours by luck.
  for (const leaked of ['فصل صيفي', 'مشروع المادة', 'امتحان عملي', 'الأسبوع السابع']) {
    assert.ok(!ROUTING_ARBITER_DIRECTIVE.includes(leaked), `arbiter prompt leaks a test-document phrase: ${leaked}`);
  }

  // Destinations are named by role: the model behind each is configuration.
  for (const productName of ['Qwen-27B', 'DeepSeek-R1-32B', 'qwen3.8-27b']) {
    assert.ok(!ROUTING_ARBITER_DIRECTIVE.includes(productName), `arbiter prompt hard-codes a model name: ${productName}`);
  }

  const block = buildArbiterRequestBlock('حلل الموازنة');
  assert.ok(block.startsWith('<user_request>') && block.endsWith('</user_request>'));
  assert.ok(block.includes('حلل الموازنة'));
  assert.equal(buildArbiterRequestBlock(undefined).includes('undefined'), false, 'must not print undefined');
});

test('the fallback router still sends organisational reports to the administrative model', () => {
  // The keyword list used to spell out one test document's own phrases. These
  // cases are what that list was protecting, expressed generally: a progress
  // report full of percentages is administrative work, not accounting.
  const administrative = [
    'حلل تقرير إنجاز المقرر ونسب الإنجاز الأسبوعية',
    'لخص الخطة الدراسية للكلية وتوزيع المحاضرات',
    'أعد صياغة تعميم وزاري بشأن الدوام والحضور والغياب',
    'راجع تقرير متابعة التنفيذ ونسبة الإنجاز للمشروع'
  ];
  for (const text of administrative) {
    assert.equal(emergencyHeuristicFallback(text).decision, 'ADMIN', `must route to ADMIN: ${text}`);
  }

  const financial = [
    'دقق الموازنة والقيود المحاسبية لهذا العام',
    'راجع الفواتير وإجمالي التكلفة بالليرة السورية',
    'احسب الأرباح والخسائر والضرائب المستحقة'
  ];
  for (const text of financial) {
    assert.equal(emergencyHeuristicFallback(text).decision, 'FINANCE', `must route to FINANCE: ${text}`);
  }

  // A number in an administrative document must not flip the route.
  assert.equal(emergencyHeuristicFallback('تقرير إنجاز بنسبة 94% خلال الفترة').decision, 'ADMIN');
});

test('model family detection is shared by the composer and the router', () => {
  for (const model of ['deepseek-r1-zero', 'qwq-32b', 'deepseek-r1-zero-671b']) {
    assert.equal(isReasoningModel(model), true, `${model} must be treated as a reasoning model`);
  }
  for (const model of ['qwen3.8-27b', 'deepseek-r1-distill-qwen-32b', 'llama-3.1-70b', '', undefined, null]) {
    assert.equal(isReasoningModel(model), false, `${model} must not be treated as a reasoning model`);
  }
});

test('the charter treats platform-computed aggregates as givens, not as arithmetic to redo', () => {
  // A large file reaches the model as system-computed totals over every row
  // plus a 24-row stratified sample. An earlier edition of this rule ordered
  // the model to "recompute every total" and declare a contradiction when the
  // figures disagreed — against a sample, that fired on every large file and
  // told the user the platform's own arithmetic was wrong.
  assert.ok(
    !SYSTEM_CHARTER.includes('أعد احتساب كل مجموع'),
    'the charter must not order a blanket recomputation of every total'
  );
  assert.ok(SYSTEM_CHARTER.includes('حسبتها المنظومة على كامل الملف'), 'must name platform-computed aggregates');
  assert.ok(SYSTEM_CHARTER.includes('عيّنة جزئية'), 'must forbid recomputing them from a partial sample');
  // The half that was always right: never edit a source figure to reconcile.
  assert.ok(SYSTEM_CHARTER.includes('لا تعدّل') && SYSTEM_CHARTER.includes('المصدر'));
});

test('the platform-extracts module explains both the dossier and the slices', () => {
  const module = PROMPT_MODULES.find((m) => m.id === 'mod_retrieved_data');
  assert.ok(module, 'the platform-extracts module must exist under its established id');

  for (const required of ['الملف الإحصائي', 'العينة الهيكلية', 'الشرائح المسترجعة']) {
    assert.ok(module.content.includes(required), `the module must describe: ${required}`);
  }
  // The sample must never be aggregated from — the specific failure this guards.
  assert.ok(module.content.includes('لا تجمع منها'), 'must forbid summing from the structural sample');
  assert.ok(module.content.includes('غير متتابعة'), 'must warn that sample row numbers are not consecutive');
  assert.ok(module.content.includes('قُرئ وحُلّل بكامله'), 'must let the model answer completeness questions with confidence');

  // It is attached everywhere, because the preprocessing runs in every session.
  for (const [categoryId, moduleIds] of Object.entries(CATEGORY_MODULE_MAP)) {
    assert.ok(moduleIds.includes('mod_retrieved_data'), `${categoryId} must receive the platform-extracts module`);
  }
});

test('the dossier headings state what the numbers are and carry no certification language', () => {
  const rows = [];
  for (let i = 1; i <= 600; i++) rows.push([`بند ${i}`, String(i * 1000)]);
  const profile = profileWorksheet('الموازنة', ['البند', 'المخصص'], rows);
  const sample = generateStratifiedSample(['البند', 'المخصص'], rows, profile.outlierRowIndices, 8);
  const dossier = formatDossierAsMarkdown(profile, sample);

  // Charter rule 9 forbids the model writing certification language; the
  // platform's own output must not model it either.
  assert.ok(!dossier.includes('معتمد'), 'the dossier must not describe its own rows as certified');
  assert.ok(!dossier.includes('بدقة قطعية'), 'the dossier must not claim definitive precision');

  // The headings themselves teach the model how to read each section.
  assert.ok(dossier.includes('لا تُعاد من العينة'), 'the statistics heading must say they are not to be recomputed');
  assert.ok(dossier.includes('غير متتابعة'), 'the sample heading must say its row numbers are not consecutive');
});

test('the module set attached to every category covers integrity, documents and retrieval', () => {
  // These three carry the rules that stop fabrication, so no department may be
  // composed without them.
  const universal = ['mod_source_discipline', 'mod_documents', 'mod_retrieved_data'];
  for (const [categoryId, moduleIds] of Object.entries(CATEGORY_MODULE_MAP)) {
    for (const required of universal) {
      assert.ok(moduleIds.includes(required), `${categoryId} is missing ${required}`);
    }
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

// ---------------------------------------------------------------
// Sovereign Spreadsheet Service (Excel .xlsx Export)
// ---------------------------------------------------------------
test('parseCellValue detects numbers, percentages, dates, and plain text', () => {
  assert.deepEqual(parseCellValue(''), { value: '', type: 'empty' });
  assert.deepEqual(parseCellValue(null), { value: '', type: 'empty' });

  // Integers
  const intVal = parseCellValue('1500');
  assert.equal(intVal.value, 1500);
  assert.equal(intVal.type, 'integer');
  assert.equal(intVal.numFmt, '#,##0');

  // Formatted integers with commas
  const commaVal = parseCellValue('25,000,000');
  assert.equal(commaVal.value, 25000000);
  assert.equal(commaVal.type, 'integer');

  // Decimals
  const decVal = parseCellValue('1250.75');
  assert.equal(decVal.value, 1250.75);
  assert.equal(decVal.type, 'decimal');
  assert.equal(decVal.numFmt, '#,##0.00');

  // Negative numbers with parentheses
  const negVal = parseCellValue('(500)');
  assert.equal(negVal.value, -500);

  // Percentages
  const pctVal = parseCellValue('35.5%');
  assert.equal(pctVal.value, 0.355);
  assert.equal(pctVal.type, 'percentage');
  assert.equal(pctVal.numFmt, '0.0%');

  // Dates
  const dateVal = parseCellValue('2026-09-06');
  assert.equal(dateVal.value, '2026-09-06');
  assert.equal(dateVal.type, 'date');

  // Text
  const txtVal = parseCellValue('محضر اجتماع رسمي');
  assert.equal(txtVal.value, 'محضر اجتماع رسمي');
  assert.equal(txtVal.type, 'text');
});

test('colToLetter converts column indices correctly', () => {
  assert.equal(colToLetter(1), 'A');
  assert.equal(colToLetter(2), 'B');
  assert.equal(colToLetter(26), 'Z');
  assert.equal(colToLetter(27), 'AA');
  assert.equal(colToLetter(28), 'AB');
});

test('generateHighGradeWorkbook produces multi-sheet workbook with branding, formulas and audit card', async () => {
  const matrix = [
    ['م', 'البند والمواصفات', 'الكمية', 'سعر الوحدة', 'القيمة الإجمالية'],
    ['1', 'حواسيب معالجة ذكاء اصطناعي', '20', '12500000', '250000000'],
    ['2', 'خوادم تخزين رئيسية', '4', '45000000', '180000000']
  ];

  const buffer = await generateHighGradeWorkbook({
    matrix,
    title: 'مصفوفة التجهيزات الفنية المركزية',
    record: {
      ref: 'SY-DATA-2026-000077',
      content_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    },
    user: { id: 'usr_admin', display_name: 'مدير المنظومة', username: 'admin', role: 'مشرف عام' },
    classification: 'internal',
    ipAddress: '127.0.0.1'
  });

  assert.ok(buffer instanceof Buffer, 'must return a Buffer');
  assert.ok(buffer.length > 5000, 'buffer must contain substantial Excel package');

  // Inspect generated workbook
  const readWb = new ExcelJS.Workbook();
  await readWb.xlsx.load(buffer);

  assert.equal(readWb.worksheets.length, 2, 'must contain exactly 2 worksheets');

  const mainSheet = readWb.getWorksheet('مصفوفة البيانات الرسمية');
  assert.ok(mainSheet, 'main sheet must exist');
  assert.equal(mainSheet.views[0].rightToLeft, true, 'main sheet must be RTL');
  assert.equal(mainSheet.views[0].showGridLines, true, 'main sheet must show gridlines');
  assert.equal(mainSheet.views[0].state, 'frozen', 'main sheet must freeze header');

  // Verify headers at row 8
  assert.equal(mainSheet.getCell(8, 1).value, 'م');
  assert.equal(mainSheet.getCell(8, 2).value, 'البند والمواصفات');
  assert.equal(mainSheet.getCell(8, 3).value, 'الكمية');

  // Verify typed data at row 9
  assert.equal(mainSheet.getCell(9, 3).value, 20, 'quantity must be number');
  assert.equal(mainSheet.getCell(9, 4).value, 12500000, 'unit price must be number');

  // Verify totals row at row 11
  const totalsRow = mainSheet.getRow(11);
  assert.equal(totalsRow.getCell(1).value, 'الإجمالي العام / المجموع');
  assert.ok(totalsRow.getCell(5).value?.formula, 'totals row must have sum formula');
  assert.equal(totalsRow.getCell(5).value.formula, 'SUM(E9:E10)');

  // Verify audit sheet
  const auditSheet = readWb.getWorksheet('بطاقة الوثيقة وسجل التدقيق');
  assert.ok(auditSheet, 'audit sheet must exist');
  assert.equal(auditSheet.views[0].rightToLeft, true, 'audit sheet must be RTL');

  // Verify audit values
  let foundRef = false;
  let foundHash = false;
  auditSheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value === 'SY-DATA-2026-000077') foundRef = true;
      if (cell.value === '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08') foundHash = true;
    });
  });
  assert.ok(foundRef, 'audit sheet must contain document reference');
  assert.ok(foundHash, 'audit sheet must contain full content sha256');
});

// ---------------------------------------------------------------
// Token Estimation & Context Window Budgeting
// ---------------------------------------------------------------
const {
  estimateTokens,
  estimateMessagesTokens,
  evaluateContextBudget
} = require('../server/lib/tokenEstimator');
const { extract } = require('../server/services/fileService');

test('estimateTokens calculates reasonable token budgets for Arabic and multilingual text', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);

  const arabicSample = 'الجمهورية العربية السورية — منظومة OSS للذكاء الاصطناعي';
  const tokens = estimateTokens(arabicSample);
  assert.ok(tokens > 10 && tokens < 35, `tokens (${tokens}) should be within expected BPE range`);

  const csvSample = 'TXN-001,2024-01-15,15000\nTXN-002,2024-01-16,8500\n';
  const csvTokens = estimateTokens(csvSample);
  assert.ok(csvTokens > 10 && csvTokens < 30);
});

test('estimateMessagesTokens and evaluateContextBudget correctly calculate context window utilization', () => {
  const messages = [
    { role: 'user', content: 'حلل هذا الجدول المالي المرفق بدقة.' },
    { role: 'assistant', content: 'الخلاصة التنفيذية: يتضمن الجدول 5 معاملات مالية.' }
  ];
  const systemPrompt = SYSTEM_CHARTER;

  const total = estimateMessagesTokens(messages, systemPrompt);
  assert.ok(total > 300, 'total messages tokens must include system charter and framing');

  const budgetSafe = evaluateContextBudget(messages, { contextLimit: 8192, reservedOutputTokens: 2048, systemPrompt });
  assert.equal(budgetSafe.isNearLimit, false);
  assert.ok(budgetSafe.usagePercent < 50);
  assert.ok(budgetSafe.recommendation.includes('الحدود الآمنة'));

  const budgetCramped = evaluateContextBudget(messages, { contextLimit: total + 50, reservedOutputTokens: 2048, systemPrompt });
  assert.equal(budgetCramped.isNearLimit, true);
  assert.ok(budgetCramped.usagePercent >= 75);
});

// ---------------------------------------------------------------
// Cell conversion — what the model is actually shown
// ---------------------------------------------------------------
test('cellToString renders every ExcelJS cell shape and never [object Object]', () => {
  const cases = [
    [null, ''],
    [undefined, ''],
    ['نص عادي', 'نص عادي'],
    [1500, '1500'],
    [0, '0'],
    [false, 'false'],
    [new Date('2026-09-09T00:00:00.000Z'), '2026-09-09'],
    [new Date('invalid'), ''],
    // A bold word inside a heading is the most common formatting there is.
    [{ richText: [{ text: 'حساب ' }, { text: 'الرواتب' }] }, 'حساب الرواتب'],
    [{ error: '#REF!' }, '#REF!'],
    // A formula shows its computed value, which is what a reader sees.
    [{ formula: 'A1*2', result: 3000 }, '3000'],
    [{ formula: 'A1/0', result: { error: '#DIV/0!' } }, '#DIV/0!'],
    [{ formula: 'TODAY()', result: new Date('2026-09-09T00:00:00.000Z') }, '2026-09-09'],
    [{ formula: 'A1', result: null }, ''],
    // Saved uncalculated: the expression is all there is.
    [{ formula: 'SUM(A1:A9)' }, '=SUM(A1:A9)'],
    [{ text: 'الموقع', hyperlink: 'http://example.gov' }, 'الموقع'],
    [{ hyperlink: 'http://example.gov' }, 'http://example.gov']
  ];

  for (const [input, expected] of cases) {
    const actual = cellToString(input);
    assert.equal(actual, expected, `cellToString(${JSON.stringify(input)}) gave "${actual}"`);
    assert.ok(!actual.includes('[object Object]'), 'a cell must never render as [object Object]');
  }
});

test('a formatted heading survives extraction, indexing and retrieval', async () => {
  // Regression: the header row was stringified raw, so a heading carrying any
  // formatting reached the model as [object Object] — and the rows underneath
  // were indexed under that text, making them unfindable by what they say.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المشتريات');
  ws.addRow([{ richText: [{ text: 'رقم ' }, { text: 'الأمر' }] }, 'المورد', 'التكلفة', 'تاريخ الاعتماد']);
  for (let i = 1; i <= 600; i++) {
    ws.addRow([
      `PO-${i}`,
      i === 427 ? { richText: [{ text: 'شركة ' }, { text: 'الشهباء' }] } : `مورد ${i}`,
      i * 1000,
      new Date('2026-03-06T00:00:00.000Z')
    ]);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const res = await extract({
    originalname: 'مشتريات.xlsx',
    buffer,
    size: buffer.length,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  assert.equal(res.success, true);
  assert.ok(!res.text.includes('[object Object]'), 'the dossier shown to the model must carry no [object Object]');

  // The row is findable by the text a person can see in it.
  assert.ok(searchAllCachedChunks('الشهباء', 3).length > 0, 'a rich-text cell must be searchable');

  const hits = searchAllCachedChunks('PO-427', 3);
  assert.ok(hits.length > 0);
  const [header, firstRow] = hits[0].csv.split('\n');
  assert.ok(header.includes('رقم الأمر'), `heading was not recovered: ${header}`);
  assert.ok(!hits[0].csv.includes('[object Object]'), 'retrieved slices must carry no [object Object]');
  assert.ok(/2026-03-06/.test(firstRow), `dates must be ISO in a slice, got: ${firstRow}`);
  assert.ok(!/GMT/.test(hits[0].csv), 'a slice must not carry locale/timezone date strings');
});

test('formula-derived values are counted in the profile statistics', () => {
  // Regression: raw formula cells were typed as text, so every formula column
  // reached the model with no sum, mean, or range at all — which in a budget
  // sheet is most columns.
  const rows = [];
  for (let i = 1; i <= 600; i++) rows.push([`بند ${i}`, cellToString({ formula: `B${i}*2`, result: i * 1000 })]);

  const profile = profileWorksheet('الموازنة', ['البند', 'المخصص'], rows);
  const column = profile.columns.find((c) => c.name === 'المخصص');

  // 1000 × (1+2+…+600) = 180,300,000
  assert.equal(column.sum, 180300000, 'formula results must be included in the column sum');
  assert.equal(column.max, 600000);
  assert.equal(column.min, 1000);
});

test('fileService.extract caches repeated file buffers via content-addressed buffer hash', async () => {
  const buffer = Buffer.from('الرقم,المبلغ\n1,100\n2,200\n', 'utf8');
  const file1 = { originalname: 'test_table.csv', buffer, size: buffer.length, mimetype: 'text/csv' };
  const file2 = { originalname: 'test_table_copy.csv', buffer, size: buffer.length, mimetype: 'text/csv' };

  const res1 = await extract(file1);
  assert.equal(res1.success, true);
  assert.ok(res1.text.includes('1,100'));

  const res2 = await extract(file2);
  assert.equal(res2.success, true);
  assert.equal(res2.filename, 'test_table_copy.csv');
  assert.equal(res2.text, res1.text);
});

test('fileService.extract: processes XLSX with sparse rows, dates, and formula error objects', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الميزانية_العمومية');
  
  // Row with sparse columns and rich text
  ws.getCell('B2').value = { richText: [{ text: 'حساب ' }, { text: 'الرواتب' }] };
  ws.getCell('E2').value = 750000;
  
  // Row with formula error
  ws.getCell('B3').value = 'قسمة_على_صفر';
  ws.getCell('C3').value = { formula: 'A1/0', result: { error: '#DIV/0!' } };

  // Row with date
  ws.getCell('B4').value = 'تاريخ_الاعتماد';
  ws.getCell('C4').value = new Date('2026-09-09T00:00:00.000Z');

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const file = { originalname: 'balance_2026.xlsx', buffer: buf, size: buf.length, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

  const res = await extract(file);
  assert.equal(res.success, true);
  assert.ok(res.text.includes('الميزانية_العمومية'));
  assert.ok(res.text.includes('حساب الرواتب'));
  assert.ok(res.text.includes('750000'));
  assert.ok(res.text.includes('#DIV/0!'), 'Must preserve formula error code without [object Object]');
  assert.ok(!res.text.includes('[object Object]'), 'Must not produce [object Object]');
  assert.ok(res.text.includes('2026-09-09'));
});

test('fileService.extract: processes HTML table exported with .xls extension', async () => {
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
      <body>
        <table>
          <tr><th>رقم الحساب</th><th>اسم الحساب</th><th>الرصيد المدين</th><th>الرصيد الدائن</th></tr>
          <tr><td>1101</td><td>صندوق دمشق المركزي</td><td>1250000</td><td>0</td></tr>
          <tr><td>1102</td><td>المصرف التجاري السوري</td><td>45000000</td><td>0</td></tr>
        </table>
      </body>
    </html>
  `;
  const buf = Buffer.from(html, 'utf8');
  const file = { originalname: 'كشف_حساب_الأمين.xls', buffer: buf, size: buf.length, mimetype: 'application/vnd.ms-excel' };

  const res = await extract(file);
  assert.equal(res.success, true);
  assert.equal(res.filename, 'كشف_حساب_الأمين.xls');
  assert.ok(res.text.includes('رقم الحساب,اسم الحساب,الرصيد المدين,الرصيد الدائن'));
  assert.ok(res.text.includes('1101,صندوق دمشق المركزي,1250000,0'));
  assert.ok(res.text.includes('1102,المصرف التجاري السوري,45000000,0'));
});

test('fileService.extract: processes XML Spreadsheet 2003 exported with .xls or .xlsx extension', async () => {
  const xml = `<?xml version="1.0"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="الرواتب_والأجور">
        <Table>
          <Row>
            <Cell><Data ss:Type="String">الموظف</Data></Cell>
            <Cell><Data ss:Type="String">الدرجة</Data></Cell>
            <Cell><Data ss:Type="Number">850000</Data></Cell>
          </Row>
          <Row>
            <Cell><Data ss:Type="String">أحمد خورشيد</Data></Cell>
            <Cell><Data ss:Type="String">أولى</Data></Cell>
            <Cell><Data ss:Type="Number">950000</Data></Cell>
          </Row>
        </Table>
      </Worksheet>
    </Workbook>
  `;
  const buf = Buffer.from(xml, 'utf8');
  const file = { originalname: 'سلم_الرواتب.xlsx', buffer: buf, size: buf.length, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

  const res = await extract(file);
  assert.equal(res.success, true);
  assert.ok(res.text.includes('### ورقة العمل: الرواتب_والأجور'));
  assert.ok(res.text.includes('الموظف,الدرجة,850000'));
  assert.ok(res.text.includes('أحمد خورشيد,أولى,950000'));
});

test('fileService.extract: supports macro-enabled .xlsm and fallback to OpenXML parser', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('بيانات_التحليل');
  ws.addRow(['المؤشر', 'القيمة']);
  ws.addRow(['نسبة السيولة', 2.4]);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const file = { originalname: 'financial_macro.xlsm', buffer: buf, size: buf.length, mimetype: 'application/vnd.ms-excel.sheet.macroEnabled.12' };

  const res = await extract(file);
  assert.equal(res.success, true);
  assert.ok(res.text.includes('نسبة السيولة,2.4'));
});

test('fileService.extract: decodes Arabic Windows-1256 CSV without corruption or error', async () => {
  // Windows-1256 bytes for 'رمز,اسم الحساب,المبلغ\n101,صندوق,500'
  // In windows-1256:
  // 'ر' = 0xD1, 'م' = 0xE3, 'ز' = 0xD2
  const win1256Bytes = Buffer.from([
    0xD1, 0xE3, 0xD2, 0x2C, // رمز,
    0xC7, 0xD3, 0xE3, 0x20, 0xC7, 0xE1, 0xCD, 0xD3, 0xC7, 0xC8, 0x2C, // اسم الحساب,
    0xC7, 0xE1, 0xE3, 0xC8, 0xE1, 0xDB, 0x0A, // المبلغ\n
    0x31, 0x30, 0x31, 0x2C, 0xCD, 0xD3, 0xC7, 0xC8, 0x2C, 0x35, 0x30, 0x30 // 101,حساب,500
  ]);
  const file = { originalname: 'arabic_win1256.csv', buffer: win1256Bytes, size: win1256Bytes.length, mimetype: 'text/csv' };

  const res = await extract(file);
  assert.equal(res.success, true);
  assert.ok(res.text.includes('اسم الحساب'));
  assert.ok(res.text.includes('101,حساب,500'));
});

// ---------------------------------------------------------------
// Decision-grade guarantees
//
// These four are the ones that failed in production, each in a report a person
// would have acted on. They are unit tests because the property each asserts is
// deterministic — the model's wording varies, what it is handed does not.
// ---------------------------------------------------------------

test('a concentration is called significant only when its interval clears the baseline', () => {
  // Nine failures in 152 records against a 3% baseline: a real outlier.
  const strong = wilsonInterval(9, 152);
  assert.ok(strong.low > 3, 'a 5.9% rate on 152 records should separate from 3%');

  // Six failures in 134 reads as 4.5% and is indistinguishable from the same
  // baseline. A report acting on it would quarantine a component over noise.
  const weak = wilsonInterval(6, 134);
  assert.ok(weak.low < 3 && weak.high > 3, 'a 4.5% rate on 134 records must not separate from 3%');

  // The interval never leaves the unit range, which the normal approximation does.
  const none = wilsonInterval(0, 100);
  assert.equal(none.low, 0);
  assert.ok(none.high > 0 && none.high < 100);
});

test('the dossier names which categories may be acted on and which may not', () => {
  const headers = ['Part', 'QC Status'];
  const rows = [];
  // BAD-PART fails far above the rest on enough records to prove it; MID-PART
  // sits just above the baseline but on too few records to tell; GOOD-PART is
  // significantly *better* than the baseline.
  for (let i = 0; i < 300; i++) rows.push(['BAD-PART', i < 60 ? 'Reject' : 'Pass']);
  for (let i = 0; i < 120; i++) rows.push(['MID-PART', i < 18 ? 'Reject' : 'Pass']);
  for (let i = 0; i < 300; i++) rows.push(['GOOD-PART', i < 6 ? 'Reject' : 'Pass']);

  const profile = profileWorksheet('QC', headers, rows);
  const dossier = formatDossierAsMarkdown(profile, []);
  const line = dossier.split('\n').find((l) => l.includes('[قائمة الأهلية للإجراءات]'));

  assert.ok(line, 'the dossier must state the eligibility lists');
  const [eligiblePart, prohibitedPart] = line.split('|');

  assert.ok(eligiblePart.includes('BAD-PART'), 'a category significantly above the baseline is eligible');
  assert.ok(!prohibitedPart.includes('BAD-PART'), 'it must not also appear as prohibited');

  // The best performer differs from the baseline too, but downward. Acting
  // against it would be acting against the thing that is working.
  assert.ok(!eligiblePart.includes('GOOD-PART'), 'a category significantly better than baseline is never eligible');
  assert.ok(prohibitedPart.includes('GOOD-PART'), 'it belongs in the prohibited list');
  assert.match(dossier, /دال — أفضل من المعدل/);
});

test('the eligibility constraint is lifted out of the dossier and restated verbatim', () => {
  const conversation = [
    { role: 'user', content: 'حلل\n[قائمة الأهلية للإجراءات] المؤهلة لإجراء موجّه: ALPHA | المحظور استهدافها بإجراء موجّه: BETA ، GAMMA\nنهاية' },
    { role: 'assistant', content: 'تقرير' },
    { role: 'user', content: 'ماذا أفعل' }
  ];

  const constraint = buildFinalDirectives(conversation, { isFollowUp: true });
  assert.ok(constraint.includes('ALPHA') && constraint.includes('BETA') && constraint.includes('GAMMA'));
  assert.ok(constraint.includes('قيد الأهلية'), 'it is labelled as a binding constraint, not as data');
  // The two metrics that cannot be steered by the party that owns them.
  assert.ok(constraint.includes('حصة الفئة من إجمالي الحالات'));
  assert.ok(constraint.includes('تقارب نسب المشغّلين'));

  assert.equal(buildFinalDirectives([{ role: 'user', content: 'مرحبا' }], { isFollowUp: false }), '');
  assert.match(constraint, /يُحظر إعادة إنتاج أي فقرة أو جدول أو جملة من الرد السابق/);
});

// ---------------------------------------------------------------
// A follow-up must not be handed the answer it is following up on
// ---------------------------------------------------------------

const PRIOR_REPORT = [
  '### الحكم التنفيذي',
  'أوسع فجوة بين المخطط والفعلي تقع في فئة «حزمة البطارية والجهد العالي» بمقدار 10.5 نقطة مئوية،',
  'والرقم الأهم الذي يلخص حالة المنظومة هو نسبة الرفض الكلية البالغة 3% من أصل 2,450 سجلاً.',
  '',
  '### بؤر تركّز الخلل',
  '| الفئة | العدد | النسبة | الدلالة |',
  '| --- | --- | --- | --- |',
  '| CAB-DASH-MOD | 9 | 5.9% | دال — أعلى من المعدل |',
  '| SUSP-DAMPER-RR | 7 | 4.5% | غير دال |',
  '',
  '### القرارات التنفيذية',
  '1. تطبيق فحص 100% على جميع دفعات المكوّن «CAB-DASH-MOD» وإرجاع الدفعات الحالية إلى المورد.',
  '2. ضبط معايير القياس والتسامح الأبعادي في محطات الفحص لتقليل الانحراف قبل بلوغه حد الرفض.',
  '3. تفعيل بروتوكول التصعيد الفوري لأي مكوّن يتجاوز انحرافه التسامحي 0.15 ملم.'
].join('\n');

/** The longest run of characters the digest shares with the report it indexes. */
function longestSharedRun(source, candidate) {
  let longest = 0;
  for (let start = 0; start < source.length; start += 1) {
    let length = longest + 1;
    while (start + length <= source.length && candidate.includes(source.slice(start, start + length))) {
      longest = length;
      length += 1;
    }
  }
  return longest;
}

test('a follow-up is handed an index of the previous report, never the report', () => {
  const digest = digestPriorReport(PRIOR_REPORT);

  // Enough to identify a section by, and to answer «expand on the third decision».
  assert.ok(digest.includes('الحكم التنفيذي'));
  assert.ok(digest.includes('بؤر تركّز الخلل'));
  assert.ok(digest.includes('القرارات التنفيذية'));
  assert.match(digest, /3\. تفعيل بروتوكول التصعيد/);

  // Not enough to reprint. The prose of the summary and every table row are gone.
  assert.ok(!digest.includes('نسبة الرفض الكلية البالغة 3%'), 'the executive summary is not carried over');
  assert.ok(!digest.includes('SUSP-DAMPER-RR'), 'table rows are not carried over');
  assert.ok(
    longestSharedRun(PRIOR_REPORT, digest) < 100,
    'no long passage of the report survives into the digest'
  );

  // And it says why the text is absent, so the gap does not read as truncation.
  assert.match(digest, /معروض أمام المستخدم/);
});

test('only the reports written about the dossier are indexed', () => {
  const conversation = [
    { role: 'user', content: 'صباح الخير، ما آخر مستجدات ملف التوريد؟' },
    { role: 'assistant', content: 'لا توجد مستجدات مسجلة في هذه الجلسة حتى الآن.' },
    { role: 'user', content: `حلل هذا لي\n\n| الفئة | العدد |\n| --- | --- |\n[نهاية الملف الإحصائي]` },
    { role: 'assistant', content: PRIOR_REPORT },
    { role: 'user', content: 'قدم نصيحة لي' }
  ];

  const digested = digestReportsAfterDossier(conversation);

  assert.equal(digested[1].content, conversation[1].content, 'chat before the dossier is untouched');
  assert.equal(digested[2].content, conversation[2].content, 'the dossier itself is untouched');
  assert.notEqual(digested[3].content, PRIOR_REPORT);
  assert.match(digested[3].content, /previous_answer_digest/);
  assert.equal(digested[4].content, 'قدم نصيحة لي');

  // A conversation with no dossier in it is returned as it came.
  const plain = [{ role: 'user', content: 'مرحبا' }, { role: 'assistant', content: 'أهلاً بك.' }];
  assert.equal(digestReportsAfterDossier(plain), plain);
});

test('a report in an unrecognised shape is described, not indexed and not copied', () => {
  const prose = 'سطر أول من نص متصل بلا عناوين ولا ترقيم على الإطلاق ويمتد طويلاً.\n\nوسطر ثانٍ مثله تماماً.';
  const digest = digestPriorReport(prose);
  assert.ok(longestSharedRun(prose, digest) < 40, 'none of the prose is carried over');
  assert.match(digest, /تقرير سابق من 2 فقرة/);
});

test('the request for raw rows is judged by the question, not by the file beneath it', () => {
  const dossier = '| المكوّن | العدد |\n| CAB-DASH-MOD | 9 |\n[نهاية الملف الإحصائي]';
  const analysisTurn = `حلل هذا لي\n\n[محتوى الملف المرفق: QC.xlsx]\n\`\`\`\n${dossier}\n\`\`\``;

  // The part codes belong to the dossier, not to the question — the question
  // asks for an analysis of the whole file and must not pull raw rows in.
  assert.equal(questionOnly(analysisTurn), 'حلل هذا لي');
  assert.ok(!/\b[A-Z]{2,5}-[A-Z0-9-]{3,}\b/.test(questionOnly(analysisTurn)));

  // A question genuinely about one record still carries its code.
  const recordTurn = `اعرض بيانات الدفعة LOT-2618-350\n\n[محتوى الملف المرفق: QC.xlsx]\n\`\`\`\n${dossier}\n\`\`\``;
  assert.ok(/\b[A-Z]{2,5}-[A-Z0-9-]{3,}\b/.test(questionOnly(recordTurn)));

  // Nothing to strip is not a reason to return nothing.
  assert.equal(questionOnly('ما أعلى نسبة رفض؟'), 'ما أعلى نسبة رفض؟');
});

test('the same dossier arriving twice is a follow-up; a different one is a new analysis', () => {
  const first = `${'ملف إحصائي أول '.repeat(40)}[نهاية الملف الإحصائي]`;
  const second = `${'ملف إحصائي ثانٍ '.repeat(40)}[نهاية الملف الإحصائي]`;

  assert.equal(
    carriesSameDossierAsEarlierTurn([
      { role: 'user', content: `حلل هذا لي\n${first}` },
      { role: 'assistant', content: PRIOR_REPORT },
      { role: 'user', content: `قدم نصيحة لي\n${first}` }
    ]),
    true
  );

  assert.equal(
    carriesSameDossierAsEarlierTurn([
      { role: 'user', content: `حلل هذا لي\n${first}` },
      { role: 'assistant', content: PRIOR_REPORT },
      { role: 'user', content: `وهذا الملف الثاني\n${second}` }
    ]),
    false
  );

  assert.equal(carriesSameDossierAsEarlierTurn([{ role: 'user', content: 'مرحبا' }]), false);
});

test('planned figures are joined to actuals across differently worded labels', () => {
  const planSheet = {
    name: 'Executive Summary',
    headers: ['', 'ANNUAL QC PLAN'],
    rows: [
      ['', 'Subsystem Category', 'Inspected Units', 'Pass Rate Target'],
      ['', 'Battery Pack & High-Voltage (LFP)', '400', '99.5%'],
      ['', 'Chassis & Structural Frame', '400', '99.0%']
    ]
  };

  const headers = ['Subsystem', 'QC Status'];
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(['Battery Pack & HV', i < 20 ? 'Reject' : 'Pass']);
  for (let i = 0; i < 200; i++) rows.push(['Chassis & Structure', i < 10 ? 'Reject' : 'Pass']);

  const profile = profileWorksheet('QC', headers, rows);
  const comparison = buildPlanVsActual([planSheet], [profile]);

  assert.ok(comparison, 'the join must survive labels that do not match literally');
  assert.equal(comparison.outcomeValue, 'Pass', 'a pass-rate target is compared against the pass rate');
  assert.equal(comparison.rows.length, 2);

  // Widest gap first: 99.5 against 90.0 beats 99.0 against 95.0.
  assert.match(comparison.rows[0].matchedTo, /Battery/);
  assert.ok(Math.abs(comparison.rows[0].gap - 9.5) < 0.01);
  assert.ok(Math.abs(comparison.rows[1].gap - 4.0) < 0.01);

  // 800 planned against 400 inspected is a planning-document defect, and is reported as one.
  assert.equal(comparison.countDiscrepancy, true);
  assert.match(formatPlanVsActualMarkdown(comparison), /جودة البيانات/);

  // Unrelated labels must not be joined at all.
  assert.equal(labelSimilarity('Braking & Pneumatic Systems', 'Cabin & Trim'), 0);
});

// ---------------------------------------------------------------
// Where the column names are, what a planned count counts, and who is eligible
// ---------------------------------------------------------------

test('a banner above the column names is read as the title, not as the header', () => {
  const { locateHeaderRow } = require('../server/lib/headerRow');
  const header = ['Inspection ID', 'Line', 'Supplier', 'Component', 'Deviation (mm)', 'QC Status'];
  const data = (i) => [`QC-${i}`, 'Line 1', 'SUP-01', 'CAB-DASH-MOD', '0.02', 'Pass'];

  const bannered = [
    ['', 'AUTOMOTIVE & MANUFACTURING ASSEMBLY QC LOG'],
    ['', 'Commercial Assembly Line & Component Inspection Register'],
    header,
    data(1),
    data(2)
  ];
  const found = locateHeaderRow(bannered);
  assert.equal(found.index, 2);
  assert.deepEqual(found.preamble, [
    'AUTOMOTIVE & MANUFACTURING ASSEMBLY QC LOG',
    'Commercial Assembly Line & Component Inspection Register'
  ]);

  // An ordinary first row is left exactly where it was.
  assert.equal(locateHeaderRow([header, data(1), data(2)]).index, 0);

  // A sheet with no header at all is not given one out of its data.
  assert.equal(locateHeaderRow([['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]).index, 0);

  // A header narrower than the data under it is still the header; the rows of
  // codes below it must not be promoted in its place.
  const narrowHeader = [['Name', 'Code'], ['ALPHA', 'A-1', 'x', 'y'], ['BETA', 'B-2', 'x', 'y']];
  assert.equal(locateHeaderRow(narrowHeader).index, 0);
});

test('a workbook that opens with a banner is still analysed on all its columns', async () => {
  const ExcelJS = require('exceljs');
  const fileService = require('../server/services/fileService');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('QC Inspection Log');
  ws.addRow(['', 'AUTOMOTIVE & MANUFACTURING ASSEMBLY QC LOG']);
  ws.addRow(['', 'Commercial Assembly Line & Component Inspection Register']);
  ws.addRow([]);
  ws.addRow(['Inspection ID', 'Assembly Line', 'Supplier Code', 'Component Code', 'Tolerance Deviation (mm)', 'QC Status']);
  for (let i = 1; i <= 600; i++) {
    const reject = i % 17 === 0;
    ws.addRow([
      `QC-${String(i).padStart(5, '0')}`,
      ['Line 1', 'Line 2', 'Line 3'][i % 3],
      ['SUP-A', 'SUP-B', 'SUP-C', 'SUP-D'][i % 4],
      ['CAB-DASH-MOD', 'BRK-CAL-4P-F', 'SUSP-DAMPER-RR'][i % 3],
      reject ? 0.28 : 0.02,
      reject ? 'Reject' : 'Pass'
    ]);
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const out = await fileService.extract({
    buffer,
    originalname: 'banner.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length
  });
  const text = out.text || '';

  assert.match(text, /عدد الأعمدة:\*\* 6 عمود/, 'all six columns are analysed, not the two cells of the banner');
  assert.match(text, /تقاطع «QC Status» حسب/, 'the log is cross-tabulated');
  assert.match(text, /عنوان الورقة/, 'the banner is kept as the sheet title');
  assert.match(text, /صف أسماء الأعمدة:\*\* السطر 3/);
});

test('a planned production volume is coverage, not a defect in the plan', () => {
  const planOf = (countHeader) => ({
    name: 'Quality Plan',
    headers: ['Component Family', countHeader, 'Target Compliance %'],
    rows: [
      ['Battery Pack & High Voltage', '400', '99.5%'],
      ['Chassis & Structural Frame', '400', '99.0%']
    ]
  });

  const headers = ['Subsystem', 'QC Status'];
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(['Battery Pack & HV', i < 20 ? 'Reject' : 'Pass']);
  for (let i = 0; i < 200; i++) rows.push(['Chassis & Structure', i < 10 ? 'Reject' : 'Pass']);
  const profile = profileWorksheet('QC', headers, rows);

  // 800 vehicles planned, 400 inspections logged: half the plan is covered.
  const volume = buildPlanVsActual([planOf('Planned Volume')], [profile]);
  assert.equal(volume.countsInspections, false);
  assert.equal(volume.countDiscrepancy, false, 'two counts of different things cannot contradict each other');
  assert.ok(Math.abs(volume.coverage - 0.5) < 1e-9);
  const volumeText = formatPlanVsActualMarkdown(volume);
  assert.match(volumeText, /تغطية الفحص/);
  assert.match(volumeText, /نسبة التغطية الإجمالية 50%/);
  assert.ok(!/تعارض يلزم إثباته/.test(volumeText), 'it is not reported as a data-quality defect');

  // A planned number of inspections is the same unit, and a gap is a defect.
  const inspections = buildPlanVsActual([planOf('Planned Inspections')], [profile]);
  assert.equal(inspections.countDiscrepancy, true);
  assert.match(formatPlanVsActualMarkdown(inspections), /جودة البيانات/);
});

test('the eligibility lists say what kind of entity each name is', () => {
  const headers = ['Component', 'Supplier', 'QC Status'];
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push(['BAD-PART', `SUP-${i % 5}`, i < 60 ? 'Reject' : 'Pass']);
  for (let i = 0; i < 300; i++) rows.push(['OK-PART', `SUP-${i % 5}`, i < 9 ? 'Reject' : 'Pass']);

  const dossier = formatDossierAsMarkdown(profileWorksheet('QC', headers, rows), []);
  const line = dossier.split('\n').find((l) => l.includes('[قائمة الأهلية للإجراءات]'));
  assert.ok(line.includes('BAD-PART (Component)'), 'an eligible component is named as a component');

  const constraint = buildFinalDirectives([{ role: 'user', content: `حلل\n${line}\nنهاية` }], { isFollowUp: false });
  assert.match(constraint, /عبر بُعده المذكور بين قوسين/);
  assert.match(constraint, /حصتها من إجمالي السجلات/);
  assert.match(constraint, /بيانات الطاقة الاستيعابية/);
});

test('the retrieval index is evicted by weight, not by number of files', () => {
  // A file's chunks weigh what its rows weigh. Counting files alone let a
  // handful of large workbooks hold gigabytes and exhaust the container.
  const headers = ['id', 'payload'];
  const wide = 'x'.repeat(400);

  const before = chunkCacheStats();
  const hashes = [];
  for (let f = 0; f < 3; f++) {
    const rows = [];
    for (let r = 0; r < 400; r++) rows.push([`R${f}-${r}`, wide]);
    const hash = `weight-test-${f}`;
    hashes.push(hash);
    chunkTable(hash, 'S', headers, rows, 100);
  }

  const after = chunkCacheStats();
  assert.ok(after.approxBytes > before.approxBytes, 'the index must account for what it holds');
  assert.ok(after.approxBytes >= 3 * 400 * 400, 'the accounting must reflect the actual payload size');
  assert.ok(after.budgetBytes > 0, 'a byte budget must exist');

  for (const h of hashes) clearChunks(h);
  const cleared = chunkCacheStats();
  assert.ok(cleared.approxBytes <= before.approxBytes + 1, 'clearing a file must return its weight to the budget');
});

test('a column too varied to cross-tabulate is reported, never silently dropped', () => {
  const headers = ['Supplier', 'Lot', 'QC Status'];
  const rows = [];
  // 80 suppliers is ordinary variety at scale and must be analysed; 4,000 lot
  // numbers is beyond what a contingency table can say anything about, but its
  // absence has to be visible or a reader will assume it was cleared.
  for (let r = 0; r < 8000; r++) {
    rows.push([`SUP-${r % 80}`, `LOT-${r % 4000}`, r % 25 === 0 ? 'Reject' : 'Pass']);
  }

  const profile = profileWorksheet('QC', headers, rows);
  const analysed = (profile.crossTabulations.crossTabs || []).map((c) => c.groupColName);
  assert.ok(analysed.includes('Supplier'), '80 distinct values is a dimension, not an identifier');

  const dossier = formatDossierAsMarkdown(profile, []);
  assert.match(dossier, /أعمدة عالية التنوّع لم تدخل مصفوفة التقاطعات/);
  assert.match(dossier, /Lot/);
  assert.match(dossier, /لا يجوز نفي وجود تركّز فيها/);
});
