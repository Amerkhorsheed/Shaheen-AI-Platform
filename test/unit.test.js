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



